import path from "path";
import { app } from "electron";
import { getAppLocale, getI18n } from "./locales";

/**
 * Registering the bloumechat:// handler or the jump list changes per-user OS state that
 * outlives the process. Automated runs (tests, a build under inspection) set this variable
 * so they never overwrite the real installation's registration.
 */
export function shouldSkipOsIntegration(): boolean {
  return process.env.BLOUME_SKIP_OS_INTEGRATION === "1";
}

/** Makes bloumechat:// links open this app. */
export function registerProtocolClient(): void {
  if (shouldSkipOsIntegration()) return;
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("bloumechat", process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient("bloumechat");
  }
}

/** Taskbar right-click menu: a single safe "Open" task. */
export function applyJumpList(): void {
  if (process.platform !== "win32" || shouldSkipOsIntegration()) return;
  try {
    const i18n = getI18n(getAppLocale());
    app.setJumpList([
      {
        type: "tasks",
        items: [
          {
            type: "task",
            title: i18n.trayOpen,
            description: i18n.trayOpen,
            program: process.execPath,
            args: app.isPackaged ? "" : `"${app.getAppPath()}"`,
            iconPath: process.execPath,
            iconIndex: 0,
          },
        ],
      },
    ]);
  } catch (e) {
    console.warn("[JumpList] Failed to set:", e);
  }
}

/** The bloumechat:// link the app was launched with (cold start), if any. */
export function findLaunchDeepLink(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith("bloumechat://"));
}
