import { Session, BrowserWindow, ipcMain, desktopCapturer } from 'electron'
import path from 'path'
import { app } from 'electron'

const ALLOWED_PERMISSIONS = [
  'media',
  'mediaKeySystem',
  'display-capture',
  'notifications',
  'fullscreen',
  'clipboard-read',
  'clipboard-write',
  'clipboard-sanitized-write',
]

export function initPermissions(
  mainSession: Session,
  getMainWindow: () => BrowserWindow | null,
  getPort: () => number,
  isPackaged: boolean
) {
  mainSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const isAllowed = ALLOWED_PERMISSIONS.includes(permission)
    console.log(`[Permissions] Request for: ${permission} -> ${isAllowed ? 'GRANTED' : 'DENIED'}`)
    callback(isAllowed)
  })

  mainSession.setPermissionCheckHandler((_webContents, permission) =>
    ALLOWED_PERMISSIONS.includes(permission)
  )

  mainSession.setDisplayMediaRequestHandler((request, callback) => {
    const mainWindow = getMainWindow()
    let callbackCalled = false

    const smartCallback = (cfg?: { video?: Electron.DesktopCapturerSource; audio?: string } | object) => {
      if (callbackCalled) return
      callbackCalled = true
      try {
        if (cfg && ('video' in cfg || 'audio' in cfg)) {
          console.log('[ScreenShare] Resolving media request')
          callback(cfg as Parameters<typeof callback>[0])
        } else {
          console.log('[ScreenShare] Cancelling media request')
          ;(callback as () => void)()
        }
      } catch (err) {
        console.error('[ScreenShare] Exception in media callback:', err)
      }
    }

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
        preload: path.join(__dirname, '../preload.js'),
        devTools: !isPackaged,
      },
    })

    const port = getPort()
    const url = isPackaged
      ? `http://127.0.0.1:${port}/screen-picker/index.html`
      : `http://localhost:${port}/screen-picker/`

    console.log('[ScreenShare] Loading picker URL:', url)

    pickerWin.loadURL(url).catch(err => {
      console.error('[ScreenShare] Failed to load picker URL:', err)
      smartCallback({})
      if (!pickerWin.isDestroyed()) pickerWin.close()
    })

    const onSelect = (_event: Electron.IpcMainEvent, sourceId: unknown) => {
      if (typeof sourceId !== 'string') { smartCallback({}); cleanup(); return }
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then(sources => {
        const source = sources.find(s => s.id === sourceId)
        if (source) {
          smartCallback({ video: source, audio: 'loopback' as 'loopback' })
        } else {
          console.error('[ScreenShare] Selected source not found')
          smartCallback({})
        }
        cleanup()
      }).catch(err => {
        console.error('[ScreenShare] Error getting sources:', err)
        smartCallback({})
        cleanup()
      })
    }

    const onCancel = () => { smartCallback(); cleanup() }

    const cleanup = () => {
      ipcMain.removeListener('select-screen-source', onSelect)
      ipcMain.removeListener('cancel-screen-source', onCancel)
      smartCallback()
      if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close()
    }

    ipcMain.on('select-screen-source', onSelect)
    ipcMain.on('cancel-screen-source', onCancel)
    pickerWin.on('closed', cleanup)
  })
}
