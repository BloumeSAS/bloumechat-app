import { ipcMain, BrowserWindow, clipboard, nativeImage, Notification, desktopCapturer } from 'electron'
import Store from 'electron-store'
import type { AppSettings } from '../types/settings'
import type { NotificationPayload } from '../types/ipc'
import { handleSetBadgeCount, handleSetVoiceActive } from './badge'
import { startRpcPolling, stopRpcPolling } from './rpc'

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  getTray: () => Electron.Tray | null,
  settingsStore: Store<AppSettings>,
  appConfig: Record<string, unknown>,
  setAutoLaunch: (enable: boolean) => void,
  getAppIconPath: () => string
) {
  const appIcon = nativeImage.createFromPath(getAppIconPath())

  // --- Notifications ---
  ipcMain.on('show-notification', (_event, raw: unknown) => {
    if (!raw || typeof raw !== 'object') return
    const data = raw as Record<string, unknown>
    if (typeof data.title !== 'string' || typeof data.body !== 'string') return
    if (data.title.length > 256 || data.body.length > 1024) return

    const notification = new Notification({
      title: data.title,
      body: data.body,
      icon: typeof data.icon === 'string' ? nativeImage.createFromDataURL(data.icon) : appIcon,
    })

    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true)

    notification.on('click', () => {
      const win = getMainWindow()
      win?.show()
      win?.focus()
      win?.flashFrame(false)
      win?.webContents.send('notification-click', {
        channelPublicId: typeof data.channelPublicId === 'string' ? data.channelPublicId : undefined,
        serverPublicId: typeof data.serverPublicId === 'string' ? data.serverPublicId : undefined,
        authorPublicId: typeof data.authorPublicId === 'string' ? data.authorPublicId : undefined,
      })
    })

    notification.show()
  })

  // Stop flashing when window gains focus
  const mainWindow = getMainWindow()
  mainWindow?.on('focus', () => getMainWindow()?.flashFrame(false))

  // --- Badge & Voice ---
  ipcMain.on('set-badge-count', (_event, count: unknown) => handleSetBadgeCount(count, getMainWindow()))
  ipcMain.on('set-voice-active', (_event, active: unknown) => handleSetVoiceActive(active, getMainWindow(), getTray()))

  // --- Window Controls ---
  ipcMain.on('window-minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.on('window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('window-close', () => BrowserWindow.getFocusedWindow()?.close())

  // --- Environment ---
  ipcMain.handle('get-env', (_event, key: unknown) => {
    if (typeof key !== 'string' || key.length > 128) return undefined
    return appConfig[key] || process.env[key]
  })
  ipcMain.handle('get-platform', () => process.platform)

  // --- Auto-Launch ---
  ipcMain.handle('get-auto-launch', () => settingsStore.get('autoLaunch', false))
  ipcMain.on('set-auto-launch', (_event, enable: unknown) => {
    if (typeof enable !== 'boolean') return
    setAutoLaunch(enable)
  })

  // --- Clipboard ---
  ipcMain.on('write-clipboard', (_event, text: unknown) => {
    if (typeof text !== 'string') return
    try { clipboard.writeText(text) } catch (e) { console.error('[Clipboard] write failed:', e) }
  })
  ipcMain.handle('read-clipboard', () => {
    try { return clipboard.readText() } catch (e) { console.debug('[Clipboard] read failed:', e); return '' }
  })
  ipcMain.on('copy-selection', (_event, text: unknown) => {
    if (typeof text !== 'string') return
    try { clipboard.writeText(text) } catch (e) { console.error('[Clipboard] copy-selection failed:', e) }
  })
  ipcMain.on('paste-text', (_event, text: unknown) => {
    if (text !== undefined && typeof text !== 'string') return
    if (typeof text === 'string') {
      try { clipboard.writeText(text) } catch { /* ignore */ }
    }
    BrowserWindow.getFocusedWindow()?.webContents.paste()
  })

  // --- Zoom ---
  ipcMain.handle('get-zoom-level', () => getMainWindow()?.webContents.getZoomLevel() || 0)
  ipcMain.on('set-zoom-level', (_event, level: unknown) => {
    if (typeof level !== 'number' || !Number.isFinite(level)) return
    const safeLevel = Math.max(-3, Math.min(5, level))
    getMainWindow()?.webContents.setZoomLevel(safeLevel)
    settingsStore.set('zoomLevel', safeLevel)
  })

  // --- Minimize to Tray ---
  ipcMain.handle('get-minimize-to-tray', () => settingsStore.get('minimizeToTray', true))
  ipcMain.on('set-minimize-to-tray', (_event, enable: unknown) => {
    if (typeof enable !== 'boolean') return
    settingsStore.set('minimizeToTray', enable)
  })

  // --- Screen Sources (for picker UI) ---
  ipcMain.handle('get-screen-sources', async () => {
    console.log('[ScreenShare] Fetching sources for picker UI...')
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      })
      console.log(`[ScreenShare] Found ${sources.length} sources.`)
      return sources.map(s => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }))
    } catch (err) {
      console.error('[ScreenShare] Failed to get sources:', err)
      return []
    }
  })

  // --- Rich Presence (RPC) ---
  ipcMain.handle('get-rpc-enabled', () => settingsStore.get('rpcEnabled', true))
  ipcMain.on('set-rpc-enabled', (_event, enable: unknown) => {
    if (typeof enable !== 'boolean') return
    settingsStore.set('rpcEnabled', enable)
    if (enable) {
      startRpcPolling(getMainWindow, () => settingsStore.get('rpcEnabled', true))
    } else {
      stopRpcPolling()
      // Notify webapp that activity is cleared
      getMainWindow()?.webContents.send('rpc:activity', { type: 'none', name: '' })
    }
  })

  // Per-type show flags (filtering happens client-side in RpcProvider)
  ipcMain.handle('get-rpc-show-using', () => settingsStore.get('rpcShowUsing', true))
  ipcMain.on('set-rpc-show-using', (_event, v: unknown) => {
    if (typeof v !== 'boolean') return
    settingsStore.set('rpcShowUsing', v)
  })

  ipcMain.handle('get-rpc-show-browsing', () => settingsStore.get('rpcShowBrowsing', true))
  ipcMain.on('set-rpc-show-browsing', (_event, v: unknown) => {
    if (typeof v !== 'boolean') return
    settingsStore.set('rpcShowBrowsing', v)
  })

  ipcMain.handle('get-rpc-show-listening', () => settingsStore.get('rpcShowListening', true))
  ipcMain.on('set-rpc-show-listening', (_event, v: unknown) => {
    if (typeof v !== 'boolean') return
    settingsStore.set('rpcShowListening', v)
  })

  ipcMain.handle('get-rpc-show-playing', () => settingsStore.get('rpcShowPlaying', true))
  ipcMain.on('set-rpc-show-playing', (_event, v: unknown) => {
    if (typeof v !== 'boolean') return
    settingsStore.set('rpcShowPlaying', v)
  })
}
