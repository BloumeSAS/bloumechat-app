/** Pure pixel drawing for the taskbar / tray icons: RGBA buffers, no Electron involved. */

export const BADGE_SIZE = 32;
const RED: [number, number, number] = [229, 62, 62];
const GREEN: [number, number, number] = [34, 197, 94];
const WHITE: [number, number, number] = [255, 255, 255];

/** 3x5 pixel font: one row per entry, bit 2 = left column. */
const GLYPHS: Record<string, number[]> = {
  "0": [0b111, 0b101, 0b101, 0b101, 0b111],
  "1": [0b010, 0b110, 0b010, 0b010, 0b111],
  "2": [0b111, 0b001, 0b111, 0b100, 0b111],
  "3": [0b111, 0b001, 0b111, 0b001, 0b111],
  "4": [0b101, 0b101, 0b111, 0b001, 0b001],
  "5": [0b111, 0b100, 0b111, 0b001, 0b111],
  "6": [0b111, 0b100, 0b111, 0b101, 0b111],
  "7": [0b111, 0b001, 0b001, 0b001, 0b001],
  "8": [0b111, 0b101, 0b111, 0b101, 0b111],
  "9": [0b111, 0b101, 0b111, 0b001, 0b111],
  "+": [0b000, 0b010, 0b111, 0b010, 0b000],
};

export function setPixel(
  pixels: Buffer,
  size: number,
  x: number,
  y: number,
  [r, g, b]: [number, number, number],
  a = 255,
): void {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

/** Filled circle with smooth edges (4x4 supersampling of the edge pixels). */
function drawCircle(
  pixels: Buffer,
  size: number,
  color: [number, number, number],
): void {
  const c = size / 2;
  const samples = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let inside = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples - c;
          const py = y + (sy + 0.5) / samples - c;
          if (px * px + py * py <= c * c) inside++;
        }
      }
      if (inside > 0) {
        setPixel(
          pixels,
          size,
          x,
          y,
          color,
          Math.round((inside / (samples * samples)) * 255),
        );
      }
    }
  }
}

/** What the badge shows for a given unread count ("1".."99", then "99+"). */
export function badgeLabel(count: number): string {
  return count > 99 ? "99+" : String(Math.max(0, Math.floor(count)));
}

function drawLabel(pixels: Buffer, size: number, label: string): void {
  // Three glyphs ("99+") need a smaller scale to stay inside the circle.
  const scale = label.length >= 3 ? 2 : 3;
  const gap = scale;
  const glyphW = 3 * scale;
  const glyphH = 5 * scale;
  const totalW = label.length * glyphW + (label.length - 1) * gap;
  let x0 = Math.round((size - totalW) / 2);
  const y0 = Math.round((size - glyphH) / 2);

  for (const ch of label) {
    const rows = GLYPHS[ch];
    if (rows) {
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 3; col++) {
          if (!(rows[row] & (1 << (2 - col)))) continue;
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              setPixel(
                pixels,
                size,
                x0 + col * scale + dx,
                y0 + row * scale + dy,
                WHITE,
              );
            }
          }
        }
      }
    }
    x0 += glyphW + gap;
  }
}

/** RGBA pixels of the red unread badge for `count`. */
export function badgePixels(count: number): Buffer {
  const pixels = Buffer.alloc(BADGE_SIZE * BADGE_SIZE * 4, 0);
  drawCircle(pixels, BADGE_SIZE, RED);
  drawLabel(pixels, BADGE_SIZE, badgeLabel(count));
  return pixels;
}

/** Green circle with a white pixel-art microphone — shown while in a voice call. */
export function micOverlayPixels(): Buffer {
  const size = 16;
  const pixels = Buffer.alloc(size * size * 4, 0);
  drawCircle(pixels, size, GREEN);

  const white = (x: number, y: number) => setPixel(pixels, size, x, y, WHITE);
  for (let y = 3; y <= 7; y++) for (let x = 6; x <= 9; x++) white(x, y);
  [
    [7, 2],
    [8, 2],
    [7, 8],
    [8, 8],
    [5, 9],
    [6, 9],
    [7, 9],
    [8, 9],
    [9, 9],
    [10, 9],
    [5, 8],
    [10, 8],
    [7, 10],
    [8, 10],
    [6, 11],
    [7, 11],
    [8, 11],
    [9, 11],
  ].forEach(([x, y]) => white(x, y));
  return pixels;
}

/**
 * Draws a small green "live" dot with a white core in the bottom-right corner of a BGRA
 * bitmap (the format Electron's `toBitmap()` returns) — the tray icon while in a call.
 */
export function addLiveDot(bgra: Buffer, size: number): Buffer {
  const out = Buffer.from(bgra);
  const radius = Math.max(4, Math.round(size * 0.22));
  const cx = size - radius - 1;
  const cy = size - radius - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      if (d2 > radius * radius) continue;
      const core = d2 <= (radius * 0.45) ** 2;
      const [r, g, b] = core ? WHITE : GREEN;
      const i = (y * size + x) * 4;
      out[i] = b;
      out[i + 1] = g;
      out[i + 2] = r;
      out[i + 3] = 255;
    }
  }
  return out;
}
