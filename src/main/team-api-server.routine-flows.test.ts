// @vitest-environment node

// `routine-flows-v1`: the routine canvas over the Team API, `src/main/team-api/route-routine-flows.ts`.
// Any member may use it for the agents the member can see; a hidden agent answers as missing.

import { EventEmitter } from "node:events";
import {
  type AgentSummary,
  isAgentSummary,
  type RoutineFlowCanvas,
  type RoutineFlowLink,
} from "@openbot/contracts/ipc";
import {
  ROUTINE_FLOW_STEP_TEXT_LIMIT,
  ROUTINE_FLOWS_CAPABILITY,
  ROUTINE_FLOWS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-flows-v1";
import { TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import opencodeFixture from "../../packages/contracts/src/team-protocol/fixtures/v4/host-http-response.json";
import type { TeamApiRoutineFlows } from "./team-api/dependencies";
import { createAgents, createTeamApiFixture, nextJsonEvent, stopTeamApiFixtures } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

const fixture = opencodeFixture[0];
if (!isAgentSummary(fixture)) throw new Error("Invalid agent fixture.");
const CHIEF: AgentSummary = { ...fixture, id: "chief", provider: "codex", model: "gpt-5.6-luna" };
const WRITER: AgentSummary = { ...fixture, id: "writer", provider: "codex", model: "gpt-5.6-luna" };
// Protocol 1, which these requests speak, has no word for OpenCode, so this agent is hidden.
const HIDDEN: AgentSummary = { ...fixture, id: "hidden", provider: "opencode", model: "opencode/model" };

const TIME = "2026-10-01T09:00:00.000Z";

function routine(id: string, agentId: string, trigger: RoutineFlowCanvas["routines"][number]["routine"]["trigger"]) {
  return {
    routine: {
      id,
      agentId,
      name: id,
      instruction: "Do it.",
      active: true,
      timezone: "UTC",
      trigger,
      createdAt: TIME,
      updatedAt: TIME,
    },
    recentRuns: [],
    upcomingRuns: [],
    steps: [],
  };
}

function link(id: string, routineId: string, fromAgentId: string, toAgentId: string): RoutineFlowLink {
  return { id, routineId, fromAgentId, toAgentId, instruction: "", createdAt: TIME };
}

const CANVAS: RoutineFlowCanvas = {
  agentId: "chief",
  routines: [
    routine("daily", "chief", {
      kind: "webhook",
      url: "https://hooks.example/secret-path",
      eventType: null,
      filters: [],
    }),
    routine("leaky", "chief", { kind: "schedule", schedule: { kind: "daily", time: "09:00" } }),
  ],
  links: [link("to-writer", "daily", "chief", "writer"), link("to-hidden", "leaky", "chief", "hidden")],
  positions: [
    { nodeKey: "agent:writer", x: 10, y: 20 },
    { nodeKey: "agent:hidden", x: 30, y: 40 },
  ],
  placedAgentIds: ["writer", "hidden"],
};

function routineFlows(overrides: Partial<TeamApiRoutineFlows> = {}): TeamApiRoutineFlows {
  const routines = new Map([
    ["daily", ["chief", "writer"]],
    ["leaky", ["chief", "hidden"]],
  ]);
  const links = new Map([
    ["to-writer", "daily"],
    ["to-hidden", "leaky"],
  ]);
  return {
    canvas: () => Effect.succeed(CANVAS),
    savePosition: () => Effect.void,
    removePosition: () => Effect.void,
    connect: (input) => Effect.succeed(link("new", input.routineId, input.fromAgentId, input.toAgentId)),
    disconnect: () => Effect.void,
    updateLink: (input) =>
      Effect.succeed({ ...link(input.linkId, "daily", "chief", "writer"), instruction: input.instruction }),
    agentsOf: (ref) =>
      Effect.succeed(routines.get("routineId" in ref ? ref.routineId : (links.get(ref.linkId) ?? "")) ?? null),
    ...overrides,
  };
}

async function startHost(flows: TeamApiRoutineFlows | null = routineFlows(), events = new EventEmitter()) {
  const host = await createTeamApiFixture("routine-flows", { configure: true });
  const { base, port } = await host.start({
    agents: createAgents({ listAgents: () => [CHIEF, WRITER, HIDDEN] }, events),
    ...(flows ? { routineFlows: flows } : {}),
  });
  const ownerToken = await host.signIn();
  const invite = await Effect.runPromise(host.store.createInvite("member"));
  const member = await Effect.runPromise(host.store.acceptInvite(invite.token, "member", "member password"));
  const send = (token: string, path: string, body: unknown, capabilities = ROUTINE_FLOWS_CAPABILITY) =>
    fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "OpenBot-Capabilities": capabilities,
      },
      body: JSON.stringify(body),
    });
  return { base, port, host, ownerToken, memberToken: member.sessionToken, send };
}

describe("Team API routine-flows-v1", () => {
  it("lets a member read and change the flows of visible agents only", async () => {
    const { send, ownerToken, memberToken } = await startHost();

    const memberCanvas = await send(memberToken, ROUTINE_FLOWS_ROUTES.canvas, { agentId: "chief" });
    expect(memberCanvas.status).toBe(200);
    const canvas: RoutineFlowCanvas = await memberCanvas.json();
    // The routine that hands work to a hidden agent, its link and the hidden node are left out.
    expect(canvas.routines.map(({ routine }) => routine.id)).toEqual(["daily"]);
    expect(canvas.links.map((item) => item.id)).toEqual(["to-writer"]);
    expect(canvas.positions.map((position) => position.nodeKey)).toEqual(["agent:writer"]);
    expect(canvas.placedAgentIds).toEqual(["writer"]);
    // Only an owner or admin reads a webhook URL, as `events-v1` keeps it.
    expect(canvas.routines[0]?.routine.trigger).toMatchObject({ kind: "webhook", url: null });
    const ownerCanvas: RoutineFlowCanvas = await (
      await send(ownerToken, ROUTINE_FLOWS_ROUTES.canvas, { agentId: "chief" })
    ).json();
    expect(ownerCanvas.routines[0]?.routine.trigger).toMatchObject({ url: "https://hooks.example/secret-path" });

    const connect = await send(memberToken, ROUTINE_FLOWS_ROUTES.connect, {
      routineId: "daily",
      fromAgentId: "writer",
      toAgentId: "chief",
    });
    expect(connect.status).toBe(200);
    expect(await connect.json()).toMatchObject({ routineId: "daily", fromAgentId: "writer", toAgentId: "chief" });
    const update = await send(memberToken, ROUTINE_FLOWS_ROUTES.updateLink, {
      linkId: "to-writer",
      instruction: "Edit.",
    });
    expect(await update.json()).toMatchObject({ id: "to-writer", instruction: "Edit." });
    expect((await send(memberToken, ROUTINE_FLOWS_ROUTES.disconnect, { linkId: "to-writer" })).status).toBe(200);

    const missing = { error: sourceText("error.team.agentNotFound") };
    const refused = [
      [ROUTINE_FLOWS_ROUTES.canvas, { agentId: "hidden" }],
      [ROUTINE_FLOWS_ROUTES.savePosition, { agentId: "chief", nodeKey: "agent:hidden", x: 1, y: 2 }],
      [ROUTINE_FLOWS_ROUTES.removePosition, { agentId: "hidden", nodeKey: "agent:writer" }],
      [ROUTINE_FLOWS_ROUTES.connect, { routineId: "daily", fromAgentId: "chief", toAgentId: "hidden" }],
      [ROUTINE_FLOWS_ROUTES.connect, { routineId: "leaky", fromAgentId: "chief", toAgentId: "writer" }],
      [ROUTINE_FLOWS_ROUTES.connect, { routineId: "gone", fromAgentId: "chief", toAgentId: "writer" }],
      [ROUTINE_FLOWS_ROUTES.disconnect, { linkId: "to-hidden" }],
      [ROUTINE_FLOWS_ROUTES.updateLink, { linkId: "to-hidden", instruction: "" }],
    ] as const;
    for (const [path, body] of refused) {
      const response = await send(memberToken, path, body);
      expect({ path, status: response.status }).toEqual({ path, status: 404 });
      expect(await response.json()).toEqual(missing);
    }
  });

  it("refuses a client without the capability and is not advertised without the service", async () => {
    const { send, ownerToken } = await startHost();
    const refused = await send(ownerToken, ROUTINE_FLOWS_ROUTES.canvas, { agentId: "chief" }, "");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: sourceText("error.team.routineFlowsUnsupported") });

    const bare = await startHost(null);
    const compatibility = await (await fetch(`${bare.base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).not.toContain(ROUTINE_FLOWS_CAPABILITY);
    const advertised = await (await fetch(`${(await startHost()).base}/v1/compatibility`)).json();
    expect(advertised.capabilities).toContain(ROUTINE_FLOWS_CAPABILITY);
  });

  it("clips step texts and empties the oldest runs' steps to fit one WebRTC frame", async () => {
    const step = (runId: string, agentId: string) => ({
      id: `${runId}-${agentId}`,
      runId,
      agentId,
      deliveryId: null,
      input: "i".repeat(50_000),
      output: "o".repeat(50_000),
      status: "succeeded" as const,
      error: null,
      createdAt: TIME,
      updatedAt: TIME,
    });
    const run = (id: string, createdAt: string) => ({
      id,
      routineId: id,
      triggerId: null,
      kind: "scheduled" as const,
      scheduledFor: createdAt,
      routineName: id,
      instruction: "Do it.",
      status: "succeeded" as const,
      error: null,
      createdAt,
      updatedAt: createdAt,
      agentId: "chief",
      deliveryId: null,
    });
    const routines = Array.from({ length: 300 }, (_, index) => {
      const id = `routine-${index}`;
      const createdAt = new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString();
      return {
        ...routine(id, "chief", { kind: "schedule", schedule: { kind: "daily", time: "09:00" } }),
        recentRuns: [run(id, createdAt)],
        steps: [step(id, "chief")],
      };
    });
    const { send, memberToken } = await startHost(
      routineFlows({
        canvas: () => Effect.succeed({ ...CANVAS, routines, links: [], positions: [], placedAgentIds: [] }),
      }),
    );
    const response = await send(memberToken, ROUTINE_FLOWS_ROUTES.canvas, { agentId: "chief" });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThan(TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES);
    const canvas: RoutineFlowCanvas = JSON.parse(text);
    expect(canvas.routines).toHaveLength(300);
    const newest = canvas.routines.at(-1)?.steps[0];
    expect(newest?.input).toHaveLength(ROUTINE_FLOW_STEP_TEXT_LIMIT);
    expect(canvas.routines[0]?.steps[0]).toMatchObject({ input: "", output: null });
  });

  it("empties the older runs' texts next, and refuses a canvas that still does not fit", async () => {
    const run = (routineId: string, index: number) => ({
      id: `${routineId}-run-${index}`,
      routineId,
      triggerId: null,
      kind: "scheduled" as const,
      scheduledFor: TIME,
      routineName: routineId,
      instruction: "r".repeat(100_000),
      status: "failed" as const,
      error: "e".repeat(10_000),
      createdAt: TIME,
      updatedAt: TIME,
      agentId: "chief",
      deliveryId: null,
    });
    const flows = (count: number, instruction: string) =>
      Array.from({ length: count }, (_, index) => {
        const entry = routine(`routine-${index}`, "chief", {
          kind: "schedule",
          schedule: { kind: "daily", time: "09:00" },
        });
        return {
          ...entry,
          routine: { ...entry.routine, instruction },
          recentRuns: Array.from({ length: 10 }, (_, runIndex) => run(entry.routine.id, runIndex)),
        };
      });
    let routines = flows(2, "Do it.");
    const { send, memberToken } = await startHost(
      routineFlows({
        canvas: () => Effect.succeed({ ...CANVAS, routines, links: [], positions: [], placedAgentIds: [] }),
      }),
    );
    const response = await send(memberToken, ROUTINE_FLOWS_ROUTES.canvas, { agentId: "chief" });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThan(TEAM_PROTOCOL_V2_MAX_JSON_FRAME_BYTES);
    const canvas: RoutineFlowCanvas = JSON.parse(text);
    for (const flow of canvas.routines) {
      expect(flow.recentRuns).toHaveLength(10);
      expect(flow.recentRuns[0]?.instruction).toHaveLength(100_000);
    }
    // The first routine is cut first, and that is enough for the canvas to fit.
    expect(canvas.routines[0]?.recentRuns[1]).toMatchObject({ instruction: "", error: null });

    routines = flows(20, "i".repeat(100_000));
    const refused = await send(memberToken, ROUTINE_FLOWS_ROUTES.canvas, { agentId: "chief" });
    expect(refused.status).toBe(413);
  });

  it("sends a canvas change only to clients with the capability and never for a hidden agent", async () => {
    const events = new EventEmitter();
    const { port, ownerToken } = await startHost(routineFlows(), events);
    const received = new Map<boolean, unknown[]>();
    const sockets: WebSocket[] = [];
    for (const supported of [true, false]) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/v1/events`, [
        "openbot-team-v1",
        `openbot-token.${ownerToken}`,
      ]);
      const presence = nextJsonEvent(socket);
      await new Promise<void>((resolve) => socket.addEventListener("open", () => resolve(), { once: true }));
      await presence;
      socket.send(
        JSON.stringify({
          type: "agent-event-scope",
          includeConversations: true,
          capabilities: supported ? [ROUTINE_FLOWS_CAPABILITY] : [],
        }),
      );
      const messages: unknown[] = [];
      received.set(supported, messages);
      socket.addEventListener("message", (event) => {
        const text = String(event.data);
        if (!text.includes('"team-presence"')) messages.push(JSON.parse(text));
      });
      sockets.push(socket);
    }
    // The scope message has no reply, so a known event on both sockets proves both scopes applied.
    events.emit("event", { type: "routines-changed", agentId: "chief" });
    await vi.waitFor(() => expect([...received.values()].every((messages) => messages.length === 1)).toBe(true));
    events.emit("event", { type: "routine-flows-changed", agentId: "hidden" });
    events.emit("event", { type: "routine-flows-changed", agentId: "chief" });
    events.emit("event", { type: "routines-changed", agentId: "chief" });
    await vi.waitFor(() => expect(received.get(false)).toHaveLength(2));
    await vi.waitFor(() => expect(received.get(true)).toHaveLength(3));
    expect(received.get(true)?.[1]).toEqual({ type: "routine-flows-changed", agentId: "chief" });
    expect(received.get(false)?.some((message) => JSON.stringify(message).includes("routine-flows-changed"))).toBe(
      false,
    );
    for (const socket of sockets) socket.close();
  });
});
