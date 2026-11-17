import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { BrowserWindow } from "electron";
import { HOOK_PS_CMD } from "./scripts";
import { handleReading } from "./pipeline";
import { startPollingFallback } from "./polling";
import { state } from "./state";

// Windows persistent hook process lifecycle (see scripts.ts for the PowerShell it runs).
let hookProcess: ChildProcessWithoutNullStreams | null = null;
let hookStdoutBuffer = "";
let hookRestartTimer: ReturnType<typeof setTimeout> | null = null;
let hookStartedAt = 0;
let hookEarlyExitCount = 0;

// If the hook process dies within this long of starting, count it as a
// startup failure (bad PowerShell policy, Add-Type blocked, etc.) rather than
// a transient crash — after a few of those in a row, give up on the hook and
// drop to the old single-shot polling path for the rest of the session.
const HOOK_EARLY_EXIT_MS = 5_000;
const HOOK_MAX_EARLY_EXITS = 3;
const HOOK_RESTART_DELAY_MS = 2_000;

/** A fresh start (re-enabled in settings, screen unlocked) gets its full retry budget again. */
export function resetHookCounters(): void {
  hookEarlyExitCount = 0;
}

export function stopHookProcess(): void {
  if (hookRestartTimer !== null) {
    clearTimeout(hookRestartTimer);
    hookRestartTimer = null;
  }
  if (hookProcess) {
    hookProcess.removeAllListeners();
    hookProcess.kill();
    hookProcess = null;
  }
  hookStdoutBuffer = "";
}

export function startHookProcess(
  getWindow: () => BrowserWindow | null,
  isEnabled: () => boolean,
): void {
  if (hookProcess || state.usingPollingFallback) return;

  hookStartedAt = Date.now();
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-WindowStyle",
      "Hidden",
      "-Command",
      HOOK_PS_CMD.replace("__PARENT_PID__", String(process.pid)),
    ],
    { windowsHide: true },
  );
  hookProcess = child;

  child.stdout.on("data", (chunk: Buffer) => {
    hookStdoutBuffer += chunk.toString("utf8");
    // A line never comes close to this; a stream without newlines must not grow without bound.
    if (hookStdoutBuffer.length > 1_000_000) hookStdoutBuffer = "";
    let idx: number;

    while ((idx = hookStdoutBuffer.indexOf("\n")) !== -1) {
      const line = hookStdoutBuffer.slice(0, idx).trim();
      hookStdoutBuffer = hookStdoutBuffer.slice(idx + 1);
      if (!line) continue;
      if (!isEnabled()) continue;
      let parsed: {
        n: string;
        t: string;
        p?: string | null;
        u?: string | null;
      };
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      void handleReading(
        parsed.n || "",
        parsed.t || "",
        parsed.p || "",
        parsed.u || "",
        getWindow,
      );
    }
  });

  child.on("error", (err) => {
    console.error("[RPC] Hook process error:", err);
  });

  child.on("exit", (code) => {
    if (hookProcess !== child) return; // already superseded (stop/restart raced)
    hookProcess = null;

    const ranMs = Date.now() - hookStartedAt;
    if (ranMs < HOOK_EARLY_EXIT_MS) {
      hookEarlyExitCount++;
      console.warn(
        `[RPC] Hook process exited early (code ${code}, ran ${ranMs}ms) — attempt ${hookEarlyExitCount}/${HOOK_MAX_EARLY_EXITS}`,
      );
      if (hookEarlyExitCount >= HOOK_MAX_EARLY_EXITS) {
        console.warn(
          "[RPC] Falling back to single-shot polling for this session",
        );
        state.usingPollingFallback = true;
        startPollingFallback(getWindow, isEnabled);
        return;
      }
    } else {
      // Ran fine for a while then died (e.g. killed by AV) — just respawn.
      hookEarlyExitCount = 0;
    }

    if (state.usingPollingFallback) return;
    hookRestartTimer = setTimeout(
      () => startHookProcess(getWindow, isEnabled),
      HOOK_RESTART_DELAY_MS,
    );
  });
}

// ---------------------------------------------------------------------------
// Polling fallback — used for macOS always, and for Windows only if the event
// hook repeatedly fails to start.
