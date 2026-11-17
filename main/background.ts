import path from "path";
import {
  app,
  session,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  powerMonitor,
} from "electron";
import Store from "electron-store";
import log from "electron-log";
import { createWindow } from "./helpers";
import type { AppSettings } from "./types/settings";
import {
  startLocalServer,
  handleDeepLink,
  initPermissions,
  initTray,
  initUpdater,
  initBadge,
  registerIpcHandlers,
  startRpcPolling,
  stopRpcPolling,
} from "./services";
import { setAppQuitting } from "./services/app-state";
import { loadAppConfig, getSiteOrigin } from "./services/config";
import {
  startCrashReporter,
  installProcessErrorHandlers,
  attachRendererRecovery,
} from "./services/crash";
import {
  installNavigationGuards,
  getAllowedOrigins,
  type NavigationContext,
} from "./services/navigation";
import { installZoomShortcuts } from "./services/zoom";
import { installWindowLifecycle } from "./services/window-lifecycle";
import { attachSiteHealth } from "./services/site-health";
import {
  registerProtocolClient,
  applyJumpList,
  findLaunchDeepLink,
} from "./services/os-integration";
import { isVoiceCallActive, prewarmBadgeCache } from "./services/badge";

// Route console.* to electron-log — writes to %APPDATA%\BloumeChat\logs\main.log in production
log.transports.file.level = "info";
Object.assign(console, log.functions);

const { appConfig, isProd } = loadAppConfig(__dirname);

if (process.platform === "win32") {
  app.setAppUserModelId("com.bloumechat.app");
}
// Must precede everything that reads userData (single-instance lock, crash dumps, stores).
if (!isProd) {
  app.setPath("userData", `${app.getPath("userData")} (development)`);
}

installProcessErrorHandlers();
startCrashReporter(appConfig);

// Allow cookies in iframes (SameSite workaround for embedded Cloudflare challenges)
app.commandLine.appendSwitch(
  "disable-features",
  "SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure",
);

const settingsStore = new Store<AppSettings>({ name: "bloumechat-settings" });

let mainWindow: BrowserWindow | null = null;
let tray: Electron.Tray | null = null;
let server: import("http").Server | null = null;
let prodPort = 0;

const getMainWindow = () => mainWindow;
const getTray = () => tray;

function getDevPort(): number {
  const portArg = process.argv.slice(1).find((arg) => /^\d+$/.test(arg));
  const port = portArg ? parseInt(portArg, 10) : 8899;
  console.log(`[Startup] Detected dev port: ${port}`);
  return port;
}
const DEV_PORT = getDevPort();
const getPort = () => (app.isPackaged ? prodPort : DEV_PORT);

const resourcePath = (file: string) =>
  app.isPackaged
    ? path.join(process.resourcesPath, file)
    : path.join(app.getAppPath(), "resources", file);
const getAppIconPath = () => resourcePath("icon.png");

function setAutoLaunch(enable: boolean) {
  try {
    const settings: { openAtLogin: boolean; path: string; args: string[] } = {
      openAtLogin: enable,
      path: app.getPath("exe"),
      args: ["--hidden"],
    };
    if (!app.isPackaged) settings.args = [app.getAppPath(), "--hidden"];
    app.setLoginItemSettings(settings);
    settingsStore.set("autoLaunch", enable);
  } catch (error) {
    console.error("[AutoLaunch] Failed to set:", error);
  }
}

async function start() {
  await app.whenReady();
  app.userAgentFallback = "BloumeChat/App";
  registerProtocolClient();

  const siteOrigin = getSiteOrigin(appConfig);
  const trayIconPath = resourcePath(
    process.platform === "win32" ? "icon.ico" : "icon.png",
  );
  initBadge(trayIconPath);
  prewarmBadgeCache();

  if (app.isPackaged && isProd) {
    try {
      const result = await startLocalServer(path.join(__dirname));
      server = result.server;
      prodPort = result.port;
    } catch (e) {
      console.error("[Server] Failed to start:", e);
    }
  }

  const navigationContext: NavigationContext = {
    getMainWindow,
    settingsStore,
    getPort,
    isPackaged: app.isPackaged,
    siteOrigin,
  };

  const mainSession = session.fromPartition("persist:main");
  initPermissions(mainSession, getMainWindow, getPort, app.isPackaged, () =>
    getAllowedOrigins(navigationContext),
  );

  // The home shell embeds the remote site in an iframe: DNS + TLS for that origin is the
  // real network-bound cost of a cold start, so warm it up while the window spins up.
  try {
    mainSession.preconnect({ url: siteOrigin, numSockets: 2 });
  } catch (e) {
    console.warn("[Startup] Preconnect failed:", e);
  }

  const startHidden = process.argv.includes("--hidden");
  mainWindow = createWindow("main", {
    width: 1200,
    height: 800,
    show: false, // revealed once painted: no white flash while the shell loads
    titleBarStyle: "hidden",
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      partition: "persist:main",
      webSecurity: true,
      devTools: !isProd,
      spellcheck: true,
    },
  });
  const win = mainWindow;

  let revealed = false;
  const reveal = () => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    if (settingsStore.get("wasMaximized", false)) win.maximize();
    if (!startHidden) win.show();
  };
  win.once("ready-to-show", reveal);
  setTimeout(reveal, 4000); // safety net: never leave the user without a window

  // Suppress native context menu so React onContextMenu handlers fire unobstructed
  win.webContents.on("context-menu", (e) => e.preventDefault());
  attachRendererRecovery(win);
  attachSiteHealth(win, siteOrigin);
  installZoomShortcuts(win, settingsStore);
  installNavigationGuards(win, navigationContext);
  installWindowLifecycle(win, settingsStore, getTray);

  tray = initTray(
    trayIconPath,
    settingsStore,
    getMainWindow,
    setAutoLaunch,
    setAppQuitting,
  );
  applyJumpList();

  registerIpcHandlers(
    getMainWindow,
    getTray,
    settingsStore,
    appConfig,
    setAutoLaunch,
    getAppIconPath,
    getPort,
    app.isPackaged,
  );

  initUpdater({
    getMainWindow,
    getIconPath: getAppIconPath,
    settingsStore,
    isVoiceActive: isVoiceCallActive,
    setQuitting: setAppQuitting,
  });

  // Rich Presence — started a few seconds after launch (it spawns a PowerShell process) and
  // only when the user has it enabled.
  const rpcEnabled = () => settingsStore.get("rpcEnabled", true);
  const startRpc = () => startRpcPolling(getMainWindow, rpcEnabled);
  if (process.platform === "win32" || process.platform === "darwin") {
    setTimeout(() => {
      if (rpcEnabled()) startRpc();
    }, 5000);
  }
  powerMonitor.on("lock-screen", () => {
    console.log("[RPC] Screen locked — pausing activity polling");
    stopRpcPolling();
    getMainWindow()?.webContents.send("rpc:activity", {
      type: "none",
      name: "",
    });
  });
  powerMonitor.on("unlock-screen", () => {
    console.log("[RPC] Screen unlocked — resuming activity polling");
    if (rpcEnabled()) startRpc();
  });

  globalShortcut.register("CommandOrControl+Shift+B", () => {
    if (win.isVisible() && win.isFocused()) win.hide();
    else {
      win.show();
      win.focus();
    }
  });

  // A bloumechat:// link that launched the app: handed to the site once the shell reports
  // it is ready (the iframe can only act on it after it has loaded).
  const launchDeepLink = findLaunchDeepLink(process.argv);
  if (launchDeepLink) {
    ipcMain.once("app-ready", () => handleDeepLink(launchDeepLink, win));
  }

  const homeUrl =
    app.isPackaged && isProd
      ? prodPort
        ? `http://127.0.0.1:${prodPort}/home/`
        : `${siteOrigin}/app?platform=desktop` // local server unavailable: open the site itself
      : `http://localhost:${DEV_PORT}/home/`;
  await win
    .loadURL(homeUrl)
    .catch((err) => console.error("[Window] Failed to load URL:", err));

  if (settingsStore.get("autoLaunch", false)) setAutoLaunch(true);
}

if (!app.requestSingleInstanceLock()) {
  // Another instance owns the profile: nothing else must run in this process.
  app.quit();
} else {
  void start();

  // Second launch — focus the running window and pass on a bloumechat:// link
  app.on("second-instance", (_event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    const deepLinkUrl = findLaunchDeepLink(commandLine);
    if (deepLinkUrl) handleDeepLink(deepLinkUrl, mainWindow);
  });
}

// macOS deep link
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url, mainWindow);
});

app.on("before-quit", () => setAppQuitting(true));

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopRpcPolling();
  if (server) server.close(() => console.log("[Server] Closed."));
});

if (process.platform === "win32") {
  (app as unknown as NodeJS.EventEmitter).on("session-end", () => {
    setAppQuitting(true);
    app.quit();
  });
}
