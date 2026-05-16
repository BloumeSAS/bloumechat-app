import { autoUpdater } from 'electron-updater'
import { BrowserWindow, Notification, nativeImage, ipcMain, app } from 'electron'

// TODO: once a CA-issued OV/EV certificate is obtained, remove these two lines
// and re-enable update signature verification for security.
// Current certificate is self-signed — Windows rejects it with UntrustedRoot.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
;(autoUpdater as any).verifyUpdateCodeSignature = false

const updateI18n = {
  fr: {
    title: 'BloumeChat — Mise à jour disponible',
    body: (v: string) => `La version ${v} est disponible. Cliquez pour mettre à jour.`,
  },
  en: {
    title: 'BloumeChat — Update available',
    body: (v: string) => `Version ${v} is available. Click to update.`,
  },
} as const

function getLocaleStrings() {
  const locale = app.getLocale()?.toLowerCase() || 'fr'
  return locale.startsWith('fr') ? updateI18n.fr : updateI18n.en
}

export function initUpdater(
  getMainWindow: () => BrowserWindow | null,
  getAppIconPath: () => string,
  getProdPort: () => number,
  isProd: boolean
) {
  autoUpdater.requestHeaders = { 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0' }
  autoUpdater.autoDownload = false

  let isUpdateIgnored = false

  autoUpdater.on('checking-for-update', () =>
    getMainWindow()?.webContents.send('update-status', { status: 'checking' })
  )

  autoUpdater.on('update-available', info => {
    const mainWindow = getMainWindow()
    mainWindow?.webContents.send('update-status', { status: 'available', info })
    if (isUpdateIgnored) return

    const { title, body } = getLocaleStrings()
    const icon = nativeImage.createFromPath(getAppIconPath())

    const notification = new Notification({ title, body: body(info.version), icon })

    notification.on('click', () => {
      mainWindow?.show()
      mainWindow?.focus()
      const port = getProdPort()
      const updateUrl = isProd
        ? `http://127.0.0.1:${port}/update`
        : `http://localhost:${port}/update`
      mainWindow?.loadURL(updateUrl)
    })

    notification.show()
  })

  autoUpdater.on('update-not-available', info =>
    getMainWindow()?.webContents.send('update-status', { status: 'not-available', info })
  )
  autoUpdater.on('error', (err: Error) =>
    getMainWindow()?.webContents.send('update-status', { status: 'error', message: err.message })
  )
  autoUpdater.on('download-progress', progressObj =>
    getMainWindow()?.webContents.send('update-status', { status: 'downloading', progress: progressObj })
  )
  autoUpdater.on('update-downloaded', info =>
    getMainWindow()?.webContents.send('update-status', { status: 'downloaded', info })
  )

  ipcMain.on('ignore-update', () => { isUpdateIgnored = true })
  ipcMain.on('quit-and-install', () => autoUpdater.quitAndInstall(true, true))
  ipcMain.on('start-download', () => autoUpdater.downloadUpdate())
  ipcMain.on('check-for-updates', () => autoUpdater.checkForUpdatesAndNotify())
  ipcMain.on('simulate-update', () =>
    getMainWindow()?.webContents.send('update-status', { status: 'available', info: { version: '9.9.9' } })
  )
}
