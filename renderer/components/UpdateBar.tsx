import React, { useEffect, useState } from "react";
import type { DesktopDict } from "../lib/i18n";

/** Height of the bar in pixels — the home shell shrinks the site area by this much. */
export const UPDATE_BAR_HEIGHT = 36;

interface UpdateBarProps {
  dict: DesktopDict["update"];
  /** Reports whether the bar is on screen so the layout can make room for it. */
  onVisibleChange: (visible: boolean) => void;
}

/**
 * Thin bar under the title bar shown once an update has been downloaded in the
 * background: one click restarts the app into it, "later" hides it (the update is
 * installed anyway the next time the app is closed).
 */
export function UpdateBar({ dict, onVisibleChange }: UpdateBarProps) {
  const [version, setVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const visible = version !== null && !dismissed;

  useEffect(() => {
    const ipc = typeof window !== "undefined" ? window.ipc : undefined;
    if (!ipc?.getUpdateState) return;

    const apply = (state: { status: string; version?: string }) => {
      setVersion(state.status === "downloaded" ? (state.version ?? "") : null);
    };
    ipc
      .getUpdateState()
      .then(apply)
      .catch(() => undefined);
    return ipc.onUpdateStatus((data) => {
      apply({ status: data.status, version: data.info?.version });
    });
  }, []);

  useEffect(() => {
    onVisibleChange(visible);
  }, [visible, onVisibleChange]);

  if (!visible) return null;

  return (
    <div
      className="fixed left-0 right-0 z-[9990] flex items-center justify-center gap-3 border-b border-primary/20 bg-primary/15 px-4 text-xs font-semibold text-foreground backdrop-blur-xl"
      style={{ top: 30, height: UPDATE_BAR_HEIGHT }}
    >
      <span className="truncate">
        {dict.bar_ready.replace("{{version}}", version ?? "")}
      </span>
      <button
        onClick={() => window.ipc.quitAndInstall()}
        className="shrink-0 rounded-md bg-primary px-3 py-1 text-primary-foreground hover:bg-primary/90"
      >
        {dict.restart_button}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-md px-2 py-1 text-muted-foreground hover:bg-foreground/10"
      >
        {dict.ignore_button}
      </button>
    </div>
  );
}
