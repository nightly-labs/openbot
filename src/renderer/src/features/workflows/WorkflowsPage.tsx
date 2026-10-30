import { WORKFLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-v1";
import { WorkflowCanvas } from "@openbot/ui/features/workflows/WorkflowCanvas";
import {
  WORKFLOW_FEATURES_V1,
  type WorkflowCatalogs,
  type WorkflowFeatures,
} from "@openbot/ui/features/workflows/workflow-model";
import { useText } from "@openbot/ui/text";
import { createMemo, Show, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { serverRoleCanAdminister, serverSupportsCapability } from "../servers/server-capabilities";
import { useServers } from "../servers/servers-context";
import { createWorkflowsController } from "./workflows-controller";
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
        <WorkflowsCanvas host={desktopWorkflowHost(serverId, server)} admin={serverRoleCanAdminister(server())} />
      )}
    </Show>
  );
}

/** `admin`: an owner or admin of the server, who may make a webhook secret. The host checks it again. */
function WorkflowsCanvas(props: { host: WorkflowHost; admin: boolean }) {
  const { agentList, agentStatus, modelOptions } = useAgents();
  const { signedInAccount } = useAuth();
  // The keyed parent mounts a new canvas for each server, so the host does not change.
  const workflows = createWorkflowsController(
    untrack(() => props.host),
    () => desktopAnalytics.scope(),
  );
  const catalogs: WorkflowCatalogs = {
    get agents() {
      return agentList();
    },
    get models() {
      return modelOptions();
    },
    get status() {
      return agentStatus();
    },
    get places() {
      return workflows.places();
    },
    imageModels: [],
    files: [],
    get self() {
      return signedInAccount()?.name ?? undefined;
    },
  };
  // A channel output needs a messaging place. Without one, a new output posts a notification.
  const features = createMemo<WorkflowFeatures>(() =>
    workflows.places().length > 0
      ? WORKFLOW_FEATURES_V1
      : { ...WORKFLOW_FEATURES_V1, outputs: WORKFLOW_FEATURES_V1.outputs.filter((output) => output !== "channel") },
  );
  // The canvas is a direct child of the window page, which gives it the height of the pane.
  return (
    <Show when={workflows.detail()}>
      {(workflow) => (
        <WorkflowCanvas
          workflow={workflow()}
          features={features()}
          catalogs={catalogs}
          frame="window"
          readOnly={workflows.readOnly()}
          {...workflows.props}
          onRotateWebhookSecret={props.admin ? workflows.props.onRotateWebhookSecret : undefined}
        />
      )}
    </Show>
  );
}
