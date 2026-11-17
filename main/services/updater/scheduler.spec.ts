import {
  startUpdateScheduler,
  FIRST_CHECK_DELAY_MS,
  CHECK_INTERVAL_MS,
  SKIPPED_RETRY_MS,
} from "./scheduler";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("startUpdateScheduler", () => {
  it("checks once after the startup delay, then on the interval", async () => {
    const check = jest.fn(async () => undefined);
    startUpdateScheduler(
      check,
      () => false,
      () => 0,
    );

    jest.advanceTimersByTime(FIRST_CHECK_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flush();
    expect(check).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("postpones a check while skipped (a call is running) and retries soon", async () => {
    const check = jest.fn(async () => undefined);
    let skip = true;
    startUpdateScheduler(
      check,
      () => skip,
      () => 0,
    );

    jest.advanceTimersByTime(FIRST_CHECK_DELAY_MS);
    await flush();
    expect(check).not.toHaveBeenCalled();

    skip = false;
    jest.advanceTimersByTime(SKIPPED_RETRY_MS);
    await flush();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("keeps going after a check that throws", async () => {
    const check = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    startUpdateScheduler(
      check,
      () => false,
      () => 0,
    );

    jest.advanceTimersByTime(FIRST_CHECK_DELAY_MS);
    await flush();
    jest.advanceTimersByTime(CHECK_INTERVAL_MS);
    await flush();
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("stop() cancels everything", async () => {
    const check = jest.fn(async () => undefined);
    const scheduler = startUpdateScheduler(
      check,
      () => false,
      () => 0,
    );
    scheduler.stop();
    jest.advanceTimersByTime(FIRST_CHECK_DELAY_MS + CHECK_INTERVAL_MS * 2);
    await flush();
    expect(check).not.toHaveBeenCalled();
  });
});
