import { app } from "electron";
import log from "electron-log";

/**
 * Last line of defence of the main process. Without these, an uncaught exception
 * pops Electron's native "A JavaScript error occurred in the main process" box in
 * front of the user (and the same for unhandled promise rejections). Everything is logged to main.log instead (the app keeps
 * running: a failed tray rebuild or one bad IPC call must not take the app down).
 */
export function installProcessErrorHandlers(): void {
  log.errorHandler.startCatching({ showDialog: false });

  // Renderers of secondary windows (screen picker, link confirmation).
  app.on("render-process-gone", (_event, _contents, details) => {
    log.error(
      `[Process] renderer gone: ${details.reason} (exit ${details.exitCode})`,
    );
  });

  // Native child processes (GPU, utility, network service) dying is recoverable —
  // Chromium restarts them — but worth knowing about when diagnosing a user report.
  app.on("child-process-gone", (_event, details) => {
    log.error(
      `[Process] ${details.type} process gone: ${details.reason} (exit ${details.exitCode})`,
    );
  });
}
