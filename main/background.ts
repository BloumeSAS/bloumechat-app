import path from 'path'
import { app, ipcMain, session, shell, Tray, Menu, nativeImage, BrowserWindow, Notification, globalShortcut, clipboard, desktopCapturer } from 'electron'
import { createWindow } from './helpers'
import { autoUpdater } from 'electron-updater'
import Store from 'electron-store'
import fs from 'fs'
import http from 'http'

// --- Configuration Reading ---
const configPath = path.join(__dirname, '../config.json');
let appConfig: any = {}
try {
  appConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
} catch (e) {
  console.error("No config.json found or invalid format.")
}

// Environment Determination (Prefer config.json, fallback to Node env)
const isProd = appConfig.IS_PROD !== undefined
  ? appConfig.IS_PROD === true || appConfig.IS_PROD === 'true'
  : process.env.NODE_ENV === 'production'

// Set Windows App User Model ID — controls the name shown in notifications
if (process.platform === 'win32') {
  app.setAppUserModelId('com.bloumechat.app')
}

// FIX: Allow cookies in iframes for local development (SameSite issue)
// This solves the infinite challenge loop when the site is embedded in the app
app.commandLine.appendSwitch('disable-features', 'SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure');

// --- Custom Protocol: bloumechat:// ---
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('bloumechat', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('bloumechat')
}

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
}

// Persistent settings store
const settingsStore = new Store<{
  autoLaunch: boolean
  zoomLevel: number
  wasMaximized: boolean
  trayNoticeShown: boolean
}>({ name: 'bloumechat-settings' })

let tray: Tray | null = null;
let mainWindow: BrowserWindow | null = null;
let server: http.Server | null = null;
let prodPort: number = 0;
let voiceBadgeInterval: NodeJS.Timeout | null = null
let isVoiceBadgeOn = false
let currentBadgeCount = 0
let isAppQuitting = false;

// --- Port Detection for Development ---
function getDevPort() {
  // Nextron usually passes the port as the first argument after electron .
  // We search specifically for a number to avoid deep link URLs or other flags
  const args = process.argv.slice(1)
  const portArg = args.find(arg => /^\d+$/.test(arg))
  const port = portArg ? parseInt(portArg, 10) : 8899
  console.log(`[Startup] Detected dev port: ${port} (from argv: ${JSON.stringify(process.argv)})`)
  return port
}
const DEV_PORT = getDevPort()

// --- Minimal i18n for main process (FR / EN) ---
const mainProcessI18n = {
  fr: {
    updateTitle: 'BloumeChat — Mise à jour disponible',
    updateBody: (version: string) => `La version ${version} est disponible. Cliquez pour mettre à jour.`,
    trayNotice: "BloumeChat continue de tourner en arrière-plan. Cliquez sur l'icône pour rouvrir.",
    trayOpen: 'Ouvrir BloumeChat',
    trayAutoLaunch: 'Lancer au démarrage',
    trayCheckUpdates: 'Vérifier les mises à jour (Store)',
    trayReload: 'Recharger',
    trayQuit: 'Quitter',
  },
  en: {
    updateTitle: 'BloumeChat — Update available',
    updateBody: (version: string) => `Version ${version} is available. Click to update.`,
    trayNotice: "BloumeChat is still running in the background. Click the icon to reopen.",
    trayOpen: 'Open BloumeChat',
    trayAutoLaunch: 'Launch at startup',
    trayCheckUpdates: 'Check for updates (Store)',
    trayReload: 'Reload',
    trayQuit: 'Quit',
  },
} as const;

type AppLocale = keyof typeof mainProcessI18n;

function getAppLocale(): AppLocale {
  // Prefer stored language (set by renderer via IPC in the future)
  // For now, fall back to system locale
  const locale = app.getLocale()?.toLowerCase() || 'fr';
  return locale.startsWith('fr') ? 'fr' : 'en';
}


if (!isProd) {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.woff': 'application/font-woff',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.otf': 'application/font-otf',
  '.wasm': 'application/wasm'
};

const PROD_PORT = 15999; // Fixed port for stable Origin and data persistence

async function startLocalServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let pathname = new URL(req.url || '', `http://${req.headers.host}`).pathname;

      // Normalize pathname for Next.js static export
      if (pathname === '/' || pathname === '') pathname = '/home/index.html';
      else if (pathname === '/home' || pathname === '/home/') pathname = '/home/index.html';
      else if (pathname === '/update' || pathname === '/update/') pathname = '/update/index.html';
      else if (pathname === '/screen-picker' || pathname === '/screen-picker/') pathname = '/screen-picker/index.html';
      else if (!pathname.includes('.')) {
        if (fs.existsSync(path.join(__dirname, pathname + '.html'))) {
          pathname += '.html';
        } else if (fs.existsSync(path.join(__dirname, pathname + '/index.html'))) {
          pathname += '/index.html';
        }
      }

      const filePath = path.join(__dirname, pathname);
      const extname = String(path.extname(filePath)).toLowerCase();
      const contentType = MIME_TYPES[extname] || 'application/octet-stream';

      fs.readFile(filePath, (error, content) => {
        if (error) {
          if (error.code === 'ENOENT') {
            res.writeHead(404);
            res.end('File not found');
          } else {
            res.writeHead(500);
            res.end('Internal server error: ' + error.code);
          }
        } else {
          res.writeHead(200, { 'Content-Type': contentType });
          res.end(content, 'utf-8');
        }
      });
    });

    server.listen(PROD_PORT, '127.0.0.1', () => {
      console.log(`Production server running at http://127.0.0.1:${PROD_PORT}`);
      resolve(PROD_PORT);
    });

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PROD_PORT} is already in use. Persistence might be affected if we fallback.`);
        reject(err);
      } else {
        reject(err);
      }
    });
  });
}

// --- Handle deep link from protocol (bloumechat://channel/xxx) ---
function handleDeepLink(url: string) {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()

  // Parse the protocol URL: bloumechat://channel/<publicId> or bloumechat://server/<publicId>
  try {
    const parsed = new URL(url)
    const action = parsed.hostname // 'channel', 'server', etc.
    const id = parsed.pathname.replace(/^\//, '')

    if (action) {
      // Pass both action, id, and any query parameters (like ?token=...)
      const queryParams = Object.fromEntries(parsed.searchParams.entries())
      mainWindow.webContents.send('deep-link', { action, id, queryParams })
    }
  } catch (e) {
    console.error('Failed to parse deep link:', url)
  }
}

// --- Auto-launch helper ---
function setAutoLaunch(enable: boolean) {
  try {
    const settings: any = {
      openAtLogin: enable,
      path: app.getPath('exe'),
      args: ['--hidden']
    }

    if (!app.isPackaged) {
      // In development, we need to pass the app path as the first argument to electron.exe
      settings.args = [app.getAppPath(), '--hidden']
    }

    app.setLoginItemSettings(settings)
    settingsStore.set('autoLaunch', enable)
  } catch (error) {
    console.error('Failed to set auto-launch:', error)
  }
}

// --- Build tray context menu (dynamic for auto-launch toggle) ---
function buildTrayMenu() {
  const isAutoLaunch = settingsStore.get('autoLaunch', false)
  const i18n = mainProcessI18n[getAppLocale()]

  return Menu.buildFromTemplate([
    { label: i18n.trayOpen, click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    {
      label: i18n.trayAutoLaunch,
      type: 'checkbox',
      checked: isAutoLaunch,
      click: (menuItem) => {
        setAutoLaunch(menuItem.checked)
        tray?.setContextMenu(buildTrayMenu())
      }
    },
    { type: 'separator' },
    {
      // Microsoft Store handles updates for MSIX builds — just open the Store page
      label: i18n.trayCheckUpdates,
      click: () => shell.openExternal('ms-windows-store://pdp/?productid=XPDBZMTB5GVG3L')
    },
    { label: i18n.trayReload, click: () => mainWindow?.webContents.reload() },
    { type: 'separator' },
    { label: i18n.trayQuit, click: () => { isAppQuitting = true; app.quit() } }
  ])
}

; (async () => {
  await app.whenReady()
  // Set a browser-like User Agent to avoid Cloudflare detection issues while keeping our identifier
  const chromeVersion = process.versions.chrome;
  app.userAgentFallback = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36 BloumeChat/App`


  // ONLY start the local static server if the app is packaged.
  // This prevents conflicts when IS_PROD is true in config.json during development.
  if (app.isPackaged && isProd) {
    try {
      prodPort = await startLocalServer();
    } catch (e) {
      console.error("Failed to start local production server:", e);
    }
  }

  // Define allowed media permissions
  const allowedPermissions = [
    'media',
    'mediaKeySystem',
    'display-capture',
    'notifications',
    'fullscreen',
    'clipboard-read',
    'clipboard-write',
    'clipboard-sanitized-write'
  ]

  const mainSession = session.fromPartition('persist:main')

  mainSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const isAllowed = allowedPermissions.includes(permission)
    console.log(`[Permissions] Request for: ${permission} -> ${isAllowed ? "GRANTED" : "DENIED"}`)
    callback(isAllowed)
  })

  mainSession.setPermissionCheckHandler((webContents, permission) => {
    const isAllowed = allowedPermissions.includes(permission)
    // console.log(`[Permissions] Check for: ${permission} -> ${isAllowed ? "GRANTED" : "DENIED"}`)
    return isAllowed
  })

  // Explicitly handle display capture requests (Screen Share)
  mainSession.setDisplayMediaRequestHandler((request, callback) => {
    let callbackCalled = false
    const smartCallback = (cfg?: any) => {
      if (callbackCalled) return
      callbackCalled = true
      try {
        if (cfg && (cfg.video || cfg.audio)) {
          console.log("[ScreenShare] Resolving media request with config")
          callback(cfg)
        } else {
          console.log("[ScreenShare] Cancelling media request (no source provided)")
          ;(callback as any)() // Correct way to cancel in some Electron versions
        }
      } catch (err) {
        console.error("[ScreenShare] Exception in media callback:", err)
      }
    }

    // Create a picker window
    const pickerWin = new BrowserWindow({
      width: 600,
      height: 500,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      modal: true,
      parent: mainWindow || undefined,
      backgroundColor: '#111C44',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        devTools: !app.isPackaged
      }
    })

    // Use app.isPackaged to decide between prod port (15999) and dev port (8899)
    const port = app.isPackaged ? prodPort : DEV_PORT
    const url = app.isPackaged
      ? `http://127.0.0.1:${port}/screen-picker/index.html`
      : `http://localhost:${port}/screen-picker/`

    console.log("[ScreenShare] Loading picker URL:", url)

    pickerWin.loadURL(url).catch(err => {
      console.error("[ScreenShare] Failed to load picker URL:", err)
      smartCallback({})
      if (!pickerWin.isDestroyed()) pickerWin.close()
    })

    const onSelect = (_event: any, sourceId: string) => {
      console.log("[ScreenShare] Source selected:", sourceId)
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        const source = sources.find(s => s.id === sourceId)
        if (source) {
          console.log("[ScreenShare] Source found, granting access")
          smartCallback({ video: source, audio: 'loopback' })
        } else {
          console.error("[ScreenShare] Selected source not found anymore")
          smartCallback({})
        }
        cleanup()
      }).catch(err => {
        console.error("[ScreenShare] Error getting sources for callback:", err)
        smartCallback({})
        cleanup()
      })
    }

    const onCancel = () => {
      console.log("[ScreenShare] Picker cancelled by user button")
      smartCallback()
      cleanup()
    }

    const cleanup = () => {
      ipcMain.removeListener('select-screen-source', onSelect)
      ipcMain.removeListener('cancel-screen-source', onCancel)
      smartCallback() // Ensure request is terminated if window is just closed
      if (pickerWin && !pickerWin.isDestroyed()) {
        pickerWin.close()
      }
    }

    ipcMain.on('select-screen-source', onSelect)
    ipcMain.on('cancel-screen-source', onCancel)

    pickerWin.on('closed', cleanup)
  })

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
      spellcheck: true
    },
  })

  // --- Restore maximized state ---
  if (settingsStore.get('wasMaximized', false)) {
    mainWindow.maximize()
  }

  // --- Restore zoom level ---
  const savedZoom = settingsStore.get('zoomLevel', 0)
  mainWindow.webContents.setZoomLevel(savedZoom)

  // --- Tray Setup ---
  const trayIconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, trayIconFile)
    : path.join(app.getAppPath(), 'resources', trayIconFile)

  if (!fs.existsSync(iconPath)) {
    console.error(`[Tray] Icon not found at: ${iconPath}`)
  }

  const rawIcon = nativeImage.createFromPath(iconPath)
  const trayIcon = rawIcon.isEmpty()
    ? nativeImage.createEmpty()
    : rawIcon.resize({ width: 24, height: 24 })

  tray = new Tray(trayIcon)
  tray.setToolTip('BloumeChat')
  tray.setContextMenu(buildTrayMenu())

  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.focus()
    else mainWindow?.show()
  })

  if (app.isPackaged && isProd) {
    await mainWindow.loadURL(`http://127.0.0.1:${prodPort}/home/`).catch(err => {
      console.error("Failed to load production URL:", err)
    })
  } else {
    await mainWindow.loadURL(`http://localhost:${DEV_PORT}/home/`).catch(err => {
      console.error("Failed to load development URL:", err)
    })
  }

  // --- Handle Links and Navigation ---
  const remoteOrigin: string = appConfig.NEXT_PUBLIC_SITE_URL || 'https://bloumechat.com';
  // Derive www variant in case the site redirects to/from www
  const remoteOriginWww = remoteOrigin.replace('https://', 'https://www.').replace('http://', 'http://www.');

  const isAllowedUrl = (url: string): boolean => {
    // In development, allow any local port to avoid mismatches
    if (!app.isPackaged && (url.startsWith('http://localhost:') || url.startsWith('http://127.0.0.1:'))) {
      return true;
    }

    const port = (app.isPackaged && isProd) ? prodPort : DEV_PORT;
    const localOrigin = `http://127.0.0.1:${port}`;
    const devOrigin = `http://localhost:${port}`;
    
    const allowed = (
      url.startsWith(localOrigin) ||
      url.startsWith(devOrigin) ||
      url.startsWith(remoteOrigin) ||
      url.startsWith(remoteOriginWww) ||
      url.startsWith('https://challenges.cloudflare.com')
    );

    if (!allowed && (url.startsWith('http:') || url.startsWith('https:'))) {
      console.log(`[Navigation] URL rejected (opening externally): ${url}`);
    }

    return allowed;
  };

  const isExternalUrl = (url: string): boolean => {
    if (!url.startsWith('https:') && !url.startsWith('http:')) return false;
    return !isAllowedUrl(url);
  };

  // Handle top-level window navigation (main frame only — not iframes)
  // Using 'will-navigate' which only fires for the main frame
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isExternalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Handle navigations within sub-frames (iframes)
  // Only intercept truly external URLs — let bloumechat.com & local server navigate freely
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    // Skip the main frame — handled by will-navigate above
    if (event.frame === mainWindow?.webContents.mainFrame) return;
    if (isExternalUrl(event.url)) {
      event.preventDefault();
      shell.openExternal(event.url);
    }
  });

  // Handle window.open and target="_blank"
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // --- Notification bridge with taskbar flash ---
  const appIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(app.getAppPath(), 'resources', 'icon.png')
  const appIcon = nativeImage.createFromPath(appIconPath)

  ipcMain.on('show-notification', (event, data: { title: string; body: string; icon?: string; channelPublicId: string; serverPublicId?: string; authorPublicId?: string }) => {
    const notification = new Notification({
      title: data.title,
      body: data.body,
      icon: data.icon ? nativeImage.createFromDataURL(data.icon) : appIcon
    })

    // Flash taskbar when app is not focused
    if (mainWindow && !mainWindow.isFocused()) {
      mainWindow.flashFrame(true)
    }

    notification.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
      mainWindow?.flashFrame(false) // Stop flashing on click
      mainWindow?.webContents.send('notification-click', {
        channelPublicId: data.channelPublicId,
        serverPublicId: data.serverPublicId,
        authorPublicId: data.authorPublicId
      })
    })

    notification.show()
  })

  // --- Unread badge count from iframe ---
  ipcMain.on('set-badge-count', (_event, count: number) => {
    currentBadgeCount = count
    if (process.platform === 'win32' && mainWindow) {
      if (count > 0) {
        const badgeIcon = createBadgeIcon(count)
        if (badgeIcon) {
          mainWindow.setOverlayIcon(badgeIcon, `${count} message(s) non lu(s)`)
        }
      } else if (!voiceBadgeInterval) {
        mainWindow.setOverlayIcon(null, '')
      }
    }
    app.setBadgeCount(count)
  })

  ipcMain.on('set-voice-active', (_event, active: boolean) => {
    if (process.platform !== 'win32' || !mainWindow) return

    if (active) {
      if (voiceBadgeInterval) return // Already running

      voiceBadgeInterval = setInterval(() => {
        isVoiceBadgeOn = !isVoiceBadgeOn
        if (isVoiceBadgeOn) {
          const voiceIcon = createVoiceBadgeIcon()
          mainWindow?.setOverlayIcon(voiceIcon, 'Vocal actif')
        } else {
          // Fallback to message badge or null
          if (currentBadgeCount > 0) {
            mainWindow?.setOverlayIcon(createBadgeIcon(currentBadgeCount), `${currentBadgeCount} message(s) non lu(s)`)
          } else {
            mainWindow?.setOverlayIcon(null, '')
          }
        }
      }, 800)
    } else {
      if (voiceBadgeInterval) {
        clearInterval(voiceBadgeInterval)
        voiceBadgeInterval = null
      }
      isVoiceBadgeOn = false
      // Restore message badge or null
      if (currentBadgeCount > 0) {
        mainWindow.setOverlayIcon(createBadgeIcon(currentBadgeCount), `${currentBadgeCount} message(s) non lu(s)`)
      } else {
        mainWindow.setOverlayIcon(null, '')
      }
    }
  })

  // Stop flashing when window is focused
  mainWindow.on('focus', () => {
    mainWindow?.flashFrame(false)
  })

  // --- Global Shortcut: Ctrl+Shift+B to toggle BloumeChat ---
  globalShortcut.register('CommandOrControl+Shift+B', () => {
    if (mainWindow?.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      mainWindow?.focus()
    }
  })

  // --- Zoom: Ctrl+Plus / Ctrl+Minus / Ctrl+0 ---
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && !input.alt && !input.shift) {
      if (input.key === '=' || input.key === '+') {
        event.preventDefault()
        const current = mainWindow?.webContents.getZoomLevel() || 0
        const newZoom = Math.min(current + 0.5, 5)
        mainWindow?.webContents.setZoomLevel(newZoom)
        settingsStore.set('zoomLevel', newZoom)
      } else if (input.key === '-') {
        event.preventDefault()
        const current = mainWindow?.webContents.getZoomLevel() || 0
        const newZoom = Math.max(current - 0.5, -3)
        mainWindow?.webContents.setZoomLevel(newZoom)
        settingsStore.set('zoomLevel', newZoom)
      } else if (input.key === '0') {
        event.preventDefault()
        mainWindow?.webContents.setZoomLevel(0)
        settingsStore.set('zoomLevel', 0)
      }
    }
  })

  // Auto-update check disabled on startup — user can check manually via tray menu

  app.on('before-quit', () => { isAppQuitting = true })

  // --- Save maximized state & show tray notice on close ---
  mainWindow.on('close', (event) => {
    if (!isAppQuitting) {
      const minimizeToTray = settingsStore.get('minimizeToTray', true)
      
      if (minimizeToTray) {
        event.preventDefault()

        // Save maximized state before hiding
        settingsStore.set('wasMaximized', mainWindow?.isMaximized() || false)

        mainWindow?.hide()

        // Show tray notification only the first time
        if (!settingsStore.get('trayNoticeShown', false)) {
          const i18n = mainProcessI18n[getAppLocale()];
          tray?.displayBalloon({
            iconType: 'info',
            title: 'BloumeChat',
            content: i18n.trayNotice,
          })
          settingsStore.set('trayNoticeShown', true)
        }
      }
    }
  })

  // --- Handle --hidden flag (auto-launch starts hidden) ---
  if (process.argv.includes('--hidden')) {
    mainWindow.hide()
  }

  // --- Heal / Apply Auto-Launch Settings on Startup ---
  // This ensures the registry path is updated if the app was moved or updated
  const storedAutoLaunch = settingsStore.get('autoLaunch', false)
  if (storedAutoLaunch) {
    setAutoLaunch(true)
  }

})()

// --- Handle second instance (single instance lock + deep link) ---
app.on('second-instance', (event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }

  // Handle deep link from second instance
  const deepLinkUrl = commandLine.find(arg => arg.startsWith('bloumechat://'))
  if (deepLinkUrl) {
    handleDeepLink(deepLinkUrl)
  }
})

// Handle deep link on macOS
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleDeepLink(url)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (server) {
    server.close(() => {
      console.log('Local server closed.')
    })
  }
})

// Handle Windows shutdown/logout (session-end)
if (process.platform === 'win32') {
  ; (app as any).on('session-end', () => {
    isAppQuitting = true
    app.quit()
  })
}

ipcMain.on('window-minimize', () => { BrowserWindow.getFocusedWindow()?.minimize() })
ipcMain.on('window-maximize', () => {
  const win = BrowserWindow.getFocusedWindow()
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
ipcMain.on('window-close', () => { BrowserWindow.getFocusedWindow()?.close() })
ipcMain.handle('get-env', (event, key: string) => appConfig[key] || process.env[key])
ipcMain.handle('get-platform', () => process.platform)

// --- Auto-Launch IPC ---
ipcMain.handle('get-auto-launch', () => settingsStore.get('autoLaunch', false))
ipcMain.on('set-auto-launch', (_event, enable: boolean) => setAutoLaunch(enable))

// --- Clipboard IPC ---
ipcMain.on('write-clipboard', (_event, text: string) => {
  clipboard.writeText(text)
})

// --- Zoom IPC ---
ipcMain.handle('get-zoom-level', () => mainWindow?.webContents.getZoomLevel() || 0)
ipcMain.on('set-zoom-level', (_event, level: number) => {
  mainWindow?.webContents.setZoomLevel(level)
  settingsStore.set('zoomLevel', level)
})

// --- Tray IPC ---
ipcMain.handle('get-minimize-to-tray', () => settingsStore.get('minimizeToTray', true))
ipcMain.on('set-minimize-to-tray', (_event, enable: boolean) => {
  settingsStore.set('minimizeToTray', enable)
})

// --- Screen Picker IPC ---
ipcMain.handle('get-screen-sources', async () => {
  console.log("[ScreenShare] Fetching sources for picker UI...")
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true
    })
    console.log(`[ScreenShare] Found ${sources.length} sources.`)
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }))
  } catch (err) {
    console.error("[ScreenShare] Failed to get sources for IPC:", err)
    return []
  }
})

// --- Auto-Updater IPC Bridge ---
let isUpdateIgnored = false;

// Disable strict SSL checks for auto-updater to bypass untrusted root cert errors
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
autoUpdater.requestHeaders = { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" };
autoUpdater.autoDownload = false; // Require explicit user interaction to download
// TEMPORARY: Disable publisher signature verification — the current code signing certificate
// is self-signed (not issued by a trusted CA), which causes electron-updater to reject
// updates with "not signed by the application owner" (Windows status UntrustedRoot).
// Replace this with a CA-trusted OV/EV certificate to re-enable verification.
(autoUpdater as any).verifyUpdateCodeSignature = false;

autoUpdater.on('checking-for-update', () => mainWindow?.webContents.send('update-status', { status: 'checking' }))
autoUpdater.on('update-available', (info) => {
  console.log('Update available:', info.version);
  mainWindow?.webContents.send('update-status', { status: 'available', info });

  if (isUpdateIgnored) return;

  const i18n = mainProcessI18n[getAppLocale()];

  // Show a system notification instead of auto-redirecting to the update page
  const updateNotification = new Notification({
    title: i18n.updateTitle,
    body: i18n.updateBody(info.version),
    icon: nativeImage.createFromPath(
      app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(app.getAppPath(), 'resources', 'icon.png')
    )
  });

  updateNotification.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
    const port = isProd ? prodPort : (process.argv[2] || 8899);
    const updateUrl = isProd
      ? `http://127.0.0.1:${port}/update`
      : `http://localhost:${port}/update`;
    mainWindow?.loadURL(updateUrl);
  });

  updateNotification.show();
})

ipcMain.on('ignore-update', () => {
  isUpdateIgnored = true;
})
autoUpdater.on('update-not-available', (info) => mainWindow?.webContents.send('update-status', { status: 'not-available', info }))
autoUpdater.on('error', (err) => mainWindow?.webContents.send('update-status', { status: 'error', message: err.message }))
autoUpdater.on('download-progress', (progressObj) => mainWindow?.webContents.send('update-status', { status: 'downloading', progress: progressObj }))
autoUpdater.on('update-downloaded', (info) => mainWindow?.webContents.send('update-status', { status: 'downloaded', info }))
ipcMain.on('quit-and-install', () => { autoUpdater.quitAndInstall(true, true) })
ipcMain.on('start-download', () => { autoUpdater.downloadUpdate() })
ipcMain.on('check-for-updates', () => { autoUpdater.checkForUpdatesAndNotify() })
ipcMain.on('simulate-update', () => {
  mainWindow?.webContents.send('update-status', {
    status: 'available',
    info: { version: '9.9.9' }
  })
})

// --- Badge Icon Generator (SVG-based, no native deps) ---
function createBadgeIcon(count: number): Electron.NativeImage | null {
  try {
    const label = count > 99 ? '99+' : String(count)
    const size = 16
    const fontSize = label.length > 2 ? 8 : 10

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#e53e3e"/>
        <text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="central"
              fill="white" font-family="Arial,sans-serif" font-weight="bold" font-size="${fontSize}">
          ${label}
        </text>
      </svg>
    `.trim()

    return nativeImage.createFromBuffer(Buffer.from(svg, 'utf-8'), { scaleFactor: 2.0 })
  } catch (e) {
    console.error('Failed to create badge icon:', e)
    return null
  }
}

function createVoiceBadgeIcon(): Electron.NativeImage | null {
  const size = 16
  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#22c55e"/>
        <path d="M5 8l2 2 4-4" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `
  return nativeImage.createFromBuffer(Buffer.from(svg, 'utf-8'), { scaleFactor: 2.0 })
}
