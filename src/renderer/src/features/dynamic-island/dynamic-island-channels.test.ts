import { DynamicIslandCoordinator } from "@openbot/team-client/dynamic-island-coordinator";
import {
  createDynamicIslandPresentation,
  type DynamicIslandChannelSource,
  type DynamicIslandPresentationInput,
  type DynamicIslandText,
} from "@openbot/team-client/dynamic-island-presentation";
import { describe, expect, it } from "vitest";

const text: DynamicIslandText = {
  taskWorking: "Working",
  questionHeader: "Question",
  questionText: "Answer",
  optionFallback: (number) => `Option ${number}`,
  takeoverTitle: "Take over",
  takeoverDetail: "Needs you",
  failureTitle: "Failed",
  failureDetail: "Failed",
  approvalCommand: "Run a command",
  approvalFileChange: "Change files",
  approvalPermissions: "Permissions",
  errorMessage: (_error, fallback) => fallback,
};

const agent = (id: string, name: string) => ({
  id,
  name,
  avatarSeed: id,
  avatarHue: null,
  avatarUrl: null,
  notifications: true,
});

function input(channels: DynamicIslandChannelSource[], overrides: Partial<DynamicIslandPresentationInput> = {}) {
  return {
    serverId: "local",
    agents: [agent("nyx", "Nyx"), agent("rig", "Rig")],
    activeTurns: {},
    queues: {},
    unreadReplies: {},
    liveMessages: {},
    pendingPrompts: {},
    pendingApprovals: {},
    failedTurns: {},
    channels,
    ...overrides,
  } satisfies DynamicIslandPresentationInput;
}

const pc = { id: "pc", name: "PC", icon: { name: "monitor", hue: 215 }, imageUrl: null };

describe("the Dynamic Island in channels", () => {
  it("shows who works in a channel, with the channel", () => {
    const presentation = createDynamicIslandPresentation(
      input([{ channel: pc, workingAgentIds: ["nyx"], task: "Fix the island", unreadCount: 0, unreadReply: null }]),
      text,
    );
    expect(presentation).toEqual({
      serverId: "local",
      mode: "working",
      working: [
        {
          agent: { id: "nyx", name: "Nyx", avatarSeed: "nyx", avatarHue: null, avatarUrl: null },
          channel: pc,
          task: "Fix the island",
          turnId: null,
        },
      ],
    });
  });

  it("lists a direct chat before a channel, and the generic text for a channel task it does not know", () => {
    const presentation = createDynamicIslandPresentation(
      input([{ channel: pc, workingAgentIds: ["rig"], task: null, unreadCount: 0, unreadReply: null }], {
        activeTurns: { nyx: "turn-1" },
      }),
      text,
    );
    expect(
      presentation.mode === "working"
        ? presentation.working.map((item) => [item.agent.name, item.channel?.name ?? null, item.task])
        : [],
    ).toEqual([
      ["Nyx", null, "Working"],
      ["Rig", "PC", "Working"],
    ]);
  });

  it("shows the newest unread reply, a channel's one included", () => {
    const presentation = createDynamicIslandPresentation(
      input(
        [
          {
            channel: pc,
            workingAgentIds: [],
            task: null,
            unreadCount: 2,
            unreadReply: {
              messageId: "channel:pc:2",
              agentId: "rig",
              text: "Done",
              createdAt: "2026-11-11T22:00:00.000Z",
            },
          },
        ],
        {
          unreadReplies: { nyx: 1 },
          liveMessages: {
            nyx: [{ id: "m1", author: "agent", body: "Older", time: "", createdAt: "2026-11-11T21:00:00.000Z" }],
          },
        },
      ),
      text,
    );
    expect(presentation).toMatchObject({
      mode: "message",
      unreadCount: 3,
      message: { text: "Done", channel: pc, agent: { name: "Rig" } },
    });
  });

  it("leaves out a channel whose worker it does not know", () => {
    const presentation = createDynamicIslandPresentation(
      input([{ channel: pc, workingAgentIds: ["gone"], task: null, unreadCount: 0, unreadReply: null }]),
      text,
    );
    expect(presentation.mode).toBe("idle");
  });
});

describe("the island coordinator with channels", () => {
  it("keeps the channel work when a runtime snapshot replaces the server", () => {
    const coordinator = new DynamicIslandCoordinator(() => text);
    coordinator.replaceServer(
      input([{ channel: pc, workingAgentIds: ["nyx"], task: "Fix the island", unreadCount: 0, unreadReply: null }]),
    );
    // A runtime snapshot carries the agents and their turns, and no channels.
    const { channels: _channels, ...snapshot } = input([]);
    coordinator.replaceServer(snapshot);
    expect(coordinator.presentation(["local"])).toMatchObject({
      mode: "working",
      working: [{ agent: { id: "nyx" }, channel: pc, task: "Fix the island" }],
    });
  });

  it("drops the channel work when the channel list says nothing runs", () => {
    const coordinator = new DynamicIslandCoordinator(() => text);
    coordinator.replaceServer(
      input([{ channel: pc, workingAgentIds: ["nyx"], task: "Fix the island", unreadCount: 0, unreadReply: null }]),
    );
    coordinator.replaceServer(input([]));
    expect(coordinator.presentation(["local"]).mode).not.toBe("working");
  });
});
