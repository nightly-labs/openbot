import { describe, expect, it } from "vitest";
import {
  BROWSER_VIEW_MAX_FRAME_BYTES,
  type BrowserViewInput,
  browserViewInputForHost,
  decodeBrowserViewFrame,
  decodeBrowserViewInput,
  encodeBrowserViewFrame,
  encodeBrowserViewInput,
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
    expect(browserViewInputForHost(click, true)).toEqual(click);
    const released = browserViewInputForHost(click, false);
    if (!released) throw new Error("A point with no frame name is still a released payload.");
    expect(released).not.toHaveProperty("sequence");
    expect(JSON.parse(encodeBrowserViewInput(released))).not.toHaveProperty("sequence");
    const ack = { type: "ack" as const, sequence: 7 };
    expect(decodeBrowserViewInput(encodeBrowserViewInput(ack))).toEqual(ack);
    expect(browserViewInputForHost(ack, true)).toEqual(ack);
    // An older host closes the socket on an input it does not know, so the acknowledgement stays here.
    expect(browserViewInputForHost(ack, false)).toBeNull();
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
    ]) {
      expect(() => decodeBrowserViewInput(JSON.stringify(invalid))).toThrow("Invalid browser view input.");
    }
  });
});
