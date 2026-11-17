import React, { useEffect, useRef } from "react";
import type { DesktopDict } from "../lib/i18n";

/** Waits between automatic retries (seconds); the last value repeats. */
const RETRY_DELAYS_S = [4, 8, 15, 30, 60];

interface OfflineOverlayProps {
  dict: DesktopDict["home"];
  /** Reloads the site; the overlay stays until the main process reports it loaded. */
  onRetry: () => void;
}

/**
 * Shown over the site area when the remote site could not be loaded (no network, DNS, the
 * service is down). Retries by itself with a growing delay, immediately when the network
 * comes back, and on demand.
 */
export function OfflineOverlay({ dict, onRetry }: OfflineOverlayProps) {
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef(onRetry);
  retryRef.current = onRetry;

  useEffect(() => {
    const schedule = () => {
      const delay =
        RETRY_DELAYS_S[Math.min(attempt.current, RETRY_DELAYS_S.length - 1)];
      timer.current = setTimeout(() => {
        attempt.current++;
        retryRef.current();
        schedule();
      }, delay * 1000);
    };
    schedule();

    const onOnline = () => {
      if (timer.current) clearTimeout(timer.current);
      attempt.current = 0;
      retryRef.current();
      schedule();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <img src="/images/logo.png" alt="" className="h-20 w-20 opacity-80" />
      <h2 className="text-lg font-bold text-foreground">
        {dict.offline_title}
      </h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        {dict.offline_desc}
      </p>
      <button
        onClick={() => {
          attempt.current = 0;
          onRetry();
        }}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {dict.offline_retry}
      </button>
    </div>
  );
}
