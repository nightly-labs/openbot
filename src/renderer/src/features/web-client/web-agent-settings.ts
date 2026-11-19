import {
  type AgentEvent,
  type AgentMemory,
  decodeAgentInstructionsFileFromMain,
  isAgentMemory,
  type TeamRealtimeEvent,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_INSTRUCTIONS_ROUTES } from "@openbot/contracts/team-protocol/agent-instructions-v1";
import { AGENT_MEMORIES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memories-v1";
import { runTeamEffect } from "@openbot/team-client";
import {
  addAgentFolder,
  browseAgentFolders,
  excludeAgentFolder,
  getHostAgentMemoryLimit,
  getRoutineResultDestination,
  includeAgentFolder,
  listRoutineResultOptions,
  readAgentFolders,
  removeAgentFolder,
  setRoutineResultDestination,
} from "@openbot/team-client/team-admin-requests";
import {
  type AgentMemoriesRequest,
  readAgentMemories,
  readAgentMemorySelection,
  setAgentMemoryInclusion,
  type TeamApiRequest,
} from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import type { AgentFoldersApi, AgentInstructionsApi } from "../conversation/agent-folders-port";
import type { AgentMemoriesApi } from "../conversation/memories-port";
import type { RoutineResultsCalls } from "../conversation/routines-port";

type HostEvents = (listener: (event: AgentEvent | TeamRealtimeEvent) => void) => () => void;

function run<T, E extends { cause: unknown }>(effect: Effect.Effect<T, E>): Promise<T> {
  return runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));
}

function decodeMemory(value: unknown): AgentMemory {
  if (!isAgentMemory(value)) throw new Error("Invalid agent memory.");
  return value;
}

export function webAgentMemoriesApi(
  request: () => TeamApiRequest,
  onHostEvent: HostEvents | undefined,
  hasCapability: (capability: string) => boolean,
): AgentMemoriesApi {
  const memoryRequest: AgentMemoriesRequest<unknown> = (method, path, decode, body) =>
    Effect.tryPromise({ try: () => request()(method, path, decode, body), catch: (cause) => cause });
  const paged = () => hasCapability(AGENT_MEMORIES_CAPABILITY);
  return {
    listMemories: (agentId) => runTeamEffect(readAgentMemories(memoryRequest, agentId, paged())),
    getMemorySelection: (agentId) => runTeamEffect(readAgentMemorySelection(memoryRequest, agentId, paged())),
    setMemoryInclusion: (input) => runTeamEffect(setAgentMemoryInclusion(memoryRequest, input)),
    createMemory: ({ agentId, text }) =>
      request()("POST", TEAM_API_ROUTES.agent.memories(agentId), decodeMemory, { text }),
    updateMemory: ({ agentId, memoryId, text }) =>
      request()("PATCH", TEAM_API_ROUTES.agent.memory(agentId, memoryId), decodeMemory, { text }),
    deleteMemory: async ({ agentId, memoryId }) => {
      await request()("DELETE", TEAM_API_ROUTES.agent.memory(agentId, memoryId), () => undefined);
    },
    clearMemories: async (agentId) => {
      await request()("DELETE", TEAM_API_ROUTES.agent.memories(agentId), () => undefined);
    },
    onEvent: (listener) =>
      onHostEvent?.((event) => {
        if (event.type === "memories-changed") listener(event);
      }) ?? (() => {}),
  };
}

export function webAgentFoldersApi(request: () => TeamApiRequest): AgentFoldersApi {
  return {
    listAgentFolders: (agentId) => run(readAgentFolders(request(), agentId)),
    addAgentFolder: (input) => run(addAgentFolder(request(), input)),
    removeAgentFolder: (input) => run(removeAgentFolder(request(), input)),
    addAgentExclusion: (input) => run(excludeAgentFolder(request(), input)),
    removeAgentExclusion: (input) => run(includeAgentFolder(request(), input)),
    browseAgentFolders: (input) => run(browseAgentFolders(request(), input)),
  };
}

export function webAgentInstructionsApi(request: () => TeamApiRequest): AgentInstructionsApi {
  return {
    readAgentInstructions: (agentId) =>
      request()("POST", AGENT_INSTRUCTIONS_ROUTES.read, decodeAgentInstructionsFileFromMain, { agentId }),
    saveAgentInstructions: ({ agentId, text, expected }) =>
      request()("POST", AGENT_INSTRUCTIONS_ROUTES.save, decodeAgentInstructionsFileFromMain, {
        agentId,
        text,
        expected,
      }),
  };
}

export function webRoutineResultsCalls(request: () => TeamApiRequest): RoutineResultsCalls {
  return {
    options: () => run(listRoutineResultOptions(request())),
    destination: (input) => run(getRoutineResultDestination(request(), input)),
    setDestination: (input) => run(setRoutineResultDestination(request(), input)),
  };
}

export function webAgentMemoryLimit(request: () => TeamApiRequest): () => Promise<number> {
  return async () => (await run(getHostAgentMemoryLimit(request()))).limit;
}
