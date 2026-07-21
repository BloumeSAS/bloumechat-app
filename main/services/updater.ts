import { autoUpdater } from "electron-updater";
import {
  BrowserWindow,
  Notification,
  nativeImage,
  ipcMain,
  app,
} from "electron";

// TODO: once a CA-issued OV/EV certificate is obtained, remove these two lines
// and re-enable update signature verification for security.
// Current certificate is self-signed — Windows rejects it with UntrustedRoot.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
(autoUpdater as any).verifyUpdateCodeSignature = false;

const readyI18n = {
  fr: {
    title: "BloumeChat — Mise à jour prête",
    body: (v: string) =>
      `La version ${v} a été téléchargée. Cliquez pour redémarrer et l'installer.`,
  },
  en: {
    title: "BloumeChat — Update ready",
    body: (v: string) =>
      `Version ${v} has been downloaded. Click to restart and install.`,
  },
} as const;

function getReadyLocaleStrings() {
  const locale = app.getLocale()?.toLowerCase() || "fr";
  return locale.startsWith("fr") ? readyI18n.fr : readyI18n.en;
}

export function initUpdater(
  getMainWindow: () => BrowserWindow | null,
  getAppIconPath: () => string,
  _getProdPort: () => number,
  _isProd: boolean,
) {
  autoUpdater.requestHeaders = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  };
  // Download silently in the background as soon as an update is found — no click
  // required to start fetching it. The user is only interrupted once it's ready
  // to install (see 'update-downloaded' below).
  autoUpdater.autoDownload = true;

  let isUpdateIgnored = false;

  autoUpdater.on("checking-for-update", () =>
    getMainWindow()?.webContents.send("update-status", { status: "checking" }),
  );

  autoUpdater.on("update-available", (info) => {
    // Just informs the renderer (e.g. a subtle "updating…" indicator) — the
    // download already started automatically, so no click is needed here.
    getMainWindow()?.webContents.send("update-status", {
      status: "available",
      info,
    });
  });

  autoUpdater.on("update-not-available", (info) =>
    getMainWindow()?.webContents.send("update-status", {
      status: "not-available",
      info,
    }),
  );
  autoUpdater.on("error", (err: Error) =>
    getMainWindow()?.webContents.send("update-status", {
      status: "error",
      message: err.message,
    }),
  );
  autoUpdater.on("download-progress", (progressObj) =>
    getMainWindow()?.webContents.send("update-status", {
      status: "downloading",
      progress: progressObj,
    }),
  );

  autoUpdater.on("update-downloaded", (info) => {
    const mainWindow = getMainWindow();
    mainWindow?.webContents.send("update-status", {
      status: "downloaded",
      info,
    });
    if (isUpdateIgnored) return;

    const { title, body } = getReadyLocaleStrings();
    const icon = nativeImage.createFromPath(getAppIconPath());
    const notification = new Notification({
      title,
      body: body(info.version),
      icon,
    });

    // Only action left for the user: click to restart & install (auto-download
    // already happened, no OV/EV cert yet so SmartScreen may still warn on launch).
    notification.on("click", () => autoUpdater.quitAndInstall(true, true));
    notification.show();
  });

  ipcMain.on("ignore-update", () => {
    isUpdateIgnored = true;
  });
  ipcMain.on("quit-and-install", () => autoUpdater.quitAndInstall(true, true));
  ipcMain.on("start-download", () => autoUpdater.downloadUpdate());
  ipcMain.on("check-for-updates", () => autoUpdater.checkForUpdatesAndNotify());
  ipcMain.on("simulate-update", () =>
    getMainWindow()?.webContents.send("update-status", {
      status: "available",
      info: { version: "9.9.9" },
    }),
  );
}
