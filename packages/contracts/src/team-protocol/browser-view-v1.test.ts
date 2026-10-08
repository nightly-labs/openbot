import { describe, expect, it } from "vitest";
import { BROWSER_LIVE_VIEW_MAX_PASTE_TEXT } from "../ipc-browser";
import {
  BROWSER_VIEW_MAX_CLIPBOARD_TEXT,
  BROWSER_VIEW_MAX_FRAME_BYTES,
  type BrowserViewInput,
  browserViewInputForHost,
  decodeBrowserViewCopied,
  decodeBrowserViewFrame,
  decodeBrowserViewInput,
  encodeBrowserViewCopied,
  encodeBrowserViewFrame,
  encodeBrowserViewInput,
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
} from "./browser-view-v1";
import { TEAM_CURRENT_CAPABILITIES } from "./current";

describe("the browser view wire format", () => {
  it("carries a frame with the size the coordinates are a fraction of", () => {
    const image = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const frame = { sequence: 42, width: 1280, height: 800, image };
    expect(decodeBrowserViewFrame(encodeBrowserViewFrame(frame))).toEqual(frame);
  });

  it("refuses a frame that is not one", () => {
    const encoded = encodeBrowserViewFrame({ sequence: 1, width: 8, height: 8, image: new Uint8Array([1, 2, 3]) });
    // A frame with no image, a frame whose magic belongs to another stream, and a frame larger than
    // any photograph: the client draws whatever survives this, so none of them may.
    expect(() => decodeBrowserViewFrame(encoded.slice(0, 12))).toThrow("Invalid browser view frame.");
    const foreign = encoded.slice();
    foreign[0] = 0x00;
    expect(() => decodeBrowserViewFrame(foreign)).toThrow("Invalid browser view frame.");
    expect(() =>
      encodeBrowserViewFrame({
        sequence: 1,
        width: 8,
        height: 8,
        image: new Uint8Array(BROWSER_VIEW_MAX_FRAME_BYTES + 1),
      }),
    ).toThrow("The browser view frame is too large.");
  });

  it("carries pointer and key input as fractions of the frame", () => {
    const click: BrowserViewInput = {
      type: "pointer",
      action: "down",
      x: 0.25,
      y: 0.5,
      button: "left",
      clickCount: 2,
      deltaX: 0,
      deltaY: 0,
      modifiers: 2,
    };
    expect(decodeBrowserViewInput(encodeBrowserViewInput(click))).toEqual(click);
    const key: BrowserViewInput = { type: "key", action: "char", key: "a", code: "KeyA", text: "a", modifiers: 0 };
    expect(decodeBrowserViewInput(encodeBrowserViewInput(key))).toEqual(key);
  });

  it("carries the frame a point belongs to, and reads a client that names none", () => {
    const click: BrowserViewInput = {
      type: "pointer",
      action: "down",
      x: 0.25,
      y: 0.5,
      sequence: 7,
      button: "left",
      clickCount: 1,
      deltaX: 0,
      deltaY: 0,
      modifiers: 0,
    };
    expect(decodeBrowserViewInput(encodeBrowserViewInput(click))).toEqual(click);
    // The field was added after this protocol shipped. A client from before it names no frame, and
    // the decoded input must not invent one: the host reads that as the newest frame it sent.
    const { sequence: _sequence, ...beforeTheField } = click;
    expect(decodeBrowserViewInput(JSON.stringify(beforeTheField))).toEqual(beforeTheField);
    expect(decodeBrowserViewInput(JSON.stringify(beforeTheField))).not.toHaveProperty("sequence");
  });

  it("omits the frame name for a host that does not advertise it", () => {
    const click: BrowserViewInput = {
      type: "pointer",
      action: "down",
      x: 0.25,
      y: 0.5,
      sequence: 7,
      button: "left",
      clickCount: 1,
      deltaX: 0,
      deltaY: 0,
      modifiers: 0,
    };
    expect(TEAM_CURRENT_CAPABILITIES).toContain(TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY);
    expect(browserViewInputForHost(click, true, true)).toEqual(click);
    const released = browserViewInputForHost(click, false, true);
    if (!released) throw new Error("A point with no frame name is still a released payload.");
    expect(released).not.toHaveProperty("sequence");
    expect(JSON.parse(encodeBrowserViewInput(released))).not.toHaveProperty("sequence");
    const ack = { type: "ack" as const, sequence: 7 };
    expect(decodeBrowserViewInput(encodeBrowserViewInput(ack))).toEqual(ack);
    expect(browserViewInputForHost(ack, true, true)).toEqual(ack);
    // An older host closes the socket on an input it does not know, so the acknowledgement stays here.
    expect(browserViewInputForHost(ack, false, true)).toBeNull();
  });

  it("carries a paste and a copy only to a host that answers them", () => {
    const paste: BrowserViewInput = { type: "paste", text: "line one\nline two" };
    const copy: BrowserViewInput = { type: "copy", cut: true };
    expect(TEAM_CURRENT_CAPABILITIES).toContain(TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY);
    expect(decodeBrowserViewInput(encodeBrowserViewInput(paste))).toEqual(paste);
    expect(decodeBrowserViewInput(encodeBrowserViewInput(copy))).toEqual(copy);
    expect(browserViewInputForHost(paste, true, true)).toEqual(paste);
    // An older host closes the view on either, which would end the view the user is working in.
    expect(browserViewInputForHost(paste, true, false)).toBeNull();
    expect(browserViewInputForHost(copy, true, false)).toBeNull();
    const longest = "x".repeat(BROWSER_VIEW_MAX_CLIPBOARD_TEXT);
    expect(decodeBrowserViewInput(encodeBrowserViewInput({ type: "paste", text: longest }))).toEqual({
      type: "paste",
      text: longest,
    });
    expect(BROWSER_LIVE_VIEW_MAX_PASTE_TEXT).toBe(BROWSER_VIEW_MAX_CLIPBOARD_TEXT);

    const copied = { type: "copied" as const, text: "selected" };
    expect(decodeBrowserViewCopied(encodeBrowserViewCopied(copied))).toEqual(copied);
    expect(decodeBrowserViewCopied(encodeBrowserViewCopied({ type: "copyTooLarge" }))).toEqual({
      type: "copyTooLarge",
    });
    for (const invalid of [
      { type: "copied", text: `${longest}x` },
      { type: "copied" },
      { type: "frame", text: "selected" },
    ]) {
      expect(() => decodeBrowserViewCopied(JSON.stringify(invalid))).toThrow("Invalid browser view message.");
    }
  });

  it("refuses input that a host would dispatch somewhere it cannot see", () => {
    const click = { type: "pointer", action: "down", x: 0.5, y: 0.5, button: "left", modifiers: 0 };
    // A fraction is the whole agreement about where the click lands: outside 0..1 the host would
    // dispatch past its own viewport, and a click count or a modifier bitmap it never sends is a
    // value it has no reading for.
    for (const invalid of [
      { ...click, x: 1.5 },
      { ...click, y: -0.1 },
      { ...click, button: "back" },
      { ...click, clickCount: 40 },
      { ...click, modifiers: 999 },
      { ...click, sequence: 0 },
      { ...click, sequence: 1.5 },
      { type: "key", action: "char", key: "a", code: "KeyA", text: "a whole pasted paragraph" },
      { type: "clipboard", data: "secret" },
      { type: "paste", text: "" },
      { type: "paste", text: "x".repeat(BROWSER_VIEW_MAX_CLIPBOARD_TEXT + 1) },
      { type: "copy" },
    ]) {
      expect(() => decodeBrowserViewInput(JSON.stringify(invalid))).toThrow("Invalid browser view input.");
    }
  });
});
