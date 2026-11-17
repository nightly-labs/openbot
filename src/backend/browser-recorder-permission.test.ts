import { describe, expect, it } from "vitest";
import { isRecorderTabCapture } from "./browser-recorder-permission";

const recorderRequest = {
  requestingUrl: "https://example.com/",
  securityOrigin: "https://recorder.openbot.invalid/",
  mediaTypes: ["video"],
};

describe("recorder tab capture permission", () => {
  it("allows the recorder's video capture of a tab while its capture starts", () => {
    expect(isRecorderTabCapture("display-capture", recorderRequest, true)).toBe(true);
  });

  it("refuses the request when no capture of the tab starts", () => {
    expect(isRecorderTabCapture("display-capture", recorderRequest, false)).toBe(false);
  });

  it("refuses a page's own screen capture", () => {
    expect(
      isRecorderTabCapture("display-capture", { ...recorderRequest, securityOrigin: "https://example.com/" }, true),
    ).toBe(false);
    expect(isRecorderTabCapture("display-capture", { requestingUrl: "https://example.com/" }, true)).toBe(false);
  });

  it("refuses audio and other permissions", () => {
    expect(isRecorderTabCapture("display-capture", { ...recorderRequest, mediaTypes: ["video", "audio"] }, true)).toBe(
      false,
    );
    expect(isRecorderTabCapture("display-capture", { ...recorderRequest, mediaTypes: ["audio"] }, true)).toBe(false);
    expect(isRecorderTabCapture("display-capture", { ...recorderRequest, mediaTypes: [] }, true)).toBe(false);
    expect(isRecorderTabCapture("media", recorderRequest, true)).toBe(false);
  });
});
