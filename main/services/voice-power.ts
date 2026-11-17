import { powerSaveBlocker } from "electron";
import type { BrowserWindow } from "electron";

let blockerId: number | null = null;

/**
 * While a call is running:
 *  - Chromium must not throttle the hidden/minimized window — throttled timers delay the
 *    socket heartbeat and the call can drop after a few minutes in the tray;
 *  - the system must not suspend the app (sleep) in the middle of a conversation.
 * Both are undone as soon as the call ends, so an idle app stays cheap on battery.
 */
export function setVoicePowerMode(
  active: boolean,
  win: BrowserWindow | null,
): void {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.setBackgroundThrottling(!active);
    }
    if (active && blockerId === null) {
      blockerId = powerSaveBlocker.start("prevent-app-suspension");
    } else if (!active && blockerId !== null) {
      powerSaveBlocker.stop(blockerId);
      blockerId = null;
    }
  } catch (e) {
    console.warn("[Voice] power mode failed:", e);
  }
}
