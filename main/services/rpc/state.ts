/** Shared between the hook process and the public API. */
export const state = {
  /** True once the PowerShell hook failed to start repeatedly and polling took over. */
  usingPollingFallback: false,
};
