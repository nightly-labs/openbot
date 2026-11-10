import { WorkflowCanvas } from "@openbot/ui/features/workflows/WorkflowCanvas";
import {
  WORKFLOW_FEATURES_V1,
  type WorkflowCatalogs,
  type WorkflowFeatures,
} from "@openbot/ui/features/workflows/workflow-model";
import { createMemo, Show, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { createWorkflowsController } from "./workflows-controller";
import type { WorkflowHost } from "./workflows-port";

/**
 * The workflows of one host on a canvas. The desktop app and the browser app give the agents, models,
 * provider status and account name of that host. `admin`: an owner or admin of the server, who may
 * make a webhook secret. The host checks it again.
 */
export function WorkflowsCanvas(props: {
  host: WorkflowHost;
  admin: boolean;
  agents: WorkflowCatalogs["agents"];
  models: WorkflowCatalogs["models"];
  status: WorkflowCatalogs["status"];
  self?: WorkflowCatalogs["self"];
}) {
  // The keyed parent mounts a new canvas for each server, so the host does not change.
  const workflows = createWorkflowsController(
    untrack(() => props.host),
    () => desktopAnalytics.scope(),
  );
  const catalogs: WorkflowCatalogs = {
    get agents() {
      return props.agents;
    },
    get models() {
      return props.models;
    },
    get status() {
      return props.status;
    },
    get places() {
      return workflows.places();
    },
    get discord() {
      return workflows.discord();
    },
    get telegram() {
      return workflows.telegram();
    },
    get slack() {
      return workflows.slack();
    },
    get channels() {
      return workflows.channels();
    },
    imageModels: [],
    files: [],
    get self() {
      return props.self;
    },
  };
  // A channel output needs a messaging place or an OpenBot channel. Without one, a new output posts a
  // notification. Only an owner or admin adds a GitHub, Discord, Telegram or Slack step, on a host that
  // runs them. The host port gives a joined server's places, channels, Telegram chats and Slack
  // workspaces only to an owner or admin, and only this computer has Discord servers.
  const features = createMemo<WorkflowFeatures>(() => {
    const github = props.admin && props.host.githubSupported();
    const discord = props.admin && workflows.discord().length > 0;
    const telegram = props.admin && workflows.telegram().length > 0;
    const slack = props.admin && workflows.slack().length > 0;
    const outputs = [
      ...WORKFLOW_FEATURES_V1.outputs.filter((output) => output !== "channel" || workflows.places().length > 0),
      ...(workflows.channels().length > 0 ? (["chat-channel"] as const) : []),
    ];
    const added = [
      ...(github ? (["github"] as const) : []),
      ...(discord ? (["discord"] as const) : []),
      ...(telegram ? (["telegram"] as const) : []),
      ...(slack ? (["slack"] as const) : []),
    ];
    return {
      ...WORKFLOW_FEATURES_V1,
      triggers: [...WORKFLOW_FEATURES_V1.triggers, ...added],
      outputs: [...outputs, ...added],
    };
  });
  // The canvas is a direct child of the window page, which gives it the height of the pane.
  return (
    <Show when={workflows.detail()}>
      {(workflow) => (
        <WorkflowCanvas
          workflow={workflow()}
          features={features()}
          catalogs={catalogs}
          github={workflows.github}
          frame="window"
          readOnly={workflows.readOnly()}
          {...workflows.props}
          onRotateWebhookSecret={props.admin ? workflows.props.onRotateWebhookSecret : undefined}
        />
      )}
    </Show>
  );
}
