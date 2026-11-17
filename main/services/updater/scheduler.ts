/** First automatic check, a little after startup so it never competes with the window loading. */
export const FIRST_CHECK_DELAY_MS = 45_000;
/** Then one check every few hours — an app left open for days still picks releases up. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Spread the load on GitHub: every client adds up to this much to each interval. */
export const CHECK_JITTER_MS = 10 * 60 * 1000;
/** When a check is skipped (e.g. in a call), try again soon rather than waiting a full interval. */
export const SKIPPED_RETRY_MS = 5 * 60 * 1000;

export interface UpdateScheduler {
  stop(): void;
}

/**
 * Runs `check` automatically: once after FIRST_CHECK_DELAY_MS, then every CHECK_INTERVAL_MS
 * (+ jitter). `shouldSkip` lets the caller postpone a check (a voice call is running: do not
 * start a download that would eat the bandwidth of the call).
 */
export function startUpdateScheduler(
  check: () => Promise<void>,
  shouldSkip: () => boolean,
  random: () => number = Math.random,
): UpdateScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = (delay: number) => {
    if (stopped) return;
    timer = setTimeout(run, delay);
    // A pending update check must never keep the process alive on its own.
    timer.unref?.();
  };

  const run = async () => {
    if (stopped) return;
    if (shouldSkip()) {
      schedule(SKIPPED_RETRY_MS);
      return;
    }
    try {
      await check();
    } catch (e) {
      console.warn("[Updater] scheduled check failed:", e);
    }
    schedule(CHECK_INTERVAL_MS + Math.floor(random() * CHECK_JITTER_MS));
  };

  schedule(FIRST_CHECK_DELAY_MS);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
