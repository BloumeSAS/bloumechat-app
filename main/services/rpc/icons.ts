import { app } from "electron";

/**
 * Auto-extract the executable's own icon as a small PNG data URL.
 * Works for ANY native app or game — no icon list required. Returns undefined
 * on failure (the webapp then falls back to a brand/Lucide icon).
 */
async function extractIconDataUrl(
  exePath: string | undefined,
): Promise<string | undefined> {
  if (!exePath) return undefined;
  try {
    const img = await app.getFileIcon(exePath, { size: "large" });
    if (!img || img.isEmpty()) return undefined;
    const sized = img.resize({ width: 48, height: 48, quality: "better" });
    const url = sized.toDataURL();
    // Safety cap — never broadcast an absurdly large payload.
    if (!url || url.length > 40000) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Shared activity pipeline — turns a raw (processName, windowTitle, exePath)
// reading (from either the Windows hook, the polling fallback, or macOS) into
// a classified RpcActivity and sends it over IPC if it actually changed.

const ICON_CACHE_LIMIT = 64;
const iconCache = new Map<string, string | undefined>();

/** Icon of an executable, cached: the same app comes back on every window switch. */
export async function getIconDataUrl(
  exePath: string | undefined,
): Promise<string | undefined> {
  if (!exePath) return undefined;
  if (iconCache.has(exePath)) return iconCache.get(exePath);
  const icon = await extractIconDataUrl(exePath);
  if (iconCache.size >= ICON_CACHE_LIMIT) {
    const oldest = iconCache.keys().next().value;
    if (oldest !== undefined) iconCache.delete(oldest);
  }
  iconCache.set(exePath, icon);
  return icon;
}
