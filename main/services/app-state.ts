/**
 * Process-wide flags shared by services that must agree on them, without
 * threading a setter through every function signature.
 */
let quitting = false;

/** True once the app is really quitting (tray "Quit", update install, session end). */
export function isAppQuitting(): boolean {
  return quitting;
}

export function setAppQuitting(value: boolean): void {
  quitting = value;
}
