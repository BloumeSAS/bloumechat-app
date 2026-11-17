import { isAllowedUrl, type NavigationContext } from "./navigation";

const ctx = {
  getMainWindow: () => null,
  settingsStore: { get: jest.fn() } as any,
  getPort: () => 15999,
  isPackaged: true,
  siteOrigin: "https://bloumechat.com",
} as NavigationContext;

describe("isAllowedUrl", () => {
  it.each([
    "https://bloumechat.com/app?platform=desktop",
    "https://bloumechat.com",
    "https://www.bloumechat.com/channels/me",
    "http://127.0.0.1:15999/home/",
    "http://localhost:15999/home/",
    "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b",
  ])("allows %s", (url) => {
    expect(isAllowedUrl(url, ctx)).toBe(true);
  });

  it.each([
    // look-alike hosts that a startsWith() test would have accepted
    "https://bloumechat.com.evil.example/login",
    "https://bloumechat.company/",
    "http://127.0.0.1:15999.evil.example/",
    "http://127.0.0.1:159990/",
    // other ports / schemes / hosts
    "http://127.0.0.1:8080/",
    "http://bloumechat.com/",
    "https://evil.example/",
    "https://challenges.cloudflare.com.evil.example/",
    "file:///C:/Windows/System32/calc.exe",
    "javascript:alert(1)",
    "not a url",
    "",
  ])("rejects %s", (url) => {
    expect(isAllowedUrl(url, ctx)).toBe(false);
  });

  it("follows the port of the local server (dev or fallback port)", () => {
    const other = { ...ctx, getPort: () => 8899 } as NavigationContext;
    expect(isAllowedUrl("http://localhost:8899/home/", other)).toBe(true);
    expect(isAllowedUrl("http://127.0.0.1:15999/home/", other)).toBe(false);
  });
});
