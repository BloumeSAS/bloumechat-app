export interface AppSettings {
  autoLaunch: boolean;
  zoomLevel: number;
  wasMaximized: boolean;
  trayNoticeShown: boolean;
  minimizeToTray: boolean;
  rpcEnabled: boolean;
  rpcShowUsing: boolean;
  rpcShowBrowsing: boolean;
  rpcShowListening: boolean;
  rpcShowPlaying: boolean;
  /** Case-insensitive keywords (app/site names) that suppress a matching activity entirely. */
  rpcEnabledCategories: string[];
  /** Last language synced from the webapp (account preference if logged in, else its
   * own browser-detected default). Cached here so main-process UI (tray, jump list,
   * native dialogs) and secondary windows (screen picker, updater) can resolve the
   * right language before the iframe has even loaded, without re-detecting from the OS. */
  accountLanguage: string | null;
}
