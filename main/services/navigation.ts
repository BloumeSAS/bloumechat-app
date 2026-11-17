import type { BrowserWindow } from "electron";
import type Store from "electron-store";
import type { AppSettings } from "../types/settings";
import { confirmAndOpenExternal } from "./external-link";

export interface NavigationContext {
  getMainWindow: () => BrowserWindow | null;
  settingsStore: Store<AppSettings>;
  /** Port the local shell is served on (production server or dev server). */
  getPort: () => number;
  isPackaged: boolean;
  /** Origin of the remote site, e.g. https://bloumechat.com */
  siteOrigin: string;
}

const CLOUDFLARE_CHALLENGE_ORIGIN = "https://challenges.cloudflare.com";

/** Origins the app may navigate to by itself — everything else goes to the system browser. */
export function getAllowedOrigins(ctx: NavigationContext): Set<string> {
  const port = ctx.getPort();
  const origins = new Set<string>([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    CLOUDFLARE_CHALLENGE_ORIGIN,
    ctx.siteOrigin,
  ]);
  try {
    const site = new URL(ctx.siteOrigin);
    if (!site.hostname.startsWith("www.")) {
      origins.add(`${site.protocol}//www.${site.host}`);
    }
  } catch {
    /* siteOrigin is validated by getSiteOrigin */
  }
  return origins;
}

/**
 * Exact origin comparison. A prefix test ("https://bloumechat.com" ->
 * "https://bloumechat.com.evil.example") would let a look-alike host through.
 */
export function isAllowedUrl(url: string, ctx: NavigationContext): boolean {
  try {
    return getAllowedOrigins(ctx).has(new URL(url).origin);
  } catch {
    return false;
  }
}

/**
 * Every "leave the current page" request funnels through here — never a second Electron
 * BrowserWindow. Same-origin targets are handed to the renderer (home.tsx) to navigate the
 * visible iframe in place; anything else asks the user before going to the system browser.
 */
export function installNavigationGuards(
  win: BrowserWindow,
  ctx: NavigationContext,
): void {
  const openExternal = (url: string) =>
    void confirmAndOpenExternal(
      url,
      ctx.getMainWindow,
      ctx.settingsStore,
      ctx.getPort,
      ctx.isPackaged,
    );

  const openInPlaceOrExternal = (url: string) => {
    if (isAllowedUrl(url, ctx)) {
      ctx.getMainWindow()?.webContents.send("navigate-iframe", url);
    } else {
      openExternal(url);
    }
  };

  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedUrl(url, ctx)) {
      event.preventDefault();
      openExternal(url);
    }
  });

  win.webContents.on("will-frame-navigate", (event) => {
    if (event.frame === win.webContents.mainFrame) return;
    if (!isAllowedUrl(event.url, ctx)) {
      event.preventDefault();
      openExternal(event.url);
    }
  });

  // Never `action: 'allow'` — that spawns a real second native window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInPlaceOrExternal(url);
    return { action: "deny" };
  });
}
