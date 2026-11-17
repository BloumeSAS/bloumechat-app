import path from "path";
import { app, crashReporter } from "electron";
import type { AppConfig } from "../config";

/**
 * Native crash reporter: writes minidumps under userData/CrashDumps and, when
 * CRASH_REPORT_URL is configured, uploads them to the admin panel.
 *
 * Reports are gzip-compressed (Electron's default; the uncompressed mode is deprecated).
 * The ingestion endpoint (server-nest crash-report-upload.ts) inflates them — before that
 * fix its multipart parser could not read the gzip body, so every report was rejected (400)
 * and none ever reached the admin panel. Deploy the server BEFORE releasing the app.
 */
export function startCrashReporter(appConfig: AppConfig): void {
  const submitURL =
    typeof appConfig.CRASH_REPORT_URL === "string"
      ? appConfig.CRASH_REPORT_URL
      : "";
  app.setPath("crashDumps", path.join(app.getPath("userData"), "CrashDumps"));
  crashReporter.start({
    submitURL,
    uploadToServer: Boolean(submitURL),
    compress: true,
    ignoreSystemCrashHandler: false,
    globalExtra: {
      _version: app.getVersion(),
      _platform: process.platform,
    },
  });
}
