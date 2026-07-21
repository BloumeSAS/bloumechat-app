import { dialog, shell } from "electron";
import { confirmAndOpenExternal } from "./external-link";

const settingsStore = { get: jest.fn(() => null) } as any;

beforeEach(() => {
  jest.clearAllMocks();
  settingsStore.get.mockReturnValue(null);
});

describe("confirmAndOpenExternal", () => {
  it("never prompts or opens for a non-http(s) URL", async () => {
    await confirmAndOpenExternal(
      "javascript:alert(1)",
      () => null,
      settingsStore,
    );
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("never prompts or opens for a file:// URL", async () => {
    await confirmAndOpenExternal(
      "file:///etc/passwd",
      () => null,
      settingsStore,
    );
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("prompts before opening a valid https URL", async () => {
    (dialog.showMessageBox as jest.Mock).mockResolvedValue({ response: 0 });
    await confirmAndOpenExternal(
      "https://example.com/page",
      () => null,
      settingsStore,
    );
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com/page");
  });

  it("accepts http URLs too", async () => {
    (dialog.showMessageBox as jest.Mock).mockResolvedValue({ response: 0 });
    await confirmAndOpenExternal(
      "http://example.com",
      () => null,
      settingsStore,
    );
    expect(shell.openExternal).toHaveBeenCalledWith("http://example.com");
  });

  it("does NOT open the link when the user cancels the confirmation", async () => {
    (dialog.showMessageBox as jest.Mock).mockResolvedValue({ response: 1 });
    await confirmAndOpenExternal(
      "https://example.com",
      () => null,
      settingsStore,
    );
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("attaches the main window as the dialog parent when available", async () => {
    (dialog.showMessageBox as jest.Mock).mockResolvedValue({ response: 0 });
    const fakeWindow = { id: "main" } as any;
    await confirmAndOpenExternal(
      "https://example.com",
      () => fakeWindow,
      settingsStore,
    );
    expect((dialog.showMessageBox as jest.Mock).mock.calls[0][0]).toBe(
      fakeWindow,
    );
  });

  it("falls back to a parentless dialog when there is no main window", async () => {
    (dialog.showMessageBox as jest.Mock).mockResolvedValue({ response: 0 });
    await confirmAndOpenExternal(
      "https://example.com",
      () => null,
      settingsStore,
    );
    // First arg is the dialog options object itself, not a BrowserWindow, when parentless.
    const firstArg = (dialog.showMessageBox as jest.Mock).mock.calls[0][0];
    expect(firstArg).toHaveProperty("message");
  });
});
