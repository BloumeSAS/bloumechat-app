// Updater flow against a fake electron-updater: configuration (signature check stays on,
// downloads are driven by us), state transitions, no retry of a version that failed, install.
const handlers: Record<string, (...args: any[]) => void> = {};
const fakeUpdater: any = {
  on: jest.fn((event: string, handler: (...args: any[]) => void) => {
    handlers[event] = handler;
  }),
  checkForUpdates: jest.fn(async () => undefined),
  downloadUpdate: jest.fn(async () => []),
  quitAndInstall: jest.fn(),
};
jest.mock("electron-updater", () => ({ autoUpdater: fakeUpdater }));
jest.mock("electron-log", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("./scheduler", () => ({
  startUpdateScheduler: jest.fn(() => ({ stop: jest.fn() })),
}));

import { app, Notification, ipcMain } from "electron";
import { startUpdateScheduler } from "./scheduler";
import {
  initUpdater,
  checkForUpdatesNow,
  installUpdateNow,
  getUpdateState,
} from "./index";
import { resetUpdateState } from "./state";

const win = { webContents: { send: jest.fn() } } as any;
const store = { get: jest.fn(() => null) } as any;
const setQuitting = jest.fn();

function init(packaged = true) {
  (app as any).isPackaged = packaged;
  Object.defineProperty(process, "platform", { value: "win32" });
  initUpdater({
    getMainWindow: () => win,
    getIconPath: () => "icon.png",
    settingsStore: store,
    isVoiceActive: () => false,
    setQuitting,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetUpdateState();
  for (const k of Object.keys(handlers)) delete handlers[k];
  delete (process as any).windowsStore;
  delete process.env.PORTABLE_EXECUTABLE_DIR;
});

describe("initUpdater", () => {
  it("keeps signature verification on and drives downloads itself", () => {
    init();
    expect(fakeUpdater.autoDownload).toBe(false);
    expect(fakeUpdater.autoInstallOnAppQuit).toBe(true);
    expect(fakeUpdater.allowDowngrade).toBe(false);
    // the old workaround that disabled verification must be gone
    expect(fakeUpdater.verifyUpdateCodeSignature).toBeUndefined();
    expect(process.env.NODE_TLS_REJECT_UNAUTHORIZED).not.toBe("0");
    expect(startUpdateScheduler).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a development run", () => init(false), "not-packaged"],
    [
      "a Microsoft Store install",
      () => {
        (process as any).windowsStore = true;
        init();
      },
      "store",
    ],
    [
      "a portable build",
      () => {
        process.env.PORTABLE_EXECUTABLE_DIR = "C:\\portable";
        init();
      },
      "portable",
    ],
  ])("does not self-update for %s", (_name, setup, reason) => {
    setup();
    expect(getUpdateState()).toEqual({ status: "unsupported", reason });
    expect(startUpdateScheduler).not.toHaveBeenCalled();
    expect(fakeUpdater.on).not.toHaveBeenCalled();
  });
});

describe("update flow", () => {
  beforeEach(() => init());

  it("downloads an available update and announces it to the window", () => {
    handlers["update-available"]({ version: "2.22.0" });
    expect(getUpdateState()).toEqual({
      status: "available",
      version: "2.22.0",
    });
    expect(fakeUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith("update-status", {
      status: "available",
      info: { version: "2.22.0" },
    });
  });

  it("reports download progress with the version being fetched", () => {
    handlers["update-available"]({ version: "2.22.0" });
    handlers["download-progress"]({ percent: 41.6 });
    expect(getUpdateState()).toEqual({
      status: "downloading",
      version: "2.22.0",
      percent: 42,
    });
  });

  it("notifies once the update is downloaded, and installs only then", () => {
    installUpdateNow(); // nothing downloaded yet: no-op
    expect(fakeUpdater.quitAndInstall).not.toHaveBeenCalled();

    handlers["update-available"]({ version: "2.22.0" });
    handlers["update-downloaded"]({ version: "2.22.0" });
    expect(getUpdateState()).toEqual({
      status: "downloaded",
      version: "2.22.0",
    });
    expect(Notification).toHaveBeenCalledTimes(1);

    installUpdateNow();
    expect(setQuitting).toHaveBeenCalledWith(true);
    expect(fakeUpdater.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it("does not download again a version whose signature was refused", () => {
    handlers["update-available"]({ version: "2.22.0" });
    handlers["error"](
      Object.assign(new Error("not signed by the application owner"), {
        code: "ERR_UPDATER_INVALID_SIGNATURE",
      }),
    );
    expect(getUpdateState().status).toBe("error");

    fakeUpdater.downloadUpdate.mockClear();
    handlers["update-available"]({ version: "2.22.0" });
    expect(fakeUpdater.downloadUpdate).not.toHaveBeenCalled();

    // a newer version is still fetched
    handlers["update-available"]({ version: "2.23.0" });
    expect(fakeUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("a network error is recorded without crashing and is retried by the next check", async () => {
    fakeUpdater.checkForUpdates.mockRejectedValueOnce(
      new Error("net::ERR_INTERNET_DISCONNECTED"),
    );
    await expect(checkForUpdatesNow(false)).resolves.toBeDefined();
    fakeUpdater.checkForUpdates.mockResolvedValueOnce(undefined);
    await checkForUpdatesNow(false);
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("does not start a second check while one is running or an update is ready", async () => {
    handlers["checking-for-update"]();
    await checkForUpdatesNow(false);
    expect(fakeUpdater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("only registers the simulate IPC outside production", () => {
    const channels = (ipcMain.on as jest.Mock).mock.calls.map(([c]) => c);
    expect(channels).toEqual(
      expect.arrayContaining([
        "check-for-updates",
        "start-download",
        "quit-and-install",
      ]),
    );
    expect(channels).not.toContain("simulate-update");
  });
});
