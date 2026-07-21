import { detectLang, getDict, resolveLang, SUPPORTED_LANGS } from "./i18n";

function mockNavigatorLanguages(languages: string[]) {
  Object.defineProperty(window.navigator, "languages", {
    value: languages,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "language", {
    value: languages[0],
    configurable: true,
  });
}

describe("detectLang", () => {
  it("picks the first supported language from navigator.languages", () => {
    mockNavigatorLanguages(["xx-XX", "de-DE", "fr-FR"]);
    expect(detectLang()).toBe("de");
  });

  it("normalizes region-tagged locales", () => {
    mockNavigatorLanguages(["pt-BR"]);
    expect(detectLang()).toBe("pt");
  });

  it("falls back to English when nothing matches", () => {
    mockNavigatorLanguages(["xx-XX", "yy-YY"]);
    expect(detectLang()).toBe("en");
  });

  it("falls back to navigator.language when navigator.languages is empty", () => {
    Object.defineProperty(window.navigator, "languages", {
      value: [],
      configurable: true,
    });
    Object.defineProperty(window.navigator, "language", {
      value: "ja-JP",
      configurable: true,
    });
    expect(detectLang()).toBe("ja");
  });
});

describe("resolveLang", () => {
  it("prefers a valid account language over the OS locale", () => {
    mockNavigatorLanguages(["en-US"]);
    expect(resolveLang("fr")).toBe("fr");
  });

  it("normalizes a region-tagged account language", () => {
    mockNavigatorLanguages(["en-US"]);
    expect(resolveLang("zh-CN")).toBe("zh");
  });

  it("falls back to detectLang() when accountLang is null/undefined", () => {
    mockNavigatorLanguages(["de-DE"]);
    expect(resolveLang(null)).toBe("de");
    expect(resolveLang(undefined)).toBe("de");
  });

  it("falls back to detectLang() when accountLang is unsupported", () => {
    mockNavigatorLanguages(["de-DE"]);
    expect(resolveLang("xx-XX")).toBe("de");
  });
});

describe("getDict", () => {
  it("returns the matching dictionary for a supported language", () => {
    expect(getDict("fr").home.loading).toBeTruthy();
    expect(getDict("en").home.loading).toBeTruthy();
  });

  it("falls back to English for an unsupported code", () => {
    expect(getDict("xx")).toBe(getDict("en"));
  });

  it("every SUPPORTED_LANGS entry resolves to a real dictionary", () => {
    for (const lang of SUPPORTED_LANGS) {
      const dict = getDict(lang);
      expect(dict.home).toBeDefined();
      expect(dict.screen_picker).toBeDefined();
      expect(dict.externalLink).toBeDefined();
    }
  });
});
