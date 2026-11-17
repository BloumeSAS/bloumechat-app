import type { BrowserWindow } from "electron";
import type Store from "electron-store";
import type { AppSettings } from "../types/settings";

const MIN_ZOOM = -3;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;

/** Ctrl +, Ctrl -, Ctrl 0 — zoom persisted across restarts. Restores the saved zoom now. */
export function installZoomShortcuts(
  win: BrowserWindow,
  settingsStore: Store<AppSettings>,
): void {
  win.webContents.setZoomLevel(settingsStore.get("zoomLevel", 0));

  const apply = (level: number) => {
    win.webContents.setZoomLevel(level);
    settingsStore.set("zoomLevel", level);
  };

  win.webContents.on("before-input-event", (event, input) => {
    if (!input.control || input.alt || input.shift) return;
    const current = win.webContents.getZoomLevel() || 0;
    if (input.key === "=" || input.key === "+") {
      event.preventDefault();
      apply(Math.min(current + ZOOM_STEP, MAX_ZOOM));
    } else if (input.key === "-") {
      event.preventDefault();
      apply(Math.max(current - ZOOM_STEP, MIN_ZOOM));
    } else if (input.key === "0") {
      event.preventDefault();
      apply(0);
    }
  });
}
