import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import { Spinner } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { useTurns } from "../../turns";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { useSetup } from "../onboarding/onboarding-context";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { usePresence } from "../team/team-context";
import { useUsage } from "../usage/usage-context";
import { WorkflowsCanvas } from "./WorkflowsCanvas";
import { workflowAgentProgress } from "./workflow-agent-progress";
import { desktopWorkflowHost, type WorkflowHost } from "./workflows-port";

export function WorkflowsPage(props: { serverId: string }) {
  const { t } = useText();
  const { servers } = useServers();
  const server = () => servers().find((entry) => entry.id === props.serverId);
  const supported = () => {
    const entry = server();
    return !entry || entry.kind === "local" || serverSupportsCapability(entry, WORKFLOWS_CAPABILITY);
  };
  const checking = () => {
    const entry = server();
    return entry?.kind === "remote" && !entry.compatibility?.hostAppVersion;
  };
  return (
    <Show
      when={supported() ? props.serverId : null}
      keyed
      fallback={
        <main class="window-page workflows-notice">
          <Show when={!checking()} fallback={<Spinner size="lg" label={t("common.loading")} />}>
            <p>{t("error.workflow.serverTooOld")}</p>
          </Show>
        </main>
      }
    >
      {(serverId) => (
        <DesktopWorkflowsCanvas
          serverId={serverId}
          host={desktopWorkflowHost(serverId, server)}
          admin={serverRoleCanAdminister(server())}
          username={server()?.username}
        />
      )}
    </Show>
  );
}

function DesktopWorkflowsCanvas(props: {
  serverId: string;
  host: WorkflowHost;
  admin: boolean;
  username: string | undefined;
}) {
  const { agentList, agentStatus, modelOptions, serverSetupChoice } = useAgents();
  const { setupState } = useSetup();
  const { signedInAccount } = useAuth();
  const { turnProgress, turnStepLines } = useTurns();
  const usage = useUsage();
  const { teamPresence, readerMemberId } = usePresence();
  const selfMemberId = () => {
    const reader = readerMemberId();
    if (reader) return reader;
    const username = props.username?.trim().toLowerCase();
    if (!username) return null;
    return teamPresence().members.find((member) => member.username.trim().toLowerCase() === username)?.id ?? null;
  };
  const request = {
    workflowId: () => {
      const requested = usage.workflowRequest();
      return requested?.serverId === props.serverId ? requested.workflowId : undefined;
    },
    taken: usage.takeWorkflowRequest,
  };
  return (
    <WorkflowsCanvas
      host={props.host}
      serverId={props.serverId}
      admin={props.admin}
      agents={agentList()}
      models={modelOptions()}
      status={agentStatus()}
      self={signedInAccount()?.name ?? undefined}
      preference={serverSetupChoice() ?? setupState()}
      request={request}
      agentProgress={(agentId) => workflowAgentProgress(agentId, turnProgress()[agentId], turnStepLines())}
      members={teamPresence().members}
      selfMemberId={selfMemberId()}
    />
  );
}
