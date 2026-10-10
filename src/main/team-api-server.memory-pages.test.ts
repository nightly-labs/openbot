import {
  type AgentMemory,
  type AgentMemorySelectionState,
  isAgentSummary,
  type SetAgentMemoryInclusionInput,
} from "@openbot/contracts/ipc";
import {
  AGENT_MEMORIES_CAPABILITY,
  AGENT_MEMORIES_PAGE_ROUTE,
  AGENT_MEMORIES_PAGE_SIZE,
  AGENT_MEMORY_INCLUSION_ROUTE,
  AGENT_MEMORY_SELECTION_PAGE_ROUTE,
} from "@openbot/contracts/team-protocol/agent-memories-v1";
import { TEAM_CAPABILITIES_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import {
  decodeTeamProtocolV2Json,
  decodeTeamProtocolV2RpcFrame,
  encodeTeamProtocolV2Frame,
} from "@openbot/contracts/team-protocol/v2";
import { decodeTeamProtocolV3CurrentHttpResponse } from "@openbot/contracts/team-protocol/v3-adapter";
import { sourceText } from "@openbot/i18n/source";
import {
  type AgentMemoriesRequest,
  setAgentMemoryInclusion as changeInclusion,
  readAgentMemories,
  readAgentMemorySelection,
  TeamRequestError,
} from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import agentFixture from "../../packages/contracts/src/team-protocol/fixtures/v4/host-http-response.json";
import { AgentMemorySelectionError } from "../backend/agent-memory-store";
import { createAgents, createTeamApiFixture, stopTeamApiFixtures } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

const source = agentFixture[0];
if (!isAgentSummary(source)) throw new Error("Invalid agent fixture.");
const visible = { ...source, id: "chief", provider: "codex", model: "gpt-5" } as const;

function memory(index: number): AgentMemory {
  return {
    id: `memory-${String(index).padStart(5, "0")}`,
    agentId: visible.id,
    text: `Memory ${index} ${"\u0001".repeat(480)}`,
    origin: "manual",
    sourceTurnId: null,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
  };
}

describe("agent memory pages", () => {
  it("reads 10,000 memories in bounded frames, keeps stable cursors during edits, and supports old hosts", async () => {
    const { start, signIn } = await createTeamApiFixture("memory-pages", { configure: true });
    const memories = Array.from({ length: 10_000 }, (_, index) => memory(index));
    const { base } = await start({
      agents: createAgents({ listAgents: () => [visible], listMemories: () => [...memories].reverse() }),
    });
    const token = await signIn();
    const paths: string[] = [];
    const request: AgentMemoriesRequest<TeamRequestError> = (method, path, decode, body) =>
      Effect.tryPromise({
        try: async () => {
          paths.push(path);
          const response = await fetch(`${base}${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              [TEAM_PROTOCOL_VERSION_HEADER]: "3",
              [TEAM_CAPABILITIES_HEADER]: AGENT_MEMORIES_CAPABILITY,
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          expect(response.status).toBe(200);
          const result = decodeTeamProtocolV2Json(await response.json());
          const frame = encodeTeamProtocolV2Frame({ version: 2, type: "response", requestId: "page", result });
          expect(decodeTeamProtocolV2RpcFrame(frame)).toMatchObject({ result });
          const decoded = decode(
            path === AGENT_MEMORIES_PAGE_ROUTE
              ? result
              : decodeTeamProtocolV3CurrentHttpResponse(method, path, response.status, result),
          );
          if (paths.length === 1) {
            // Remove the cursor entry, and edit a later entry. Neither must skip the next page.
            memories.splice(AGENT_MEMORIES_PAGE_SIZE - 1, 1);
            const later = memories.at(-1);
            if (later) {
              later.text = "Updated during paging";
              later.updatedAt = "2026-10-09T01:00:00.000Z";
            }
          }
          return decoded;
        },
        catch: (cause) => new TeamRequestError({ cause }),
      });
    const result = await Effect.runPromise(readAgentMemories(request, visible.id, true));
    expect(new Set(result.map((entry) => entry.id)).size).toBe(10_000);
    expect(result).toHaveLength(10_000);
    expect(result[0]?.text).toBe("Updated during paging");
    expect(paths).toHaveLength(Math.ceil(10_000 / AGENT_MEMORIES_PAGE_SIZE));
    expect(paths.every((path) => path === AGENT_MEMORIES_PAGE_ROUTE)).toBe(true);
    // The original route remains a full list for a host without paging.
    memories.splice(1);
    paths.length = 0;
    expect(await Effect.runPromise(readAgentMemories(request, visible.id, false))).toHaveLength(1);
    expect(paths).toEqual(["/v1/agents/chief/memories"]);
  });

  it("refuses unauthenticated, hidden, missing, malformed, and unnegotiated requests", async () => {
    const { start, signIn } = await createTeamApiFixture("memory-page-access", { configure: true });
    const listMemories = vi.fn(() => []);
    const hidden = { ...visible, id: "hidden", provider: "opencode" } as const;
    const { base } = await start({ agents: createAgents({ listAgents: () => [visible, hidden], listMemories }) });
    const token = await signIn();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: "3",
      [TEAM_CAPABILITIES_HEADER]: AGENT_MEMORIES_CAPABILITY,
    };
    for (const agentId of ["hidden", "missing"]) {
      const response = await fetch(`${base}${AGENT_MEMORIES_PAGE_ROUTE}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ agentId, after: null }),
      });
      expect(response.status).toBe(404);
    }
    for (const invalid of [
      { headers: { ...headers, Authorization: "" }, body: { agentId: visible.id, after: null } },
      { headers: { ...headers, [TEAM_CAPABILITIES_HEADER]: "" }, body: { agentId: visible.id, after: null } },
      { headers, body: { agentId: visible.id, after: 1 } },
    ]) {
      const response = await fetch(`${base}${AGENT_MEMORIES_PAGE_ROUTE}`, {
        method: "POST",
        headers: invalid.headers,
        body: JSON.stringify(invalid.body),
      });
      expect(response.ok).toBe(false);
    }
    expect(listMemories).not.toHaveBeenCalled();
  });

  it("rejects a page for another agent or a cursor that does not advance", async () => {
    for (const page of [
      { memories: [{ ...memory(0), agentId: "other" }], nextCursor: null },
      { memories: [memory(0)], nextCursor: "wrong" },
      { memories: [memory(0)], nextCursor: memory(0).id },
    ]) {
      const request: AgentMemoriesRequest<TeamRequestError> = (_method, _path, decode) =>
        Effect.try({ try: () => decode(page), catch: (cause) => new TeamRequestError({ cause }) });
      await expect(Effect.runPromise(readAgentMemories(request, visible.id, true))).rejects.toThrow();
    }
  });
});

describe("agent memory selection transport", () => {
  it("reads bounded selection pages, changes selection, and disables controls for old hosts", async () => {
    const { start, signIn } = await createTeamApiFixture("memory-selection", { configure: true });
    const state: AgentMemorySelectionState = {
      selections: Array.from({ length: 512 }, (_, index) => ({
        memoryId: memory(index).id,
        inclusion: "searchable",
        userControlled: false,
        revision: 0,
      })),
      usedBytes: 50,
      budgetBytes: 8192,
    };
    const setMemoryInclusion = vi.fn((input: SetAgentMemoryInclusionInput) => {
      for (const change of input.changes) {
        const entry = state.selections.find((selection) => selection.memoryId === change.memoryId);
        if (!entry || entry.revision !== change.expectedRevision) throw new Error("Stale selection.");
        if (change.inclusion !== "automatic") entry.inclusion = change.inclusion;
        entry.userControlled = change.inclusion !== "automatic";
        entry.revision += 1;
      }
      return state;
    });
    const { base } = await start({
      agents: createAgents({ listAgents: () => [visible], getMemorySelection: () => state, setMemoryInclusion }),
    });
    const token = await signIn();
    const calls: string[] = [];
    const request: AgentMemoriesRequest<TeamRequestError> = (method, path, decode, body) =>
      Effect.tryPromise({
        try: async () => {
          calls.push(path);
          const response = await fetch(`${base}${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              [TEAM_PROTOCOL_VERSION_HEADER]: "3",
              [TEAM_CAPABILITIES_HEADER]: AGENT_MEMORIES_CAPABILITY,
            },
            body: JSON.stringify(body),
          });
          expect(response.status).toBe(200);
          const result = decodeTeamProtocolV2Json(await response.json());
          expect(
            decodeTeamProtocolV2RpcFrame(
              encodeTeamProtocolV2Frame({ version: 2, type: "response", requestId: "selection", result }),
            ),
          ).toMatchObject({ result });
          return decode(result);
        },
        catch: (cause) => new TeamRequestError({ cause }),
      });
    expect(await Effect.runPromise(readAgentMemorySelection(request, visible.id, false))).toBeNull();
    expect(calls).toEqual([]);
    expect(await Effect.runPromise(readAgentMemorySelection(request, visible.id, true))).toEqual(state);
    expect(calls).toEqual([AGENT_MEMORY_SELECTION_PAGE_ROUTE, AGENT_MEMORY_SELECTION_PAGE_ROUTE]);
    // The public helper must collect metadata again after the bounded mutation acknowledgement.
    const changed = await Effect.runPromise(
      changeInclusion(request, {
        agentId: visible.id,
        changes: [{ memoryId: memory(0).id, inclusion: "essential", expectedRevision: 0 }],
      }),
    );
    expect(changed.selections[0]).toMatchObject({ inclusion: "essential", userControlled: true, revision: 1 });
    expect(setMemoryInclusion).toHaveBeenCalledOnce();
    const released = await Effect.runPromise(
      changeInclusion(request, {
        agentId: visible.id,
        changes: [{ memoryId: memory(0).id, inclusion: "automatic", expectedRevision: 1 }],
      }),
    );
    expect(released.selections[0]).toMatchObject({ inclusion: "essential", userControlled: false, revision: 2 });
  });

  it("blocks metadata reads and writes for hidden agents, missing authentication, and invalid changes", async () => {
    const { start, signIn } = await createTeamApiFixture("memory-selection-access", { configure: true });
    const getMemorySelection = vi.fn();
    const setMemoryInclusion = vi.fn();
    const { base } = await start({
      agents: createAgents({
        listAgents: () => [visible, { ...visible, id: "hidden", provider: "opencode" }],
        getMemorySelection,
        setMemoryInclusion,
      }),
    });
    const token = await signIn();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      [TEAM_PROTOCOL_VERSION_HEADER]: "3",
      [TEAM_CAPABILITIES_HEADER]: AGENT_MEMORIES_CAPABILITY,
    };
    for (const path of [AGENT_MEMORY_SELECTION_PAGE_ROUTE, AGENT_MEMORY_INCLUSION_ROUTE]) {
      const body = {
        agentId: "hidden",
        after: null,
        changes: [{ memoryId: "memory", inclusion: "essential", expectedRevision: 0 }],
      };
      expect((await fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) })).status).toBe(404);
      expect(
        (
          await fetch(`${base}${path}`, {
            method: "POST",
            headers: { ...headers, Authorization: "" },
            body: JSON.stringify({ ...body, agentId: visible.id }),
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await fetch(`${base}${path}`, {
            method: "POST",
            headers: { ...headers, [TEAM_CAPABILITIES_HEADER]: "" },
            body: JSON.stringify({ ...body, agentId: visible.id }),
          })
        ).ok,
      ).toBe(false);
    }
    for (const changes of [
      [],
      [{ memoryId: "memory", inclusion: "essential", expectedRevision: -1 }],
      [
        { memoryId: "memory", inclusion: "essential", expectedRevision: 0 },
        { memoryId: "memory", inclusion: "searchable", expectedRevision: 0 },
      ],
    ]) {
      expect(
        (
          await fetch(`${base}${AGENT_MEMORY_INCLUSION_ROUTE}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ agentId: visible.id, changes }),
          })
        ).status,
      ).toBe(400);
    }
    expect(getMemorySelection).not.toHaveBeenCalled();
    expect(setMemoryInclusion).not.toHaveBeenCalled();
  });

  it("rejects another owner's selection, invalid budget, and repeated metadata cursors", async () => {
    const selection = { memoryId: "memory-0", inclusion: "searchable", userControlled: false, revision: 0 };
    for (const page of [
      { agentId: "other", selections: [selection], usedBytes: 50, budgetBytes: 8192, nextCursor: null },
      { agentId: visible.id, selections: [selection], usedBytes: 8193, budgetBytes: 8192, nextCursor: null },
      { agentId: visible.id, selections: [selection], usedBytes: 50, budgetBytes: 8192, nextCursor: "wrong" },
      { agentId: visible.id, selections: [selection], usedBytes: 50, budgetBytes: 8192, nextCursor: "memory-0" },
    ]) {
      const request: AgentMemoriesRequest<TeamRequestError> = (_method, _path, decode) =>
        Effect.try({ try: () => decode(page), catch: (cause) => new TeamRequestError({ cause }) });
      await expect(Effect.runPromise(readAgentMemorySelection(request, visible.id, true))).rejects.toThrow();
    }
  });
});

it("reports expected prompt-budget errors on selection and legacy text edits", async () => {
  const { start, signIn } = await createTeamApiFixture("memory-selection-budget", { configure: true });
  const fail = () => {
    throw new AgentMemorySelectionError({ code: "budget", message: sourceText("error.backend.memoryEssentialBudget") });
  };
  const { base } = await start({
    agents: createAgents({ listAgents: () => [visible], setMemoryInclusion: fail, updateMemory: fail }),
  });
  const token = await signIn();
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: "3",
    [TEAM_CAPABILITIES_HEADER]: AGENT_MEMORIES_CAPABILITY,
  };
  for (const [method, path, body] of [
    [
      "POST",
      AGENT_MEMORY_INCLUSION_ROUTE,
      { agentId: visible.id, changes: [{ memoryId: "memory", inclusion: "essential", expectedRevision: 0 }] },
    ],
    ["PATCH", `/v1/agents/${visible.id}/memories/memory`, { text: "Updated memory" }],
  ] as const) {
    const response = await fetch(`${base}${path}`, { method, headers, body: JSON.stringify(body) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: sourceText("error.backend.memoryEssentialBudget") });
  }
});
