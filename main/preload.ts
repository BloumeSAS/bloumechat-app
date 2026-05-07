import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

const handler = {
  send(channel: string, value: unknown) {
    ipcRenderer.send(channel, value)
  },
  on(channel: string, callback: (...args: unknown[]) => void) {
    const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
      callback(...args)
    ipcRenderer.on(channel, subscription)

    return () => {
      ipcRenderer.removeListener(channel, subscription)
    }
  },
  getEnv: (key: string) => ipcRenderer.invoke('get-env', key),
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  showNotification: (data: any) => ipcRenderer.send('show-notification', data),
  onNotificationClick: (callback: any) => {
    const listener = (event: any, data: any) => callback(data)
    ipcRenderer.on('notification-click', listener)
    return () => ipcRenderer.removeListener('notification-click', listener)
  },
  onUpdateStatus: (callback: (data: any) => void) => {
    const listener = (event: any, data: any) => callback(data)
    ipcRenderer.on('update-status', listener)
    return () => ipcRenderer.removeListener('update-status', listener)
  },
  quitAndInstall: () => ipcRenderer.send('quit-and-install'),
  startDownload: () => ipcRenderer.send('start-download'),
  checkForUpdates: () => ipcRenderer.send('check-for-updates'),
  ignoreUpdate: () => ipcRenderer.send('ignore-update'),
  simulateUpdate: () => ipcRenderer.send('simulate-update'),

  // --- New features ---
  setBadgeCount: (count: number) => ipcRenderer.send('set-badge-count', count),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enable: boolean) => ipcRenderer.send('set-auto-launch', enable),
  getZoomLevel: () => ipcRenderer.invoke('get-zoom-level'),
  setZoomLevel: (level: number) => ipcRenderer.send('set-zoom-level', level),
  getMinimizeToTray: () => ipcRenderer.invoke('get-minimize-to-tray'),
  setMinimizeToTray: (enable: boolean) => ipcRenderer.send('set-minimize-to-tray', enable),
  onDeepLink: (callback: (data: { action: string; id: string, queryParams?: Record<string, string> }) => void) => {
    const listener = (event: any, data: any) => callback(data)
    ipcRenderer.on('deep-link', listener)
    return () => ipcRenderer.removeListener('deep-link', listener)
  },
  writeToClipboard: (text: string) => ipcRenderer.send('write-clipboard', text),

  // --- Screen Share Picker ---
  getScreenSources: (): Promise<{ id: string; name: string; thumbnail: string }[]> =>
    ipcRenderer.invoke('get-screen-sources'),
  selectScreenSource: (sourceId: string) => ipcRenderer.send('select-screen-source', sourceId),
  cancelScreenSource: () => ipcRenderer.send('cancel-screen-source'),
  setVoiceActive: (active: boolean) => ipcRenderer.send('set-voice-active', active),
}

contextBridge.exposeInMainWorld('ipc', handler)

export type IpcHandler = typeof handler
