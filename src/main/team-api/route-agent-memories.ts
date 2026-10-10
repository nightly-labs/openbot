// One agent's memories: the standing notes it carries into every turn.
//
// `memoryId` is decoded by `pathIdentifier` on the first line of the parametric branch, before any
// method is matched, so a malformed id is a 400 and not a 404. That ordering is the released
// behaviour and the status-contract test pins it.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_MEMORIES_CAPABILITY,
  AGENT_MEMORIES_PAGE_ROUTE,
  AGENT_MEMORIES_PAGE_SIZE,
  AGENT_MEMORY_INCLUSION_ROUTE,
  AGENT_MEMORY_SELECTION_PAGE_ROUTE,
} from "@openbot/contracts/team-protocol/agent-memories-v1";
import { sourceText } from "@openbot/i18n/source";
import { parseSetAgentMemoryInclusion } from "../ipc/agent-inputs";
import type { TeamApiAgents } from "./dependencies";
import { HttpError } from "./http-error";
import type { AgentRouteTarget, RouteOutcome, TeamApiRequestContext } from "./request-context";
import { pathIdentifier, readJson, stringField } from "./request-helpers";

export interface AgentMemoryRouteDependencies {
  agents: Pick<TeamApiAgents, "listMemories" | "createMemory" | "updateMemory" | "deleteMemory" | "clearMemories">;
}

export async function routeAgentMemories(
  context: TeamApiRequestContext,
  { agentId, action }: AgentRouteTarget,
  { agents }: AgentMemoryRouteDependencies,
): Promise<RouteOutcome> {
  const { method, request, json, empty } = context;

  if (action === "memories") {
    if (method === "GET") {
      return json(200, agents.listMemories(agentId));
    }
    if (method === "POST") {
      const body = await readJson(request);
      return json(
        201,
        agents.createMemory({
          agentId,
          text: stringField(body, "text", false, INPUT_LIMITS.agentMemoryText),
        }),
      );
    }
    if (method === "DELETE") {
      agents.clearMemories(agentId);
      return empty(204);
    }
  }
  const memoryMatch = action.match(/^memories\/([^/]+)$/);
  if (memoryMatch) {
    const memoryId = pathIdentifier(memoryMatch[1], "memoryId");
    if (method === "PATCH") {
      const body = await readJson(request);
      return json(
        200,
        agents.updateMemory({
          agentId,
          memoryId,
          text: stringField(body, "text", false, INPUT_LIMITS.agentMemoryText),
        }),
      );
    }
    if (method === "DELETE") {
      agents.deleteMemory({ agentId, memoryId });
      return empty(204);
    }
  }

  return "unmatched";
}

/** A separate optional route keeps the released full-list response unchanged. */
export async function routeAgentMemoryPage(
  context: TeamApiRequestContext,
  agents: Pick<TeamApiAgents, "listMemories" | "listAgents" | "getMemorySelection" | "setMemoryInclusion">,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, request, json } = context;
  if (
    method !== "POST" ||
    ![AGENT_MEMORIES_PAGE_ROUTE, AGENT_MEMORY_SELECTION_PAGE_ROUTE, AGENT_MEMORY_INCLUSION_ROUTE].includes(
      url.pathname,
    ) ||
    !capabilities.has(AGENT_MEMORIES_CAPABILITY)
  )
    return "unmatched";
  const body = await readJson(request);
  const agentId = stringField(body, "agentId");

  if (hiddenAgentIds.has(agentId) || !agents.listAgents().some((agent) => agent.id === agentId))
    throw new HttpError(404, sourceText("error.team.agentNotFound"));
  if (url.pathname === AGENT_MEMORY_INCLUSION_ROUTE) {
    let input: ReturnType<typeof parseSetAgentMemoryInclusion>;
    try {
      input = parseSetAgentMemoryInclusion(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid memory inclusion request.");
    }
    agents.setMemoryInclusion(input);
    return json(200, {});
  }
  const after = body.after === null ? null : stringField(body, "after");
  if (url.pathname === AGENT_MEMORY_SELECTION_PAGE_ROUTE) {
    const state = agents.getMemorySelection(agentId);
    const remaining = state.selections
      .filter((entry) => after === null || entry.memoryId > after)
      .sort((left, right) => (left.memoryId < right.memoryId ? -1 : left.memoryId > right.memoryId ? 1 : 0));
    const selections = remaining.slice(0, AGENT_MEMORIES_PAGE_SIZE);
    return json(200, {
      agentId,
      selections,
      usedBytes: state.usedBytes,
      budgetBytes: state.budgetBytes,
      nextCursor: remaining.length > selections.length ? (selections.at(-1)?.memoryId ?? null) : null,
    });
  }
  const remaining = agents
    .listMemories(agentId)
    .filter((memory) => after === null || memory.id > after)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const memories = remaining.slice(0, AGENT_MEMORIES_PAGE_SIZE);
  return json(200, {
    memories,
    nextCursor: remaining.length > memories.length ? (memories.at(-1)?.id ?? null) : null,
  });
}
