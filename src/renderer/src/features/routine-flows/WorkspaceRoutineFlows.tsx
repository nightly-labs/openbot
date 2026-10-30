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
import { useLayout } from "../../layout";
import { useNavigation } from "../../navigation";
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
  const {
    activeAgent,
    agentList,
    modelOptions,
    agentStatus,
    serverSetupChoice,
    developmentCreation,
    setSettingsRequest,
  } = useAgents();
  const { selectAgent } = useNavigation();
  const layout = useLayout();
  const { setupState } = useSetup();
  const { customProviders } = useCustomProviders();
  const { customAgents } = useCustomAgents();
  const { activeServer } = useServers();
  const { createAgentInPlace } = useAgentActions();
  /** A new agent starts on the model the agent form would pick, and the user can change it. */
  const newAgentModels = createMemo((): DiagramModelChoice | undefined => {
    const initial = resolveCreationModel(
      serverSetupChoice() ?? setupState(),
      modelOptions(),
      agentStatus(),
      developmentCreation(),
    );
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
  /**
   * A joined server that has not answered the compatibility check yet. Each start, reconnect and wake
   * clears what it reported, so it is not an older host until it answers.
   */
  const checking = () => {
    const server = activeServer();
    return server?.kind === "remote" && !server.compatibility?.hostAppVersion;
  };
  const webhooks = () => serverCanAdminister(activeServer(), EVENTS_CAPABILITY);
  /** A routine is made in the agent's settings, so the agent's chat opens with a new routine in them. */
  function createRoutine(agentId: string): void {
    layout.setSidebarView("agents");
    selectAgent(agentId);
    setSettingsRequest({ agentId, nonce: Date.now(), routine: "new" });
  }

  return (
    <Show
      when={serverId()}
      keyed
      fallback={
        <main class="diagram-view diagram-flows-notice">
          <Show when={!checking()}>
            <p>{t("diagram.flows.unsupported")}</p>
          </Show>
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
          onCreateRoutine={createRoutine}
        />
      )}
    </Show>
  );
}
