// Dev helper: renders the unread badges and the call overlay to PNG files so they can be looked at.
//   npx tsx tools/badge-preview.ts [outputFolder]
import fs from "fs";
import path from "path";
import { encodePng } from "../main/services/badge/png";
import { badgePixels, micOverlayPixels } from "../main/services/badge/pixels";

const out = process.argv[2] || ".";
const SCALE = 6;

/** Nearest-neighbour upscale of an RGBA square, over a mid-grey "taskbar" background. */
function upscale(src: Buffer, size: number): { size: number; data: Buffer } {
  const big = size * SCALE;
  const data = Buffer.alloc(big * big * 4);
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const i = (Math.floor(y / SCALE) * size + Math.floor(x / SCALE)) * 4;
      const a = src[i + 3] / 255;
      const o = (y * big + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.round(src[i + c] * a + 40 * (1 - a));
      data[o + 3] = 255;
    }
  }
  return { size: big, data };
}

// one sheet: 1, 7, 42, 99, 100 (-> 99+) and the voice overlay
const items: { size: number; data: Buffer }[] = [1, 7, 42, 99, 100].map((n) => upscale(badgePixels(n), 32));
items.push(upscale(micOverlayPixels(), 16));
const cell = 32 * SCALE;
const sheetW = items.length * (cell + 10) + 10;
const sheet = Buffer.alloc(sheetW * (cell + 20) * 4, 40);
for (let i = 3; i < sheet.length; i += 4) sheet[i] = 255;
items.forEach((item, n) => {
  const ox = 10 + n * (cell + 10);
  const oy = 10 + Math.floor((cell - item.size) / 2);
  for (let y = 0; y < item.size; y++) {
    item.data.copy(sheet, ((oy + y) * sheetW + ox) * 4, y * item.size * 4, (y + 1) * item.size * 4);
  }
});
// encodePng wants a square: pad to square
const side = Math.max(sheetW, cell + 20);
const square = Buffer.alloc(side * side * 4, 40);
for (let i = 3; i < square.length; i += 4) square[i] = 255;
for (let y = 0; y < cell + 20; y++) sheet.copy(square, y * side * 4, y * sheetW * 4, (y + 1) * sheetW * 4);
fs.writeFileSync(path.join(out, "badges.png"), encodePng(side, square));
console.log("written", path.join(out, "badges.png"));
