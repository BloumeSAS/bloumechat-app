import { ipcMain, shell } from "electron";
import { confirmAndOpenExternal } from "./external-link";

const settingsStore = { get: jest.fn(() => null) } as any;
const getPort = () => 4000;

/** Grabs the handler registered for `channel` via the most recent `ipcMain.on`
 * call and invokes it — stands in for the confirm window's renderer sending
 * "confirm-external-link"/"cancel-external-link" back to main. */
function fireIpcHandler(channel: string) {
  const call = (ipcMain.on as jest.Mock).mock.calls.find(
    ([ch]) => ch === channel,
  );
  if (!call) throw new Error(`No ipcMain.on handler registered for ${channel}`);
  call[1]();
}

beforeEach(() => {
  jest.clearAllMocks();
  settingsStore.get.mockReturnValue(null);
});

describe("confirmAndOpenExternal", () => {
  it("never opens a confirm window or the browser for a non-http(s) URL", async () => {
    await confirmAndOpenExternal(
      "javascript:alert(1)",
      () => null,
      settingsStore,
      getPort,
      false,
    );
    expect(ipcMain.on).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("never opens a confirm window or the browser for a file:// URL", async () => {
    await confirmAndOpenExternal(
      "file:///etc/passwd",
      () => null,
      settingsStore,
      getPort,
      false,
    );
    expect(ipcMain.on).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("opens the browser once the confirm window signals confirmation", async () => {
    const pending = confirmAndOpenExternal(
      "https://example.com/page",
      () => null,
      settingsStore,
      getPort,
      false,
    );
    // Let the BrowserWindow constructor + ipcMain.on registration run first.
    await Promise.resolve();
    fireIpcHandler("confirm-external-link");
    await pending;
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com/page");
  });

  it("accepts http URLs too", async () => {
    const pending = confirmAndOpenExternal(
      "http://example.com",
      () => null,
      settingsStore,
      getPort,
      false,
    );
    await Promise.resolve();
    fireIpcHandler("confirm-external-link");
    await pending;
    expect(shell.openExternal).toHaveBeenCalledWith("http://example.com");
  });

  it("does NOT open the link when the user cancels the confirmation", async () => {
    const pending = confirmAndOpenExternal(
      "https://example.com",
      () => null,
      settingsStore,
      getPort,
      false,
    );
    await Promise.resolve();
    fireIpcHandler("cancel-external-link");
    await pending;
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("removes both ipcMain listeners once the confirmation settles", async () => {
    const pending = confirmAndOpenExternal(
      "https://example.com",
      () => null,
      settingsStore,
      getPort,
      false,
    );
    await Promise.resolve();
    fireIpcHandler("confirm-external-link");
    await pending;
    expect(ipcMain.removeListener).toHaveBeenCalledWith(
      "confirm-external-link",
      expect.any(Function),
    );
    expect(ipcMain.removeListener).toHaveBeenCalledWith(
      "cancel-external-link",
      expect.any(Function),
    );
  });
});
