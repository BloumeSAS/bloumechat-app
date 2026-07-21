import zlib from "zlib";
import { nativeImage, BrowserWindow, Tray, app } from "electron";
import fs from "fs";

// ─── Icon caches ────────────────────────────────────────────────────────────
const badgeIconCache = new Map<string, Electron.NativeImage>();
let cachedMicOverlay: Electron.NativeImage | null = null;
let currentBadgeCount = 0;
let isVoiceActive = false;

// Tray icon paths — set once by initBadge()
let baseTrayIconPath = "";

export function getCurrentBadgeCount() {
  return currentBadgeCount;
}

export function initBadge(trayIconPath: string) {
  baseTrayIconPath = trayIconPath;
}

// ─── PNG helpers (pure-JS, no native deps) ──────────────────────────────────
function crc32(buf: Buffer): number {
  const table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++)
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) | 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const len = Buffer.allocUnsafe(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4);
  crcBuf.writeInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function buildPng(size: number, pixels: Buffer): Electron.NativeImage {
  const filtered = Buffer.allocUnsafe(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    filtered[y * (1 + size * 4)] = 0;
    pixels.copy(
      filtered,
      y * (1 + size * 4) + 1,
      y * size * 4,
      (y + 1) * size * 4,
    );
  }
  const compressed = zlib.deflateSync(filtered);
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
  return nativeImage.createFromBuffer(png);
}

function setPixel(
  pixels: Buffer,
  size: number,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  a = 255,
) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

// ─── Red badge overlay (unread count) ───────────────────────────────────────
export function createBadgeIcon(count: number): Electron.NativeImage | null {
  const key = String(count);
  if (badgeIconCache.has(key)) return badgeIconCache.get(key)!;
  try {
    const label = count > 99 ? "99+" : String(count);
    const size = 16;
    const fontSize = label.length > 2 ? 7 : 9;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#e53e3e"/>` +
      `<text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="central" ` +
      `fill="white" font-family="Arial,sans-serif" font-weight="bold" font-size="${fontSize}">${label}</text></svg>`;
    const img = nativeImage.createFromDataURL(
      "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"),
    );
    badgeIconCache.set(key, img.isEmpty() ? createFallbackBadge() : img);
    return badgeIconCache.get(key)!;
  } catch (e) {
    console.error("[Badge] Failed to create badge icon:", e);
    return null;
  }
}

function createFallbackBadge(): Electron.NativeImage {
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2,
    cy = size / 2,
    r = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2 <= r * r) {
        setPixel(pixels, size, x, y, 229, 62, 62);
      }
    }
  }
  return buildPng(size, pixels);
}

// ─── Green microphone overlay (voice active) ────────────────────────────────
/**
 * 16×16 green circle with a white pixel-art microphone.
 * No blinking — shown statically when in voice.
 */
export function createMicOverlayIcon(): Electron.NativeImage {
  if (cachedMicOverlay) return cachedMicOverlay;

  const size = 16;
  const pixels = Buffer.alloc(size * size * 4, 0);
  const cx = size / 2,
    cy = size / 2,
    r = size / 2;

  // Green background circle
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - cx + 0.5) ** 2 + (y - cy + 0.5) ** 2 <= r * r) {
        setPixel(pixels, size, x, y, 34, 197, 94);
      }
    }
  }

  // White pixel-art mic body (capsule shape, center of circle)
  const W = 255,
    G = 255,
    B = 255;
  // Mic body: 4px wide, 5px tall, centered horizontally at x=6..9, y=3..7
  for (let y = 3; y <= 7; y++) {
    setPixel(pixels, size, 6, y, W, G, B);
    setPixel(pixels, size, 7, y, W, G, B);
    setPixel(pixels, size, 8, y, W, G, B);
    setPixel(pixels, size, 9, y, W, G, B);
  }
  // Round top of mic
  setPixel(pixels, size, 7, 2, W, G, B);
  setPixel(pixels, size, 8, 2, W, G, B);
  // Round bottom of mic
  setPixel(pixels, size, 7, 8, W, G, B);
  setPixel(pixels, size, 8, 8, W, G, B);

  // Mic arc (stand): y=9, x=5..10
  setPixel(pixels, size, 5, 9, W, G, B);
  setPixel(pixels, size, 6, 9, W, G, B);
  setPixel(pixels, size, 7, 9, W, G, B);
  setPixel(pixels, size, 8, 9, W, G, B);
  setPixel(pixels, size, 9, 9, W, G, B);
  setPixel(pixels, size, 10, 9, W, G, B);
  // Sides of arc
  setPixel(pixels, size, 5, 8, W, G, B);
  setPixel(pixels, size, 10, 8, W, G, B);
  // Stand stem
  setPixel(pixels, size, 7, 10, W, G, B);
  setPixel(pixels, size, 8, 10, W, G, B);
  // Stand base
  setPixel(pixels, size, 6, 11, W, G, B);
  setPixel(pixels, size, 7, 11, W, G, B);
  setPixel(pixels, size, 8, 11, W, G, B);
  setPixel(pixels, size, 9, 11, W, G, B);

  cachedMicOverlay = buildPng(size, pixels);
  return cachedMicOverlay;
}

/**
 * Composite the base tray icon with a small green mic badge in the bottom-right corner.
 * Used to update the system-tray icon when voice is active.
 */
function createTrayMicIcon(): Electron.NativeImage | null {
  if (!baseTrayIconPath || !fs.existsSync(baseTrayIconPath)) return null;
  try {
    // Try SVG compositing via dataURL — simpler than pixel manipulation of ICO
    const micSvg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">` +
      `<circle cx="8" cy="8" r="8" fill="#22c55e"/>` +
      `<rect x="6" y="3" width="4" height="6" rx="2" fill="white"/>` +
      `<path d="M4 9a4 4 0 0 0 8 0" stroke="white" stroke-width="1.5" fill="none"/>` +
      `<line x1="8" y1="13" x2="8" y2="15" stroke="white" stroke-width="1.5"/>` +
      `<line x1="6" y1="15" x2="10" y2="15" stroke="white" stroke-width="1.5"/>` +
      `</svg>`;
    return nativeImage.createFromDataURL(
      "data:image/svg+xml;base64," + Buffer.from(micSvg).toString("base64"),
    );
  } catch {
    return null;
  }
}

// ─── Prewarming ──────────────────────────────────────────────────────────────
export function prewarmBadgeCache() {
  for (let i = 1; i <= 20; i++) createBadgeIcon(i);
  createMicOverlayIcon();
}

// ─── Apply helpers ───────────────────────────────────────────────────────────
function applyTaskbarOverlay(mainWindow: BrowserWindow) {
  if (process.platform !== "win32") return;
  try {
    if (isVoiceActive) {
      // Voice active → static mic icon
      mainWindow.setOverlayIcon(createMicOverlayIcon(), "Vocal actif");
    } else {
      // Not in voice → always base logo, no overlay
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
      tray.setToolTip("BloumeChat — 🎙 Vocal actif");
      // Use a dedicated mic tray icon when available, otherwise fallback to base
      const micTrayIcon = createTrayMicIcon();
      if (micTrayIcon && !micTrayIcon.isEmpty()) {
        tray.setImage(micTrayIcon);
      }
    } else {
      tray.setToolTip("BloumeChat");
      if (fs.existsSync(baseTrayIconPath)) {
        tray.setImage(baseTrayIconPath);
      }
    }
  } catch (e) {
    console.warn("[Badge] applyTrayIcon failed:", e);
  }
}

// ─── Public handlers ─────────────────────────────────────────────────────────
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
