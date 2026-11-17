import { Session, BrowserWindow, ipcMain, desktopCapturer } from "electron";
import path from "path";

const ALLOWED_PERMISSIONS = [
  "media",
  "mediaKeySystem",
  "display-capture",
  "notifications",
  "fullscreen",
  "clipboard-read",
  "clipboard-write",
  "clipboard-sanitized-write",
];

/** True when `urlOrOrigin` belongs to an origin the app itself loads (local shell, bloumechat.com). */
function isTrusted(urlOrOrigin: string, trusted: Set<string>): boolean {
  try {
    return trusted.has(new URL(urlOrOrigin).origin);
  } catch {
    return false;
  }
}

export function initPermissions(
  mainSession: Session,
  getMainWindow: () => BrowserWindow | null,
  getPort: () => number,
  isPackaged: boolean,
  getTrustedOrigins: () => Set<string>,
) {
  // Camera, microphone, screen capture, notifications and clipboard are granted only to
  // the pages the app embeds — never to whatever origin a frame happens to navigate to.
  mainSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const isAllowed =
        ALLOWED_PERMISSIONS.includes(permission) &&
        isTrusted(details.requestingUrl, getTrustedOrigins());
      console.log(
        `[Permissions] Request for: ${permission} -> ${isAllowed ? "GRANTED" : "DENIED"}`,
      );
      callback(isAllowed);
    },
  );

  mainSession.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin) =>
      ALLOWED_PERMISSIONS.includes(permission) &&
      isTrusted(requestingOrigin, getTrustedOrigins()),
  );

  mainSession.setDisplayMediaRequestHandler((request, callback) => {
    const mainWindow = getMainWindow();
    let callbackCalled = false;

    if (!isTrusted(request.securityOrigin, getTrustedOrigins())) {
      console.warn("[ScreenShare] Refused for untrusted origin");
      (callback as () => void)();
      return;
    }

    const smartCallback = (
      cfg?: { video?: Electron.DesktopCapturerSource; audio?: string } | object,
    ) => {
      if (callbackCalled) return;
      callbackCalled = true;
      try {
        if (cfg && ("video" in cfg || "audio" in cfg)) {
          console.log("[ScreenShare] Resolving media request");
          callback(cfg as Parameters<typeof callback>[0]);
        } else {
          console.log("[ScreenShare] Cancelling media request");
          (callback as () => void)();
        }
      } catch (err) {
        console.error("[ScreenShare] Exception in media callback:", err);
      }
    };

    /** Resolves the request with the first screen (used when the custom picker cannot be shown). */
    const shareFirstScreen = async () => {
      try {
        const screens = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 0, height: 0 },
        });
        if (screens[0]) {
          smartCallback({ video: screens[0], audio: "loopback" as const });
          return;
        }
      } catch (err) {
        console.error("[ScreenShare] Fallback screen lookup failed:", err);
      }
      smartCallback({});
    };

    const pickerWin = new BrowserWindow({
      width: 600,
      height: 500,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      modal: true,
      parent: mainWindow || undefined,
      backgroundColor: "#111C44",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        devTools: !isPackaged,
      },
    });

    const port = getPort();
    const url = isPackaged
      ? `http://127.0.0.1:${port}/screen-picker/index.html`
      : `http://localhost:${port}/screen-picker/`;

    console.log("[ScreenShare] Loading picker URL:", url);

    pickerWin.loadURL(url).catch((err) => {
      // The picker UI is served by the local app server; on some machines it fails to load
      // (port taken, firewall, antivirus). Cancelling here left those users with a dead
      // "share screen" button while the browser version worked — fall back to the primary screen.
      console.error(
        "[ScreenShare] Failed to load picker URL, falling back to the primary screen:",
        err,
      );
      void shareFirstScreen();
      if (!pickerWin.isDestroyed()) pickerWin.close();
    });

    const onSelect = (_event: Electron.IpcMainEvent, sourceId: unknown) => {
      if (typeof sourceId !== "string") {
        smartCallback({});
        cleanup();
        return;
      }
      desktopCapturer
        .getSources({ types: ["screen", "window"] })
        .catch(async (err) => {
          console.error(
            "[ScreenShare] getSources(screen+window) failed, retrying screens only:",
            err,
          );
          return desktopCapturer.getSources({
            types: ["screen"],
            thumbnailSize: { width: 0, height: 0 },
          });
        })
        .then((sources) => {
          const source = sources.find((s) => s.id === sourceId);
          if (source) {
            smartCallback({ video: source, audio: "loopback" as const });
          } else {
            console.error("[ScreenShare] Selected source not found");
            smartCallback({});
          }
          cleanup();
        })
        .catch((err) => {
          console.error("[ScreenShare] Error getting sources:", err);
          smartCallback({});
          cleanup();
        });
    };

    const onCancel = () => {
      smartCallback();
      cleanup();
    };

    const cleanup = () => {
      ipcMain.removeListener("select-screen-source", onSelect);
      ipcMain.removeListener("cancel-screen-source", onCancel);
      smartCallback();
      if (pickerWin && !pickerWin.isDestroyed()) pickerWin.close();
    };

    ipcMain.on("select-screen-source", onSelect);
    ipcMain.on("cancel-screen-source", onCancel);
    pickerWin.on("closed", cleanup);
  });
}
