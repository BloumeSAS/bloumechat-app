import { Tray, Menu, nativeImage, BrowserWindow, shell, app } from 'electron'
import Store from 'electron-store'
import fs from 'fs'
import type { AppSettings } from '../types/settings'

const mainProcessI18n = {
  fr: {
    trayOpen: 'Ouvrir BloumeChat',
    trayAutoLaunch: 'Lancer au démarrage',
    trayCheckUpdates: 'Vérifier les mises à jour (Store)',
    trayReload: 'Recharger',
    trayQuit: 'Quitter',
    trayNotice: "BloumeChat continue de tourner en arrière-plan. Cliquez sur l'icône pour rouvrir.",
    trayMuteMic: 'Couper le micro',
    trayUnmuteMic: 'Activer le micro',
    trayDeafen: 'Couper le son',
    trayUndeafen: 'Réactiver le son',
  },
  en: {
    trayOpen: 'Open BloumeChat',
    trayAutoLaunch: 'Launch at startup',
    trayCheckUpdates: 'Check for updates (Store)',
    trayReload: 'Reload',
    trayQuit: 'Quit',
    trayNotice: 'BloumeChat is still running in the background. Click the icon to reopen.',
    trayMuteMic: 'Mute microphone',
    trayUnmuteMic: 'Unmute microphone',
    trayDeafen: 'Deafen',
    trayUndeafen: 'Undeafen',
  },
} as const

// ─── Shared voice state (mirrors the thumbar) ──────────────────────────────────
// Lets the tray menu expose mic / deafen toggles while in a call, so users always
// have reliable controls in the taskbar notification area — no icon rasterization
// needed (unlike the thumbnail-toolbar buttons).
const voiceState = { active: false, muted: false, deafened: false }

// Closure set by initTray so any state change can rebuild the context menu.
let rebuildTrayMenu: (() => void) | null = null

/** Called from the IPC layer when the user joins/leaves voice. */
export function setTrayVoiceActive(active: boolean): void {
  voiceState.active = active
  if (!active) { voiceState.muted = false; voiceState.deafened = false }
  rebuildTrayMenu?.()
}

/** Called from the IPC layer when the user's mute/deafen state changes. */
export function setTrayMuteState(isMuted: boolean, isDeafened: boolean): void {
  voiceState.muted = isMuted
  voiceState.deafened = isDeafened
  rebuildTrayMenu?.()
}

export type AppLocale = keyof typeof mainProcessI18n

export function getAppLocale(): AppLocale {
  const locale = app.getLocale()?.toLowerCase() || 'fr'
  return locale.startsWith('fr') ? 'fr' : 'en'
}

export function getI18n(locale: AppLocale) {
  return mainProcessI18n[locale]
}

export function buildTrayMenu(
  settingsStore: Store<AppSettings>,
  getMainWindow: () => BrowserWindow | null,
  setAutoLaunch: (enable: boolean) => void,
  setIsAppQuitting: (v: boolean) => void,
  getTray: () => Tray | null
): Electron.Menu {
  const isAutoLaunch = settingsStore.get('autoLaunch', false)
  const i18n = mainProcessI18n[getAppLocale()]

  // Voice controls — only shown while in a call. They reuse the same IPC channels
  // as the thumbnail-toolbar buttons, so the webapp toggles mute/deafen for us.
  const voiceItems: Electron.MenuItemConstructorOptions[] = voiceState.active
    ? [
        {
          label: voiceState.muted ? i18n.trayUnmuteMic : i18n.trayMuteMic,
          click: () => getMainWindow()?.webContents.send('thumbar:toggle-mute'),
        },
        {
          label: voiceState.deafened ? i18n.trayUndeafen : i18n.trayDeafen,
          click: () => getMainWindow()?.webContents.send('thumbar:toggle-deafen'),
        },
        { type: 'separator' as const },
      ]
    : []

  return Menu.buildFromTemplate([
    { label: i18n.trayOpen, click: () => { getMainWindow()?.show(); getMainWindow()?.focus() } },
    { type: 'separator' },
    ...voiceItems,
    {
      label: i18n.trayAutoLaunch,
      type: 'checkbox',
      checked: isAutoLaunch,
      click: (menuItem) => {
        setAutoLaunch(menuItem.checked)
        getTray()?.setContextMenu(buildTrayMenu(settingsStore, getMainWindow, setAutoLaunch, setIsAppQuitting, getTray))
      },
    },
    { type: 'separator' },
    // MS Store link only makes sense on Windows
    ...(process.platform === 'win32' ? [{
      label: i18n.trayCheckUpdates,
      click: () => shell.openExternal('ms-windows-store://pdp/?productid=XPDBZMTB5GVG3L'),
    }] : []),
    { label: i18n.trayReload, click: () => getMainWindow()?.webContents.reload() },
    { type: 'separator' },
    { label: i18n.trayQuit, click: () => { setIsAppQuitting(true); app.quit() } },
  ])
}

export function initTray(
  iconPath: string,
  settingsStore: Store<AppSettings>,
  getMainWindow: () => BrowserWindow | null,
  setAutoLaunch: (enable: boolean) => void,
  setIsAppQuitting: (v: boolean) => void
): Tray {
  if (!fs.existsSync(iconPath)) {
    console.error('[Tray] Icon not found at:', iconPath)
  }

  const rawIcon = nativeImage.createFromPath(iconPath)
  const trayIcon = rawIcon.isEmpty() ? nativeImage.createEmpty() : rawIcon.resize({ width: 24, height: 24 })

  const tray = new Tray(trayIcon)
  tray.setToolTip('BloumeChat')

  const getTray = () => tray
  const rebuild = () => tray.setContextMenu(buildTrayMenu(settingsStore, getMainWindow, setAutoLaunch, setIsAppQuitting, getTray))
  rebuildTrayMenu = rebuild
  rebuild()

  tray.on('click', () => {
    const win = getMainWindow()
    if (win?.isVisible()) win.focus()
    else win?.show()
  })

  return tray
}
