import { describe, expect, it } from "vitest";
import { resolveLocale, translateFor } from "./index";
import { createTranslate } from "./message";

describe("resolveLocale", () => {
  it("reads a system locale by its language subtag", () => {
    expect(resolveLocale("system", "ja-JP")).toBe("ja");
    expect(resolveLocale("system", "ja")).toBe("ja");
  });

  it("falls back to English for a language no catalog covers", () => {
    expect(resolveLocale("system", "fi-FI")).toBe("en");
  });

  it("lets an explicit choice override the computer", () => {
    expect(resolveLocale("ja", "en-US")).toBe("ja");
    expect(resolveLocale("en", "ja-JP")).toBe("en");
  });
});

describe("translateFor", () => {
  it("returns the translation for the locale", () => {
    expect(translateFor("ja")("menu.stopAllAgents")).toBe("すべてのエージェントを停止");
    expect(translateFor("en")("menu.stopAllAgents")).toBe("Stop all agents");
  });

  it("fills a placeholder", () => {
    expect(translateFor("en")("startup.failedBody", { message: "Disk is full" })).toContain("Disk is full");
  });
});

describe("createTranslate", () => {
  const source = {
    greeting: "Hello {name}",
    replies: { one: "{count} reply", other: "{count} replies" },
  } as const;

  it("falls back to the English source when a catalog has not translated a key", () => {
    // A catalog from a newer build can be missing a key this build added. English is readable;
    // an empty string is not.
    const translate = createTranslate({
      source,
      translation: { greeting: "こんにちは {name}" },
      locale: "ja",
      sourceLocale: "en",
    });
    expect(translate("replies", { count: 2 })).toBe("2 replies");
    // English text, so English plural rules. Japanese has one form for every count, and choosing
    // by the language that was asked for rather than by the language of the text renders
    // "1 replies".
    expect(translate("replies", { count: 1 })).toBe("1 reply");
  });

  it("picks the plural form the locale asks for", () => {
    const english = createTranslate({ source, locale: "en", sourceLocale: "en" });
    expect(english("replies", { count: 1 })).toBe("1 reply");
    expect(english("replies", { count: 5 })).toBe("5 replies");
  });

  it("uses the single form in a language without a plural distinction", () => {
    const japanese = createTranslate({
      source,
      translation: { greeting: "こんにちは {name}", replies: { other: "{count} 件の返信" } },
      locale: "ja",
      sourceLocale: "en",
    });
    expect(japanese("replies", { count: 1 })).toBe("1 件の返信");
    expect(japanese("replies", { count: 5 })).toBe("5 件の返信");
  });

  it("renders readable text for a locale tag Intl rejects", () => {
    const broken = createTranslate({ source, locale: "not a locale", sourceLocale: "en" });
    expect(broken("replies", { count: 2 })).toBe("2 replies");
  });
});
