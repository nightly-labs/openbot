/**
 * The desktop Routines view: the canvas of the open agent on the active server. This computer keeps
 * its own flows; a joined server serves them through `routine-flows-v1`, and an older one shows a
 * notice. Webhook routines change only for an account that manages the server's events.
 */

import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { ROUTINE_FLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-flows-v1";
import type { DiagramModelChoice } from "@openbot/ui/features/diagrams/DiagramNewAgentCard";
import { useText } from "@openbot/ui/text";
import { createMemo, Show } from "solid-js";
import { useAgentActions } from "../agents/agent-actions";
import { resolveCreationModel } from "../agents/agent-creation-model";
import { useAgents } from "../agents/agents-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
import { useCustomProviders } from "../custom-providers/custom-providers-context";
import { useSetup } from "../onboarding/onboarding-context";
import { serverCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { RoutineFlowsCanvas } from "./RoutineFlowsCanvas";
import { desktopRoutineFlowsHost } from "./routine-flows-port";

export function WorkspaceRoutineFlows() {
  const { t } = useText();
  const { activeAgent, agentList, modelOptions, agentStatus, serverSetupChoice } = useAgents();
  const { setupState } = useSetup();
  const { customProviders } = useCustomProviders();
  const { customAgents } = useCustomAgents();
  const { activeServer } = useServers();
  const { createAgentInPlace } = useAgentActions();
  /** A new agent starts on the model the agent form would pick, and the user can change it. */
  const newAgentModels = createMemo((): DiagramModelChoice | undefined => {
    const initial = resolveCreationModel(serverSetupChoice() ?? setupState(), modelOptions());
    return initial
      ? {
          options: modelOptions(),
          status: agentStatus(),
          initial,
          customProviders: customProviders(),
          customAgents: customAgents(),
        }
      : undefined;
  });
  /** The server whose flows the canvas shows, or null when it cannot serve them. */
  const serverId = createMemo(() => {
    const server = activeServer();
    if (!server) return "local";
    return server.kind === "local" || serverSupportsCapability(server, ROUTINE_FLOWS_CAPABILITY) ? server.id : null;
  });
  const webhooks = () => serverCanAdminister(activeServer(), EVENTS_CAPABILITY);

  return (
    <Show
      when={serverId()}
      keyed
      fallback={
        <main class="diagram-view diagram-flows-notice">
          <p>{t("diagram.flows.unsupported")}</p>
        </main>
      }
    >
      {(id) => (
        <RoutineFlowsCanvas
          host={desktopRoutineFlowsHost(id, webhooks)}
          agent={activeAgent()}
          agents={agentList()}
          newAgentModels={newAgentModels()}
          createAgent={createAgentInPlace}
        />
      )}
    </Show>
  );
}
