import { createFailureTracker, FAILURE_MEMORY_MS } from "./site-health";

describe("createFailureTracker", () => {
  const URL_A = "https://bloumechat.com/app?platform=desktop";

  it("recognises the error page that follows a failure, once", () => {
    const tracker = createFailureTracker(() => 1000);
    tracker.recordFailure(URL_A);
    expect(tracker.isErrorPage(URL_A)).toBe(true);
    // the next "finished" for the same URL is a real load
    expect(tracker.isErrorPage(URL_A)).toBe(false);
  });

  it("treats a load with no recorded failure as a success", () => {
    const tracker = createFailureTracker(() => 1000);
    expect(tracker.isErrorPage(URL_A)).toBe(false);
  });

  it("does not mix up URLs", () => {
    const tracker = createFailureTracker(() => 1000);
    tracker.recordFailure(URL_A);
    expect(tracker.isErrorPage("https://bloumechat.com/other")).toBe(false);
    expect(tracker.isErrorPage(URL_A)).toBe(true);
  });

  it("forgets a failure whose error page never came, so a later success is not swallowed", () => {
    let t = 0;
    const tracker = createFailureTracker(() => t);
    tracker.recordFailure(URL_A);
    t = FAILURE_MEMORY_MS + 1;
    expect(tracker.isErrorPage(URL_A)).toBe(false);
  });
});
