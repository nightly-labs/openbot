import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { ROUTINE_FLOW_STOP_CAPABILITY } from "@openbot/contracts/team-protocol/routine-flow-stop-v1";
import { ROUTINE_FLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-flows-v1";
import type { DiagramModelChoice } from "@openbot/ui/features/diagrams/DiagramNewAgentCard";
import { useText } from "@openbot/ui/text";
import { createMemo, Show } from "solid-js";
import { useLayout } from "../../layout";
import { useNavigation } from "../../navigation";
import { useProviders } from "../../providers";
import { useAgentActions } from "../agents/agent-actions";
import { resolveCreationModel } from "../agents/agent-creation-model";
import { useAgents } from "../agents/agents-context";
import { useCustomAgents } from "../custom-agents/custom-agents-context";
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
  const { activeCustomProviders } = useProviders();
  const { customAgents } = useCustomAgents();
  const { activeServer } = useServers();
  const { createAgentInPlace } = useAgentActions();
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
          customProviders: activeCustomProviders(),
          customAgents: customAgents(),
        }
      : undefined;
  });
  const serverId = createMemo(() => {
    const server = activeServer();
    if (!server) return "local";
    return server.kind === "local" || serverSupportsCapability(server, ROUTINE_FLOWS_CAPABILITY) ? server.id : null;
  });
  const checking = () => {
    const server = activeServer();
    return server?.kind === "remote" && !server.compatibility?.hostAppVersion;
  };
  const webhooks = () => serverCanAdminister(activeServer(), EVENTS_CAPABILITY);
  const stops = () => serverSupportsCapability(activeServer(), ROUTINE_FLOW_STOP_CAPABILITY);
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
          host={desktopRoutineFlowsHost(id, webhooks, stops)}
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
