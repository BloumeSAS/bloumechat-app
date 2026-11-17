import { app } from "electron";
import type { UpdateSupport } from "./types";

/**
 * Self-update only makes sense for the NSIS installer build on Windows:
 *  - a Microsoft Store (MSIX) install is updated by the Store itself,
 *  - a portable build has no installer to run,
 *  - a development run has no `app-update.yml`.
 */
export function getUpdateSupport(): UpdateSupport {
  if (process.platform !== "win32")
    return { supported: false, reason: "platform" };
  if (!app.isPackaged) return { supported: false, reason: "not-packaged" };
  if (process.windowsStore) return { supported: false, reason: "store" };
  if (process.env.PORTABLE_EXECUTABLE_DIR)
    return { supported: false, reason: "portable" };
  return { supported: true };
}
