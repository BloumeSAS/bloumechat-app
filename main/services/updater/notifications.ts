import { Notification, nativeImage } from "electron";
import type Store from "electron-store";
import type { AppSettings } from "../../types/settings";
import { getLocaleDict, resolveMainProcessLocale } from "../locales";

function strings(settingsStore: Store<AppSettings>) {
  return getLocaleDict(resolveMainProcessLocale(settingsStore)).update;
}

function fill(template: string, version?: string): string {
  return template.replace("{{version}}", version ?? "");
}

function show(
  title: string,
  body: string,
  iconPath: string,
  onClick?: () => void,
): void {
  try {
    const notification = new Notification({
      title,
      body,
      icon: nativeImage.createFromPath(iconPath),
    });
    if (onClick) notification.on("click", onClick);
    notification.show();
  } catch (e) {
    console.warn("[Updater] Could not show notification:", e);
  }
}

/** An update finished downloading: one click restarts into it. */
export function notifyUpdateReady(
  version: string,
  settingsStore: Store<AppSettings>,
  iconPath: string,
  onClick: () => void,
): void {
  const s = strings(settingsStore);
  show(s.ready, fill(s.bar_ready, version), iconPath, onClick);
}

/** Feedback for a check the user asked for (tray menu): silent for automatic checks. */
export function notifyCheckResult(
  kind: "up-to-date" | "available" | "error",
  settingsStore: Store<AppSettings>,
  iconPath: string,
  details?: string,
): void {
  const s = strings(settingsStore);
  if (kind === "up-to-date") show(s.uptodate, s.uptodate_desc, iconPath);
  else if (kind === "available")
    show(s.available, fill(s.available_desc, details), iconPath);
  else show(s.error, details ?? s.error, iconPath);
}
