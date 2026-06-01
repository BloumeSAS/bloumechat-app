/**
 * Ambient type declaration for window.ipc (Electron contextBridge API).
 * Mirrors the handler object in main/preload.ts without importing Electron
 * so this file resolves cleanly in both the renderer and main tsconfig contexts.
 */

interface RpcActivity {
  type: 'using' | 'browsing' | 'listening' | 'playing' | 'none'
  name: string
  details?: string
  startedAt?: number
  icon?: string
}

interface DeepLinkPayload {
  action: string
  id: string
  queryParams?: Record<string, string>
}

interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  info?: { version: string }
  progress?: object
  message?: string
}

interface WindowIpc {
  send(channel: string, value: unknown): void
  on(channel: string, callback: (...args: unknown[]) => void): () => void
  getEnv(key: string): Promise<unknown>
  getPlatform(): Promise<string>
  minimize(): void
  maximize(): void
  close(): void
  showNotification(data: {
    title: string; body: string; icon?: string
    channelPublicId?: string; serverPublicId?: string; authorPublicId?: string
  }): void
  onNotificationClick(callback: (data: {
    channelPublicId?: string; serverPublicId?: string; authorPublicId?: string
  }) => void): () => void
  onUpdateStatus(callback: (data: UpdateStatus) => void): () => void
  quitAndInstall(): void
  startDownload(): void
  checkForUpdates(): void
  ignoreUpdate(): void
  simulateUpdate(): void
  setBadgeCount(count: number): void
  getAutoLaunch(): Promise<boolean>
  setAutoLaunch(enable: boolean): void
  getZoomLevel(): Promise<number>
  setZoomLevel(level: number): void
  getMinimizeToTray(): Promise<boolean>
  setMinimizeToTray(enable: boolean): void
  onDeepLink(callback: (data: DeepLinkPayload) => void): () => void
  writeToClipboard(text: string): void
  readFromClipboard(): Promise<string>
  copySelection(text: string): void
  pasteText(text?: string): void
  getScreenSources(): Promise<Array<{ id: string; name: string; thumbnail: string }>>
  selectScreenSource(sourceId: string): void
  cancelScreenSource(): void
  setVoiceActive(active: boolean): void
  onRpcActivity(cb: (activity: RpcActivity) => void): () => void
  getRpcEnabled(): Promise<boolean>
  setRpcEnabled(enable: boolean): void
  getRpcShowUsing(): Promise<boolean>
  setRpcShowUsing(v: boolean): void
  getRpcShowBrowsing(): Promise<boolean>
  setRpcShowBrowsing(v: boolean): void
  getRpcShowListening(): Promise<boolean>
  setRpcShowListening(v: boolean): void
  getRpcShowPlaying(): Promise<boolean>
  setRpcShowPlaying(v: boolean): void
}

declare global {
  interface Window {
    ipc: WindowIpc
  }
}

export {}
