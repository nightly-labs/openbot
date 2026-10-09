import { describe, expect, it } from "vitest";
import { BROWSER_LIVE_VIEW_MAX_PASTE_TEXT } from "../ipc-browser";
import {
  BROWSER_VIEW_MAX_CLIPBOARD_TEXT,
  BROWSER_VIEW_MAX_FRAME_BYTES,
  type BrowserViewInput,
  browserViewClientViewport,
  browserViewInputForHost,
  decodeBrowserViewCopied,
  decodeBrowserViewFrame,
  decodeBrowserViewHostMessage,
  decodeBrowserViewInput,
  encodeBrowserViewCopied,
  encodeBrowserViewFrame,
  encodeBrowserViewHostMessage,
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

  it("carries a paste, a copy and a cut only to a host that answers them", () => {
    const paste: BrowserViewInput = { type: "paste", text: "line one\nline two" };
    const copy: BrowserViewInput = { type: "copy" };
    const cut: BrowserViewInput = { type: "cut", text: "line one" };
    expect(TEAM_CURRENT_CAPABILITIES).toContain(TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY);
    for (const input of [paste, copy, cut]) {
      expect(decodeBrowserViewInput(encodeBrowserViewInput(input))).toEqual(input);
      expect(browserViewInputForHost(input, true, true)).toEqual(input);
      // An older host closes the view on each, which would end the view the user is working in.
      expect(browserViewInputForHost(input, true, false)).toBeNull();
    }
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
      { type: "cut", text: "" },
      { type: "cut" },
    ]) {
      expect(() => decodeBrowserViewInput(JSON.stringify(invalid))).toThrow("Invalid browser view input.");
    }
  });

  it("reads a host message it knows, and ignores one it does not", () => {
    const cursor = { type: "cursor" as const, cursor: "text" as const };
    expect(decodeBrowserViewHostMessage(encodeBrowserViewHostMessage(cursor))).toEqual(cursor);
    // A newer host can name a cursor this client has no drawing for.
    expect(decodeBrowserViewHostMessage(JSON.stringify({ type: "cursor", cursor: "alias-of-the-future" }))).toEqual({
      type: "cursor",
      cursor: "default",
    });
    expect(decodeBrowserViewHostMessage(JSON.stringify({ type: "something-newer" }))).toBeNull();
    // The answer to a copy keeps the bounds of the released decoder.
    expect(decodeBrowserViewHostMessage(encodeBrowserViewCopied({ type: "copied", text: "hi" }))).toEqual({
      type: "copied",
      text: "hi",
    });
    expect(() => decodeBrowserViewHostMessage(JSON.stringify({ type: "copied", text: 4 }))).toThrow(
      "Invalid browser view message.",
    );
    // A menu keeps the items this client knows, and a copy item only with the address it copies.
    expect(
      decodeBrowserViewHostMessage(
        JSON.stringify({
          type: "context-menu",
          items: ["copy-link", "copy-image-address", "copy", "print"],
          link: "https://a.example/",
        }),
      ),
    ).toEqual({ type: "context-menu", items: ["copy-link", "copy"], link: "https://a.example/" });
    expect(() =>
      decodeBrowserViewHostMessage(
        JSON.stringify({ type: "context-menu", items: [], link: `https://a.example/${"a".repeat(2_048)}` }),
      ),
    ).toThrow("Invalid browser view message.");
  });

  it("reads the page size a client asks for only inside the bounds", () => {
    const asked = (value: string) => browserViewClientViewport(new URL(`http://host/stream?viewport=${value}`));
    expect(asked("1280x800")).toEqual({ width: 1280, height: 800 });
    expect([asked("100x800"), asked("1280x9000"), asked("1280"), asked("1e3x800")]).toEqual([null, null, null, null]);
    expect(browserViewClientViewport(new URL("http://host/stream"))).toBeNull();
  });
});
