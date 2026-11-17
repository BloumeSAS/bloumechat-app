import type { UpdateState, UpdateStatusEvent } from "./types";

type Listener = (state: UpdateState) => void;

let state: UpdateState = { status: "idle" };
const listeners = new Set<Listener>();

export function getUpdateState(): UpdateState {
  return state;
}

/** Replaces the state (never merges: each status owns its own fields) and notifies listeners. */
export function setUpdateState(next: UpdateState): void {
  state = next;
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (e) {
      console.warn("[Updater] state listener failed:", e);
    }
  });
}

/** Subscribes to state changes; returns the unsubscribe function. */
export function onUpdateStateChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Maps the internal state to the `update-status` IPC payload (null = nothing to send). */
export function toStatusEvent(s: UpdateState): UpdateStatusEvent | null {
  if (s.status === "idle" || s.status === "unsupported") return null;
  const event: UpdateStatusEvent = { status: s.status };
  if (s.version) event.info = { version: s.version };
  if (s.percent !== undefined) event.progress = { percent: s.percent };
  if (s.message) event.message = s.message;
  return event;
}

/** Test helper — returns to the initial state without notifying. */
export function resetUpdateState(): void {
  state = { status: "idle" };
  listeners.clear();
}
