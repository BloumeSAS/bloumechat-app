import zlib from "zlib";
import { encodePng } from "./png";
import {
  BADGE_SIZE,
  addLiveDot,
  badgeLabel,
  badgePixels,
  micOverlayPixels,
} from "./pixels";

const at = (pixels: Buffer, size: number, x: number, y: number) => {
  const i = (y * size + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
};

describe("badgeLabel", () => {
  it("shows the count up to 99 and 99+ beyond", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(42)).toBe("42");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
    expect(badgeLabel(9999)).toBe("99+");
  });
});

describe("badgePixels", () => {
  it("draws a red disc: opaque red in the middle-left, transparent in the corner", () => {
    const px = badgePixels(1);
    expect(px.length).toBe(BADGE_SIZE * BADGE_SIZE * 4);
    expect(at(px, BADGE_SIZE, 0, 0)[3]).toBe(0);
    expect(at(px, BADGE_SIZE, 3, 16)).toEqual([229, 62, 62, 255]);
  });

  it("draws white digit pixels in the middle", () => {
    const px = badgePixels(8);
    let white = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] === 255 && px[i + 1] === 255 && px[i + 2] === 255) white++;
    }
    expect(white).toBeGreaterThan(40);
  });

  it("renders different counts differently", () => {
    expect(badgePixels(1).equals(badgePixels(2))).toBe(false);
    expect(badgePixels(7).equals(badgePixels(7))).toBe(true);
    expect(badgePixels(100).equals(badgePixels(250))).toBe(true); // both "99+"
  });
});

describe("micOverlayPixels", () => {
  it("is a 16x16 green disc with white microphone pixels", () => {
    const px = micOverlayPixels();
    expect(px.length).toBe(16 * 16 * 4);
    expect(at(px, 16, 7, 5)).toEqual([255, 255, 255, 255]);
    expect(at(px, 16, 2, 8)).toEqual([34, 197, 94, 255]);
  });
});

describe("addLiveDot", () => {
  it("paints a green dot (BGRA) in the bottom-right corner and leaves the rest alone", () => {
    const size = 32;
    const base = Buffer.alloc(size * size * 4, 7);
    const out = addLiveDot(base, size);
    const i = ((size - 6) * size + (size - 6)) * 4; // inside the dot, outside its core
    expect([out[i], out[i + 1], out[i + 2], out[i + 3]]).toEqual([
      94, 197, 34, 255,
    ]);
    expect(out[0]).toBe(7); // top-left untouched
    expect(base[i]).toBe(7); // input not mutated
  });
});

describe("encodePng", () => {
  it("produces a valid PNG that inflates back to the same pixels", () => {
    const size = 4;
    const rgba = Buffer.alloc(size * size * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7) % 256;
    const png = encodePng(size, rgba);
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    // locate the IDAT chunk and inflate it
    let offset = 8;
    let idat: Buffer | null = null;
    while (offset < png.length) {
      const len = png.readUInt32BE(offset);
      const type = png.toString("ascii", offset + 4, offset + 8);
      if (type === "IDAT") idat = png.subarray(offset + 8, offset + 8 + len);
      offset += 12 + len;
    }
    const raw = zlib.inflateSync(idat as Buffer);
    const stride = 1 + size * 4;
    const rebuilt = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
      raw.copy(rebuilt, y * size * 4, y * stride + 1, (y + 1) * stride);
    }
    expect(rebuilt.equals(rgba)).toBe(true);
  });
});
