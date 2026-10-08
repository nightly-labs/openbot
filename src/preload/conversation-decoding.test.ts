// @vitest-environment node

import { describe, expect, it } from "vitest";
import { decodeFilePreview } from "./conversation-decoding";

const preview = {
  name: "report.html",
  size: 1,
  mimeType: "text/html",
  previewKind: "text",
  bytes: new Uint8Array([60]),
};
const pageUrl = "openbot-visual://preview/6e25cdd3-e985-4b45-8f86-572bb037ed50";

describe("file preview page decoding", () => {
  it("keeps a temporary page address and accepts previews from main without it", () => {
    expect(decodeFilePreview({ ...preview, pageUrl })).toEqual({ ...preview, pageUrl });
    expect(decodeFilePreview(preview)).toEqual(preview);
  });

  it("rejects page addresses outside the isolated preview scheme", () => {
    for (const address of [
      "file:///private.html",
      "javascript:alert(1)",
      "https://example.com",
      "openbot-app://app/index.html",
      "openbot-visual://preview/../../private.html",
      `${pageUrl}?file=/private.html`,
      null,
      1,
    ]) {
      expect(() => decodeFilePreview({ ...preview, pageUrl: address })).toThrow("Invalid file preview response.");
    }
  });
});
