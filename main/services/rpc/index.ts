import type { BrowserWindow } from "electron";
import {
  startHookProcess,
  stopHookProcess,
  resetHookCounters,
} from "./hook-process";
import { startPollingFallback, stopPollingFallback } from "./polling";
import { resetPipeline } from "./pipeline";
import { state } from "./state";

// ---------------------------------------------------------------------------
export function startRpcPolling(
  getWindow: () => BrowserWindow | null,
  isEnabled: () => boolean,
): void {
  resetPipeline();

  if (process.platform === "win32") {
    state.usingPollingFallback = false;
    resetHookCounters();
    startHookProcess(getWindow, isEnabled);
  } else {
    startPollingFallback(getWindow, isEnabled);
  }
}

export function stopRpcPolling(): void {
  stopHookProcess();
  stopPollingFallback();
  state.usingPollingFallback = false;
  resetHookCounters();
  resetPipeline();
}
