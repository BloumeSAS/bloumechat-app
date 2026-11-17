import { app, BrowserWindow } from "electron";
import type Store from "electron-store";
import type { AppSettings } from "../../types/settings";
import { getUpdateSupport } from "./support";
import {
  getUpdateState,
  setUpdateState,
  onUpdateStateChange,
  toStatusEvent,
} from "./state";
import { startUpdateScheduler } from "./scheduler";
import {
  configureEngine,
  runCheck,
  installNow,
  downloadNow,
} from "./updater-engine";
import { notifyUpdateReady, notifyCheckResult } from "./notifications";
import { registerUpdateIpc } from "./ipc";
import type { UpdateState } from "./types";

export { getUpdateState, onUpdateStateChange } from "./state";
export { getUpdateSupport } from "./support";
export type { UpdateState, UpdateStatus } from "./types";

export interface UpdaterDeps {
  getMainWindow: () => BrowserWindow | null;
  getIconPath: () => string;
  settingsStore: Store<AppSettings>;
  /** True while a voice call runs: no automatic check/download during a call. */
  isVoiceActive: () => boolean;
  /** Tells the window code the app is really quitting (so "minimize to tray" lets go). */
  setQuitting: (value: boolean) => void;
}

let deps: UpdaterDeps | null = null;

/** Restarts into the downloaded update. No-op when nothing is ready. */
export function installUpdateNow(): void {
  if (getUpdateState().status !== "downloaded") return;
  deps?.setQuitting(true);
  installNow();
}

/**
 * One check. `userInitiated` (tray menu) also reports the outcome in a notification;
 * the automatic ones stay silent unless an update is actually ready.
 */
export async function checkForUpdatesNow(
  userInitiated: boolean,
): Promise<UpdateState> {
  const current = getUpdateState();
  if (current.status === "unsupported" || !deps) return current;
  if (["checking", "downloading", "downloaded"].includes(current.status)) {
    return current;
  }

  const result = await runCheck();
  if (userInitiated) {
    const icon = deps.getIconPath();
    if (result.status === "not-available") {
      notifyCheckResult("up-to-date", deps.settingsStore, icon);
    } else if (result.status === "error") {
      notifyCheckResult("error", deps.settingsStore, icon, result.message);
    } else if (
      result.status === "available" ||
      result.status === "downloading"
    ) {
      notifyCheckResult("available", deps.settingsStore, icon, result.version);
    }
  }
  return result;
}

export function initUpdater(d: UpdaterDeps): void {
  deps = d;

  const support = getUpdateSupport();
  if (!support.supported) {
    console.log(`[Updater] Self-update disabled (${support.reason})`);
    setUpdateState({ status: "unsupported", reason: support.reason });
  } else {
    configureEngine({
      onDownloaded: (version) =>
        notifyUpdateReady(
          version,
          d.settingsStore,
          d.getIconPath(),
          installUpdateNow,
        ),
    });
    startUpdateScheduler(
      () => checkForUpdatesNow(false).then(() => undefined),
      d.isVoiceActive,
    );
  }

  onUpdateStateChange((state) => {
    const event = toStatusEvent(state);
    if (event) d.getMainWindow()?.webContents.send("update-status", event);
  });

  registerUpdateIpc({
    check: checkForUpdatesNow,
    install: installUpdateNow,
    download: downloadNow,
    simulate: app.isPackaged
      ? undefined
      : () => setUpdateState({ status: "available", version: "9.9.9" }),
  });
}
