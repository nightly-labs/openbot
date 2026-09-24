import { describe, expect, it } from "vitest";
import { applySiteIdentity, scrubbedBrowserUserAgent, siteIdentityForUrl } from "./browser-identity";

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

describe("siteIdentityForUrl", () => {
  it("scrubs WhatsApp hosts including subdomains and media hosts", () => {
    expect(siteIdentityForUrl("https://web.whatsapp.com/")).toBe("scrubbed");
    expect(siteIdentityForUrl("https://www.whatsapp.com/download")).toBe("scrubbed");
    expect(siteIdentityForUrl("https://mmg.whatsapp.net/media")).toBe("scrubbed");
    expect(siteIdentityForUrl("https://whatsapp.com/")).toBe("scrubbed");
  });

  it("keeps native identity for lookalikes and everything else", () => {
    expect(siteIdentityForUrl("https://evilwhatsapp.com/")).toBe("native");
    expect(siteIdentityForUrl("https://whatsapp.com.evil.test/")).toBe("native");
    expect(siteIdentityForUrl("https://accounts.google.com/")).toBe("native");
    expect(siteIdentityForUrl("https://www.google.com/")).toBe("native");
    expect(siteIdentityForUrl("https://x.com/")).toBe("native");
  });

  it("falls back to native when no host can be read", () => {
    expect(siteIdentityForUrl("about:blank")).toBe("native");
    expect(siteIdentityForUrl("not a url")).toBe("native");
  });

  it("ignores a trailing dot on the hostname", () => {
    expect(siteIdentityForUrl("https://web.whatsapp.com./")).toBe("scrubbed");
  });
});

describe("applySiteIdentity", () => {
  const rawAgent = "Mozilla/5.0 AppleWebKit/537.36 OpenBot/0.3.5 Chrome/152.0.7977.54 Electron/44.0.0 Safari/537.36";
  const cleanAgent = "Mozilla/5.0 AppleWebKit/537.36 Chrome/152.0.7977.54 Safari/537.36";

  it("scrubs a listed host and keeps one canonical entry", () => {
    expect(applySiteIdentity("https://web.whatsapp.com/", { "user-agent": rawAgent, Accept: "text/html" })).toEqual({
      "User-Agent": cleanAgent,
      Accept: "text/html",
    });
  });

  it("invents no header when none is sent", () => {
    expect(applySiteIdentity("https://web.whatsapp.com/", { Accept: "text/html" })).toEqual({
      Accept: "text/html",
    });
  });
});
