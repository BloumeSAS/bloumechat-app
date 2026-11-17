import type { BrowserWindow, Tray } from "electron";
import type Store from "electron-store";
import type { AppSettings } from "../types/settings";
import { isAppQuitting } from "./app-state";
import { getAppLocale, getI18n } from "./locales";
import { reapplyThumbar } from "./thumbar";

/**
 * Close = hide to the tray (unless the user turned that off or the app is really quitting),
 * and the taskbar thumbnail buttons are put back whenever the window comes back.
 */
export function installWindowLifecycle(
  win: BrowserWindow,
  settingsStore: Store<AppSettings>,
  getTray: () => Tray | null,
): void {
  // Windows drops the thumbnail toolbar whenever the window is hidden and shown again.
  win.on("show", () => reapplyThumbar(win));
  win.on("restore", () => reapplyThumbar(win));

  win.on("close", (event) => {
    if (isAppQuitting()) return;
    if (!settingsStore.get("minimizeToTray", true)) return;

    event.preventDefault();
    settingsStore.set("wasMaximized", win.isMaximized());
    win.hide();

    if (!settingsStore.get("trayNoticeShown", false)) {
      getTray()?.displayBalloon({
        iconType: "info",
        title: "BloumeChat",
        content: getI18n(getAppLocale()).trayNotice,
      });
      settingsStore.set("trayNoticeShown", true);
    }
  });
}
