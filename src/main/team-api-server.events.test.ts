import { isAgentSummary } from "@openbot/contracts/ipc";
import {
  decodeTeamProtocolV1CurrentHttpResponse,
  encodeTeamProtocolV1CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v1-adapter";
import {
  decodeTeamProtocolV3CurrentHttpResponse,
  encodeTeamProtocolV3CurrentHttpResponse,
} from "@openbot/contracts/team-protocol/v3-adapter";
import { Effect } from "effect";
import opencodeFixture from "../../packages/contracts/src/team-protocol/fixtures/v4/host-http-response.json";
import { legacyProviderView } from "./team-api/provider-visibility";
// @vitest-environment node

// The WebSocket side: who receives which realtime event, and what a client on an older protocol
// is sent. This is the half of the server the route modules do not own.

import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import {
  AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT,
  hostedSiteConversationEventItemType,
  hostedSiteConversationEventText,
  routineConversationEventItemType,
  routineRunConversationEventItemType,
} from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarLayoutStore } from "../backend/sidebar-layout-store";
import {
  createAgents,
  createTeamApiFixture,
  jsonRequest,
  nextJsonEvent,
  nextJsonEvents,
  stopTeamApiFixtures,
  type TeamApiAgents,
} from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

describe("TeamApiServer events", () => {
  it("filters OpenCode for old peers and Gemini for every peer without changing the host", async () => {
    const source = opencodeFixture[0];
    if (!isAgentSummary(source)) throw new Error("Invalid OpenCode fixture.");
    // Gemini stays on the host: no protocol, v4 included, gets its agent.
    const gemini: AgentSummary = { ...source, id: "agent-gemini", provider: "antigravity", model: "gemini-3-pro" };
    const events = new EventEmitter();
    const snapshot = { ...createAgents().getRuntimeSnapshot(), agents: [source, gemini] };
    const { store, start } = await createTeamApiFixture("provider-events", { configure: true });
    const { port } = await start({
      agents: createAgents({ listAgents: () => [source, gemini], getRuntimeSnapshot: () => snapshot }, events),
    });
    const login = await Effect.runPromise(store.login("owner", "correct horse battery"));
    for (const supportsOpencode of [false, true]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
        "openbot-team-v1",
        `openbot-token.${login.sessionToken}`,
      ]);
      const presence = nextJsonEvent(socket);
      await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
      await presence;
      const initial = nextJsonEvent(socket);
      socket.send(
        JSON.stringify({
          type: "agent-event-scope",
          includeConversations: true,
          capabilities: ["agent-runtime-snapshots", ...(supportsOpencode ? ["opencode"] : [])],
        }),
      );
      await expect(initial).resolves.toMatchObject({
        type: "runtime-snapshot",
        snapshot: { bots: supportsOpencode ? [expect.objectContaining({ id: source.id, name: source.name })] : [] },
      });
      const changed = new Promise<unknown>((resolve) =>
        socket.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), { once: true }),
      );
      events.emit("event", { type: "agents-changed", agents: [source, gemini] });
      await expect(changed).resolves.toMatchObject({ type: "bots-changed", bots: supportsOpencode ? [source] : [] });
      const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
      socket.close();
      await closed;
    }
    expect(snapshot.agents).toEqual([source, gemini]);
  });

  it("sends a Cursor agent only to a protocol 6 event client", async () => {
    const source = opencodeFixture[0];
    if (!isAgentSummary(source)) throw new Error("Invalid OpenCode fixture.");
    const cursor: AgentSummary = {
      ...source,
      id: "agent-cursor",
      provider: "cursor",
      model: "gpt-5.6-sol[context=272k,reasoning=medium,fast=false]",
    };
    const events = new EventEmitter();
    const { store, start } = await createTeamApiFixture("cursor-events", { configure: true });
    const snapshot = { ...createAgents().getRuntimeSnapshot(), agents: [source, cursor] };
    const { port } = await start({
      agents: createAgents({ listAgents: () => [source, cursor], getRuntimeSnapshot: () => snapshot }, events),
    });
    const login = await Effect.runPromise(store.login("owner", "correct horse battery"));
    for (const capabilities of [
      ["agent-runtime-snapshots", "opencode", "local-providers"],
      ["agent-runtime-snapshots", "opencode", "local-providers", "local-providers-v2"],
    ]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
        "openbot-team-v1",
        `openbot-token.${login.sessionToken}`,
      ]);
      const presence = nextJsonEvent(socket);
      await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
      await presence;
      const initial = nextJsonEvent(socket);
      socket.send(JSON.stringify({ type: "agent-event-scope", includeConversations: true, capabilities }));
      const expected = capabilities.includes("local-providers-v2") ? [source, cursor] : [source];
      await expect(initial).resolves.toMatchObject({
        type: "runtime-snapshot",
        snapshot: { bots: expected.map((agent) => expect.objectContaining({ id: agent.id })) },
      });
      const changed = new Promise<unknown>((resolve) =>
        socket.addEventListener("message", (event) => resolve(JSON.parse(String(event.data))), { once: true }),
      );
      events.emit("event", { type: "agents-changed", agents: [source, cursor] });
      await expect(changed).resolves.toMatchObject({ type: "bots-changed", bots: expected });
      const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
      socket.close();
      await closed;
    }
  });

  it.each([
    { capabilities: ["quiet-turn-v1", "local-providers-v2", "agent-runtime-snapshots"], quiet: true },
    { capabilities: ["local-providers-v2", "agent-runtime-snapshots"], quiet: false },
    { capabilities: ["agent-runtime-snapshots"], quiet: false },
  ])("keeps completion delivery for event capabilities $capabilities", async ({ capabilities, quiet }) => {
    const events = new EventEmitter();
    const { store, start } = await createTeamApiFixture("quiet-turn-events", { configure: true });
    const { port } = await start({ agents: createAgents({}, events) });
    const login = await Effect.runPromise(store.login("owner", "correct horse battery"));
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
      "openbot-team-v1",
      `openbot-token.${login.sessionToken}`,
    ]);
    const presence = nextJsonEvent(socket);
    await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
    await presence;
    const initial = nextJsonEvent(socket);
    socket.send(JSON.stringify({ type: "agent-event-scope", includeConversations: true, capabilities }));
    await initial;
    const completion = {
      type: "turn-completed" as const,
      agentId: "agent-1",
      threadId: "thread-1",
      turnId: "turn-1".repeat(30),
      status: "completed",
      origin: "routine" as const,
    };
    // The shared event helper projects only fields used by older tests. Check the complete wire value here.
    const nextCompletion = () =>
      new Promise<unknown>((resolve, reject) => {
        socket.addEventListener("message", (message) => resolve(JSON.parse(String(message.data))), { once: true });
        socket.addEventListener("error", () => reject(new Error("WebSocket event failed.")), { once: true });
      });
    const quietReceived = nextCompletion();
    events.emit("event", { ...completion, quiet: true });
    const { agentId, ...wire } = completion;
    await expect(quietReceived).resolves.toEqual(
      quiet ? { ...completion, type: "quiet-turn-completed" } : { ...wire, botId: agentId },
    );
    const normalReceived = nextCompletion();
    events.emit("event", completion);
    await expect(normalReceived).resolves.toEqual({ ...wire, botId: agentId });
    const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
    socket.close();
    await closed;
  });

  it("sends a skills change only to clients that negotiated skills-events-v1", async () => {
    const events = new EventEmitter();
    const { store, start } = await createTeamApiFixture("skills-events", { configure: true });
    const { port } = await start({ agents: createAgents({}, events) });
    const login = await Effect.runPromise(store.login("owner", "correct horse battery"));
    const received = new Map<boolean, unknown[]>();
    const sockets: WebSocket[] = [];
    for (const supportsSkillsEvents of [true, false]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
        "openbot-team-v1",
        `openbot-token.${login.sessionToken}`,
      ]);
      const presence = nextJsonEvent(socket);
      await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
      await presence;
      socket.send(
        JSON.stringify({
          type: "agent-event-scope",
          includeConversations: true,
          capabilities: supportsSkillsEvents ? ["skills-events-v1"] : [],
        }),
      );
      const messages: unknown[] = [];
      received.set(supportsSkillsEvents, messages);
      // Presence follows the members that join, so the second socket reaches the first.
      socket.addEventListener("message", (event) => {
        const text = String(event.data);
        if (!text.includes('"team-presence"')) messages.push(JSON.parse(text));
      });
      sockets.push(socket);
    }
    // The scope message has no reply, so a known event on both sockets proves both scopes applied.
    events.emit("event", { type: "routines-changed", agentId: "agent-1" });
    await vi.waitFor(() => expect([...received.values()].every((messages) => messages.length === 1)).toBe(true));
    events.emit("event", { type: "skills-changed", agentId: "agent-1" });
    events.emit("event", { type: "routines-changed", agentId: "agent-1" });
    await vi.waitFor(() => expect(received.get(false)).toHaveLength(2));
    await vi.waitFor(() => expect(received.get(true)).toHaveLength(3));
    expect(received.get(true)?.[1]).toEqual({ type: "skills-changed", agentId: "agent-1" });
    // A released client never sees the event: its protocol has no word for it.
    expect(received.get(false)?.some((message) => JSON.stringify(message).includes("skills-changed"))).toBe(false);
    for (const socket of sockets) socket.close();
  });

  it("shares sidebar layout mutations with owner, admin, and member clients", async () => {
    const { root, store, start } = await createTeamApiFixture("sidebar-layout", { configure: true });
    const adminInvite = await Effect.runPromise(store.createInvite("admin"));
    const memberInvite = await Effect.runPromise(store.createInvite("member"));
    const admin = await Effect.runPromise(
      store.acceptInviteWithAccount(adminInvite.token, {
        id: "admin-account",
        email: "admin@example.com",
        name: "Admin",
        avatarUrl: null,
      }),
    );
    const member = await Effect.runPromise(
      store.acceptInviteWithAccount(memberInvite.token, {
        id: "member-account",
        email: "member@example.com",
        name: "Member",
        avatarUrl: null,
      }),
    );
    const sidebarLayout = new SidebarLayoutStore(join(root, "sidebar-layout.json"));
    await Effect.runPromise(sidebarLayout.initialize());
    const getRuntimeSnapshot = vi.fn<TeamApiAgents["getRuntimeSnapshot"]>(() => ({
      agents: [],
      activeTurns: [],
      work: [],
      latestMessages: [],
      attentionComplete: true,
      pendingPrompts: [],
      pendingApprovals: [],
      pendingBrowserTakeovers: [],
      failedTurns: [],
    }));
    const agentEvents = new EventEmitter();
    const agents = createAgents({
      on: (event, listener) => agentEvents.on(event, listener),
      off: (event, listener) => agentEvents.off(event, listener),
      getRuntimeSnapshot,
      listAgents: () => [
        {
          id: "chief",
          provider: "codex",
          name: "Chief",
          title: "Lead",
          description: "",
          notifications: true,
          model: "gpt-5.6-luna",
          reasoningEffort: "medium",
          threadId: "thread-chief",
          workspacePath: root,
          preview: "",
          updatedAt: null,
          avatarSeed: "chief",
          avatarHue: null,
          avatarUrl: null,
        } satisfies AgentSummary,
      ],
      sidebarChatIds: () => new Set(["chief"]),
    });
    let now = 0;
    const { base, port } = await start({
      agents,
      sidebarLayout,
      now: () => now,
    });

    const owner = await Effect.runPromise(store.login("owner", "correct horse battery"));
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
      "openbot-events-v2",
      `openbot-token.${member.sessionToken}`,
    ]);
    const initialEvents = nextJsonEvents(socket, 2);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("WebSocket did not open.")), { once: true });
    });
    const [initialSnapshot, initialPresence] = await initialEvents;
    expect(initialSnapshot).toMatchObject({
      type: "runtime-snapshot",
      snapshot: { bots: [], activeTurns: [], pendingApprovals: [] },
    });
    expect(initialPresence).toMatchObject({ type: "team-presence" });

    const conversation = {
      type: "conversation",
      snapshot: {
        agentId: "chief",
        threadId: "thread-chief",
        activeTurnId: null,
        revision: 1,
        messages: [
          {
            id: "reply-1",
            author: "assistant",
            text: "Done",
            createdAt: "2026-08-29T10:00:00.000Z",
            status: "completed",
          },
        ],
      },
    };
    getRuntimeSnapshot.mockReturnValueOnce({
      ...createAgents().getRuntimeSnapshot(),
      latestMessages: [{ agentId: "chief", id: "reply-1", text: "Done", createdAt: "2026-08-29T10:00:00.000Z" }],
    });
    const boundedEvents = nextJsonEvents(socket, 2);
    agentEvents.emit("event", conversation);
    agentEvents.emit("event", {
      type: "turn-completed",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
      status: "completed",
    });
    await expect(boundedEvents).resolves.toEqual([
      expect.objectContaining({ type: "turn-completed" }),
      expect.objectContaining({
        type: "runtime-snapshot",
        snapshot: expect.objectContaining({ latestMessages: [expect.objectContaining({ id: "reply-1" })] }),
      }),
    ]);

    socket.send(JSON.stringify({ type: "agent-event-scope", includeConversations: true }));
    // Nothing answers the scope message, so the emit below has to be ordered behind it some other
    // way, and a sleep is not that: the client and the server share this event loop, and one
    // macrotask is only usually long enough for the frame to be read. When it is not - a loaded CI
    // runner is enough - the scope is still off when the conversation event is emitted, the event is
    // dropped as out of scope, and the wait below never ends. Typing is answered, and one connection
    // is read in order, so a presence event proves every message sent before it was applied.
    const scopeApplied = nextJsonEvents(socket, 2);
    socket.send(JSON.stringify({ type: "team-typing", botId: "chief", typing: true }));
    socket.send(JSON.stringify({ type: "team-typing", botId: null, typing: false }));
    await scopeApplied;

    const conversationEvent = nextJsonEvent(socket);
    agentEvents.emit("event", conversation);
    await expect(conversationEvent).resolves.toEqual({
      type: "conversation-invalidated",
      botId: "chief",
      revision: 1,
    });
    const queueEvent = nextJsonEvent(socket);
    agentEvents.emit("event", { type: "queue-changed", snapshot: { agentId: "chief", deliveries: [] } });
    await expect(queueEvent).resolves.toEqual({ type: "queue-invalidated", botId: "chief" });

    const eventAfterUnsupportedActivity = nextJsonEvent(socket);
    agentEvents.emit("event", {
      type: "turn-progress",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
      detail: "Searching for current information…",
    });
    agentEvents.emit("event", { type: "agents-changed", agents: [] });
    await expect(eventAfterUnsupportedActivity).resolves.toMatchObject({ type: "bots-changed" });

    const eventsAfterOversizedConversation = nextJsonEvents(socket, 2);
    agentEvents.emit("event", {
      ...conversation,
      snapshot: {
        ...conversation.snapshot,
        messages: [{ ...conversation.snapshot.messages[0], text: "x".repeat(1024 * 1024) }],
      },
    });
    agentEvents.emit("event", { type: "agents-changed", agents: [] });
    await expect(eventsAfterOversizedConversation).resolves.toEqual([
      expect.objectContaining({ type: "conversation-invalidated" }),
      expect.objectContaining({ type: "bots-changed" }),
    ]);

    const refreshedSnapshot = nextJsonEvent(socket);
    socket.send(JSON.stringify({ type: "runtime-snapshot-request" }));
    await expect(refreshedSnapshot).resolves.toMatchObject({ type: "runtime-snapshot" });
    for (let index = 0; index < 20; index += 1) {
      socket.send(JSON.stringify({ type: "runtime-snapshot-request" }));
    }
    await vi.waitFor(() => expect(getRuntimeSnapshot).toHaveBeenCalledTimes(3));

    for (const [index, token] of [owner.sessionToken, admin.sessionToken, member.sessionToken].entries()) {
      const event = nextJsonEvent(socket);
      const layout = await jsonRequest<{ sections: Array<{ name: string }>; revision: number }>(
        base,
        "/v1/sidebar-layout/actions",
        { token, body: { type: "create", name: `Shared ${index + 1}` } },
      );
      expect(layout.sections.at(-1)?.name).toBe(`Shared ${index + 1}`);
      await expect(event).resolves.toMatchObject({
        type: "sidebar-layout-changed",
        layout: { revision: index + 1 },
      });
    }
    // Three request/response round-trips have passed through the same socket
    // since the burst, so the coalescer provably never woke for the other 19.
    expect(getRuntimeSnapshot).toHaveBeenCalledTimes(3);

    await expect(jsonRequest(base, "/v1/sidebar-layout", { token: member.sessionToken })).resolves.toMatchObject({
      revision: 3,
      sections: [{ name: "Shared 1" }, { name: "Shared 2" }, { name: "Shared 3" }],
    });
    const firstSocketClosed = new Promise<CloseEvent>((resolve) =>
      socket.addEventListener("close", resolve, { once: true }),
    );
    socket.close();
    await firstSocketClosed;
    const oversizedSocket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
      "openbot-events-v2",
      `openbot-token.${member.sessionToken}`,
    ]);
    const oversizedInitialEvents = nextJsonEvents(oversizedSocket, 2);
    await new Promise<void>((resolve, reject) => {
      oversizedSocket.addEventListener("open", () => resolve(), { once: true });
      oversizedSocket.addEventListener("error", () => reject(new Error("WebSocket did not open.")), { once: true });
    });
    await oversizedInitialEvents;
    const closed = new Promise<CloseEvent>((resolve) =>
      oversizedSocket.addEventListener("close", resolve, { once: true }),
    );
    now = 1_000;
    getRuntimeSnapshot.mockImplementation(() => ({
      agents: [],
      activeTurns: [],
      work: [],
      latestMessages: [
        {
          agentId: "chief",
          id: "oversized",
          text: "x".repeat(AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT),
          createdAt: "2026-08-29T10:00:00.000Z",
        },
      ],
      attentionComplete: true,
      pendingPrompts: [],
      pendingApprovals: [],
      pendingBrowserTakeovers: [],
      failedTurns: [],
    }));
    oversizedSocket.send(JSON.stringify({ type: "runtime-snapshot-request" }));
    expect((await closed).code).toBe(1011);
  }, 30_000);

  it("serves a turn to every client when one of them cannot take the post-turn snapshot", async () => {
    const agentEvents = new EventEmitter();
    // These agents are OpenCode peers: a protocol 1 client cannot see one, a protocol 5 client sees
    // all of them. Their wire fields sit at the frozen caps, so 100 of them carry the protocol 5
    // snapshot past its byte limit and leave the protocol 1 one almost empty.
    const opencodeAgent = (index: number, large: boolean): AgentSummary => ({
      id: `opencode-agent-${index}`,
      provider: "opencode",
      name: large ? "n".repeat(80) : "OpenCode Agent",
      title: "Lead",
      description: "",
      notifications: true,
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      threadId: `thread-opencode-${index}`,
      workspacePath: "",
      preview: large ? "p".repeat(240) : "",
      updatedAt: null,
      avatarSeed: large ? "a".repeat(128) : "opencode",
      avatarHue: null,
      avatarUrl: large ? `https://example.invalid/${"u".repeat(2_000)}` : null,
    });
    // One small agent until both clients are ready, so neither socket is closed by the byte limit.
    let agents: AgentSummary[] = [opencodeAgent(0, false)];
    const { store, start } = await createTeamApiFixture("oversized-turn-snapshot", { configure: true });
    const { port } = await start({
      agents: createAgents(
        {
          listAgents: () => agents,
          getRuntimeSnapshot: () => ({
            ...createAgents().getRuntimeSnapshot(),
            agents,
            latestMessages: agents.map((agent, index) => ({
              agentId: agent.id,
              id: `message-${index}`,
              text: "Answer ready.",
              createdAt: "2026-08-29T10:00:00.000Z",
            })),
          }),
        },
        agentEvents,
      ),
    });
    const login = await Effect.runPromise(store.login("owner", "correct horse battery"));
    const received = new Map<string, Array<{ type: string }>>();
    const open = async (name: string, capabilities: string[]): Promise<WebSocket> => {
      const messages: Array<{ type: string }> = [];
      received.set(name, messages);
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
        "openbot-team-v1",
        `openbot-token.${login.sessionToken}`,
      ]);
      const presence = nextJsonEvent(socket);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("WebSocket did not open.")), { once: true });
      });
      socket.addEventListener("message", (message) => messages.push(JSON.parse(String(message.data))));
      await presence;
      const initialSnapshot = nextJsonEvent(socket);
      socket.send(JSON.stringify({ type: "agent-event-scope", includeConversations: false, capabilities }));
      await expect(initialSnapshot).resolves.toMatchObject({ type: "runtime-snapshot" });
      return socket;
    };
    // The oversized client connects first, so the broadcast loop reaches it before the other one.
    const oversized = await open("oversized", ["agent-runtime-snapshots", "local-providers"]);
    const fits = await open("fits", ["agent-runtime-snapshots"]);
    const typesOf = (name: string) => received.get(name)?.map((message) => message.type) ?? [];
    for (const messages of received.values()) messages.length = 0;
    // Protocol 5 reads all 100 of these agents, so its post-turn snapshot no longer fits.
    agents = Array.from({ length: 100 }, (_, index) => opencodeAgent(index, true));
    agentEvents.emit("event", {
      type: "turn-completed",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-1",
      status: "completed",
    });
    // The turn reaches both clients. Only the client whose snapshot does not fit loses the snapshot.
    await vi.waitFor(() => {
      expect(typesOf("oversized").filter((type) => type === "turn-completed")).toHaveLength(1);
      expect(typesOf("fits").filter((type) => type === "turn-completed")).toHaveLength(1);
    });
    await vi.waitFor(() => expect(typesOf("fits").filter((type) => type === "runtime-snapshot")).toHaveLength(1));
    expect(typesOf("oversized").filter((type) => type === "runtime-snapshot")).toHaveLength(0);
    oversized.close();
    fits.close();
  }, 30_000);

  it("keeps legacy event clients connected without sending runtime snapshots", async () => {
    const { store, start } = await createTeamApiFixture("legacy-events", { configure: true });
    const login = await Effect.runPromise(store.login("owner", "correct horse battery"));
    const agentEvents = new EventEmitter();
    const source = opencodeFixture[0];
    if (!isAgentSummary(source)) throw new Error("Invalid agent fixture.");
    const primaryAgent: AgentSummary = {
      ...source,
      id: "chief",
      provider: "codex",
      model: "gpt-5.6-luna",
      threadId: "thread-chief",
    };
    const legacySnapshot = {
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 2,
      messages: [
        {
          id: "reply-1",
          author: "assistant" as const,
          text: "Done",
          createdAt: "2026-08-29T10:00:00.000Z",
          status: "completed" as const,
        },
        {
          id: "routine-event-1",
          author: "system" as const,
          source: "system" as const,
          text: "Morning brief",
          createdAt: "2026-08-29T10:01:00.000Z",
          status: "completed" as const,
          itemType: routineConversationEventItemType("created", "routine-1"),
        },
        {
          id: "routine-run-event-1",
          author: "system" as const,
          source: "system" as const,
          text: "Morning brief",
          createdAt: "2026-08-29T10:02:00.000Z",
          status: "completed" as const,
          itemType: routineRunConversationEventItemType("running", "routine-1", "run-1"),
        },
        {
          id: "hosted-site-event-1",
          author: "system" as const,
          source: "system" as const,
          text: hostedSiteConversationEventText({
            siteId: null,
            title: "Launch page",
            hostname: null,
            url: null,
          }),
          createdAt: "2026-08-29T10:03:00.000Z",
          status: "completed" as const,
          itemType: hostedSiteConversationEventItemType("publish", "running", "operation-1"),
        },
      ],
    };
    const { port } = await start({
      agents: createAgents(
        { listAgents: () => [primaryAgent], readConversation: () => Effect.succeed(legacySnapshot) },
        agentEvents,
      ),
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
      "openbot-events",
      `openbot-token.${login.sessionToken}`,
    ]);
    const firstEvent = nextJsonEvent(socket);

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("WebSocket did not open.")), { once: true });
      });
      await expect(firstEvent).resolves.toMatchObject({ type: "team-presence" });
      expect(socket.protocol).toBe("openbot-events");
      const supportedEvent = nextJsonEvent(socket);
      agentEvents.emit("event", { type: "runtime-snapshot", snapshot: createAgents().getRuntimeSnapshot() });
      agentEvents.emit("event", { type: "agents-changed", agents: [] });
      await expect(supportedEvent).resolves.toMatchObject({ type: "bots-changed" });

      const conversationEvent = nextJsonEvent(socket);
      agentEvents.emit("event", { type: "conversation", snapshot: legacySnapshot });
      await expect(conversationEvent).resolves.toMatchObject({
        type: "conversation",
        snapshot: { messages: [expect.objectContaining({ id: "reply-1" })] },
      });
    } finally {
      socket.close();
    }
  });

  it("materializes the full snapshot for a released legacy conversation event", async () => {
    const { store, start } = await createTeamApiFixture("legacy-full-conversation", { configure: true });
    const login = await Effect.runPromise(store.login("owner", "correct horse battery"));
    const agentEvents = new EventEmitter();
    const source = opencodeFixture[0];
    if (!isAgentSummary(source)) throw new Error("Invalid agent fixture.");
    const primaryAgent: AgentSummary = {
      ...source,
      id: "chief",
      provider: "codex",
      model: "gpt-5.6-luna",
      threadId: "thread-chief",
    };
    const fullSnapshot = {
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 4,
      messages: [
        {
          id: "old-message",
          author: "user" as const,
          text: "Earlier",
          createdAt: "2026-08-29T09:00:00.000Z",
          status: "completed" as const,
        },
        {
          id: "new-message",
          author: "assistant" as const,
          text: "Done",
          createdAt: "2026-08-29T10:00:00.000Z",
          status: "completed" as const,
        },
      ],
    };
    const readConversation = vi.fn(() => Effect.succeed(fullSnapshot));
    const { port } = await start({
      agents: createAgents({ listAgents: () => [primaryAgent], readConversation }, agentEvents),
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
      "openbot-events",
      `openbot-token.${login.sessionToken}`,
    ]);
    const presence = nextJsonEvent(socket);
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("WebSocket did not open.")), { once: true });
      });
      await presence;
      const conversationEvent = nextJsonEvent(socket);
      agentEvents.emit("event", {
        type: "conversation",
        snapshot: { ...fullSnapshot, revision: 4, messages: [fullSnapshot.messages[1]] },
      });
      await expect(conversationEvent).resolves.toMatchObject({
        type: "conversation",
        snapshot: {
          revision: 4,
          messages: [expect.objectContaining({ id: "old-message" }), expect.objectContaining({ id: "new-message" })],
        },
      });
      expect(readConversation).toHaveBeenCalledWith("chief");
    } finally {
      socket.close();
    }
  });
});

it.each([
  { version: "v1", encode: encodeTeamProtocolV1CurrentHttpResponse, decode: decodeTeamProtocolV1CurrentHttpResponse },
  { version: "v3", encode: encodeTeamProtocolV3CurrentHttpResponse, decode: decodeTeamProtocolV3CurrentHttpResponse },
])("preserves OpenCode sender and reaction references in $version provider views", ({ encode, decode }) => {
  const actor = { kind: "agent", agentId: "opencode-agent" };
  const queue = {
    agentId: "chief",
    deliveries: [
      {
        id: "delivery-1",
        messageId: "message-1",
        recipientAgentId: "chief",
        sender: actor,
        text: "Please review.",
        attachments: [],
        replyToMessageId: null,
        status: "queued",
        position: 1,
        turnId: null,
        error: null,
        createdAt: "2026-09-09T10:00:00.000Z",
      },
    ],
  };
  const conversation = {
    agentId: "chief",
    threadId: "thread-chief",
    activeTurnId: null,
    revision: 1,
    readState: { unreadCount: 0, firstUnreadMessageId: null, throughMessageId: "message-1" },
    messages: [
      {
        id: "message-1",
        author: "assistant",
        text: "Review complete.",
        status: "completed",
        createdAt: "2026-09-09T10:00:00.000Z",
        reactions: [{ emoji: "👍", actor }],
      },
    ],
  };
  for (const [route, payload] of [
    ["queue", queue],
    ["conversation", conversation],
  ] as const) {
    const path = `/v1/agents/chief/${route}`;
    const filtered = legacyProviderView(payload, new Set([actor.agentId]));
    const wire = JSON.parse(encode("GET", path, 200, filtered));
    expect(decode("GET", path, 200, wire)).toEqual(payload);
  }
});
