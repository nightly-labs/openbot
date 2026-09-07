import { describe, expect, it } from "vitest";
import { embeddedBrowserUserAgent } from "./browser-identity";

describe("embeddedBrowserUserAgent", () => {
  it("removes the build and product tokens, so a browser allowlist reads plain Chromium", () => {
    expect(
      embeddedBrowserUserAgent(
        "Mozilla/5.0 AppleWebKit/537.36 OpenBot/0.3.5 Chrome/152.0.7977.54 Electron/44.0.0 Safari/537.36",
      ),
    ).toBe("Mozilla/5.0 AppleWebKit/537.36 Chrome/152.0.7977.54 Safari/537.36");
  });
});
