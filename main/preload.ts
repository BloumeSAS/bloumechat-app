import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";

const handler = {
  send(channel: string, value: unknown) {
    ipcRenderer.send(channel, value);
  },
  on(channel: string, callback: (...args: unknown[]) => void) {
    const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
      callback(...args);
    ipcRenderer.on(channel, subscription);

    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
  getEnv: (key: string) => ipcRenderer.invoke("get-env", key),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("get-app-version"),
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  showNotification: (data: any) => ipcRenderer.send("show-notification", data),
  onNotificationClick: (callback: any) => {
    const listener = (event: any, data: any) => callback(data);
    ipcRenderer.on("notification-click", listener);
    return () => ipcRenderer.removeListener("notification-click", listener);
  },
  onUpdateStatus: (callback: (data: any) => void) => {
    const listener = (event: any, data: any) => callback(data);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
  quitAndInstall: () => ipcRenderer.send("quit-and-install"),
  startDownload: () => ipcRenderer.send("start-download"),
  checkForUpdates: () => ipcRenderer.send("check-for-updates"),
  ignoreUpdate: () => ipcRenderer.send("ignore-update"),
  simulateUpdate: () => ipcRenderer.send("simulate-update"),

  // --- New features ---
  setBadgeCount: (count: number) => ipcRenderer.send("set-badge-count", count),
  getAutoLaunch: () => ipcRenderer.invoke("get-auto-launch"),
  setAutoLaunch: (enable: boolean) =>
    ipcRenderer.send("set-auto-launch", enable),
  getZoomLevel: () => ipcRenderer.invoke("get-zoom-level"),
  setZoomLevel: (level: number) => ipcRenderer.send("set-zoom-level", level),
  getMinimizeToTray: () => ipcRenderer.invoke("get-minimize-to-tray"),
  setMinimizeToTray: (enable: boolean) =>
    ipcRenderer.send("set-minimize-to-tray", enable),
  onDeepLink: (
    callback: (data: {
      action: string;
      id: string;
      queryParams?: Record<string, string>;
    }) => void,
  ) => {
    const listener = (event: any, data: any) => callback(data);
    ipcRenderer.on("deep-link", listener);
    return () => ipcRenderer.removeListener("deep-link", listener);
  },
  writeToClipboard: (text: string) => ipcRenderer.send("write-clipboard", text),
  readFromClipboard: (): Promise<string> =>
    ipcRenderer.invoke("read-clipboard"),
  copySelection: (text: string) => ipcRenderer.send("copy-selection", text),
  pasteText: (text?: string) => ipcRenderer.send("paste-text", text || ""),

  // --- Screen Share Picker ---
  getScreenSources: (): Promise<
    { id: string; name: string; thumbnail: string }[]
  > => ipcRenderer.invoke("get-screen-sources"),
  selectScreenSource: (sourceId: string) =>
    ipcRenderer.send("select-screen-source", sourceId),
  cancelScreenSource: () => ipcRenderer.send("cancel-screen-source"),
  setVoiceActive: (active: boolean) =>
    ipcRenderer.send("set-voice-active", active),

  // --- Taskbar thumbnail toolbar (mute/deafen) ---
  setMuteState: (isMuted: boolean, isDeafened: boolean) =>
    ipcRenderer.send("set-mute-state", { isMuted, isDeafened }),
  onThumbarToggleMute: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("thumbar:toggle-mute", listener);
    return () => ipcRenderer.removeListener("thumbar:toggle-mute", listener);
  },
  onThumbarToggleDeafen: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("thumbar:toggle-deafen", listener);
    return () => ipcRenderer.removeListener("thumbar:toggle-deafen", listener);
  },

  // --- Rich Presence (RPC) ---
  onRpcActivity: (
    cb: (activity: import("./types/ipc").RpcActivity) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      activity: import("./types/ipc").RpcActivity,
    ) => cb(activity);
    ipcRenderer.on("rpc:activity", listener);
    return () => ipcRenderer.removeListener("rpc:activity", listener);
  },
  getRpcEnabled: (): Promise<boolean> => ipcRenderer.invoke("get-rpc-enabled"),
  setRpcEnabled: (enable: boolean) =>
    ipcRenderer.send("set-rpc-enabled", enable),

  // Per-type show flags
  getRpcShowUsing: (): Promise<boolean> =>
    ipcRenderer.invoke("get-rpc-show-using"),
  setRpcShowUsing: (v: boolean) => ipcRenderer.send("set-rpc-show-using", v),
  getRpcShowBrowsing: (): Promise<boolean> =>
    ipcRenderer.invoke("get-rpc-show-browsing"),
  setRpcShowBrowsing: (v: boolean) =>
    ipcRenderer.send("set-rpc-show-browsing", v),
  getRpcShowListening: (): Promise<boolean> =>
    ipcRenderer.invoke("get-rpc-show-listening"),
  setRpcShowListening: (v: boolean) =>
    ipcRenderer.send("set-rpc-show-listening", v),
  getRpcShowPlaying: (): Promise<boolean> =>
    ipcRenderer.invoke("get-rpc-show-playing"),
  setRpcShowPlaying: (v: boolean) =>
    ipcRenderer.send("set-rpc-show-playing", v),

  // Per-app/site excluded keywords
  getRpcEnabledCategories: (): Promise<string[]> =>
    ipcRenderer.invoke("get-rpc-enabled-categories"),
  setRpcEnabledCategories: (v: string[]) =>
    ipcRenderer.send("set-rpc-enabled-categories", v),

  // --- External URL (opens in system browser, not Electron window) ---
  openExternal: (url: string) => ipcRenderer.send("open-external", url),

  // --- Account language sync (webapp -> desktop shell) ---
  getAccountLanguage: (): Promise<string | null> =>
    ipcRenderer.invoke("get-account-language"),
  setAccountLanguage: (lang: string) =>
    ipcRenderer.send("set-account-language", lang),
};

contextBridge.exposeInMainWorld("ipc", handler);

export type IpcHandler = typeof handler;
