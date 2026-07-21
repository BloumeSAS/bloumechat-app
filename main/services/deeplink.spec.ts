import { handleDeepLink } from "./deeplink";

function makeWindow() {
  return {
    show: jest.fn(),
    focus: jest.fn(),
    webContents: { send: jest.fn() },
  } as any;
}

describe("handleDeepLink", () => {
  it("no-ops when there is no window", () => {
    expect(() =>
      handleDeepLink("bloumechat://channel/abc", null),
    ).not.toThrow();
  });

  it("ignores non-string input", () => {
    const win = makeWindow();
    handleDeepLink(123 as any, win);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("ignores URLs longer than the length cap", () => {
    const win = makeWindow();
    const long = "bloumechat://channel/" + "a".repeat(600);
    handleDeepLink(long, win);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("shows and focuses the window, then dispatches a valid deep link", () => {
    const win = makeWindow();
    handleDeepLink("bloumechat://channel/abc123", win);
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith("deep-link", {
      action: "channel",
      id: "abc123",
      queryParams: {},
    });
  });

  it.each(["server", "gift"])("accepts the %s action", (action) => {
    const win = makeWindow();
    handleDeepLink(`bloumechat://${action}/xyz`, win);
    expect(win.webContents.send).toHaveBeenCalledWith(
      "deep-link",
      expect.objectContaining({ action }),
    );
  });

  it("rejects an unknown protocol (not bloumechat:)", () => {
    const win = makeWindow();
    handleDeepLink("https://evil.example/channel/abc", win);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("rejects an unknown action", () => {
    const win = makeWindow();
    handleDeepLink("bloumechat://deleteAccount/abc", win);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("rejects an id with disallowed characters (injection-shaped input)", () => {
    const win = makeWindow();
    handleDeepLink("bloumechat://channel/../../etc/passwd", win);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("rejects an id longer than 64 chars", () => {
    const win = makeWindow();
    handleDeepLink(`bloumechat://channel/${"a".repeat(65)}`, win);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("allows an empty id", () => {
    const win = makeWindow();
    handleDeepLink("bloumechat://server/", win);
    expect(win.webContents.send).toHaveBeenCalledWith("deep-link", {
      action: "server",
      id: "",
      queryParams: {},
    });
  });

  it("forwards well-formed query params", () => {
    const win = makeWindow();
    handleDeepLink("bloumechat://channel/abc?foo=bar&baz=qux", win);
    expect(win.webContents.send).toHaveBeenCalledWith("deep-link", {
      action: "channel",
      id: "abc",
      queryParams: { foo: "bar", baz: "qux" },
    });
  });

  it("drops query params with an oversized key or value", () => {
    const win = makeWindow();
    const hugeValue = "v".repeat(300);
    handleDeepLink(`bloumechat://channel/abc?ok=1&bad=${hugeValue}`, win);
    expect(win.webContents.send).toHaveBeenCalledWith("deep-link", {
      action: "channel",
      id: "abc",
      queryParams: { ok: "1" },
    });
  });

  it("caps forwarded query params at 10", () => {
    const win = makeWindow();
    const params = Array.from({ length: 15 }, (_, i) => `k${i}=v${i}`).join(
      "&",
    );
    handleDeepLink(`bloumechat://channel/abc?${params}`, win);
    const sent = win.webContents.send.mock.calls[0][1];
    expect(Object.keys(sent.queryParams)).toHaveLength(10);
  });

  it("swallows a malformed URL without throwing", () => {
    const win = makeWindow();
    expect(() => handleDeepLink("not a url at all", win)).not.toThrow();
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
