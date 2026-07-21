import { app } from "electron";
import {
  resolveSupportedLocale,
  getAppLocale,
  resolveMainProcessLocale,
  getI18n,
  getExternalLinkI18n,
  SUPPORTED_LOCALE_CODES,
} from "./locales";

describe("resolveSupportedLocale", () => {
  it("maps a plain 2-letter code to itself when supported", () => {
    expect(resolveSupportedLocale("fr")).toBe("fr");
    expect(resolveSupportedLocale("de")).toBe("de");
  });

  it("strips region/script subtags before matching (BCP-47)", () => {
    expect(resolveSupportedLocale("fr-FR")).toBe("fr");
    expect(resolveSupportedLocale("zh-Hans-CN")).toBe("zh");
    expect(resolveSupportedLocale("pt_BR")).toBe("pt");
  });

  it("is case-insensitive", () => {
    expect(resolveSupportedLocale("FR-fr")).toBe("fr");
  });

  it("falls back to English for an unsupported language", () => {
    expect(resolveSupportedLocale("xx-XX")).toBe("en");
  });

  it("falls back to French when given undefined", () => {
    expect(resolveSupportedLocale(undefined)).toBe("fr");
  });

  it("every code in SUPPORTED_LOCALE_CODES resolves to itself", () => {
    for (const code of SUPPORTED_LOCALE_CODES) {
      expect(resolveSupportedLocale(code)).toBe(code);
    }
  });
});

describe("getAppLocale", () => {
  it("resolves the OS/Chromium locale reported by Electron", () => {
    (app.getLocale as jest.Mock).mockReturnValue("de-DE");
    expect(getAppLocale()).toBe("de");
  });

  it("falls back to en for an unsupported OS locale", () => {
    (app.getLocale as jest.Mock).mockReturnValue("xx-XX");
    expect(getAppLocale()).toBe("en");
  });
});

describe("resolveMainProcessLocale", () => {
  const makeStore = (cached: string | null) =>
    ({
      get: jest.fn(() => cached),
    }) as any;

  it("prefers the cached account language over the OS locale", () => {
    (app.getLocale as jest.Mock).mockReturnValue("en-US");
    expect(resolveMainProcessLocale(makeStore("ja"))).toBe("ja");
  });

  it("normalizes a region-tagged cached value", () => {
    (app.getLocale as jest.Mock).mockReturnValue("en-US");
    expect(resolveMainProcessLocale(makeStore("pt-BR"))).toBe("pt");
  });

  it("falls back to the OS locale when nothing is cached", () => {
    (app.getLocale as jest.Mock).mockReturnValue("de-DE");
    expect(resolveMainProcessLocale(makeStore(null))).toBe("de");
  });

  it("falls back to the OS locale when the cached value is unsupported", () => {
    (app.getLocale as jest.Mock).mockReturnValue("de-DE");
    expect(resolveMainProcessLocale(makeStore("xx"))).toBe("de");
  });
});

describe("getI18n / getExternalLinkI18n", () => {
  it("returns the tray dictionary for a given locale", () => {
    expect(getI18n("fr").trayOpen).toBe("Ouvrir BloumeChat");
    expect(getI18n("en").trayOpen).toBe("Open BloumeChat");
  });

  it("returns the externalLink confirmation dictionary for a given locale", () => {
    const fr = getExternalLinkI18n("fr");
    expect(fr.openButton).toBeTruthy();
    expect(fr.cancelButton).toBeTruthy();
    expect(fr.title).toBeTruthy();
  });
});
