import { isAgentSummary } from "@openbot/contracts/ipc";
import opencodeFixture from "../../packages/contracts/src/team-protocol/fixtures/v4/host-http-response.json";
// @vitest-environment node

// The agent collection and the per-agent routes: `src/main/team-api/route-agents.ts` and the
// memories, routines, conversation and queue modules it dispatches to.

import { join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentMemory, AgentSummary, Routine, RoutineRun } from "@openbot/contracts/ipc";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import { encodeTeamProtocolV4WebRtcHttpRequest } from "@openbot/contracts/team-protocol/v4-webrtc-adapter";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStore } from "../backend/agent-store";
import { SidebarLayoutStore } from "../backend/sidebar-layout-store";
import { addRemotePreviewUrls } from "./remote-server-urls";
import {
  createAgents,
  createTeamApiFixture,
  emptyRequest,
  jsonRequest,
  stopTeamApiFixtures,
  type TeamApiAgents,
} from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

describe("TeamApiServer agents", () => {
  it("downloads uploaded and replaced avatars through a WebRTC request and removes them", async () => {
    const { root, start, signIn } = await createTeamApiFixture("agent-avatar", { configure: true });
    const store = new AgentStore(join(root, "agents"), join(root, "home"));
    await store.initialize();
    await store.getOrCreate("chief");
    const { base } = await start({
      agents: createAgents({
        listAgents: () => store.list(),
        setAvatar: (id, image) => store.setAvatar(id, image),
        resolveAvatar: (id) => store.resolveAvatar(id),
      }),
    });
    const token = await signIn();
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "image/png" };
    const path = "/v1/agents/chief/avatar";
    const images = [
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1],
    ];
    const downloads = [];
    let downloadPath = path;
    for (const image of images) {
      const upload = await fetch(`${base}${path}`, { method: "PUT", headers, body: Buffer.from(image) });
      const agent = await upload.json();
      if (!isAgentSummary(agent) || !agent.avatarUrl) throw new Error("Missing uploaded avatar.");
      const avatarUrl = new URL(addRemotePreviewUrls(agent, "host-1").avatarUrl ?? "");
      downloadPath = `${path}${avatarUrl.search}`;
      const body = encodeTeamProtocolV4WebRtcHttpRequest("GET", downloadPath, undefined);
      const download = await fetch(`${base}${downloadPath}`, { headers });
      downloads.push({
        uploadStatus: upload.status,
        protocol: avatarUrl.protocol,
        body,
        status: download.status,
        mimeType: download.headers.get("content-type"),
        bytes: [...new Uint8Array(await download.arrayBuffer())],
      });
    }
    const removal = await fetch(`${base}${path}`, { method: "DELETE", headers });
    const removed = await removal.json();
    const missing = await fetch(`${base}${downloadPath}`, { headers });
    expect({
      downloads,
      removalStatus: removal.status,
      avatarUrl: removed.avatarUrl,
      missingStatus: missing.status,
    }).toEqual({
      downloads: images.map((bytes) => ({
        uploadStatus: 200,
        protocol: "openbot-remote-avatar:",
        body: {},
        status: 200,
        mimeType: "image/png",
        bytes,
      })),
      removalStatus: 200,
      avatarUrl: null,
      missingStatus: 404,
    });
  });

  it("hides OpenCode from old clients and allows protocol 4 to read and change it", async () => {
    const source = opencodeFixture[0];
    if (!isAgentSummary(source)) throw new Error("Invalid OpenCode fixture.");
    const updateAgent = vi.fn(async () => source);
    const { start, signIn } = await createTeamApiFixture("opencode-visibility", { configure: true });
    const { base } = await start({
      appVersion: "1.0.0",
      agents: createAgents({ listAgents: () => [source], updateAgent, preferredProvider: () => "opencode" }),
    });
    const token = await signIn({ protocol: 4, appVersion: "1.0.0" });
    for (const protocol of [1, 2, 3, 4]) {
      const headers = {
        Authorization: `Bearer ${token}`,
        [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
        [TEAM_APP_VERSION_HEADER]: "1.0.0",
        "Content-Type": "application/json",
      };
      const list = await fetch(`${base}/v1/agents`, { headers });
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual(protocol === 4 ? [source] : []);
      const update = await fetch(`${base}/v1/agents/${source.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ model: source.model }),
      });
      expect(update.status).toBe(protocol === 4 ? 200 : 404);
      if (protocol < 4) {
        const create = await fetch(`${base}/v1/agents`, { method: "POST", headers, body: "{}" });
        expect(create.status).toBe(400);
        expect(await create.text()).toContain("The host's default provider requires Team API v4.");
      }
    }
    expect(updateAgent).toHaveBeenCalledTimes(1);
  });

  it("duplicates an agent through protocol v3 and places it after the source", async () => {
    const { root, start, signIn } = await createTeamApiFixture("duplicate", { configure: true });
    const sidebarLayout = new SidebarLayoutStore(join(root, "sidebar-layout.json"));
    await sidebarLayout.initialize();
    const source = {
      id: "chief",
      provider: "codex",
      name: "Chief",
      title: "Lead",
      description: "Coordinates work.",
      notifications: true,
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      threadId: "thread-chief",
      workspacePath: join(root, "chief"),
      preview: "Ready",
      updatedAt: null,
      avatarSeed: "chief",
      avatarHue: null,
      avatarUrl: null,
    } satisfies AgentSummary;
    const duplicate = {
      ...source,
      id: "chief-copy",
      name: "Chief copy",
      threadId: null,
      workspacePath: join(root, "chief-copy"),
      preview: "No messages yet",
    } satisfies AgentSummary;
    let agents: AgentSummary[] = [source];
    const duplicateAgent = vi.fn(async () => {
      agents = [duplicate, source];
      return duplicate;
    });
    let committedDuplicate: Awaited<ReturnType<TeamApiAgents["commitAgentDuplication"]>> | null = null;
    const commitAgentDuplication = vi.fn(async (_agentId, layout) => {
      committedDuplicate = { agent: duplicate, layout };
      return committedDuplicate;
    });
    const deleteAgent = vi.fn(async (agentId: string) => {
      agents = agents.filter((agent) => agent.id !== agentId);
    });
    // A channel the user filed in the sidebar. The layout prunes every id outside the set it is
    // given, so duplication must offer the channels as well as the agents.
    const channelId = "channel-launch-room";
    const chatIds = () => new Set([...agents.map((agent) => agent.id), channelId]);
    const agentService = createAgents({
      listAgents: () => agents,
      sidebarChatIds: chatIds,
      committedAgentDuplication: () => committedDuplicate,
      duplicateAgent,
      commitAgentDuplication,
      deleteAgent,
    });
    const section = await sidebarLayout.mutate(
      { type: "create", name: "Core", agentId: source.id },
      new Set([source.id]),
    );
    const sectionId = section.sections[0]?.id ?? null;
    await sidebarLayout.mutate({ type: "move-agent", agentId: channelId, sectionId, beforeAgentId: null }, chatIds());
    const { base } = await start({
      agents: agentService,
      sidebarLayout,
      appVersion: "1.0.0",
    });

    const token = await signIn({ protocol: TEAM_PROTOCOL_V3, appVersion: "1.0.0" });
    const response = await fetch(`${base}/v1/agents/${source.id}/duplicate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V3),
        [TEAM_APP_VERSION_HEADER]: "1.0.0",
      },
      body: JSON.stringify({ operationId: "7674b664-cd72-4cf9-88ed-6f2e189d551f" }),
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      bot: { id: duplicate.id, threadId: null },
      layout: {
        agentAssignments: {
          [source.id]: sectionId,
          [duplicate.id]: sectionId,
          // The channel keeps the section the user filed it in.
          [channelId]: sectionId,
        },
      },
    });
    const placed = sidebarLayout.getSnapshot().agentOrder;
    expect(placed.indexOf(duplicate.id)).toBe(placed.indexOf(source.id) + 1);
    expect(placed).toContain(channelId);
    expect(duplicateAgent).toHaveBeenCalledWith(source.id, "7674b664-cd72-4cf9-88ed-6f2e189d551f");
    expect(commitAgentDuplication).toHaveBeenCalledWith(duplicate.id, expect.objectContaining({ revision: 3 }));
    expect(deleteAgent).not.toHaveBeenCalled();

    const currentLayout = await sidebarLayout.mutate(
      { type: "create", name: "Later", agentId: duplicate.id },
      new Set([...chatIds(), duplicate.id]),
    );

    const retry = await fetch(`${base}/v1/agents/${source.id}/duplicate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V3),
        [TEAM_APP_VERSION_HEADER]: "1.0.0",
      },
      body: JSON.stringify({ operationId: "7674b664-cd72-4cf9-88ed-6f2e189d551f" }),
    });
    expect(retry.status).toBe(201);
    await expect(retry.json()).resolves.toMatchObject({ layout: { revision: currentLayout.revision } });
    expect(duplicateAgent).toHaveBeenCalledTimes(1);
    expect(commitAgentDuplication).toHaveBeenCalledTimes(1);
  });

  it("attempts layout cleanup when duplicate deletion reports an error", async () => {
    const { root, start, signIn } = await createTeamApiFixture("duplicate-rollback", { configure: true });
    const sidebarLayout = new SidebarLayoutStore(join(root, "sidebar-layout.json"));
    await sidebarLayout.initialize();
    const duplicate = {
      id: "chief-copy",
      provider: "codex",
      name: "Chief copy",
      title: "Lead",
      description: "",
      notifications: true,
      model: "gpt-5.6-luna",
      reasoningEffort: "medium",
      threadId: null,
      workspacePath: join(root, "chief-copy"),
      preview: "No messages yet",
      updatedAt: null,
      avatarSeed: "chief",
      avatarHue: null,
      avatarUrl: null,
    } satisfies AgentSummary;
    const deleteAgent = vi.fn(async () => {
      throw new Error("agent cleanup failed");
    });
    const agents = createAgents({
      listAgents: () => [duplicate],
      duplicateAgent: vi.fn(async () => duplicate),
      deleteAgent,
    });
    vi.spyOn(sidebarLayout, "placeDuplicateAfter").mockRejectedValueOnce(new Error("layout persistence failed"));
    const removeAgent = vi.spyOn(sidebarLayout, "removeAgent");
    const { base } = await start({
      agents,
      sidebarLayout,
      appVersion: "1.0.0",
    });

    const token = await signIn({ protocol: TEAM_PROTOCOL_V3, appVersion: "1.0.0" });
    const response = await fetch(`${base}/v1/agents/chief/duplicate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V3),
        [TEAM_APP_VERSION_HEADER]: "1.0.0",
      },
      body: JSON.stringify({ operationId: "25dc8b8e-a93b-48f5-9e22-d3a7840f5d4d" }),
    });

    expect(response.status).toBe(500);
    expect(deleteAgent).toHaveBeenCalledWith(duplicate.id);
    expect(removeAgent).toHaveBeenCalledWith(duplicate.id);
  });

  it("supports memory operations through the authenticated team API", async () => {
    const { start, signIn } = await createTeamApiFixture("memories", { configure: true });
    const memories: AgentMemory[] = [];
    const createMemory = vi.fn((input: { agentId: string; text: string }) => {
      const memory: AgentMemory = {
        id: "memory-1",
        agentId: input.agentId,
        text: input.text,
        origin: "manual",
        sourceTurnId: null,
        createdAt: "2026-08-25T12:00:00.000Z",
        updatedAt: "2026-08-25T12:00:00.000Z",
      };
      memories.push(memory);
      return memory;
    });
    const updateMemory = vi.fn((input: { agentId: string; memoryId: string; text: string }) => {
      const memory = memories.find((item) => item.id === input.memoryId && item.agentId === input.agentId);
      if (!memory) throw new Error("Memory not found.");
      memory.text = input.text;
      memory.updatedAt = "2026-08-25T12:01:00.000Z";
      return memory;
    });
    const deleteMemory = vi.fn((input: { agentId: string; memoryId: string }) => {
      const index = memories.findIndex((item) => item.id === input.memoryId && item.agentId === input.agentId);
      if (index >= 0) memories.splice(index, 1);
    });
    const clearMemories = vi.fn((agentId: string) => {
      for (let index = memories.length - 1; index >= 0; index -= 1) {
        if (memories[index]?.agentId === agentId) memories.splice(index, 1);
      }
    });
    const { base } = await start({
      agents: createAgents({
        listMemories: (agentId) => memories.filter((memory) => memory.agentId === agentId),
        createMemory,
        updateMemory,
        deleteMemory,
        clearMemories,
      }),
    });

    const token = await signIn();
    await expect(
      jsonRequest<AgentMemory>(base, "/v1/agents/chief/memories", {
        token,
        body: { text: "Uses metric units." },
      }),
    ).resolves.toMatchObject({ id: "memory-1", botId: "chief", origin: "manual" });
    await expect(jsonRequest(base, "/v1/agents/chief/memories", { token })).resolves.toHaveLength(1);
    await expect(
      jsonRequest<AgentMemory>(base, "/v1/agents/chief/memories/memory-1", {
        method: "PATCH",
        token,
        body: { text: "Uses SI units." },
      }),
    ).resolves.toMatchObject({ text: "Uses SI units." });
    await emptyRequest(base, "/v1/agents/chief/memories/memory-1", { method: "DELETE", token });
    await expect(jsonRequest(base, "/v1/agents/chief/memories", { token })).resolves.toEqual([]);
    expect(createMemory).toHaveBeenCalledWith({ agentId: "chief", text: "Uses metric units." });
    expect(updateMemory).toHaveBeenCalledWith({ agentId: "chief", memoryId: "memory-1", text: "Uses SI units." });
    expect(deleteMemory).toHaveBeenCalledWith({ agentId: "chief", memoryId: "memory-1" });

    await jsonRequest<AgentMemory>(base, "/v1/agents/chief/memories", {
      token,
      body: { text: "Clear this memory." },
    });
    await emptyRequest(base, "/v1/agents/chief/memories", { method: "DELETE", token });
    await expect(jsonRequest(base, "/v1/agents/chief/memories", { token })).resolves.toEqual([]);
    expect(clearMemories).toHaveBeenCalledWith("chief");

    const oversized = await fetch(`${base}/v1/agents/chief/memories`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(INPUT_LIMITS.agentMemoryText + 1) }),
    });
    expect(oversized.status).toBe(400);
  });

  it("supports routine operations through the authenticated team API", async () => {
    const { start, signIn } = await createTeamApiFixture("routines", { configure: true });
    const routines: Routine[] = [];
    const createRoutine = vi.fn((input: Parameters<TeamApiAgents["createRoutine"]>[0]) => {
      const now = "2026-08-25T12:00:00.000Z";
      const routine: Routine = {
        id: "routine-1",
        agentId: input.agentId,
        name: input.name,
        instruction: input.instruction,
        active: input.active,
        timezone: input.timezone,
        trigger: {
          id: "trigger-1",
          routineId: "routine-1",
          schedule: input.schedule,
          nextRunAt: "2026-08-26T05:00:00.000Z",
          createdAt: now,
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      };
      routines.push(routine);
      return routine;
    });
    const updateRoutine = vi.fn((input: Parameters<TeamApiAgents["updateRoutine"]>[0]) => {
      const routine = routines.find((item) => item.id === input.routineId && item.agentId === input.agentId);
      if (!routine) throw new Error("Routine not found.");
      if (input.name !== undefined) routine.name = input.name;
      if (input.active !== undefined) routine.active = input.active;
      if (input.schedule !== undefined) routine.trigger.schedule = input.schedule;
      return routine;
    });
    const run: RoutineRun = {
      id: "run-1",
      routineId: "routine-1",
      agentId: "chief",
      triggerId: null,
      kind: "manual",
      scheduledFor: "2026-08-25T12:05:00.000Z",
      routineName: "Morning brief",
      instruction: "Prepare the brief.",
      deliveryId: "delivery-1",
      status: "queued",
      error: null,
      createdAt: "2026-08-25T12:05:00.000Z",
      updatedAt: "2026-08-25T12:05:00.000Z",
    };
    // The run above is what the fake agent service returns, so it says `agentId`; the run the assertion
    // below reads back came off `fetch` as frozen wire JSON, which still says `botId`.
    const { agentId: runAgentId, ...runRest } = run;
    const wireRun = { ...runRest, botId: runAgentId };
    const deleteRoutine = vi.fn(async ({ routineId }: { routineId: string }) => {
      const index = routines.findIndex((routine) => routine.id === routineId);
      if (index >= 0) routines.splice(index, 1);
    });
    const { base } = await start({
      agents: createAgents({
        listRoutines: (agentId) => routines.filter((routine) => routine.agentId === agentId),
        createRoutine,
        updateRoutine,
        deleteRoutine,
        testRoutine: vi.fn(async () => run),
        listRoutineRuns: vi.fn(() => [run]),
      }),
    });

    const token = await signIn();
    await expect(
      jsonRequest<Routine>(base, "/v1/agents/chief/routines", {
        token,
        body: {
          name: "Morning brief",
          instruction: "Prepare the brief.",
          active: true,
          timezone: "Europe/Warsaw",
          schedule: { kind: "weekdays", time: "07:00" },
        },
      }),
    ).resolves.toMatchObject({ id: "routine-1", botId: "chief" });
    await expect(jsonRequest(base, "/v1/agents/chief/routines", { token })).resolves.toHaveLength(1);
    await expect(
      jsonRequest<Routine>(base, "/v1/agents/chief/routines/routine-1", {
        method: "PATCH",
        token,
        body: { active: false, schedule: { kind: "daily", time: "09:15" } },
      }),
    ).resolves.toMatchObject({ active: false, trigger: { schedule: { kind: "daily", time: "09:15" } } });
    await expect(
      jsonRequest<RoutineRun>(base, "/v1/agents/chief/routines/routine-1/test", { token, body: {} }),
    ).resolves.toMatchObject({ kind: "manual", status: "queued" });
    await expect(jsonRequest(base, "/v1/agents/chief/routines/routine-1/runs?limit=10", { token })).resolves.toEqual([
      wireRun,
    ]);
    await emptyRequest(base, "/v1/agents/chief/routines/routine-1", { method: "DELETE", token });
    await expect(jsonRequest(base, "/v1/agents/chief/routines", { token })).resolves.toEqual([]);
  });

  it("responds to authenticated remote interactive requests", async () => {
    const { start, signIn } = await createTeamApiFixture("approval", { configure: true });
    const approvals: unknown[] = [];
    const failures: unknown[] = [];
    const takeovers: unknown[] = [];
    const prompts: unknown[] = [];
    const agents = createAgents({
      acknowledgeFailedTurn: (agentId, turnId) => {
        failures.push({ agentId, turnId });
      },
      respondToPrompt: async (input: unknown) => {
        prompts.push(input);
      },
      respondToApproval: async (input: unknown) => {
        approvals.push(input);
      },
      respondToBrowserTakeover: async (input: unknown) => {
        takeovers.push(input);
      },
    });
    const { base } = await start({ agents });

    const token = await signIn();
    await emptyRequest(base, "/v1/approvals/respond", {
      token: token,
      body: { requestId: 17, decision: "accept" },
    });
    expect(approvals).toEqual([{ requestId: 17, decision: "accept" }]);
    await emptyRequest(base, "/v1/browser-takeovers/respond", {
      token: token,
      body: { requestId: "takeover-17", decision: "complete" },
    });
    expect(takeovers).toEqual([{ requestId: "takeover-17", decision: "complete" }]);
    await emptyRequest(base, "/v1/prompts/respond", {
      token: token,
      body: { requestId: "prompt-17", answers: { scope: ["Small"] } },
    });
    expect(prompts).toEqual([{ requestId: "prompt-17", answers: { scope: ["Small"] } }]);
    await emptyRequest(base, "/v1/agents/chief/failures/acknowledge", {
      token: token,
      body: { turnId: "turn-failed" },
    });
    expect(failures).toEqual([{ agentId: "chief", turnId: "turn-failed" }]);

    const oversizedPrompt = await fetch(`${base}/v1/prompts/respond`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestId: "prompt-18",
        answers: {
          first: ["a".repeat(INPUT_LIMITS.promptAnswersTotalText / 2 + 1)],
          second: ["b".repeat(INPUT_LIMITS.promptAnswersTotalText / 2)],
        },
      }),
    });
    expect(oversizedPrompt.status).toBe(400);
    expect(prompts).toHaveLength(1);

    const invalid = await fetch(`${base}/v1/approvals/respond`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId: 17, decision: "session" }),
    });
    expect(invalid.status).toBe(400);
  });
});

it("requires authentication and the profile capability before generating an editable draft", async () => {
  const { root, start, signIn } = await createTeamApiFixture("profile-generation", { configure: true });
  const sidebarLayout = new SidebarLayoutStore(join(root, "sidebar-layout.json"));
  await sidebarLayout.initialize();
  const draft = {
    name: "Researcher",
    title: "Science",
    description: "Cite sources",
    avatarSeed: "research",
    avatarHue: 215,
    sectionId: null,
  } as const;
  let prompt: string | undefined;
  const { base } = await start({
    sidebarLayout,
    agents: createAgents({
      generateProfile: async (input) => {
        prompt = input.prompt;
        return draft;
      },
    }),
  });
  const token = await signIn({ protocol: TEAM_PROTOCOL_V3 });
  const headers = {
    "Content-Type": "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V3),
    [TEAM_APP_VERSION_HEADER]: "1.0.0",
    [TEAM_CAPABILITIES_HEADER]: "agent-profile-generation",
  };
  const path = `${base}/v1/agents/profile/generate`;
  const unauthorized = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: "Research science" }),
  });
  expect(unauthorized.status).toBe(401);
  expect(prompt).toBeUndefined();
  const response = await fetch(path, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt: "Research science" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(draft);
  expect(prompt).toBe("Research science");
  prompt = undefined;
  const incompatible = await fetch(path, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${token}`, [TEAM_CAPABILITIES_HEADER]: "" },
    body: JSON.stringify({ prompt: "Research science" }),
  });
  expect(incompatible.status).toBe(400);
  expect(prompt).toBeUndefined();
});
