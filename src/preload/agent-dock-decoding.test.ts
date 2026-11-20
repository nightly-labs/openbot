// @vitest-environment node

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_DOCK_LIMITS,
  type AgentDockPresentation,
  type AgentDockPrompt,
  type AgentDockTakeover,
  type AgentDockUsageLimit,
} from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  decodeAgentDockAction,
  decodeAgentDockDisplays,
  decodeAgentDockOffset,
  decodeAgentDockPresentation,
} from "./agent-dock-decoding";

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

const CHANNEL = {
  id: "channel-1",
  name: "Launch",
  title: "Release work",
  members: ["agent-1"],
  icon: { name: "megaphone", hue: 210 },
  imageUrl: null,
};

const RESULT = { id: "message-1", agentId: "agent-1", kind: "message", label: "Done.", at: 1_762_500_000_000 } as const;

const APPROVAL = {
  requestId: 7,
  agentId: "agent-1",
  threadId: "thread-1",
  turnId: "turn-1",
  kind: "command",
  command: "git push",
  cwd: "/work",
  reason: null,
  grantRoot: null,
  permissions: null,
} as const;

const PROMPT: AgentDockPrompt = {
  requestId: "prompt-1",
  agentId: "agent-1",
  threadId: "thread-1",
  turnId: "turn-1",
  questions: [
    {
      id: "q1",
      header: "Branch",
      question: "Which branch?",
      isSecret: false,
      multiSelect: true,
      options: [{ label: "main", description: "The default branch." }],
    },
  ],
  attempt: 0,
};

const TAKEOVER: AgentDockTakeover = {
  request: {
    requestId: 9,
    agentId: "agent-1",
    threadId: "thread-1",
    turnId: "turn-1",
    tabId: "tab-1",
    secret: { method: "password", digits: 6, origin: "https://example.com" },
  },
  page: { title: "Example – Sign in", origin: "https://example.com" },
  agentName: "Chief",
  vault: { server: "Office", blocked: "role" },
  attempt: 0,
};

const USAGE_LIMIT: AgentDockUsageLimit = {
  agentId: "agent-1",
  provider: "codex",
  model: "GPT-5.5",
  agentName: null,
  resetsAt: 1_762_500_000,
  options: [
    {
      key: "claude:claude-sonnet",
      choice: { provider: "claude", model: "claude-sonnet" },
      model: "Sonnet",
      account: null,
      state: "ready",
    },
  ],
  rememberable: false,
  attempt: 0,
};

const PRESENTATION: AgentDockPresentation = {
  serverId: "local",
  display: { kind: "display", id: 69733382 },
  edge: "left",
  autoHide: true,
  edgeStrip: false,
  sizePercent: 85,
  offsets: [{ displayId: 69733382, offset: 0 }],
  seats: [
    { kind: "agent", agent: AGENT, mood: "working", state: { kind: "unread", count: 2 }, temporary: false },
    { kind: "channel", channel: CHANNEL, state: null, temporary: false },
  ],
  available: [],
  availableChannels: [CHANNEL],
  agents: [AGENT],
  chats: [
    {
      seat: { kind: "agent", id: "agent-1" },
      messages: [
        {
          id: "message-1",
          author: "agent",
          senderAgentId: null,
          senderMember: null,
          kind: "text",
          body: "Done.",
          attachments: [],
        },
      ],
      working: false,
      wait: null,
      approval: null,
      prompt: null,
      takeover: null,
      usageLimit: null,
    },
    {
      seat: { kind: "channel", id: "channel-1" },
      messages: [
        {
          id: "message-2",
          author: "agent",
          senderAgentId: "agent-1",
          senderMember: null,
          kind: "text",
          body: "Shipped.",
          attachments: [],
        },
        {
          id: "message-3",
          author: "you",
          senderAgentId: null,
          senderMember: { id: "member-1", name: "Grace" },
          kind: "text",
          body: "Thanks.",
          attachments: [],
        },
      ],
      working: true,
      wait: "approval",
      approval: { approval: APPROVAL, attempt: 1, cut: true },
      prompt: { ...PROMPT, attempt: 2 },
      takeover: TAKEOVER,
      usageLimit: null,
    },
  ],
  results: [RESULT],
};

describe("agent dock decoding", () => {
  it("accepts a presentation and null", () => {
    expect(decodeAgentDockPresentation(PRESENTATION)).toEqual(PRESENTATION);
    expect(decodeAgentDockPresentation(null)).toBeNull();
    const all: AgentDockPresentation = { ...PRESENTATION, display: { kind: "all" } };
    expect(decodeAgentDockPresentation(all)).toEqual(all);
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, display: { kind: "each" } })).toThrow(
      "Invalid agent dock presentation.",
    );
  });

  it("accepts a temporary seat and rejects a seat that does not say whether it is temporary", () => {
    const temporary: AgentDockPresentation = {
      ...PRESENTATION,
      seats: [{ kind: "agent", agent: AGENT, mood: "idle", state: { kind: "unread", count: 1 }, temporary: true }],
    };
    expect(decodeAgentDockPresentation(temporary)).toEqual(temporary);
    const unmarked = [{ kind: "agent", agent: AGENT, mood: "idle", state: null }];
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, seats: unmarked })).toThrow(
      "Invalid agent dock presentation.",
    );
  });

  it("rejects a presentation over its limits", () => {
    const seats = Array.from({ length: AGENT_DOCK_LIMITS.seats + 1 }, () => PRESENTATION.seats[0]);
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, seats })).toThrow("Invalid agent dock presentation.");
    const badCount = [
      {
        kind: "agent",
        agent: AGENT,
        mood: "idle",
        state: { kind: "unread", count: AGENT_DOCK_LIMITS.count + 1 },
        temporary: false,
      },
    ];
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, seats: badCount })).toThrow(
      "Invalid agent dock presentation.",
    );
    const longName = { ...AGENT, name: "a".repeat(INPUT_LIMITS.agentName + 1) };
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, agents: [longName] })).toThrow(
      "Invalid agent dock presentation.",
    );
    for (const channel of [
      { ...CHANNEL, name: "a".repeat(INPUT_LIMITS.agentName + 1) },
      { ...CHANNEL, members: [""] },
      { ...CHANNEL, icon: { name: "megaphone", hue: 360 } },
      { ...CHANNEL, imageUrl: "a".repeat(AGENT_DOCK_LIMITS.channelImageUrl + 1) },
    ]) {
      expect(() => decodeAgentDockPresentation({ ...PRESENTATION, availableChannels: [channel] })).toThrow(
        "Invalid agent dock presentation.",
      );
    }
    const channels = Array.from({ length: AGENT_DOCK_LIMITS.channels + 1 }, () => CHANNEL);
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, availableChannels: channels })).toThrow(
      "Invalid agent dock presentation.",
    );
  });

  it("rejects a chat approval that is not whole or has no cut mark, and a chat without the approval field", () => {
    const chat = PRESENTATION.chats[1];
    if (!chat) throw new Error("The presentation fixture has no channel chat.");
    for (const approval of [
      { approval: { ...APPROVAL, kind: "network" }, attempt: 0, cut: false },
      { approval: APPROVAL, attempt: -1, cut: false },
      { approval: APPROVAL, cut: false },
      { approval: APPROVAL, attempt: 0 },
      { approval: APPROVAL, attempt: 0, cut: "yes" },
    ]) {
      expect(() => decodeAgentDockPresentation({ ...PRESENTATION, chats: [{ ...chat, approval }] })).toThrow(
        "Invalid agent dock presentation.",
      );
    }
    const { approval: _missing, ...withoutApproval } = chat;
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, chats: [withoutApproval] })).toThrow(
      "Invalid agent dock presentation.",
    );
  });

  it("keeps a chat question, takeover and usage limit, and rejects one that is not whole", () => {
    const chat = PRESENTATION.chats[1];
    if (!chat) throw new Error("The presentation fixture has no channel chat.");
    const whole = { ...chat, usageLimit: USAGE_LIMIT };
    expect(decodeAgentDockPresentation({ ...PRESENTATION, chats: [whole] })?.chats[0]).toEqual(whole);
    const noPage = { ...chat, takeover: { ...TAKEOVER, page: null } };
    expect(decodeAgentDockPresentation({ ...PRESENTATION, chats: [noPage] })?.chats[0]).toEqual(noPage);
    const [option] = USAGE_LIMIT.options;
    for (const bad of [
      { ...chat, prompt: { ...PROMPT, questions: [] } },
      { ...chat, prompt: { ...PROMPT, threadId: "" } },
      { ...chat, prompt: { ...PROMPT, questions: [{ ...PROMPT.questions[0], isSecret: "no" }] } },
      { ...chat, takeover: { ...TAKEOVER, request: { ...TAKEOVER.request, tabId: "" } } },
      { ...chat, takeover: { ...TAKEOVER, request: { ...TAKEOVER.request, secret: { method: "password" } } } },
      { ...chat, takeover: { ...TAKEOVER, vault: { server: "Office", blocked: "owner" } } },
      { ...chat, takeover: { ...TAKEOVER, agentName: "x".repeat(INPUT_LIMITS.agentName + 1) } },
      { ...chat, takeover: { ...TAKEOVER, page: { title: "x".repeat(AGENT_DOCK_LIMITS.pageTitle + 1), origin: "" } } },
      { ...chat, takeover: { ...TAKEOVER, page: { title: "Example" } } },
      { ...chat, usageLimit: { ...USAGE_LIMIT, options: [] } },
      { ...chat, usageLimit: { ...USAGE_LIMIT, provider: "unknown" } },
      { ...chat, usageLimit: { ...USAGE_LIMIT, options: [{ ...option, key: "" }] } },
      { ...chat, usageLimit: { ...USAGE_LIMIT, options: [{ ...option, state: "busy" }] } },
      {
        ...chat,
        usageLimit: {
          ...USAGE_LIMIT,
          options: Array.from({ length: AGENT_DOCK_LIMITS.backupModels + 1 }, () => option),
        },
      },
    ]) {
      expect(() => decodeAgentDockPresentation({ ...PRESENTATION, chats: [bad] })).toThrow(
        "Invalid agent dock presentation.",
      );
    }
    for (const field of ["prompt", "takeover", "usageLimit"] as const) {
      const { [field]: _missing, ...without } = chat;
      expect(() => decodeAgentDockPresentation({ ...PRESENTATION, chats: [without] })).toThrow(
        "Invalid agent dock presentation.",
      );
    }
  });

  it("rejects a finished result that is too long, empty or of an unknown kind", () => {
    const results = Array.from({ length: AGENT_DOCK_LIMITS.results + 1 }, () => RESULT);
    expect(() => decodeAgentDockPresentation({ ...PRESENTATION, results })).toThrow("Invalid agent dock presentation.");
    for (const bad of [
      { ...RESULT, label: "a".repeat(AGENT_DOCK_LIMITS.resultLabel + 1) },
      { ...RESULT, label: "" },
      { ...RESULT, kind: "event" },
      { ...RESULT, at: -1 },
    ]) {
      expect(() => decodeAgentDockPresentation({ ...PRESENTATION, results: [bad] })).toThrow(
        "Invalid agent dock presentation.",
      );
    }
    const { results: _missing, ...withoutResults } = PRESENTATION;
    expect(() => decodeAgentDockPresentation(withoutResults)).toThrow("Invalid agent dock presentation.");
  });

  it("accepts a dock position and rejects one outside the display", () => {
    expect(decodeAgentDockOffset({ displayId: 1, offset: 1 })).toEqual({ displayId: 1, offset: 1 });
    expect(decodeAgentDockOffset({ displayId: 1, offset: 0 })).toEqual({ displayId: 1, offset: 0 });
    const bounds = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(decodeAgentDockOffset({ displayId: 1, offset: 0, bounds })).toEqual({ displayId: 1, offset: 0, bounds });
    for (const value of [
      { displayId: 1, offset: 0, bounds: { ...bounds, width: 0 } },
      { displayId: 1, offset: 0, bounds: { ...bounds, x: 0.5 } },
      { displayId: 1, offset: 0, bounds: { ...bounds, y: 100_001 } },
      { displayId: 1, offset: 0, bounds: { x: 0, y: 0, width: 1920 } },
      { displayId: 1, offset: 0, bounds: null },
      { displayId: 1, offset: -0.1 },
      { displayId: 1, offset: 1.1 },
      { displayId: 1, offset: Number.POSITIVE_INFINITY },
      { displayId: 1.5, offset: 0.5 },
      { displayId: 1 },
      null,
    ]) {
      expect(() => decodeAgentDockOffset(value)).toThrow("Invalid agent dock position.");
    }
  });

  it("accepts the display list and rejects a wrong or long one", () => {
    const display = { id: 1, label: "Built-in Retina Display", primary: true, internal: true };
    expect(decodeAgentDockDisplays([display])).toEqual([display]);
    expect(decodeAgentDockDisplays([])).toEqual([]);
    const many = Array.from({ length: AGENT_DOCK_LIMITS.displays + 1 }, () => display);
    expect(() => decodeAgentDockDisplays(many)).toThrow("Invalid agent dock display list.");
    expect(() => decodeAgentDockDisplays([{ ...display, id: 1.5 }])).toThrow("Invalid agent dock display list.");
    expect(() =>
      decodeAgentDockDisplays([{ ...display, label: "a".repeat(AGENT_DOCK_LIMITS.displayLabel + 1) }]),
    ).toThrow("Invalid agent dock display list.");
    expect(() => decodeAgentDockDisplays(null)).toThrow("Invalid agent dock display list.");
  });

  it("accepts the actions that main forwards and rejects others", () => {
    const action = { type: "open-chat", serverId: "local", seat: null };
    expect(decodeAgentDockAction(action)).toEqual(action);
    const channelChat = { type: "open-chat", serverId: "local", seat: { kind: "channel", id: "channel-1" } };
    expect(decodeAgentDockAction(channelChat)).toEqual(channelChat);
    const openChannel = { type: "open-channel", serverId: "local", channelId: "channel-1" };
    expect(decodeAgentDockAction(openChannel)).toEqual(openChannel);
    expect(decodeAgentDockAction({ type: "open-link", url: "https://example.com" })).toEqual({
      type: "open-link",
      url: "https://example.com",
    });
    expect(decodeAgentDockAction({ type: "open-settings" })).toEqual({ type: "open-settings" });
    expect(decodeAgentDockAction({ type: "hide" })).toEqual({ type: "hide" });
    const move = {
      type: "move",
      serverId: "local",
      seat: { kind: "agent", id: "agent-1" },
      before: { kind: "channel", id: "channel-1" },
    };
    expect(decodeAgentDockAction(move)).toEqual(move);
    const moveToEnd = { type: "move", serverId: "local", seat: { kind: "agent", id: "agent-1" }, before: null };
    expect(decodeAgentDockAction(moveToEnd)).toEqual(moveToEnd);
    expect(() =>
      decodeAgentDockAction({ type: "move", serverId: "local", seat: { kind: "agent", id: "agent-1" } }),
    ).toThrow("Invalid agent dock action.");
    expect(() =>
      decodeAgentDockAction({
        type: "move",
        serverId: "local",
        seat: { kind: "agent", id: "agent-1" },
        before: { kind: "group", id: "group-1" },
      }),
    ).toThrow("Invalid agent dock action.");
    expect(decodeAgentDockAction({ type: "open-window", serverId: "local", agentId: "agent-1" })).toEqual({
      type: "open-window",
      serverId: "local",
      agentId: "agent-1",
    });
    expect(() => decodeAgentDockAction({ type: "open-window", serverId: "local", agentId: "" })).toThrow(
      "Invalid agent dock action.",
    );
    expect(() => decodeAgentDockAction({ type: "open-link", url: "" })).toThrow("Invalid agent dock action.");
    expect(() => decodeAgentDockAction({ type: "add", serverId: "", seat: { kind: "agent", id: "agent-1" } })).toThrow(
      "Invalid agent dock action.",
    );
    expect(() => decodeAgentDockAction({ type: "add", serverId: "local", agentId: "agent-1" })).toThrow(
      "Invalid agent dock action.",
    );
    expect(() =>
      decodeAgentDockAction({ type: "remove", serverId: "local", seat: { kind: "group", id: "group-1" } }),
    ).toThrow("Invalid agent dock action.");
    expect(() => decodeAgentDockAction({ type: "open-channel", serverId: "local", channelId: "" })).toThrow(
      "Invalid agent dock action.",
    );
    const respond = {
      type: "respond-approval",
      serverId: "local",
      agentId: "agent-1",
      requestId: "request-1",
      decision: "accept",
    };
    expect(decodeAgentDockAction(respond)).toEqual(respond);
    expect(decodeAgentDockAction({ ...respond, requestId: 7, decision: "decline" })).toEqual({
      ...respond,
      requestId: 7,
      decision: "decline",
    });
    for (const bad of [
      { ...respond, decision: "always" },
      { ...respond, agentId: "" },
      { ...respond, requestId: null },
    ]) {
      expect(() => decodeAgentDockAction(bad)).toThrow("Invalid agent dock action.");
    }
    const answer = {
      type: "answer-prompt",
      serverId: "local",
      agentId: "agent-1",
      threadId: "thread-1",
      requestId: "prompt-1",
      answers: { q1: ["main"] },
    };
    const takeover = {
      type: "respond-takeover",
      serverId: "remote-1",
      agentId: "agent-1",
      threadId: null,
      requestId: 9,
      decision: "complete",
    };
    const send = {
      type: "usage-limit-send",
      serverId: "local",
      agentId: "agent-1",
      optionKey: "claude:x",
      remember: true,
    };
    const wait = { type: "usage-limit-wait", serverId: "local", agentId: "agent-1" };
    for (const good of [answer, { ...answer, answers: {} }, takeover, send, wait]) {
      expect(decodeAgentDockAction(good)).toEqual(good);
    }
    for (const bad of [
      { ...answer, answers: { q1: "main" } },
      { ...answer, answers: { q1: ["x".repeat(INPUT_LIMITS.promptAnswerText + 1)] } },
      { ...answer, threadId: "" },
      { ...takeover, decision: "accept" },
      { ...send, optionKey: "" },
      { ...send, remember: "yes" },
      { ...wait, agentId: "" },
    ]) {
      expect(() => decodeAgentDockAction(bad)).toThrow("Invalid agent dock action.");
    }
    expect(() => decodeAgentDockAction({ type: "run", serverId: "local" })).toThrow("Invalid agent dock action.");
  });
});
