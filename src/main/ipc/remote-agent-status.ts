import { type AgentStatus, decodeProviderModelSources, withModelSources } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import type { TeamCurrentCapability } from "@openbot/contracts/team-protocol/current";
import {
  PROVIDER_MODEL_SOURCE_CAPABILITY,
  PROVIDER_MODEL_SOURCE_ROUTES,
} from "@openbot/contracts/team-protocol/provider-model-source-v1";
import { Effect } from "effect";
import { decodeAgentStatusFromHost } from "../remote-agent-decoding";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteRequestInit } from "../remote-server-client";
import type { RemoteWorkflowError } from "../remote-service-effects";

/** The part of the remote server manager that reads a joined server's status. */
export interface RemoteStatusServers {
  supportsCapability(serverId: string, capability: TeamCurrentCapability): boolean;
  request<T>(
    serverId: string,
    path: string,
    decoder: ResponseDecoder<T>,
    init?: RemoteRequestInit,
  ): Effect.Effect<T, RemoteWorkflowError>;
}

/**
 * A joined server's status, as the local `AgentStatus`. Every remote status read uses it, so a
 * provider change on a joined server returns the same rows that `agent.getStatus` gives.
 *
 * `provider-model-source-v1` says where a provider's models come from, such as the Ollama models of a
 * Codex that its settings point to Ollama (#9956). A host without it, or a failed read, leaves the rows
 * as they are: the picker then shows no source.
 */
export const readRemoteAgentStatus = Effect.fn("RemoteAgentStatus.read")(function* (
  remoteServers: RemoteStatusServers,
  serverId: string,
) {
  const status = remoteServers.request(serverId, TEAM_API_ROUTES.agents.status, decodeAgentStatusFromHost);
  const sources = remoteServers.supportsCapability(serverId, PROVIDER_MODEL_SOURCE_CAPABILITY)
    ? remoteServers
        .request(serverId, PROVIDER_MODEL_SOURCE_ROUTES.list, decodeProviderModelSources, { method: "POST", body: {} })
        .pipe(Effect.orElseSucceed(() => []))
    : Effect.succeed([]);
  const [rows, listed] = yield* Effect.all([status, sources], { concurrency: "unbounded" });
  return withModelSources(rows, listed) satisfies AgentStatus;
});
