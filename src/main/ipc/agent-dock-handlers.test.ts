// @vitest-environment node

import type {
  AgentDockAction,
  AgentDockDragPhase,
  AgentDockInputRect,
  AgentDockPresentation,
  SetAgentDockInteractiveInput,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentDockIpcHandlers } from "./agent-dock-handlers";

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
const DOCK_ID = 2;
const OTHER_ID = 3;

const AGENT = {
  id: "agent-1",
  name: "Ada",
  title: "Researcher",
  description: "",
  avatarSeed: "agent-1",
  avatarHue: null,
  avatarColor: null,
  avatarUrl: null,
};

const PRESENTATION: AgentDockPresentation = {
  serverId: "local",
  display: { kind: "window" },
  edge: "right",
  autoHide: false,
  edgeStrip: true,
  sizePercent: 120,
  offsets: [{ displayId: 1, offset: 0.25 }],
  seats: [
    { kind: "agent", agent: AGENT, mood: "working", state: { kind: "working" } },
    {
      kind: "channel",
      channel: { id: "channel-1", name: "Launch", title: "", members: ["agent-1"], icon: null, imageUrl: null },
      state: { kind: "unread", count: 1 },
    },
  ],
  available: [],
  availableChannels: [],
  agents: [AGENT],
  chats: [
    {
      seat: { kind: "agent", id: "agent-1" },
      messages: [
        {
          id: "m1",
          author: "agent",
          senderAgentId: null,
          senderMember: null,
          kind: "text",
          body: "Hello",
          attachments: [],
        },
      ],
      working: true,
      wait: null,
    },
  ],
  results: [],
};

const DISPLAYS = [{ id: 1, label: "Built-in Retina Display", primary: true, internal: true }];

const SEND: AgentDockAction = {
  type: "send",
  serverId: "local",
  seat: { kind: "agent", id: "agent-1" },
  text: "Hello",
  clientMessageId: "draft-1",
};

function event(senderId: number, url = "openbot-app://app/helper.html?surface=agent-dock") {
  return { senderFrame: { url }, sender: { id: senderId } };
}

function register() {
  const published: Array<AgentDockPresentation | null> = [];
  const actions: Array<[number, AgentDockAction]> = [];
  const interactive: Array<[number, SetAgentDockInteractiveInput]> = [];
  const drags: Array<[number, AgentDockDragPhase]> = [];
  const regions: Array<[number, AgentDockInputRect[]]> = [];
  const xwayland: boolean[] = [];
  const { agentDock } = agentDockIpcHandlers({
    agentDock: {
      mainRendererIds: new Set([MAIN_ID]),
      dockRendererIds: new Set([DOCK_ID]),
      presentation: PRESENTATION,
      publish: (presentation) =>
        Effect.sync(() => {
          published.push(presentation);
        }),
      performAction: (rendererId, action) =>
        Effect.sync(() => {
          actions.push([rendererId, action]);
        }),
      setInteractive: (rendererId, input) => {
        interactive.push([rendererId, input]);
      },
      setInputRegion: (rendererId, rects) => {
        regions.push([rendererId, rects]);
      },
      listDisplays: () => DISPLAYS,
      drag: (rendererId, phase) => {
        drags.push([rendererId, phase]);
      },
    },
    setXWayland: (enabled) =>
      Effect.sync(() => {
        xwayland.push(enabled);
      }),
  });
  for (const [name, bind] of Object.entries(agentDock)) bind(`agentDock:${name}`);
  const call = (name: string, senderId: number, payload?: unknown) => {
    const listener = registrations.get(`agentDock:${name}`);
    if (!listener) throw new Error(`No handler for ${name}.`);
    return listener(event(senderId), payload);
  };
  return { published, actions, interactive, drags, regions, xwayland, call };
}

beforeEach(() => registrations.clear());

describe("agent dock handlers", () => {
  it("takes the presentation only from the main renderer", async () => {
    const { published, call } = register();
    expect(() => call("publishPresentation", DOCK_ID, PRESENTATION)).toThrow("outside the main renderer");
    expect(() => call("publishPresentation", OTHER_ID, PRESENTATION)).toThrow("outside the main renderer");
    await call("publishPresentation", MAIN_ID, PRESENTATION);
    await call("publishPresentation", MAIN_ID, null);
    expect(published).toEqual([PRESENTATION, null]);
  });

  it("lists the displays only to the main renderer", () => {
    const { call } = register();
    expect(() => call("listDisplays", DOCK_ID)).toThrow("outside the main renderer");
    expect(() => call("listDisplays", OTHER_ID)).toThrow("outside the main renderer");
    expect(call("listDisplays", MAIN_ID)).toEqual(DISPLAYS);
  });

  it("refuses a display that is not a choice", () => {
    const { published, call } = register();
    for (const display of [undefined, { kind: "display" }, { kind: "display", id: -1 }, { kind: "left" }]) {
      expect(() => call("publishPresentation", MAIN_ID, { ...PRESENTATION, display })).toThrow(
        "presentation is invalid",
      );
    }
    expect(published).toEqual([]);
  });

  it("refuses an edge, a hide setting or a position that is not valid", () => {
    const { published, call } = register();
    const wrong = [
      { edge: "top" },
      { autoHide: "yes" },
      { edgeStrip: "yes" },
      { sizePercent: 141 },
      { sizePercent: 69 },
      { sizePercent: 100.5 },
      { sizePercent: undefined },
      { offsets: [{ displayId: 1, offset: 1.5 }] },
      { offsets: [{ displayId: 1, offset: Number.NaN }] },
      { offsets: [{ displayId: -1, offset: 0.5 }] },
      { offsets: Array.from({ length: 17 }, (_, displayId) => ({ displayId, offset: 0.5 })) },
    ];
    for (const patch of wrong) {
      expect(() => call("publishPresentation", MAIN_ID, { ...PRESENTATION, ...patch })).toThrow(
        "presentation is invalid",
      );
    }
    expect(published).toEqual([]);
  });

  it("takes a drag only from the dock window, with a known phase", () => {
    const { drags, call } = register();
    expect(() => call("drag", MAIN_ID, "start")).toThrow("outside the agent dock window");
    expect(() => call("drag", OTHER_ID, "move")).toThrow("outside the agent dock window");
    expect(() => call("drag", DOCK_ID, { phase: "start" })).toThrow("drag phase is invalid");
    expect(() => call("drag", DOCK_ID, "jump")).toThrow("drag phase is invalid");
    call("drag", DOCK_ID, "start");
    call("drag", DOCK_ID, "move");
    call("drag", DOCK_ID, "end");
    expect(drags).toEqual([
      [DOCK_ID, "start"],
      [DOCK_ID, "move"],
      [DOCK_ID, "end"],
    ]);
  });

  it("takes the input region only from the dock window, with whole px inside the limits", () => {
    const { regions, call } = register();
    const shape = [{ x: 0, y: 40, width: 120, height: 400 }];
    expect(() => call("setInputRegion", MAIN_ID, shape)).toThrow("outside the agent dock window");
    expect(() => call("setInputRegion", OTHER_ID, shape)).toThrow("outside the agent dock window");
    const wrong = [
      { x: 0, y: 0, width: 0, height: 10 },
      { x: -1, y: 0, width: 10, height: 10 },
      { x: 0.5, y: 0, width: 10, height: 10 },
      { x: 0, y: 0, width: 10 },
    ];
    for (const rect of wrong) expect(() => call("setInputRegion", DOCK_ID, [rect])).toThrow("input region is invalid");
    expect(() =>
      call(
        "setInputRegion",
        DOCK_ID,
        Array.from({ length: 9 }, () => shape[0]),
      ),
    ).toThrow("input region is invalid");
    call("setInputRegion", DOCK_ID, shape);
    call("setInputRegion", DOCK_ID, []);
    expect(regions).toEqual([
      [DOCK_ID, shape],
      [DOCK_ID, []],
    ]);
  });

  it("starts on XWayland only for the main renderer, with a boolean state", async () => {
    const { xwayland, call } = register();
    expect(() => call("setXWayland", DOCK_ID, { enabled: true })).toThrow("outside the main renderer");
    expect(() => call("setXWayland", OTHER_ID, { enabled: true })).toThrow("outside the main renderer");
    expect(() => call("setXWayland", MAIN_ID, { enabled: "yes" })).toThrow("XWayland state is required");
    expect(() => call("setXWayland", MAIN_ID, true)).toThrow("XWayland state is required");
    await call("setXWayland", MAIN_ID, { enabled: true });
    await call("setXWayland", MAIN_ID, { enabled: false });
    expect(xwayland).toEqual([true, false]);
  });

  it("checks the sender before it decodes the payload", () => {
    const { published, actions, interactive, call } = register();
    expect(() => call("publishPresentation", DOCK_ID, { seats: "nope" })).toThrow("outside the main renderer");
    expect(() => call("performAction", MAIN_ID, { type: "unknown" })).toThrow("outside the agent dock window");
    expect(() => call("setInteractive", MAIN_ID, { interactive: "yes" })).toThrow("outside the agent dock window");
    expect(() => call("publishPresentation", MAIN_ID, { seats: "nope" })).toThrow("presentation is invalid");
    expect(() => call("performAction", DOCK_ID, { type: "unknown" })).toThrow("action is invalid");
    expect(() => call("setInteractive", DOCK_ID, { interactive: "yes" })).toThrow("interaction state is required");
    expect([published, actions, interactive]).toEqual([[], [], []]);
  });

  it("gives the presentation and takes the actions only from the dock window", async () => {
    const { actions, interactive, call } = register();
    expect(() => call("getPresentation", MAIN_ID)).toThrow("outside the agent dock window");
    expect(call("getPresentation", DOCK_ID)).toEqual(PRESENTATION);
    const channelSend: AgentDockAction = { ...SEND, seat: { kind: "channel", id: "channel-1" } };
    await call("performAction", DOCK_ID, SEND);
    await call("performAction", DOCK_ID, channelSend);
    await call("performAction", DOCK_ID, { type: "open-settings" });
    call("setInteractive", DOCK_ID, { interactive: true, keyboard: true });
    expect(actions).toEqual([
      [DOCK_ID, SEND],
      [DOCK_ID, channelSend],
      [DOCK_ID, { type: "open-settings" }],
    ]);
    expect(interactive).toEqual([[DOCK_ID, { interactive: true, keyboard: true }]]);
  });

  it("refuses an empty message, a link that is too long and too many seats", () => {
    const { published, actions, call } = register();
    expect(() => call("performAction", DOCK_ID, { ...SEND, text: "   " })).toThrow("action is invalid");
    expect(() => call("performAction", DOCK_ID, { ...SEND, seat: { kind: "group", id: "agent-1" } })).toThrow(
      "action is invalid",
    );
    expect(() => call("performAction", DOCK_ID, { type: "open-link", url: "x".repeat(8193) })).toThrow(
      "action is invalid",
    );
    const seats = Array.from({ length: 25 }, () => PRESENTATION.seats[0]);
    expect(() => call("publishPresentation", MAIN_ID, { ...PRESENTATION, seats })).toThrow("presentation is invalid");
    expect([published, actions]).toEqual([[], []]);
  });

  it("rejects a renderer outside the app", () => {
    const { published } = register();
    const listener = registrations.get("agentDock:publishPresentation");
    expect(() => listener?.(event(MAIN_ID, "https://evil.example/"), PRESENTATION)).toThrow("untrusted renderer");
    expect(published).toEqual([]);
  });
});
