import {
  ipcMain,
  BrowserWindow,
  clipboard,
  nativeImage,
  Notification,
  desktopCapturer,
  app,
} from "electron";
import Store from "electron-store";
import type { AppSettings } from "../types/settings";
import { handleSetBadgeCount, handleSetVoiceActive } from "./badge";
import { startRpcPolling, stopRpcPolling } from "./rpc";
import { handleThumbarVoiceActive, handleSetMuteState } from "./thumbar";
import { setTrayVoiceActive, setTrayMuteState } from "./tray";
import { confirmAndOpenExternal } from "./external-link";
import { SUPPORTED_LOCALE_CODES } from "./locales";

export function registerIpcHandlers(
  getMainWindow: () => BrowserWindow | null,
  getTray: () => Electron.Tray | null,
  settingsStore: Store<AppSettings>,
  appConfig: Record<string, unknown>,
  setAutoLaunch: (enable: boolean) => void,
  getAppIconPath: () => string,
) {
  const appIcon = nativeImage.createFromPath(getAppIconPath());

  // --- Notifications ---
  ipcMain.on("show-notification", (_event, raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const data = raw as Record<string, unknown>;
    if (typeof data.title !== "string" || typeof data.body !== "string") return;
    if (data.title.length > 256 || data.body.length > 1024) return;

    const notification = new Notification({
      title: data.title,
      body: data.body,
      icon:
        typeof data.icon === "string"
          ? nativeImage.createFromDataURL(data.icon)
          : appIcon,
    });

    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true);

    notification.on("click", () => {
      const win = getMainWindow();
      win?.show();
      win?.focus();
      win?.flashFrame(false);
      win?.webContents.send("notification-click", {
        channelPublicId:
          typeof data.channelPublicId === "string"
            ? data.channelPublicId
            : undefined,
        serverPublicId:
          typeof data.serverPublicId === "string"
            ? data.serverPublicId
            : undefined,
        authorPublicId:
          typeof data.authorPublicId === "string"
            ? data.authorPublicId
            : undefined,
      });
    });

    notification.show();
  });

  // Stop flashing when window gains focus
  const mainWindow = getMainWindow();
  mainWindow?.on("focus", () => getMainWindow()?.flashFrame(false));

  // --- Badge & Voice ---
  ipcMain.on("set-badge-count", (_event, count: unknown) =>
    handleSetBadgeCount(count, getMainWindow()),
  );
  ipcMain.on("set-voice-active", (_event, active: unknown) => {
    handleSetVoiceActive(active, getMainWindow(), getTray());
    if (typeof active === "boolean") {
      handleThumbarVoiceActive(active, getMainWindow());
      setTrayVoiceActive(active);
    }
  });
  ipcMain.on("set-mute-state", (_event, raw: unknown) => {
    handleSetMuteState(raw, getMainWindow());
    if (raw && typeof raw === "object") {
      const data = raw as Record<string, unknown>;
      if (
        typeof data.isMuted === "boolean" &&
        typeof data.isDeafened === "boolean"
      ) {
        setTrayMuteState(data.isMuted, data.isDeafened);
      }
    }
  });

  // --- Window Controls ---
  ipcMain.on("window-minimize", () =>
    BrowserWindow.getFocusedWindow()?.minimize(),
  );
  ipcMain.on("window-maximize", () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.on("window-close", () => BrowserWindow.getFocusedWindow()?.close());

  // --- Environment ---
  // Only appConfig (config.json, public/non-secret values) is exposed — never process.env,
  // which could contain unrelated secrets present in the user's environment.
  ipcMain.handle("get-env", (_event, key: unknown) => {
    if (typeof key !== "string" || key.length > 128) return undefined;
    return appConfig[key];
  });
  ipcMain.handle("get-platform", () => process.platform);
  ipcMain.handle("get-app-version", () => app.getVersion());

  // --- Auto-Launch ---
  ipcMain.handle("get-auto-launch", () =>
    settingsStore.get("autoLaunch", false),
  );
  ipcMain.on("set-auto-launch", (_event, enable: unknown) => {
    if (typeof enable !== "boolean") return;
    setAutoLaunch(enable);
  });

  // --- Clipboard ---
  ipcMain.on("write-clipboard", (_event, text: unknown) => {
    if (typeof text !== "string") return;
    try {
      clipboard.writeText(text);
    } catch (e) {
      console.error("[Clipboard] write failed:", e);
    }
  });
  ipcMain.handle("read-clipboard", () => {
    try {
      return clipboard.readText();
    } catch (e) {
      console.debug("[Clipboard] read failed:", e);
      return "";
    }
  });
  ipcMain.on("copy-selection", (_event, text: unknown) => {
    if (typeof text !== "string") return;
    try {
      clipboard.writeText(text);
    } catch (e) {
      console.error("[Clipboard] copy-selection failed:", e);
    }
  });
  ipcMain.on("paste-text", (_event, text: unknown) => {
    if (text !== undefined && typeof text !== "string") return;
    if (typeof text === "string") {
      try {
        clipboard.writeText(text);
      } catch {
        /* ignore */
      }
    }
    BrowserWindow.getFocusedWindow()?.webContents.paste();
  });

  // --- Zoom ---
  ipcMain.handle(
    "get-zoom-level",
    () => getMainWindow()?.webContents.getZoomLevel() || 0,
  );
  ipcMain.on("set-zoom-level", (_event, level: unknown) => {
    if (typeof level !== "number" || !Number.isFinite(level)) return;
    const safeLevel = Math.max(-3, Math.min(5, level));
    getMainWindow()?.webContents.setZoomLevel(safeLevel);
    settingsStore.set("zoomLevel", safeLevel);
  });

  // --- Minimize to Tray ---
  ipcMain.handle("get-minimize-to-tray", () =>
    settingsStore.get("minimizeToTray", true),
  );
  ipcMain.on("set-minimize-to-tray", (_event, enable: unknown) => {
    if (typeof enable !== "boolean") return;
    settingsStore.set("minimizeToTray", enable);
  });

  // --- Screen Sources (for picker UI) ---
  ipcMain.handle("get-screen-sources", async () => {
    console.log("[ScreenShare] Fetching sources for picker UI...");
    try {
      const sources = await desktopCapturer.getSources({
        types: ["window", "screen"],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      console.log(`[ScreenShare] Found ${sources.length} sources.`);
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL(),
      }));
    } catch (err) {
      console.error("[ScreenShare] Failed to get sources:", err);
      return [];
    }
  });

  // --- Rich Presence (RPC) ---
  ipcMain.handle("get-rpc-enabled", () =>
    settingsStore.get("rpcEnabled", true),
  );
  ipcMain.on("set-rpc-enabled", (_event, enable: unknown) => {
    if (typeof enable !== "boolean") return;
    settingsStore.set("rpcEnabled", enable);
    if (enable) {
      startRpcPolling(getMainWindow, () =>
        settingsStore.get("rpcEnabled", true),
      );
    } else {
      stopRpcPolling();
      // Notify webapp that activity is cleared
      getMainWindow()?.webContents.send("rpc:activity", {
        type: "none",
        name: "",
      });
    }
  });

  // Per-type show flags (filtering happens client-side in RpcProvider)
  ipcMain.handle("get-rpc-show-using", () =>
    settingsStore.get("rpcShowUsing", true),
  );
  ipcMain.on("set-rpc-show-using", (_event, v: unknown) => {
    if (typeof v !== "boolean") return;
    settingsStore.set("rpcShowUsing", v);
  });

  ipcMain.handle("get-rpc-show-browsing", () =>
    settingsStore.get("rpcShowBrowsing", true),
  );
  ipcMain.on("set-rpc-show-browsing", (_event, v: unknown) => {
    if (typeof v !== "boolean") return;
    settingsStore.set("rpcShowBrowsing", v);
  });

  ipcMain.handle("get-rpc-show-listening", () =>
    settingsStore.get("rpcShowListening", true),
  );
  ipcMain.on("set-rpc-show-listening", (_event, v: unknown) => {
    if (typeof v !== "boolean") return;
    settingsStore.set("rpcShowListening", v);
  });

  ipcMain.handle("get-rpc-show-playing", () =>
    settingsStore.get("rpcShowPlaying", true),
  );
  ipcMain.on("set-rpc-show-playing", (_event, v: unknown) => {
    if (typeof v !== "boolean") return;
    settingsStore.set("rpcShowPlaying", v);
  });

  // Per-app/site excluded keywords (case-insensitive substring match against activity name/details)
  ipcMain.handle("get-rpc-enabled-categories", () =>
    settingsStore.get("rpcEnabledCategories", []),
  );
  ipcMain.on("set-rpc-enabled-categories", (_event, v: unknown) => {
    if (!Array.isArray(v) || !v.every((k) => typeof k === "string")) return;
    settingsStore.set(
      "rpcEnabledCategories",
      v
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 50),
    );
  });

  // --- External URL opener (confirms, then opens in the system/default browser —
  // never a second Electron window) ---
  ipcMain.on("open-external", (_event, url: unknown) => {
    if (typeof url !== "string") return;
    void confirmAndOpenExternal(url, getMainWindow, settingsStore);
  });

  // --- Account language sync (webapp -> desktop shell) ---
  // Lets secondary windows (screen picker, updater) and main-process UI (tray,
  // jump list, external-link dialog) resolve the account's language even
  // before the webapp iframe has loaded, by reading the last-synced value.
  ipcMain.handle("get-account-language", () =>
    settingsStore.get("accountLanguage", null),
  );
  ipcMain.on("set-account-language", (_event, lang: unknown) => {
    if (typeof lang !== "string") return;
    const code = lang.toLowerCase().split(/[-_]/)[0];
    if (
      !SUPPORTED_LOCALE_CODES.includes(
        code as (typeof SUPPORTED_LOCALE_CODES)[number],
      )
    )
      return;
    settingsStore.set("accountLanguage", code);
  });
}
