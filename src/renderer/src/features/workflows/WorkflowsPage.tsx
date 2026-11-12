import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { WorkflowsCanvas } from "./WorkflowsCanvas";
import { desktopWorkflowHost, type WorkflowHost } from "./workflows-port";

/**
 * The workflows of one server on a page that covers the agent list. A joined server whose OpenBot
 * does not serve `workflows-v1` shows a notice.
 */
export function WorkflowsPage(props: { serverId: string }) {
  const { t } = useText();
  const { servers } = useServers();
  const server = () => servers().find((entry) => entry.id === props.serverId);
  const supported = () => {
    const entry = server();
    return !entry || entry.kind === "local" || serverSupportsCapability(entry, WORKFLOWS_CAPABILITY);
  };
  /** A joined server that has not answered the compatibility check yet is not an older host. */
  const checking = () => {
    const entry = server();
    return entry?.kind === "remote" && !entry.compatibility?.hostAppVersion;
  };
  return (
    <Show
      when={supported() ? props.serverId : null}
      keyed
      fallback={
        <main class="window-page diagram-view diagram-flows-notice">
          <Show when={!checking()}>
            <p>{t("error.workflow.serverTooOld")}</p>
          </Show>
        </main>
      }
    >
      {(serverId) => (
        <DesktopWorkflowsCanvas
          host={desktopWorkflowHost(serverId, server)}
          admin={serverRoleCanAdminister(server())}
        />
      )}
    </Show>
  );
}

/** The canvas with the agents, models and account of the desktop app. */
function DesktopWorkflowsCanvas(props: { host: WorkflowHost; admin: boolean }) {
  const { agentList, agentStatus, modelOptions } = useAgents();
  const { signedInAccount } = useAuth();
  return (
    <WorkflowsCanvas
      host={props.host}
      admin={props.admin}
      agents={agentList()}
      models={modelOptions()}
      status={agentStatus()}
      self={signedInAccount()?.name ?? undefined}
    />
  );
}
