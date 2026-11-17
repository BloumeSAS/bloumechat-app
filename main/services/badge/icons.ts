import fs from "fs";
import { nativeImage } from "electron";
import { encodePng } from "./png";
import {
  BADGE_SIZE,
  addLiveDot,
  badgeLabel,
  badgePixels,
  micOverlayPixels,
} from "./pixels";

const badgeIconCache = new Map<string, Electron.NativeImage>();
let cachedMicOverlay: Electron.NativeImage | null = null;
let cachedTrayLiveIcon: Electron.NativeImage | null = null;
let cachedTrayLiveSource = "";

/** Red badge with the unread count (1..99, then 99+). */
export function createBadgeIcon(count: number): Electron.NativeImage {
  const key = badgeLabel(count);
  const cached = badgeIconCache.get(key);
  if (cached) return cached;
  const img = nativeImage.createFromBuffer(
    encodePng(BADGE_SIZE, badgePixels(count)),
  );
  badgeIconCache.set(key, img);
  return img;
}

/** Green microphone overlay shown on the taskbar button while in a call. */
export function createMicOverlayIcon(): Electron.NativeImage {
  if (!cachedMicOverlay) {
    cachedMicOverlay = nativeImage.createFromBuffer(
      encodePng(16, micOverlayPixels()),
    );
  }
  return cachedMicOverlay;
}

/** The tray icon with a green "live" dot in its corner, or null if the base icon is unusable. */
export function createTrayLiveIcon(
  baseIconPath: string,
): Electron.NativeImage | null {
  if (cachedTrayLiveIcon && cachedTrayLiveSource === baseIconPath) {
    return cachedTrayLiveIcon;
  }
  if (!baseIconPath || !fs.existsSync(baseIconPath)) return null;
  try {
    const base = nativeImage
      .createFromPath(baseIconPath)
      .resize({ width: 32, height: 32 });
    if (base.isEmpty()) return null;
    const { width, height } = base.getSize();
    if (width !== height) return null;
    cachedTrayLiveIcon = nativeImage.createFromBitmap(
      addLiveDot(base.toBitmap(), width),
      { width, height },
    );
    cachedTrayLiveSource = baseIconPath;
    return cachedTrayLiveIcon;
  } catch (e) {
    console.warn("[Badge] Failed to build the live tray icon:", e);
    return null;
  }
}

export function prewarmBadgeCache(): void {
  for (let i = 1; i <= 9; i++) createBadgeIcon(i);
  createMicOverlayIcon();
}
