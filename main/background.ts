import path from "path";
import {
  app,
  session,
  BrowserWindow,
  globalShortcut,
  powerMonitor,
  crashReporter,
} from "electron";
import { createWindow } from "./helpers";
import Store from "electron-store";
import fs from "fs";
import log from "electron-log";
import type { AppSettings } from "./types/settings";
import {
  startLocalServer,
  handleDeepLink,
  initPermissions,
  initTray,
  initUpdater,
  prewarmBadgeCache,
  initBadge,
  registerIpcHandlers,
  getAppLocale,
  getI18n,
  startRpcPolling,
  stopRpcPolling,
  reapplyThumbar,
  confirmAndOpenExternal,
} from "./services";

// Route console.* to electron-log — writes to %APPDATA%\BloumeChat\logs\main.log in production
log.transports.file.level = "info";
Object.assign(console, log.functions);

// --- Config ---
const configPath = path.join(__dirname, "../config.json");
let appConfig: Record<string, unknown> = {};
try {
  appConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  console.error("[Config] No config.json found or invalid format.");
}

const isProd =
  appConfig.IS_PROD !== undefined
    ? appConfig.IS_PROD === true || appConfig.IS_PROD === "true"
    : process.env.NODE_ENV === "production";

if (process.platform === "win32") {
  app.setAppUserModelId("com.bloumechat.app");
}

// Crash reporter — writes native minidumps locally AND, when a collection
// endpoint is configured, uploads them to the admin panel (server/routes/crash-reports.ts)
// so a crash can be diagnosed from any user's machine without relying on their
// bug report alone. Falls back to local-only if CRASH_REPORT_URL isn't set
// (e.g. a dev build without config.json wired up).
const crashReportUrl =
  typeof appConfig.CRASH_REPORT_URL === "string"
    ? appConfig.CRASH_REPORT_URL
    : "";
app.setPath("crashDumps", path.join(app.getPath("userData"), "CrashDumps"));
crashReporter.start({
  submitURL: crashReportUrl,
  uploadToServer: Boolean(crashReportUrl),
  compress: true,
  ignoreSystemCrashHandler: false,
  globalExtra: {
    _version: app.getVersion(),
    _platform: process.platform,
  },
});

// Allow cookies in iframes (SameSite workaround for embedded Cloudflare challenges)
app.commandLine.appendSwitch(
  "disable-features",
  "SameSiteByDefaultCookies,CookiesWithoutSameSiteMustBeSecure",
);

// --- Custom Protocol ---
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("bloumechat", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("bloumechat");
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) app.quit();

const settingsStore = new Store<AppSettings>({ name: "bloumechat-settings" });

let mainWindow: BrowserWindow | null = null;
let tray: Electron.Tray | null = null;
let server: import("http").Server | null = null;
let prodPort = 0;
let isAppQuitting = false;

function getMainWindow() {
  return mainWindow;
}
function getTray() {
  return tray;
}
function getProdPort() {
  return prodPort;
}

function getDevPort() {
  const args = process.argv.slice(1);
  const portArg = args.find((arg) => /^\d+$/.test(arg));
  const port = portArg ? parseInt(portArg, 10) : 8899;
  console.log(`[Startup] Detected dev port: ${port}`);
  return port;
}
const DEV_PORT = getDevPort();

function getAppIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(app.getAppPath(), "resources", "icon.png");
}

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

if (!isProd) {
  app.setPath("userData", `${app.getPath("userData")} (development)`);
}

(async () => {
  await app.whenReady();
  app.userAgentFallback = "BloumeChat/App";

  // Resolve tray icon path once — reused by initBadge + initTray
  const trayIconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  const trayIconPath = app.isPackaged
    ? path.join(process.resourcesPath, trayIconFile)
    : path.join(app.getAppPath(), "resources", trayIconFile);
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

  const mainSession = session.fromPartition("persist:main");
  initPermissions(
    mainSession,
    getMainWindow,
    () => (app.isPackaged ? prodPort : DEV_PORT),
    app.isPackaged,
  );

  // Cold start — the home shell (served locally) embeds an iframe pointing at the
  // real remote site (bloumechat.com). DNS + TLS handshake for that origin is the
  // actual network-bound cost, so warm it up while the window/local server spin up.
  try {
    const preconnectOrigin = String(
      appConfig.NEXT_PUBLIC_SITE_URL || "https://bloumechat.com",
    );
    mainSession.preconnect({ url: preconnectOrigin, numSockets: 2 });
  } catch (e) {
    console.warn("[Startup] Preconnect failed:", e);
  }

  mainWindow = createWindow("main", {
    width: 1200,
    height: 800,
    titleBarStyle: "hidden",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "icon.png")
      : path.join(app.getAppPath(), "resources", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      partition: "persist:main",
      webSecurity: true,
      devTools: !isProd,
      spellcheck: true,
    },
  });

  // Suppress native context menu so React onContextMenu handlers fire unobstructed
  mainWindow.webContents.on("context-menu", (e) => e.preventDefault());

  // Renderer crash/OOM — log with as much detail as electron-log can persist,
  // then reload in place so the user isn't left staring at a blank window.
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[Renderer] Process gone:", details.reason, details.exitCode);
    if (details.reason !== "clean-exit" && !isAppQuitting) {
      mainWindow?.webContents.reload();
    }
  });
  mainWindow.webContents.on("unresponsive", () =>
    console.warn("[Renderer] Became unresponsive"),
  );
  mainWindow.webContents.on("responsive", () =>
    console.log("[Renderer] Responsive again"),
  );

  if (settingsStore.get("wasMaximized", false)) mainWindow.maximize();

  const savedZoom = settingsStore.get("zoomLevel", 0);
  mainWindow.webContents.setZoomLevel(savedZoom);

  // Tray (reuses trayIconPath resolved above)
  tray = initTray(
    trayIconPath,
    settingsStore,
    getMainWindow,
    setAutoLaunch,
    (v) => {
      isAppQuitting = v;
    },
  );

  // Jump List (taskbar right-click) — kept to a single safe "Open" task for now.
  // Dynamic entries like "New message" / "Set status" need a matching deep-link
  // route (only 'channel'/'server' exist today, see services/deeplink.ts) and a
  // real webapp destination for them — adding those is a follow-up, not a main-
  // process concern on its own.
  if (process.platform === "win32") {
    try {
      const i18n = getI18n(getAppLocale());
      app.setJumpList([
        {
          type: "tasks",
          items: [
            {
              type: "task",
              title: i18n.trayOpen,
              description: i18n.trayOpen,
              program: process.execPath,
              args: app.isPackaged ? "" : `"${app.getAppPath()}"`,
              iconPath: process.execPath,
              iconIndex: 0,
            },
          ],
        },
      ]);
    } catch (e) {
      console.warn("[JumpList] Failed to set:", e);
    }
  }

  // IPC
  registerIpcHandlers(
    getMainWindow,
    getTray,
    settingsStore,
    appConfig,
    setAutoLaunch,
    getAppIconPath,
    () => (app.isPackaged ? prodPort : DEV_PORT),
    app.isPackaged,
  );

  // Rich Presence — Windows (PowerShell) + macOS (osascript)
  if (process.platform === "win32" || process.platform === "darwin") {
    startRpcPolling(getMainWindow, () => settingsStore.get("rpcEnabled", true));
  }

  // Lock / unlock screen — pause and resume RPC activity polling
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
    if (settingsStore.get("rpcEnabled", true)) {
      startRpcPolling(getMainWindow, () =>
        settingsStore.get("rpcEnabled", true),
      );
    }
  });

  // Updater
  initUpdater(getMainWindow, getAppIconPath, getProdPort, isProd);

  // Load app URL
  const homeUrl =
    app.isPackaged && isProd
      ? `http://127.0.0.1:${prodPort}/home/`
      : `http://localhost:${DEV_PORT}/home/`;

  await mainWindow
    .loadURL(homeUrl)
    .catch((err) => console.error("[Window] Failed to load URL:", err));

  // Navigation whitelist
  const remoteOrigin = String(
    appConfig.NEXT_PUBLIC_SITE_URL || "https://bloumechat.com",
  );
  const remoteOriginWww = remoteOrigin
    .replace("https://", "https://www.")
    .replace("http://", "http://www.");

  const isAllowedUrl = (url: string): boolean => {
    const port = isProd ? prodPort : DEV_PORT;
    return (
      url.startsWith(`http://127.0.0.1:${port}`) ||
      url.startsWith(`http://localhost:${port}`) ||
      url.startsWith(remoteOrigin) ||
      url.startsWith(remoteOriginWww) ||
      url.startsWith("https://challenges.cloudflare.com")
    );
  };

  // Every "leave the current page" request funnels through here — never a second
  // Electron BrowserWindow. Same-origin (allowed) targets are handed to the
  // renderer (home.tsx) to navigate the visible iframe's `src` in place — Electron
  // 34's setWindowOpenHandler doesn't expose the requesting frame, so we can't
  // target it directly from main, but the app only ever shows one content iframe
  // at a time, so redirecting that one is equivalent and popup-free. Anything else
  // asks the user before handing it to the system/default browser.
  const openInPlaceOrExternal = (url: string) => {
    if (isAllowedUrl(url)) {
      mainWindow?.webContents.send("navigate-iframe", url);
    } else {
      void confirmAndOpenExternal(
        url,
        getMainWindow,
        settingsStore,
        () => (app.isPackaged ? prodPort : DEV_PORT),
        app.isPackaged,
      );
    }
  };

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedUrl(url)) {
      event.preventDefault();
      void confirmAndOpenExternal(
        url,
        getMainWindow,
        settingsStore,
        () => (app.isPackaged ? prodPort : DEV_PORT),
        app.isPackaged,
      );
    }
  });
  mainWindow.webContents.on("will-frame-navigate", (event) => {
    if (event.frame === mainWindow?.webContents.mainFrame) return;
    if (!isAllowedUrl(event.url)) {
      event.preventDefault();
      void confirmAndOpenExternal(
        event.url,
        getMainWindow,
        settingsStore,
        () => (app.isPackaged ? prodPort : DEV_PORT),
        app.isPackaged,
      );
    }
  });
  // Never `action: 'allow'` — that spawns a real second native window. Links that
  // ask for target="_blank"/window.open() are always denied here and instead
  // routed through openInPlaceOrExternal (in-place iframe navigation, or a
  // confirmed system-browser open), so the app never shows more than one window/page.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openInPlaceOrExternal(url);
    return { action: "deny" };
  });

  // Global shortcuts
  globalShortcut.register("CommandOrControl+Shift+B", () => {
    if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
    else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!input.control || input.alt || input.shift) return;
    if (input.key === "=" || input.key === "+") {
      event.preventDefault();
      const newZoom = Math.min(
        (mainWindow?.webContents.getZoomLevel() || 0) + 0.5,
        5,
      );
      mainWindow?.webContents.setZoomLevel(newZoom);
      settingsStore.set("zoomLevel", newZoom);
    } else if (input.key === "-") {
      event.preventDefault();
      const newZoom = Math.max(
        (mainWindow?.webContents.getZoomLevel() || 0) - 0.5,
        -3,
      );
      mainWindow?.webContents.setZoomLevel(newZoom);
      settingsStore.set("zoomLevel", newZoom);
    } else if (input.key === "0") {
      event.preventDefault();
      mainWindow?.webContents.setZoomLevel(0);
      settingsStore.set("zoomLevel", 0);
    }
  });

  // Windows drops the taskbar thumbnail toolbar (mute/deafen buttons) whenever
  // the window is hidden (minimize-to-tray) and shown again — re-apply it here
  // instead of waiting for the next mute/deafen toggle to fix it incidentally.
  mainWindow.on("show", () => reapplyThumbar(mainWindow));
  mainWindow.on("restore", () => reapplyThumbar(mainWindow));

  app.on("before-quit", () => {
    isAppQuitting = true;
  });

  mainWindow.on("close", (event) => {
    if (isAppQuitting) return;
    const minimizeToTray = settingsStore.get("minimizeToTray", true);
    if (!minimizeToTray) return;

    event.preventDefault();
    settingsStore.set("wasMaximized", mainWindow?.isMaximized() || false);
    mainWindow?.hide();

    if (!settingsStore.get("trayNoticeShown", false)) {
      const i18n = getI18n(getAppLocale());
      tray?.displayBalloon({
        iconType: "info",
        title: "BloumeChat",
        content: i18n.trayNotice,
      });
      settingsStore.set("trayNoticeShown", true);
    }
  });

  if (process.argv.includes("--hidden")) mainWindow.hide();

  const storedAutoLaunch = settingsStore.get("autoLaunch", false);
  if (storedAutoLaunch) setAutoLaunch(true);
})();

// Second instance — deep link + focus
app.on("second-instance", (_event, commandLine) => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  const deepLinkUrl = commandLine.find((arg) =>
    arg.startsWith("bloumechat://"),
  );
  if (deepLinkUrl) handleDeepLink(deepLinkUrl, mainWindow);
});

// macOS deep link
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url, mainWindow);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  stopRpcPolling();
  if (server) server.close(() => console.log("[Server] Closed."));
});

if (process.platform === "win32") {
  (app as any).on("session-end", () => {
    isAppQuitting = true;
    app.quit();
  });
}
