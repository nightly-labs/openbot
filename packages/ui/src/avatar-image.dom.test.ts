import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAvatarFile } from "./avatar-image";

// Two-frame 96x64 animated WebP made with `img2webp`.
const ANIMATED_WEBP = base64Bytes(
  "UklGRpAAAABXRUJQVlA4WAoAAAACAAAAXwAAPwAAQU5JTQYAAAD/////AABBTk1GLgAAAAAAAAAAAF8AAD8AAMgAAAJWUDhMFQAAAC9fwA8ABxD1j/4HgITwf74U0f/UHwBBTk1GLgAAAAAAAAAAAF8AAD8AAMgAAABWUDhMFQAAAC9fwA8ABxDR//4HgITwf74U0f/UHwA=",
);
// A still WebP laid out as Chromium's canvas encoder writes it: VP8X, an ICCP profile, then VP8.
const CANVAS_STILL_WEBP = base64Bytes("UklGRiwAAABXRUJQVlA4WAoAAAAgAAAA/wEA/wEASUNDUAEAAAABAFZQOCADAAAAAgMEAA==");
const nativeCanvasGetContext = HTMLCanvasElement.prototype.getContext;

describe("normalizeAvatarFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: nativeCanvasGetContext,
    });
  });

  it("resizes every frame of an animated WebP into one animated WebP", async () => {
    vi.stubGlobal(
      "ImageDecoder",
      class {
        tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2 } };
        close = vi.fn();
        decode = vi.fn(async () => ({
          image: { displayWidth: 96, displayHeight: 64, duration: 200_000, close: vi.fn() },
        }));
      },
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ drawImage: vi.fn() })),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob([CANVAS_STILL_WEBP], { type: "image/webp" }));
    });

    const avatar = await normalizeAvatarFile(new File([ANIMATED_WEBP], "avatar.webp", { type: "image/webp" }));

    const text = String.fromCharCode(...avatar.bytes);
    expect(avatar.mimeType).toBe("image/webp");
    expect(new DataView(avatar.bytes.buffer).getUint32(4, true)).toBe(avatar.bytes.byteLength - 8);
    expect(text.slice(8, 16)).toBe("WEBPVP8X");
    expect(text.match(/ANMF/g)).toHaveLength(2);
    expect(text.match(/VP8 /g)).toHaveLength(2);
    // A frame that holds an ICCP chunk makes the whole file invalid.
    expect(text).not.toContain("ICCP");
  });

  it("stops encoding frames once an animated WebP passes the stored size limit", async () => {
    const decode = vi.fn(async () => ({
      image: { displayWidth: 96, displayHeight: 64, duration: 200_000, close: vi.fn() },
    }));
    vi.stubGlobal(
      "ImageDecoder",
      class {
        tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 100 } };
        close = vi.fn();
        decode = decode;
      },
    );
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      writable: true,
      value: vi.fn(() => ({ drawImage: vi.fn() })),
    });
    // A 300 KB frame: two of them pass the 512 KB limit.
    const largeFrame = new Uint8Array(12 + 8 + 300 * 1024);
    largeFrame.set(CANVAS_STILL_WEBP.subarray(0, 12));
    largeFrame.set([0x56, 0x50, 0x38, 0x20], 12);
    new DataView(largeFrame.buffer).setUint32(16, 300 * 1024, true);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob([largeFrame], { type: "image/webp" }));
    });

    await expect(normalizeAvatarFile(new File([ANIMATED_WEBP], "avatar.webp", { type: "image/webp" }))).rejects.toThrow(
      "OpenBot could not make this image small enough. Choose a simpler image.",
    );
    // Two frames for each of the four output sizes, not all 100 frames four times.
    expect(decode).toHaveBeenCalledTimes(8);
  });
});

function base64Bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
