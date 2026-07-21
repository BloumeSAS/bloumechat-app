// Confirms with the user before handing a link off to their system browser.
// Used both by same-window link interception (background.ts) and the explicit
// `open-external` IPC channel (ipc-handlers.ts) so every "leave the app" path
// goes through one gate — see BloumeChat.com/CLAUDE.md rule about never
// silently popping a second Electron window for links.
//
// The confirmation itself is a small frameless BrowserWindow (mirroring the
// screen-share picker in permissions.ts) instead of the native OS
// dialog.showMessageBox — consistent in-app styling instead of a plain
// Windows message box.
import { BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import type Store from "electron-store";
import type { AppSettings } from "../types/settings";

/** Only http/https are ever handed to the OS shell — blocks file://, javascript://, etc. */
function isSafeExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Shows the in-app "Open this link in your browser?" confirm modal and, if
 * accepted, opens `url` via `shell.openExternal` — which hands it to the OS
 * default browser (or an already-open window of it), never a second Electron
 * window. Silently no-ops on unsafe/malformed URLs.
 *
 * `settingsStore` isn't read directly here — kept in the signature so every
 * call site (background.ts) stays uniform with the other services taking it;
 * the confirm window's own page resolves its language independently via
 * `window.ipc.getAccountLanguage()`, same as the screen-share picker.
 */
export async function confirmAndOpenExternal(
  url: string,
  getMainWindow: () => BrowserWindow | null,
  _settingsStore: Store<AppSettings>,
  getPort: () => number,
  isPackaged: boolean,
): Promise<void> {
  if (!isSafeExternalUrl(url)) {
    console.warn("[Navigation] Blocked unsafe external URL:", url);
    return;
  }

  const confirmed = await showExternalLinkConfirmWindow({
    parent: getMainWindow(),
    url,
    getPort,
    isPackaged,
  });

  if (confirmed) {
    shell.openExternal(url);
  }
}

function showExternalLinkConfirmWindow(opts: {
  parent: BrowserWindow | null;
  url: string;
  getPort: () => number;
  isPackaged: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const { parent, url, getPort, isPackaged } = opts;

    const confirmWin = new BrowserWindow({
      width: 440,
      height: 280,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      modal: true,
      parent: parent || undefined,
      backgroundColor: "#111C44",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        devTools: !isPackaged,
      },
    });

    const port = getPort();
    const query = `?url=${encodeURIComponent(url)}`;
    const loadUrl = isPackaged
      ? `http://127.0.0.1:${port}/external-link-confirm/index.html${query}`
      : `http://localhost:${port}/external-link-confirm/${query}`;

    confirmWin.loadURL(loadUrl).catch((err) => {
      console.error("[ExternalLink] Failed to load confirm URL:", err);
      settle(false);
    });

    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
      if (!confirmWin.isDestroyed()) confirmWin.close();
    };

    const onConfirm = () => settle(true);
    const onCancel = () => settle(false);

    const cleanup = () => {
      ipcMain.removeListener("confirm-external-link", onConfirm);
      ipcMain.removeListener("cancel-external-link", onCancel);
    };

    ipcMain.on("confirm-external-link", onConfirm);
    ipcMain.on("cancel-external-link", onCancel);
    confirmWin.on("closed", () => settle(false));
  });
}
