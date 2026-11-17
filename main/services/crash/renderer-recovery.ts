import type { BrowserWindow } from "electron";
import log from "electron-log";
import { isAppQuitting } from "../app-state";

/** More than this many crashes inside the window = something is wrong at startup, back off. */
const MAX_RELOADS_IN_WINDOW = 3;
const WINDOW_MS = 60_000;
const BACKOFF_MS = 30_000;

/**
 * Reloads the window when its renderer dies (crash, out of memory, killed), but never in
 * a tight loop: a renderer that crashes on load would otherwise reload — and crash — as
 * fast as the machine allows, freezing the whole app.
 */
export function attachRendererRecovery(win: BrowserWindow): void {
  const crashTimes: number[] = [];

  win.webContents.on("render-process-gone", (_event, details) => {
    log.error("[Renderer] Process gone:", details.reason, details.exitCode);
    if (details.reason === "clean-exit" || isAppQuitting()) return;

    const now = Date.now();
    crashTimes.push(now);
    while (crashTimes.length && now - crashTimes[0] > WINDOW_MS) {
      crashTimes.shift();
    }

    const reload = () => {
      if (!win.isDestroyed() && !isAppQuitting()) win.webContents.reload();
    };
    if (crashTimes.length <= MAX_RELOADS_IN_WINDOW) {
      reload();
    } else {
      log.warn(`[Renderer] Crash loop — next reload in ${BACKOFF_MS / 1000}s`);
      setTimeout(reload, BACKOFF_MS);
    }
  });

  win.webContents.on("unresponsive", () =>
    log.warn("[Renderer] Became unresponsive"),
  );
  win.webContents.on("responsive", () =>
    log.info("[Renderer] Responsive again"),
  );
}
