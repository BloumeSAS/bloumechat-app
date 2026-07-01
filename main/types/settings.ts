export interface AppSettings {
  autoLaunch: boolean
  zoomLevel: number
  wasMaximized: boolean
  trayNoticeShown: boolean
  minimizeToTray: boolean
  rpcEnabled: boolean
  rpcShowUsing: boolean
  rpcShowBrowsing: boolean
  rpcShowListening: boolean
  rpcShowPlaying: boolean
  /** Case-insensitive keywords (app/site names) that suppress a matching activity entirely. */
  rpcEnabledCategories: string[]
}
