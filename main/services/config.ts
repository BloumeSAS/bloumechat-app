import fs from "fs";
import path from "path";

export interface AppConfig {
  [key: string]: unknown;
}

/**
 * Reads config.json (public, non-secret values shipped with the app: site URL,
 * crash-report endpoint, IS_PROD). A missing or broken file is not fatal.
 */
export function loadAppConfig(baseDir: string): {
  appConfig: AppConfig;
  isProd: boolean;
} {
  let appConfig: AppConfig = {};
  try {
    appConfig = JSON.parse(
      fs.readFileSync(path.join(baseDir, "../config.json"), "utf8"),
    );
  } catch {
    console.error("[Config] No config.json found or invalid format.");
  }

  const isProd =
    appConfig.IS_PROD !== undefined
      ? appConfig.IS_PROD === true || appConfig.IS_PROD === "true"
      : process.env.NODE_ENV === "production";

  return { appConfig, isProd };
}

/** Origin of the remote site the shell embeds (no trailing slash). */
export function getSiteOrigin(appConfig: AppConfig): string {
  try {
    return new URL(
      String(appConfig.NEXT_PUBLIC_SITE_URL || "https://bloumechat.com"),
    ).origin;
  } catch {
    return "https://bloumechat.com";
  }
}
