import path from 'path'
import { app, session, shell, BrowserWindow, globalShortcut, powerMonitor } from 'electron'
import { createWindow } from './helpers'
import Store from 'electron-store'
import fs from 'fs'
import log from 'electron-log'
import type { AppSettings } from './types/settings'
import {
  startLocalServer,
  handleDeepLink,
  initPermissions,
  initTray,
  initUpdater,
  prewarmBadgeCache,
  initBadge,
  registerIpcHandlers,
  getAppLocale,
  getI18n,
  startRpcPolling,
  stopRpcPolling,
} from './services'

// Route console.* to electron-log — writes to %APPDATA%\BloumeChat\logs\main.log in production
log.transports.file.level = 'info'
Object.assign(console, log.functions)

// --- Config ---
const configPath = path.join(__dirname, '../config.json')
let appConfig: Record<string, unknown> = {}
try {
  appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
} catch {
  console.error('[Config] No config.json found or invalid format.')
}

const isProd = appConfig.IS_PROD !== undefined
  ? appConfig.IS_PROD === true || appConfig.IS_PROD === 'true'
  : process.env.NODE_ENV === 'production'

if (process.platform === 'win32') {
  app.setAppUserModelId('com.bloumechat.app')
}

// Allow cookies in iframes (SameSite workaround for embedded Cloudflare challenges)
app.commandLine.appendSwitch('disable-features', 'SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure')

// --- Custom Protocol ---
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('bloumechat', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('bloumechat')
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) app.quit()

const settingsStore = new Store<AppSettings>({ name: 'bloumechat-settings' })

let mainWindow: BrowserWindow | null = null
let tray: Electron.Tray | null = null
let server: import('http').Server | null = null
let prodPort = 0
let isAppQuitting = false

function getMainWindow() { return mainWindow }
function getTray() { return tray }
function getProdPort() { return prodPort }

function getDevPort() {
  const args = process.argv.slice(1)
  const portArg = args.find(arg => /^\d+$/.test(arg))
  const port = portArg ? parseInt(portArg, 10) : 8899
  console.log(`[Startup] Detected dev port: ${port}`)
  return port
}
const DEV_PORT = getDevPort()

function getAppIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icon.png')
}

function setAutoLaunch(enable: boolean) {
  try {
    const settings: { openAtLogin: boolean; path: string; args: string[] } = {
      openAtLogin: enable,
      path: app.getPath('exe'),
      args: ['--hidden'],
    }
    if (!app.isPackaged) settings.args = [app.getAppPath(), '--hidden']
    app.setLoginItemSettings(settings)
    settingsStore.set('autoLaunch', enable)
  } catch (error) {
    console.error('[AutoLaunch] Failed to set:', error)
  }
}

if (!isProd) {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

;(async () => {
  await app.whenReady()
  app.userAgentFallback = 'BloumeChat/App'

  // Resolve tray icon path once — reused by initBadge + initTray
  const trayIconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, trayIconFile)
    : path.join(app.getAppPath(), 'resources', trayIconFile)
  initBadge(trayIconPath)
  prewarmBadgeCache()

  if (app.isPackaged && isProd) {
    try {
      const result = await startLocalServer(path.join(__dirname))
      server = result.server
      prodPort = result.port
    } catch (e) {
      console.error('[Server] Failed to start:', e)
    }
  }

  const mainSession = session.fromPartition('persist:main')
  initPermissions(
    mainSession,
    getMainWindow,
    () => app.isPackaged ? prodPort : DEV_PORT,
    app.isPackaged
  )

  mainWindow = createWindow('main', {
    width: 1200,
    height: 800,
    titleBarStyle: 'hidden',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'icon.png')
      : path.join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      partition: 'persist:main',
      webSecurity: true,
      devTools: !isProd,
      spellcheck: true,
    },
  })

  // Suppress native context menu so React onContextMenu handlers fire unobstructed
  mainWindow.webContents.on('context-menu', e => e.preventDefault())

  if (settingsStore.get('wasMaximized', false)) mainWindow.maximize()

  const savedZoom = settingsStore.get('zoomLevel', 0)
  mainWindow.webContents.setZoomLevel(savedZoom)

  // Tray (reuses trayIconPath resolved above)
  tray = initTray(trayIconPath, settingsStore, getMainWindow, setAutoLaunch, v => { isAppQuitting = v })

  // IPC
  registerIpcHandlers(getMainWindow, getTray, settingsStore, appConfig, setAutoLaunch, getAppIconPath)

  // Rich Presence — Windows (PowerShell) + macOS (osascript)
  if (process.platform === 'win32' || process.platform === 'darwin') {
    startRpcPolling(getMainWindow, () => settingsStore.get('rpcEnabled', true))
  }

  // Lock / unlock screen — pause and resume RPC activity polling
  powerMonitor.on('lock-screen', () => {
    console.log('[RPC] Screen locked — pausing activity polling')
    stopRpcPolling()
    getMainWindow()?.webContents.send('rpc:activity', { type: 'none', name: '' })
  })
  powerMonitor.on('unlock-screen', () => {
    console.log('[RPC] Screen unlocked — resuming activity polling')
    if (settingsStore.get('rpcEnabled', true)) {
      startRpcPolling(getMainWindow, () => settingsStore.get('rpcEnabled', true))
    }
  })

  // Updater
  initUpdater(getMainWindow, getAppIconPath, getProdPort, isProd)

  // Load app URL
  const homeUrl = app.isPackaged && isProd
    ? `http://127.0.0.1:${prodPort}/home/`
    : `http://localhost:${DEV_PORT}/home/`

  await mainWindow.loadURL(homeUrl).catch(err => console.error('[Window] Failed to load URL:', err))

  // Navigation whitelist
  const remoteOrigin = String(appConfig.NEXT_PUBLIC_SITE_URL || 'https://bloumechat.com')
  const remoteOriginWww = remoteOrigin.replace('https://', 'https://www.').replace('http://', 'http://www.')

  const isAllowedUrl = (url: string): boolean => {
    const port = isProd ? prodPort : DEV_PORT
    return (
      url.startsWith(`http://127.0.0.1:${port}`) ||
      url.startsWith(`http://localhost:${port}`) ||
      url.startsWith(remoteOrigin) ||
      url.startsWith(remoteOriginWww) ||
      url.startsWith('https://challenges.cloudflare.com')
    )
  }

  /** Only allow http/https through openExternal — blocks file://, javascript://, etc. */
  const safeOpen = (url: string) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    else log.warn('[Navigation] Blocked unsafe URL:', url)
  }

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedUrl(url)) { event.preventDefault(); safeOpen(url) }
  })
  mainWindow.webContents.on('will-frame-navigate', event => {
    if (event.frame === mainWindow?.webContents.mainFrame) return
    if (!isAllowedUrl(event.url)) { event.preventDefault(); safeOpen(event.url) }
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedUrl(url)) { safeOpen(url); return { action: 'deny' } }
    return { action: 'allow' }
  })

  // Global shortcuts
  globalShortcut.register('CommandOrControl+Shift+B', () => {
    if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide()
    else { mainWindow?.show(); mainWindow?.focus() }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!input.control || input.alt || input.shift) return
    if (input.key === '=' || input.key === '+') {
      event.preventDefault()
      const newZoom = Math.min((mainWindow?.webContents.getZoomLevel() || 0) + 0.5, 5)
      mainWindow?.webContents.setZoomLevel(newZoom)
      settingsStore.set('zoomLevel', newZoom)
    } else if (input.key === '-') {
      event.preventDefault()
      const newZoom = Math.max((mainWindow?.webContents.getZoomLevel() || 0) - 0.5, -3)
      mainWindow?.webContents.setZoomLevel(newZoom)
      settingsStore.set('zoomLevel', newZoom)
    } else if (input.key === '0') {
      event.preventDefault()
      mainWindow?.webContents.setZoomLevel(0)
      settingsStore.set('zoomLevel', 0)
    }
  })

  app.on('before-quit', () => { isAppQuitting = true })

  mainWindow.on('close', event => {
    if (isAppQuitting) return
    const minimizeToTray = settingsStore.get('minimizeToTray', true)
    if (!minimizeToTray) return

    event.preventDefault()
    settingsStore.set('wasMaximized', mainWindow?.isMaximized() || false)
    mainWindow?.hide()

    if (!settingsStore.get('trayNoticeShown', false)) {
      const i18n = getI18n(getAppLocale())
      tray?.displayBalloon({ iconType: 'info', title: 'BloumeChat', content: i18n.trayNotice })
      settingsStore.set('trayNoticeShown', true)
    }
  })

  if (process.argv.includes('--hidden')) mainWindow.hide()

  const storedAutoLaunch = settingsStore.get('autoLaunch', false)
  if (storedAutoLaunch) setAutoLaunch(true)
})()

// Second instance — deep link + focus
app.on('second-instance', (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  const deepLinkUrl = commandLine.find(arg => arg.startsWith('bloumechat://'))
  if (deepLinkUrl) handleDeepLink(deepLinkUrl, mainWindow)
})

// macOS deep link
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url, mainWindow)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopRpcPolling()
  if (server) server.close(() => console.log('[Server] Closed.'))
})

if (process.platform === 'win32') {
  ;(app as any).on('session-end', () => { isAppQuitting = true; app.quit() })
}
