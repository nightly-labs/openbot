// @vitest-environment node

import type { BrowserDockAction, BrowserDockFrame, BrowserDockPresentation } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_DOCK_OVERLAY_WIDTH, browserDockLayout } from "../browser-dock-overlay";
import { browserDockIpcHandlers } from "./browser-dock-handlers";

// Same reason as define-ipc-group.test.ts: electron cannot be imported outside an Electron process, so
// registrations are captured. The overlay module also imports the view classes, which these tests never build.
const { registrations } = vi.hoisted(() => ({
  registrations: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown) {
      registrations.set(channel, listener);
    },
  },
  View: class {},
  WebContentsView: class {},
}));

const MAIN_ID = 1;
const OVERLAY_ID = 2;
const OTHER_ID = 3;

const AGENT = {
  id: "agent-1",
  name: "Ada",
  title: "Researcher",
  description: "",
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarUrl: null,
};

const PRESENTATION: BrowserDockPresentation = {
  agent: AGENT,
  agents: [AGENT],
  skills: [],
  mcpServers: [],
  draft: { text: "", revision: 0 },
  focusRequest: 0,
  sendShortcut: "enter",
  working: false,
  deliveries: [],
  hold: null,
  editingDeliveryId: null,
  canSteer: false,
  steerSupported: true,
  canRunAsTask: false,
  island: null,
  handoffPending: false,
  canHandoff: false,
};

const FRAME: BrowserDockFrame = { seq: 1, height: 120, glass: [] };

function event(senderId: number, url = "openbot-app://app/index.html") {
  return { senderFrame: { url }, sender: { id: senderId } };
}

function register() {
  const published: Array<BrowserDockPresentation | null> = [];
  const actions: BrowserDockAction[] = [];
  const frames: BrowserDockFrame[] = [];
  const { browserDock } = browserDockIpcHandlers({
    browserDock: {
      mainRendererIds: new Set([MAIN_ID]),
      overlayRendererIds: new Set([OVERLAY_ID]),
      presentation: PRESENTATION,
      publish: (presentation) =>
        Effect.sync(() => {
          published.push(presentation);
        }),
      performAction: (action) => {
        actions.push(action);
      },
      setFrame: (frame) => {
        frames.push(frame);
      },
    },
  });
  for (const [name, bind] of Object.entries(browserDock)) bind(`browserDock:${name}`);
  const call = (name: string, senderId: number, payload?: unknown) => {
    const listener = registrations.get(`browserDock:${name}`);
    if (!listener) throw new Error(`No handler for ${name}.`);
    return listener(event(senderId), payload);
  };
  return { published, actions, frames, call };
}

beforeEach(() => registrations.clear());

describe("browser dock handlers", () => {
  it("takes the presentation only from the main renderer", async () => {
    const { published, call } = register();
    expect(() => call("publishPresentation", OVERLAY_ID, PRESENTATION)).toThrow("outside the main renderer");
    expect(() => call("publishPresentation", OTHER_ID, PRESENTATION)).toThrow("outside the main renderer");
    await call("publishPresentation", MAIN_ID, PRESENTATION);
    await call("publishPresentation", MAIN_ID, null);
    expect(published).toEqual([PRESENTATION, null]);
  });

  it("checks the sender before it decodes the payload", () => {
    const { published, actions, frames, call } = register();
    expect(() => call("publishPresentation", OVERLAY_ID, { agent: "nope" })).toThrow("outside the main renderer");
    expect(() => call("performAction", MAIN_ID, { type: "unknown" })).toThrow("outside the browser dock overlay");
    expect(() => call("setFrame", MAIN_ID, { seq: -1 })).toThrow("outside the browser dock overlay");
    expect(() => call("publishPresentation", MAIN_ID, { agent: "nope" })).toThrow("presentation is invalid");
    expect(() => call("performAction", OVERLAY_ID, { type: "unknown" })).toThrow("action is invalid");
    expect(() => call("setFrame", OVERLAY_ID, { seq: -1 })).toThrow("frame is invalid");
    expect([published, actions, frames]).toEqual([[], [], []]);
  });

  it("gives the presentation, the actions and the frames only to the overlay", () => {
    const { actions, frames, call } = register();
    expect(() => call("getPresentation", MAIN_ID)).toThrow("outside the browser dock overlay");
    expect(call("getPresentation", OVERLAY_ID)).toEqual(PRESENTATION);
    call("performAction", OVERLAY_ID, { type: "send", text: "hello" });
    call("setFrame", OVERLAY_ID, FRAME);
    expect(actions).toEqual([{ type: "send", text: "hello" }]);
    expect(frames).toEqual([FRAME]);
  });

  it("refuses a frame with too many glass shapes or too large a blur", () => {
    const { frames, call } = register();
    const glass = { left: 0, bottom: 0, width: 10, height: 10, radius: 4, blur: 20 };
    expect(() => call("setFrame", OVERLAY_ID, { ...FRAME, glass: Array.from({ length: 17 }, () => glass) })).toThrow(
      "frame is invalid",
    );
    expect(() => call("setFrame", OVERLAY_ID, { ...FRAME, glass: [{ ...glass, blur: 65 }] })).toThrow(
      "frame is invalid",
    );
    expect(frames).toEqual([]);
  });

  it("rejects a renderer outside the app", () => {
    const { published } = register();
    const listener = registrations.get("browserDock:publishPresentation");
    expect(() => listener?.(event(MAIN_ID, "https://evil.example/"), PRESENTATION)).toThrow("untrusted renderer");
    expect(published).toEqual([]);
  });
});

describe("browser dock layout", () => {
  const page = { tabId: "tab-1", bounds: { x: 100, y: 50, width: 1000, height: 800 }, zoomFactor: 1 };

  it("puts the overlay at the bottom centre of the page", () => {
    expect(browserDockLayout(page, 200, []).overlay).toEqual({
      x: 100 + (1000 - BROWSER_DOCK_OVERLAY_WIDTH) / 2,
      y: 650,
      width: BROWSER_DOCK_OVERLAY_WIDTH,
      height: 200,
    });
  });

  it("keeps the overlay inside a small page", () => {
    const small = { ...page, bounds: { x: 0, y: 0, width: 400, height: 300 } };
    expect(browserDockLayout(small, 16_384, []).overlay).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  it("scales with the zoom of the window", () => {
    const zoomed = { ...page, bounds: { x: 0, y: 0, width: 2000, height: 1000 }, zoomFactor: 2 };
    const layout = browserDockLayout(zoomed, 100, [
      { left: 10, bottom: 5, width: 50, height: 20, radius: 10, blur: 16 },
    ]);
    expect(layout.overlay).toEqual({ x: 312, y: 800, width: 1376, height: 200 });
    expect(layout.glass).toEqual([{ bounds: { x: 332, y: 950, width: 100, height: 40 }, radius: 20, blur: 16 }]);
  });

  it("clips glass to the overlay, drops glass outside it, and bounds the radius and the blur", () => {
    const layout = browserDockLayout(page, 100, [
      { left: -20, bottom: 0, width: 60, height: 40, radius: 400, blur: 500 },
      { left: 700, bottom: 0, width: 50, height: 50, radius: 4, blur: 8 },
      { left: 0, bottom: 120, width: 50, height: 50, radius: 4, blur: 8 },
    ]);
    const x = 100 + (1000 - BROWSER_DOCK_OVERLAY_WIDTH) / 2;
    expect(layout.glass).toEqual([{ bounds: { x, y: 810, width: 40, height: 40 }, radius: 20, blur: 64 }]);
  });
});
