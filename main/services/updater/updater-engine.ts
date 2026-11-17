import { autoUpdater } from "electron-updater";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import log from "electron-log";
import { setUpdateState, getUpdateState } from "./state";
import type { UpdateState } from "./types";

/** Versions whose download or verification already failed: not retried until the app restarts. */
const failedVersions = new Set<string>();

/** Looks like a rejected signature / corrupted download (as opposed to "offline"). */
function isIntegrityError(err: Error & { code?: string }): boolean {
  return (
    err.code === "ERR_UPDATER_INVALID_SIGNATURE" ||
    /sha512|checksum|signature/i.test(err.message)
  );
}

/**
 * Configures electron-updater and maps its events onto the shared UpdateState.
 * Signature verification stays ON (the default): the installer must be signed by
 * the publisher named in app-update.yml (`win.publisherName`), otherwise the
 * downloaded file is deleted and the update refused.
 */
export function configureEngine(hooks: {
  onDownloaded(version: string): void;
}): void {
  autoUpdater.logger = log;
  // Downloads are started by us (below) so a version that already failed is not
  // downloaded again every few hours.
  autoUpdater.autoDownload = false;
  // Not installed when the user leaves, only when they chose to — but if they just
  // quit the app, the update is applied silently on the way out.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.requestHeaders = { "Cache-Control": "no-cache" };

  autoUpdater.on("checking-for-update", () =>
    setUpdateState({ status: "checking" }),
  );

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    if (failedVersions.has(info.version)) {
      log.warn(`[Updater] ${info.version} failed before — not retried`);
      setUpdateState({
        status: "error",
        version: info.version,
        message: "Update previously failed",
      });
      return;
    }
    setUpdateState({ status: "available", version: info.version });
    void autoUpdater.downloadUpdate().catch((e: Error) => {
      log.error("[Updater] download failed:", e);
    });
  });

  autoUpdater.on("update-not-available", () =>
    setUpdateState({ status: "not-available" }),
  );

  autoUpdater.on("download-progress", (p: ProgressInfo) => {
    const current = getUpdateState();
    setUpdateState({
      status: "downloading",
      version: current.version,
      percent: Math.round(p.percent),
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    setUpdateState({ status: "downloaded", version: info.version });
    hooks.onDownloaded(info.version);
  });

  autoUpdater.on("error", (err: Error & { code?: string }) => {
    const version = getUpdateState().version;
    if (version && isIntegrityError(err)) failedVersions.add(version);
    log.warn("[Updater] error:", err.message);
    setUpdateState({
      status: "error",
      version,
      // A network blip is normal for a background check: keep the message short.
      message: err.message.split("\n")[0].slice(0, 300),
    });
  });
}

/** Runs one check; never throws (the "error" event already updated the state). */
export async function runCheck(): Promise<UpdateState> {
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    // The 'error' event handler above already recorded it.
    log.warn("[Updater] check rejected:", (e as Error).message);
  }
  return getUpdateState();
}

/** Restarts the app into the downloaded installer. Silent, and runs the app again afterwards. */
export function installNow(): void {
  autoUpdater.quitAndInstall(true, true);
}

export function downloadNow(): void {
  void autoUpdater.downloadUpdate().catch((e: Error) => {
    log.error("[Updater] manual download failed:", e);
  });
}
