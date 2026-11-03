// The instruction file at the root of an agent's workspace. On a joined server the host reads and
// saves it through `agent-instructions-v1`, and the host answers only an owner or admin.

import { parseSaveAgentInstructionsInput } from "@openbot/contracts/ipc";
import {
  AGENT_INSTRUCTIONS_CAPABILITY,
  AGENT_INSTRUCTIONS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-instructions-v1";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import { sourceText } from "@openbot/i18n/source";
import type { Effect } from "effect";
import { shell } from "electron";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AgentInstructionsFiles } from "../agent-instructions-files";
import { decodeRemoteAgentInstructionsFile } from "../remote-agent-decoding";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";
import { parseAgentId } from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler } from "./scoped-handler";

interface AgentInstructionsRemoteServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

export interface AgentInstructionsIpcDependencies {
  files: AgentInstructionsFiles;
  remoteServers: AgentInstructionsRemoteServers;
}

export function agentInstructionsIpcHandlers({
  files,
  remoteServers,
}: AgentInstructionsIpcDependencies): Pick<IpcGroupHandlers, "agentInstructions"> {
  function remote(serverId: string, path: string, body: unknown) {
    if (!remoteServers.supportsCapability(serverId, AGENT_INSTRUCTIONS_CAPABILITY))
      throw new Error(sourceText("error.team.agentInstructionsUnsupported"));
    return runCauseEffect(
      remoteServers.request(serverId, path, decodeRemoteAgentInstructionsFile, { method: "POST", body }),
    );
  }

  return {
    agentInstructions: {
      readAgentInstructions: scopedHandler(parseAgentId, {
        local: (agentId) => files.read(agentId),
        remote: (agentId, serverId) => remote(serverId, AGENT_INSTRUCTIONS_ROUTES.read, { agentId }),
      }),
      saveAgentInstructions: scopedHandler(parseSaveAgentInstructionsInput, {
        local: (input) => files.save(input),
        remote: (input, serverId) => remote(serverId, AGENT_INSTRUCTIONS_ROUTES.save, input),
      }),
      revealAgentInstructions: payloadHandler(parseAgentId, async (agentId) => {
        shell.showItemInFolder(await files.revealPath(agentId));
      }),
    },
  };
}
