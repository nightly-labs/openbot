import { describe, expect, it } from "vitest";
import { DOWNLOAD_PLATFORM_ORDER, DOWNLOAD_PLATFORMS, detectDownloadPlatform } from "../src/lib/download-platforms";
import { OPENBOT_DOWNLOAD_LINKS } from "../src/lib/landing-links";

describe("download platforms", () => {
  it.each([
    [{ userAgentData: { platform: "macOS" } }, "macos"],
    [{ platform: "MacIntel" }, "macos"],
    [{ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }, "windows"],
    [{ platform: "Linux x86_64" }, "linux"],
    [{ userAgent: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64)" }, "linux"],
  ] as const)("detects %o as %s", (source, expected) => {
    expect(detectDownloadPlatform(source)).toBe(expected);
  });

  it("returns no platform for an unknown client", () => {
    expect(detectDownloadPlatform({ platform: "Unknown" })).toBeUndefined();
  });

  it("offers a download for every platform it can detect", () => {
    for (const platform of DOWNLOAD_PLATFORM_ORDER) {
      const details = DOWNLOAD_PLATFORMS[platform];
      expect(details).toMatchObject({ available: true, status: "Available", href: OPENBOT_DOWNLOAD_LINKS[platform] });
    }
  });

  it("describes the Linux download as an x64 AppImage", () => {
    expect(DOWNLOAD_PLATFORMS.linux.description).toBe("x64 · AppImage");
    expect(DOWNLOAD_PLATFORMS.linux.action).toBe("Download for Linux");
  });
});
