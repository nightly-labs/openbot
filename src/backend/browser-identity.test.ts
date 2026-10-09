import { describe, expect, it } from "vitest";
import { browserClientHints, browserRequestUserAgent, sessionBrowserUserAgent } from "./browser-identity";

const rawAgent = "Mozilla/5.0 AppleWebKit/537.36 OpenBot/0.3.5 Chrome/152.0.7977.54 Electron/44.0.0 Safari/537.36";
const cleanAgent = "Mozilla/5.0 AppleWebKit/537.36 Chrome/152.0.7977.54 Safari/537.36";

describe("sessionBrowserUserAgent", () => {
  it("removes the build and product tokens without changing the Chromium version", () => {
    expect(sessionBrowserUserAgent(rawAgent)).toBe(cleanAgent);
    expect(sessionBrowserUserAgent(cleanAgent)).toBe(cleanAgent);
  });
});

describe("browserRequestUserAgent", () => {
  it("keeps the Google account request identity that accepts sign-in", () => {
    const googleAgent = cleanAgent.replace(" Safari/", " Electron/44.0.0 Safari/");
    expect(browserRequestUserAgent("https://accounts.google.com/", cleanAgent, "44.0.0")).toBe(googleAgent);
    expect(browserRequestUserAgent("https://accounts.google.com./", rawAgent, "44.0.0")).toBe(googleAgent);
  });

  it.each([
    "https://x.com/",
    "https://www.linkedin.com/",
    "https://web.whatsapp.com/",
    "https://www.canva.com/",
    "https://framer.com/",
    "https://accounts.google.com.example.com/",
    "https://notaccounts.google.com/",
    "https://www.google.com/",
  ])("uses the plain Chromium identity for %s", (url) => {
    expect(browserRequestUserAgent(url, rawAgent, "44.0.0")).toBe(cleanAgent);
  });
});

describe("browserClientHints", () => {
  it.each([
    ["darwin", "macOS"],
    ["win32", "Windows"],
    ["linux", "Linux"],
  ] as const)("uses the installed Chromium version and %s platform", (platform, name) => {
    expect(browserClientHints("152.0.7977.54", platform)).toEqual({
      "Sec-CH-UA": '"Chromium";v="152"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": `"${name}"`,
    });
  });
});
