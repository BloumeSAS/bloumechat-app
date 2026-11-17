import { app } from "electron";
import {
  handleSetBadgeCount,
  getCurrentBadgeCount,
  createBadgeIcon,
} from "./badge";

function makeWindow() {
  return { setOverlayIcon: jest.fn() } as any;
}

describe("handleSetBadgeCount", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("ignores non-numeric input", () => {
    handleSetBadgeCount("5" as any, null);
    expect(app.setBadgeCount).not.toHaveBeenCalled();
  });

  it("ignores non-finite input (NaN, Infinity)", () => {
    handleSetBadgeCount(NaN, null);
    handleSetBadgeCount(Infinity, null);
    expect(app.setBadgeCount).not.toHaveBeenCalled();
  });

  it("floors a fractional count", () => {
    handleSetBadgeCount(4.9, null);
    expect(app.setBadgeCount).toHaveBeenCalledWith(4);
    expect(getCurrentBadgeCount()).toBe(4);
  });

  it("clamps negative counts to 0", () => {
    handleSetBadgeCount(-50, null);
    expect(app.setBadgeCount).toHaveBeenCalledWith(0);
    expect(getCurrentBadgeCount()).toBe(0);
  });

  it("clamps counts above 9999", () => {
    handleSetBadgeCount(1_000_000, null);
    expect(app.setBadgeCount).toHaveBeenCalledWith(9999);
    expect(getCurrentBadgeCount()).toBe(9999);
  });

  it("applies the taskbar overlay only on win32", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    const win = makeWindow();
    handleSetBadgeCount(3, win);
    expect(win.setOverlayIcon).toHaveBeenCalled();
  });

  it("skips the taskbar overlay on non-win32 platforms", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    const win = makeWindow();
    handleSetBadgeCount(3, win);
    expect(win.setOverlayIcon).not.toHaveBeenCalled();
  });
});

describe("createBadgeIcon", () => {
  it("returns and caches an icon for a given count", () => {
    const icon = createBadgeIcon(5);
    expect(icon).not.toBeNull();
    // Same count returns the cached instance rather than rebuilding.
    expect(createBadgeIcon(5)).toBe(icon);
  });
});
