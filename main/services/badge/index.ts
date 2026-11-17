import fs from "fs";
import { BrowserWindow, Tray, app } from "electron";
import {
  createBadgeIcon,
  createMicOverlayIcon,
  createTrayLiveIcon,
  prewarmBadgeCache,
} from "./icons";

export { createBadgeIcon, createMicOverlayIcon, prewarmBadgeCache };

let currentBadgeCount = 0;
let isVoiceActive = false;
let baseTrayIconPath = "";

export function getCurrentBadgeCount() {
  return currentBadgeCount;
}

/** True while a voice call is running (the renderer reports it through IPC). */
export function isVoiceCallActive() {
  return isVoiceActive;
}

export function initBadge(trayIconPath: string) {
  baseTrayIconPath = trayIconPath;
}

/**
 * Windows shows ONE overlay icon on the taskbar button: the green microphone while in a
 * call, otherwise the red unread count, otherwise nothing.
 */
function applyTaskbarOverlay(mainWindow: BrowserWindow) {
  if (process.platform !== "win32") return;
  try {
    if (isVoiceActive) {
      mainWindow.setOverlayIcon(createMicOverlayIcon(), "");
    } else if (currentBadgeCount > 0) {
      mainWindow.setOverlayIcon(
        createBadgeIcon(currentBadgeCount),
        String(currentBadgeCount),
      );
    } else {
      mainWindow.setOverlayIcon(null, "");
    }
  } catch (e) {
    console.warn("[Badge] setOverlayIcon failed:", e);
  }
}

function applyTrayIcon(tray: Tray | null) {
  if (!tray || !baseTrayIconPath) return;
  try {
    if (isVoiceActive) {
      tray.setToolTip("BloumeChat — 🎙");
      const live = createTrayLiveIcon(baseTrayIconPath);
      if (live && !live.isEmpty()) tray.setImage(live);
    } else {
      tray.setToolTip("BloumeChat");
      if (fs.existsSync(baseTrayIconPath)) tray.setImage(baseTrayIconPath);
    }
  } catch (e) {
    console.warn("[Badge] applyTrayIcon failed:", e);
  }
}

export function handleSetBadgeCount(
  count: unknown,
  mainWindow: BrowserWindow | null,
) {
  if (typeof count !== "number" || !Number.isFinite(count)) return;
  currentBadgeCount = Math.max(0, Math.min(9999, Math.floor(count)));
  if (mainWindow) applyTaskbarOverlay(mainWindow);
  app.setBadgeCount(currentBadgeCount);
}

export function handleSetVoiceActive(
  active: unknown,
  mainWindow: BrowserWindow | null,
  tray: Tray | null,
) {
  if (typeof active !== "boolean") return;
  if (!mainWindow) return;
  isVoiceActive = active;
  applyTaskbarOverlay(mainWindow);
  applyTrayIcon(tray);
}
