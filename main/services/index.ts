export { startLocalServer, PROD_PORT } from "./server";
export { handleDeepLink } from "./deeplink";
export { initPermissions } from "./permissions";
export { initTray, buildTrayMenu } from "./tray";
export {
  getAppLocale,
  getI18n,
  getExternalLinkI18n,
  resolveMainProcessLocale,
} from "./locales";
export { confirmAndOpenExternal } from "./external-link";
export { initUpdater } from "./updater";
export {
  prewarmBadgeCache,
  initBadge,
  createBadgeIcon,
  createMicOverlayIcon,
  handleSetBadgeCount,
  handleSetVoiceActive,
  getCurrentBadgeCount,
} from "./badge";
export { registerIpcHandlers } from "./ipc-handlers";
export { startRpcPolling, stopRpcPolling } from "./rpc";
export {
  handleThumbarVoiceActive,
  handleSetMuteState,
  reapplyThumbar,
} from "./thumbar";
