import { describe, expect, it } from "vitest";
import { requiresScrubbedIdentity, scrubbedBrowserUserAgent } from "./browser-identity";

describe("scrubbedBrowserUserAgent", () => {
  it("removes the build and product tokens for gated hosts", () => {
    expect(
      scrubbedBrowserUserAgent(
        "Mozilla/5.0 AppleWebKit/537.36 OpenBot/0.3.5 Chrome/152.0.7977.54 Electron/44.0.0 Safari/537.36",
      ),
    ).toBe("Mozilla/5.0 AppleWebKit/537.36 Chrome/152.0.7977.54 Safari/537.36");
  });

  it("leaves an already plain agent alone", () => {
    const agent = "Mozilla/5.0 AppleWebKit/537.36 Chrome/152.0.7977.54 Safari/537.36";
    expect(scrubbedBrowserUserAgent(agent)).toBe(agent);
  });
});

describe("requiresScrubbedIdentity", () => {
  it("names WhatsApp hosts including subdomains and media hosts", () => {
    expect(requiresScrubbedIdentity("https://web.whatsapp.com/")).toBe(true);
    expect(requiresScrubbedIdentity("https://www.whatsapp.com/download")).toBe(true);
    expect(requiresScrubbedIdentity("https://mmg.whatsapp.net/media")).toBe(true);
    expect(requiresScrubbedIdentity("https://whatsapp.com/")).toBe(true);
  });

  it("ignores lookalike hosts and anything unparsable", () => {
    expect(requiresScrubbedIdentity("https://evilwhatsapp.com/")).toBe(false);
    expect(requiresScrubbedIdentity("https://whatsapp.com.evil.test/")).toBe(false);
    expect(requiresScrubbedIdentity("https://accounts.google.com/")).toBe(false);
    expect(requiresScrubbedIdentity("https://www.google.com/")).toBe(false);
    expect(requiresScrubbedIdentity("about:blank")).toBe(false);
    expect(requiresScrubbedIdentity("not a url")).toBe(false);
  });
});
