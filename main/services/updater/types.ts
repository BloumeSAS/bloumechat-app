/** Everything the updater can be doing, from the main process point of view. */
export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

/** Why self-update is not possible for this installation. */
export type UnsupportedReason =
  "platform" | "not-packaged" | "store" | "portable";

export interface UpdateState {
  status: UpdateStatus;
  /** Version being downloaded / ready to install. */
  version?: string;
  /** 0-100 while downloading. */
  percent?: number;
  /** Human readable error, only for status "error". */
  message?: string;
  /** Only for status "unsupported". */
  reason?: UnsupportedReason;
}

export interface UpdateSupport {
  supported: boolean;
  /** Set when `supported` is false. */
  reason?: UnsupportedReason;
}

/**
 * Payload of the `update-status` IPC event. The shape is the one the existing
 * /update renderer page already consumes (`info.version`, `progress.percent`, `message`).
 */
export interface UpdateStatusEvent {
  status: Exclude<UpdateStatus, "idle" | "unsupported">;
  info?: { version: string };
  progress?: { percent: number };
  message?: string;
}
