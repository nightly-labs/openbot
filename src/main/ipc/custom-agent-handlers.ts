import { Effect, Semaphore } from "effect";

// The user's own ACP agents: list, save, delete, check and the answers to their usage prompts. An
// owner or admin of a joined server lists, saves and deletes the host's agents through
// `custom-agents-v1`. That contract keeps the trial start and the usage answers on the host's own
// computer, so `check` and `usage` reach this computer only. `custom-agent-changes.ts` owns the
// order of the writes.

import {
  type CustomAgentResult,
  type CustomAgentSummary,
  isCustomAgentResult,
  isCustomAgentSummary,
} from "@openbot/contracts/ipc";
import { CUSTOM_AGENTS_CAPABILITY, CUSTOM_AGENTS_ROUTES } from "@openbot/contracts/team-protocol/custom-agents-v1";
import { sourceText } from "@openbot/i18n/source";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { CustomAgentChanges } from "../custom-agent-changes";
import type { ResponseDecoder } from "../remote-host-decoding";
import type { RemoteServerManager } from "../remote-server-manager";
import { parseCheckCustomAgent, parseDeleteCustomAgent, parseSaveCustomAgent } from "./custom-agent-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { scopedHandler, scopedQueryHandler } from "./scoped-handler";

export interface CustomAgentIpcDependencies {
  changes: CustomAgentChanges;
  remoteServers: Pick<RemoteServerManager, "request" | "supportsCapability">;
}

export function customAgentIpcHandlers({
  changes,
  remoteServers,
}: CustomAgentIpcDependencies): Pick<IpcGroupHandlers, "customAgents"> {
  /**
   * One check at a time. A check starts a program and waits up to 20 seconds for its answer and 10
   * more for its models, so a renderer that sent many at once would start many; the next one waits
   * for the one before.
   */
  const checks = Semaphore.makeUnsafe(1);
  /** The renderer offers the host's agents only while the host serves `custom-agents-v1`. */
  function remote<T>(serverId: string, path: string, body: unknown, decoder: ResponseDecoder<T>): Promise<T> {
    if (!remoteServers.supportsCapability(serverId, CUSTOM_AGENTS_CAPABILITY))
      throw new Error(sourceText("error.provider.customAgentsUnavailable"));
    return runCauseEffect(remoteServers.request(serverId, path, decoder, { method: "POST", body }));
  }
  return {
    customAgents: {
      list: scopedQueryHandler({
        local: () => Effect.runPromise(changes.list()),
        remote: (serverId) => remote(serverId, CUSTOM_AGENTS_ROUTES.list, {}, decodeRemoteCustomAgents),
      }),
      usage: handler(() => Effect.runPromise(changes.usage())),
      save: scopedHandler(parseSaveCustomAgent, {
        local: (input) => runCauseEffect(changes.save(input)),
        remote: (input, serverId) => remote(serverId, CUSTOM_AGENTS_ROUTES.save, input, decodeRemoteCustomAgentResult),
      }),
      delete: scopedHandler(parseDeleteCustomAgent, {
        local: ({ id }) => runCauseEffect(changes.remove(id)),
        remote: ({ id }, serverId) =>
          remote(serverId, CUSTOM_AGENTS_ROUTES.delete, { id }, decodeRemoteCustomAgentResult),
      }),
      check: payloadHandler(parseCheckCustomAgent, (input) => {
        return runCauseEffect(checks.withPermit(changes.check(input)));
      }),
    },
  };
}

/** The transport has already run the response through the `custom-agents-v1` codec. */
function decodeRemoteCustomAgents(value: unknown): CustomAgentSummary[] {
  if (!Array.isArray(value) || !value.every(isCustomAgentSummary)) throw new Error("Invalid custom agent list.");
  return value;
}

function decodeRemoteCustomAgentResult(value: unknown): CustomAgentResult {
  if (!isCustomAgentResult(value)) throw new Error("Invalid custom agent response.");
  return value;
}
