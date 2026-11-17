import { execFile } from "child_process";
import type { BrowserWindow } from "electron";
import { PS_CMD, MACOS_CMD } from "./scripts";
import { handleReading } from "./pipeline";

// ---------------------------------------------------------------------------
let pollTimer: ReturnType<typeof setTimeout> | null = null;

// Adaptive interval — spawning a PowerShell/osascript process every tick has a
// real cost, so once the SAME recognized activity has been stable for a while we
// back off (up to MAX_POLL_INTERVAL_MS). Any change — including landing on our
// OWN blocklisted app, which is treated the same as a change so polling stays
// fast for the switch that's likely coming right after — snaps back to MIN.
const MIN_POLL_INTERVAL_MS = 1_500;
const MAX_POLL_INTERVAL_MS = 6_000;
const BACKOFF_STEP_MS = 1_500;
let currentIntervalMs = MIN_POLL_INTERVAL_MS;
let stableStreak = 0;

export function startPollingFallback(
  getWindow: () => BrowserWindow | null,
  isEnabled: () => boolean,
): void {
  if (pollTimer !== null) return;

  const scheduleNext = () => {
    pollTimer = setTimeout(poll, currentIntervalMs);
  };

  const onPollSettled = (result: "changed" | "blocked" | "unchanged") => {
    if (result === "unchanged") {
      stableStreak++;
      currentIntervalMs = Math.min(
        MAX_POLL_INTERVAL_MS,
        MIN_POLL_INTERVAL_MS + stableStreak * BACKOFF_STEP_MS,
      );
    } else {
      currentIntervalMs = MIN_POLL_INTERVAL_MS;
      stableStreak = 0;
    }
    scheduleNext();
  };

  const poll = () => {
    if (!isEnabled()) {
      scheduleNext();
      return;
    }

    if (process.platform === "win32") {
      execFile(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-WindowStyle",
          "Hidden",
          "-Command",
          PS_CMD,
        ],
        { timeout: 2500 },
        (err, stdout) => {
          if (err || !stdout.trim()) {
            onPollSettled("unchanged");
            return;
          }
          let parsed: {
            n: string;
            t: string;
            p?: string | null;
            u?: string | null;
          };
          try {
            parsed = JSON.parse(stdout.trim());
          } catch {
            onPollSettled("unchanged");
            return;
          }
          void handleReading(
            parsed.n || "",
            parsed.t || "",
            parsed.p || "",
            parsed.u || "",
            getWindow,
          ).then(onPollSettled);
        },
      );
    } else if (process.platform === "darwin") {
      execFile(
        "osascript",
        ["-e", MACOS_CMD],
        { timeout: 3000 },
        (err, stdout) => {
          if (err || !stdout.trim()) {
            onPollSettled("unchanged");
            return;
          }
          const raw = stdout.trim();
          const firstPipe = raw.indexOf("|");
          if (firstPipe === -1) {
            onPollSettled("unchanged");
            return;
          }
          const procName = raw.substring(0, firstPipe).trim();
          const remainder = raw.substring(firstPipe + 1);
          const lastPipe = remainder.lastIndexOf("|");
          const winTitle = (
            lastPipe === -1 ? remainder : remainder.substring(0, lastPipe)
          ).trim();
          const browserUrl = (
            lastPipe === -1 ? "" : remainder.substring(lastPipe + 1)
          ).trim();
          // macOS: executable path not resolved here → icon falls back to brand/Lucide.
          void handleReading(
            procName,
            winTitle,
            "",
            browserUrl,
            getWindow,
          ).then(onPollSettled);
        },
      );
    } else {
      // Linux / other platforms: not supported (no reliable cross-distro foreground window API)
      scheduleNext();
    }
  };

  currentIntervalMs = MIN_POLL_INTERVAL_MS;
  stableStreak = 0;
  poll();
}

export function stopPollingFallback(): void {
  if (pollTimer !== null) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  currentIntervalMs = MIN_POLL_INTERVAL_MS;
  stableStreak = 0;
}

// ---------------------------------------------------------------------------
// Public API
