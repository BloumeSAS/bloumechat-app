import { ipcMain } from "electron";
import { getUpdateState } from "./state";
import type { UpdateState } from "./types";

/** A second "check now" within this window is ignored (double click, polling renderer). */
const MIN_USER_CHECK_GAP_MS = 5_000;

export interface UpdateIpcActions {
  check(userInitiated: boolean): Promise<UpdateState>;
  install(): void;
  download(): void;
  /** Dev only: pretend an update exists so the UI can be exercised. */
  simulate?: () => void;
}

/**
 * IPC surface of the updater (see preload.ts). Every handler validates the current
 * state itself, so a misbehaving renderer cannot start a download or an install that
 * the updater did not offer.
 */
export function registerUpdateIpc(actions: UpdateIpcActions): void {
  let lastUserCheck = 0;

  ipcMain.handle("get-update-state", () => getUpdateState());

  ipcMain.on("check-for-updates", () => {
    const now = Date.now();
    if (now - lastUserCheck < MIN_USER_CHECK_GAP_MS) return;
    lastUserCheck = now;
    void actions.check(true);
  });

  ipcMain.on("start-download", () => {
    if (getUpdateState().status === "available") actions.download();
  });

  ipcMain.on("quit-and-install", () => {
    if (getUpdateState().status === "downloaded") actions.install();
  });

  // Kept for the /update page's "later" button — nothing to remember: the
  // downloaded update installs on the next quit anyway.
  ipcMain.on("ignore-update", () => undefined);

  if (actions.simulate) ipcMain.on("simulate-update", actions.simulate);
}
