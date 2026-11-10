// An InstanceTransferService for the e2e scripts that move transfer files: an empty instance, or
// agents that have only workspace files. Every other boundary call fails.

import { dirname, join } from "node:path";
import { Effect } from "effect";
import { type InstanceTransferOptions, InstanceTransferService } from "../src/main/instance-transfer-service";
import { LocalSkillFailure } from "../src/main/local-skill-library";
import { SkillMarketplaceFailure } from "../src/main/skill-marketplace-service";

function unexpected(operation: string): Error {
  return new Error(`Unexpected boundary call: ${operation}`);
}

type AgentSummary = ReturnType<InstanceTransferOptions["agents"]["listAgents"]>[number];

export function emptyInstanceTransferService(
  uploadDirectory: string,
  /** Agents with no routines, memories or avatar, that an export reads. */
  exported: readonly AgentSummary[] = [],
): InstanceTransferService {
  /** An empty answer for an agent of `exported`; any other agent is a boundary call that must not happen. */
  const forExported =
    <T>(operation: string, value: T) =>
    (agentId: string): T => {
      if (exported.some((agent) => agent.id === agentId)) return value;
      throw unexpected(operation);
    };
  const agents: InstanceTransferOptions["agents"] = {
    listAgents: () => [...exported],
    listRoutines: forExported("listRoutines", []),
    listMemories: forExported("listMemories", []),
    getMemorySelection: forExported("getMemorySelection", { selections: [] }),
    setMemoryInclusion: (_input) => {
      throw unexpected("setMemoryInclusion");
    },
    resolveAvatar: forExported("resolveAvatar", null),
    listModels: () => {
      throw unexpected("listModels");
    },
    createAgentProfile: (_input) => Effect.fail(unexpected("createAgentProfile")),
    updateAgent: (_input) => Effect.fail(unexpected("updateAgent")),
    createRoutine: (_input, _options) => {
      throw unexpected("createRoutine");
    },
    createMemory: (_input) => {
      throw unexpected("createMemory");
    },
    memoryLimit: () => {
      throw unexpected("memoryLimit");
    },
    initializeMemorySelection: (_agentId) => {
      throw unexpected("initializeMemorySelection");
    },
    setAvatar: (_agentId, _image) => Effect.fail(unexpected("setAvatar")),
    deleteAgent: (_agentId) => Effect.fail(unexpected("deleteAgent")),
    setAgentHidden: (_input) => Effect.fail(unexpected("setAgentHidden")),
    readTransferHistory: (_agentId) => {
      throw unexpected("readTransferHistory");
    },
    resolveTransferFile: (_attachmentId) => Effect.die(unexpected("resolveTransferFile")),
    importTransferHistory: (_input, _readerId) => Effect.die(unexpected("importTransferHistory")),
    channels: {
      store: {
        ids: () => [],
        get: (_channelId) => {
          throw unexpected("channels.get");
        },
        messages: (_channelId) => {
          throw unexpected("channels.messages");
        },
        update: (_channel, _changes) => {
          throw unexpected("channels.update");
        },
      },
      images: {
        resolve: (_channel) => {
          throw unexpected("channels.images.resolve");
        },
      },
      command: (_command, _actor) => Effect.fail(unexpected("channels.command")),
      setImage: (_channelId, _image) => Effect.fail(unexpected("channels.setImage")),
    },
    listChannelMemories: (_channelId) => {
      throw unexpected("listChannelMemories");
    },
    listChannelRoutines: (_channelId) => {
      throw unexpected("listChannelRoutines");
    },
    createChannelMemory: (_input) => {
      throw unexpected("createChannelMemory");
    },
    createChannelRoutine: (_input) => {
      throw unexpected("createChannelRoutine");
    },
    deleteChannel: (_channelId) => Effect.fail(unexpected("deleteChannel")),
  };
  const library: ReturnType<InstanceTransferOptions["skills"]["library"]> = {
    list: () => Effect.fail(new LocalSkillFailure({ cause: unexpected("library.list") })),
    create: (_agentId, _folder) => Effect.fail(new LocalSkillFailure({ cause: unexpected("library.create") })),
    revise: (_agentId, _id, _revision, _folder) =>
      Effect.fail(new LocalSkillFailure({ cause: unexpected("library.revise") })),
    withdraw: (_id, _revision) => Effect.fail(new LocalSkillFailure({ cause: unexpected("library.withdraw") })),
  };
  const skills: InstanceTransferOptions["skills"] = {
    library: () => library,
    installLocal: (_input) => Effect.fail(new SkillMarketplaceFailure({ cause: unexpected("installLocal") })),
  };
  const settings: InstanceTransferOptions["settings"] = {
    mcpServers: () => {
      throw unexpected("mcpServers");
    },
    saveMcpServer: (_config) => Effect.fail(unexpected("saveMcpServer")),
    customProviders: () => {
      throw unexpected("customProviders");
    },
    saveCustomProvider: (_input) => Effect.fail(unexpected("saveCustomProvider")),
    customAgents: () => Effect.fail(unexpected("customAgents")),
    providersOff: () => {
      throw unexpected("providersOff");
    },
    sidebar: () => {
      throw unexpected("sidebar");
    },
    mutateSidebar: (_action) => Effect.fail(unexpected("mutateSidebar")),
    routineFlowLinks: (_agentId) => Effect.fail(unexpected("routineFlowLinks")),
    connectRoutineFlow: (_input) => Effect.fail(unexpected("connectRoutineFlow")),
    signedInProviders: () => [],
  };
  const options: InstanceTransferOptions = {
    uploadDirectory,
    channelActor: () => ({ id: "local", name: "You" }),
    sharedRoot: join(dirname(uploadDirectory), "shared"),
    appVersion: "e2e",
    agents,
    skills,
    settings,
    timezone: () => "UTC",
  };
  return new InstanceTransferService(options);
}
