import { describe, expect, it } from "vitest";
import { canCheckRendererPermission, canRequestRendererPermission } from "./renderer-permissions";

const developmentUrl = "http://localhost:5173";

describe("renderer permissions", () => {
  it("allows sanitized clipboard writes only from the trusted renderer", () => {
    expect(canCheckRendererPermission("clipboard-sanitized-write", developmentUrl, {}, developmentUrl)).toBe(true);
    expect(
      canRequestRendererPermission(
        "clipboard-sanitized-write",
        { requestingUrl: `${developmentUrl}/settings`, isMainFrame: true },
        developmentUrl,
      ),
    ).toBe(true);
    expect(canCheckRendererPermission("clipboard-sanitized-write", "https://example.com", {}, developmentUrl)).toBe(
      false,
    );
    expect(canCheckRendererPermission("clipboard-read", developmentUrl, {}, developmentUrl)).toBe(false);
  });

  it("keeps media access limited to audio from the trusted renderer", () => {
    expect(canCheckRendererPermission("media", developmentUrl, { mediaType: "audio" }, developmentUrl)).toBe(true);
    expect(canCheckRendererPermission("media", developmentUrl, { mediaType: "video" }, developmentUrl)).toBe(false);
    expect(
      canRequestRendererPermission(
        "media",
        { requestingUrl: developmentUrl, isMainFrame: true, mediaTypes: ["audio"] },
        developmentUrl,
      ),
    ).toBe(true);
    expect(
      canRequestRendererPermission(
        "media",
        { requestingUrl: developmentUrl, isMainFrame: true, mediaTypes: ["audio", "video"] },
        developmentUrl,
      ),
    ).toBe(false);
  });

  it("refuses a frame inside the trusted window, such as a visual reply", () => {
    const visualFrame = { requestingUrl: "openbot-visual://file/attachment-1", isMainFrame: false };
    expect(canRequestRendererPermission("clipboard-sanitized-write", visualFrame, developmentUrl)).toBe(false);
    expect(
      canRequestRendererPermission(
        "media",
        { requestingUrl: developmentUrl, isMainFrame: false, mediaTypes: ["audio"] },
        developmentUrl,
      ),
    ).toBe(false);
  });
});
