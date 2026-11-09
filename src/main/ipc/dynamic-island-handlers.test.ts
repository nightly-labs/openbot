// @vitest-environment node

import {
  type AgentDockInputRect,
  type DynamicIslandPreference,
  IDLE_DYNAMIC_ISLAND_PRESENTATION,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dynamicIslandIpcHandlers } from "./dynamic-island-handlers";

// Same reason as define-ipc-group.test.ts: electron cannot be imported outside an Electron process, so
// registrations are captured.
const { registrations } = vi.hoisted(() => ({
  registrations: new Map<string, (event: unknown, payload?: unknown) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown) {
      registrations.set(channel, listener);
    },
  },
}));

const MAIN_ID = 1;
const ISLAND_ID = 2;
const OTHER_ID = 3;

const PREFERENCE: DynamicIslandPreference = {
  enabled: true,
  hapticsEnabled: true,
  idleVisible: true,
  additionalDisplaysEnabled: false,
  widthPercent: 100,
  heightPercent: 100,
  serverVisibility: {},
  newServersVisible: true,
};

function event(senderId: number, url = "openbot-app://app/helper.html?surface=dynamic-island") {
  return { senderFrame: { url }, sender: { id: senderId } };
}

function register() {
  const regions: Array<[number, AgentDockInputRect[]]> = [];
  const xwayland: boolean[] = [];
  const saved: DynamicIslandPreference[] = [];
  const { dynamicIsland } = dynamicIslandIpcHandlers({
    dynamicIsland: {
      mainRendererIds: new Set([MAIN_ID]),
      overlayRendererIds: new Set([ISLAND_ID]),
      preference: PREFERENCE,
      presentation: IDLE_DYNAMIC_ISLAND_PRESENTATION,
      builtInDisplayGeometry: null,
      setPreference: (preference) =>
        Effect.sync(() => {
          saved.push(preference);
          return preference;
        }),
      publish: () => undefined,
      performAction: () => Effect.void,
      performHaptic: () => undefined,
      setInteractive: () => undefined,
      setInputRegion: (rendererId, rects) => {
        regions.push([rendererId, rects]);
      },
    },
    setXWayland: (enabled) =>
      Effect.sync(() => {
        xwayland.push(enabled);
      }),
    keepXWayland: () => Effect.void,
  });
  for (const [name, bind] of Object.entries(dynamicIsland)) bind(`dynamicIsland:${name}`);
  const call = (name: string, senderId: number, payload?: unknown) => {
    const listener = registrations.get(`dynamicIsland:${name}`);
    if (!listener) throw new Error(`No handler for ${name}.`);
    return listener(event(senderId), payload);
  };
  return { regions, xwayland, saved, call };
}

beforeEach(() => registrations.clear());

describe("dynamic island handlers", () => {
  it("takes the input region only from the island window, with whole px inside the limits", () => {
    const { regions, call } = register();
    const shape = [{ x: 200, y: 0, width: 214, height: 32 }];
    expect(() => call("setInputRegion", MAIN_ID, shape)).toThrow("outside the Dynamic Island renderer");
    expect(() => call("setInputRegion", OTHER_ID, shape)).toThrow("outside the Dynamic Island renderer");
    for (const rect of [
      { x: 0, y: 0, width: 0, height: 10 },
      { x: -1, y: 0, width: 10, height: 10 },
      { x: 0.5, y: 0, width: 10, height: 10 },
    ]) {
      expect(() => call("setInputRegion", ISLAND_ID, [rect])).toThrow("input region is invalid");
    }
    expect(() => call("setInputRegion", ISLAND_ID, { rects: shape })).toThrow("input region is invalid");
    call("setInputRegion", ISLAND_ID, shape);
    call("setInputRegion", ISLAND_ID, []);
    expect(regions).toEqual([
      [ISLAND_ID, shape],
      [ISLAND_ID, []],
    ]);
  });

  it("starts on XWayland only for the main renderer, with a boolean state", async () => {
    const { xwayland, call } = register();
    expect(() => call("setXWayland", ISLAND_ID, { enabled: true })).toThrow("outside the main renderer");
    expect(() => call("setXWayland", OTHER_ID, { enabled: true })).toThrow("outside the main renderer");
    expect(() => call("setXWayland", MAIN_ID, { enabled: "yes" })).toThrow("XWayland state is required");
    await call("setXWayland", MAIN_ID, { enabled: true });
    expect(xwayland).toEqual([true]);
  });

  it("rejects a renderer outside the app", () => {
    const { regions } = register();
    const listener = registrations.get("dynamicIsland:setInputRegion");
    expect(() => listener?.(event(ISLAND_ID, "https://evil.example/"), [])).toThrow("untrusted renderer");
    expect(regions).toEqual([]);
  });
});
