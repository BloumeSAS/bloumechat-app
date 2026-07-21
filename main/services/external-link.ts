// Confirms with the user before handing a link off to their system browser.
// Used both by same-window link interception (background.ts) and the explicit
// `open-external` IPC channel (ipc-handlers.ts) so every "leave the app" path
// goes through one gate — see BloumeChat.com/CLAUDE.md rule about never
// silently popping a second Electron window for links.
import { BrowserWindow, dialog, shell } from "electron";
import type Store from "electron-store";
import type { AppSettings } from "../types/settings";
import { getExternalLinkI18n, resolveMainProcessLocale } from "./locales";

/** Only http/https are ever handed to the OS shell — blocks file://, javascript://, etc. */
function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Shows a native confirm dialog ("Open this link in your browser?") and, if
 * accepted, opens `url` via `shell.openExternal` — which hands it to the OS
 * default browser (or an already-open window of it), never a second Electron
 * window. Silently no-ops on unsafe/malformed URLs.
 */
export async function confirmAndOpenExternal(
  url: string,
  getMainWindow: () => BrowserWindow | null,
  settingsStore: Store<AppSettings>,
): Promise<void> {
  if (!isSafeExternalUrl(url)) {
    console.warn("[Navigation] Blocked unsafe external URL:", url);
    return;
  }

  const locale = resolveMainProcessLocale(settingsStore);
  const t = getExternalLinkI18n(locale);
  const parent = getMainWindow();

  const displayUrl = url.length > 90 ? `${url.slice(0, 87)}...` : url;

  const { response } = parent
    ? await dialog.showMessageBox(parent, {
        type: "question",
        buttons: [t.openButton, t.cancelButton],
        defaultId: 0,
        cancelId: 1,
        title: t.title,
        message: t.message,
        detail: displayUrl,
        noLink: true,
      })
    : await dialog.showMessageBox({
        type: "question",
        buttons: [t.openButton, t.cancelButton],
        defaultId: 0,
        cancelId: 1,
        title: t.title,
        message: t.message,
        detail: displayUrl,
        noLink: true,
      });

  if (response === 0) {
    shell.openExternal(url);
  }
}
