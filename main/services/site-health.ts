import { webFrameMain } from "electron";
import type { BrowserWindow } from "electron";

/** Chromium's "request cancelled" code — a navigation replaced by another one, not a failure. */
const ERR_ABORTED = -3;

/** A failure only explains the "load finished" that follows it immediately. */
export const FAILURE_MEMORY_MS = 10_000;

/**
 * When a frame fails to load, Chromium shows its own error page inside it and then reports
 * "finished loading" for that page — carrying the URL that FAILED, not an error URL. Taken
 * at face value that looks like success and cancels the failure: this tracker remembers the
 * failed URLs so the error page's "finished" is recognised for what it is.
 */
export function createFailureTracker(now: () => number = Date.now) {
  const failed = new Map<string, number>();
  return {
    recordFailure(url: string) {
      failed.set(url, now());
    },
    /** True when this "finished" is the error page of a recent failure for the same URL. */
    isErrorPage(url: string): boolean {
      const at = failed.get(url);
      if (at === undefined) return false;
      failed.delete(url);
      return now() - at <= FAILURE_MEMORY_MS;
    },
  };
}

/**
 * Tells the home shell whether the remote site (the iframe) could be loaded. When the
 * network is down Chromium silently swaps the iframe for its own error page, and the user
 * was left staring at it with no way back; the shell now shows a retry panel instead.
 */
export function attachSiteHealth(win: BrowserWindow, siteOrigin: string): void {
  const isSite = (url: string) => {
    try {
      return new URL(url).origin === siteOrigin;
    } catch {
      return false;
    }
  };
  const send = (payload: { ok: boolean; code?: number; reason?: string }) => {
    if (!win.isDestroyed()) win.webContents.send("site-status", payload);
  };
  const tracker = createFailureTracker();

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (errorCode === ERR_ABORTED || isMainFrame) return;
      if (isSite(validatedURL)) {
        console.warn(`[Site] Load failed: ${errorDescription} (${errorCode})`);
        tracker.recordFailure(validatedURL);
        send({ ok: false, code: errorCode, reason: errorDescription });
      }
    },
  );

  win.webContents.on(
    "did-frame-finish-load",
    (_event, isMainFrame, frameProcessId, frameRoutingId) => {
      if (isMainFrame) return;
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      if (!frame || !isSite(frame.url)) return;
      if (tracker.isErrorPage(frame.url)) return;
      send({ ok: true });
    },
  );
}
