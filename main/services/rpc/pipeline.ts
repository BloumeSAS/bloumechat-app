import type { BrowserWindow } from "electron";
import { classifyActivity, activityKey, sanitizeText } from "./classify";
import { getIconDataUrl } from "./icons";
import { BLOCKLIST } from "./data";

// ---------------------------------------------------------------------------
let lastActivityKey = "";
// Each reading gets a number; a slower earlier one (icon extraction is async) must never
// overwrite the activity of a later one.
let latestReading = 0;

/**
 * Returns 'changed' when a new activity was broadcast, 'blocked' when the
 * foreground app is on the blocklist (own app, shell, etc. — nothing sent),
 * or 'unchanged' when the same known activity persists.
 */
export async function handleReading(
  processName: string,
  windowTitle: string,
  exePath: string,
  browserUrl: string,
  getWindow: () => BrowserWindow | null,
): Promise<"changed" | "blocked" | "unchanged"> {
  const reading = ++latestReading;
  const rawName = sanitizeText(processName);
  const lc = rawName.toLowerCase().trim();
  if (!lc || BLOCKLIST.has(lc)) {
    // Forget the last key while parked on a blocklisted app (incl. BloumeChat
    // itself): if the user tabs back to the SAME app they were in before, it
    // must be re-broadcast — the renderer may have cleared the server state in
    // the meantime (socket reconnect, provider effect re-run), and an
    // "unchanged" dedup here would leave the profile activity empty forever.
    lastActivityKey = "";
    return "blocked";
  }

  const activity = classifyActivity(
    rawName,
    sanitizeText(windowTitle),
    exePath || "",
    (browserUrl || "").trim(),
  );
  const key = activityKey(activity);

  if (key === lastActivityKey) return "unchanged";
  lastActivityKey = key;

  // Auto-extract the real executable icon (any app/game). Best-effort — the
  // webapp (resolveActivityIcon) now checks its curated brand-logo map FIRST
  // and only falls back to this extracted icon for apps it doesn't recognize,
  // so this stays visually consistent with what the VS Code extension shows.
  activity.icon = await getIconDataUrl(exePath);
  if (reading !== latestReading) return "unchanged";

  const win = getWindow();
  if (!win || win.isDestroyed() || !win.webContents) return "changed";

  win.webContents.send("rpc:activity", activity);
  return "changed";
}

// ---------------------------------------------------------------------------
// Windows — persistent hook process lifecycle

/** Forgets the last broadcast activity so the next reading is always sent. */
export function resetPipeline(): void {
  lastActivityKey = "";
  latestReading++;
}
