import { WORKFLOW_MEDIA_MODELS } from "@openbot/contracts/ipc";
import { providerAvailability, providerTurnedOff } from "@openbot/ui/components/provider-model-options";
import { WorkflowCanvas } from "@openbot/ui/features/workflows/WorkflowCanvas";
import {
  WORKFLOW_FEATURES_V1,
  type WorkflowCatalogs,
  type WorkflowFeatures,
} from "@openbot/ui/features/workflows/workflow-model";
import { currentText } from "@openbot/ui/text";
import { createMemo, Show, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { createWorkflowsController, type WorkflowRequest } from "./workflows-controller";
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
  /** The workflow to open, such as the one of a clicked notification. Without it, the first one opens. */
  request?: WorkflowRequest | undefined;
}) {
  // The keyed parent mounts a new canvas for each server, so the host does not change.
  const workflows = createWorkflowsController(
    untrack(() => props.host),
    () => desktopAnalytics.scope(),
    untrack(() => props.request),
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
    // Only the models of a provider that is on and signed in now. The host makes the file with that
    // subscription, or with the provider's API key when it uses one.
    get imageModels() {
      if (!props.host.mediaSupported()) return [];
      return WORKFLOW_MEDIA_MODELS.flatMap((model) => {
        if (providerTurnedOff(props.status, model.provider)) return [];
        const status = providerAvailability(props.status, props.models, model.provider, currentText().t);
        if (status.state !== "available") return [];
        return [{ ...model, ...(status.apiKeyInUse ? { apiKey: true } : {}) }];
      });
    },
    get media() {
      return props.host.mediaSupported() ? props.host.mediaUrl : undefined;
    },
    // The Library pictures that an asset step can use. A picture with no preview address, as the
    // browser gets, reads its file only when the canvas shows it.
    get files() {
      return workflows.pictures().map((file) =>
        file.previewUrl
          ? file
          : {
              ...file,
              get previewUrl() {
                return props.host.mediaUrl(file.id, "image") ?? null;
              },
            },
      );
    },
    get upload() {
      return props.host.mediaSupported() ? workflows.uploadPicture : undefined;
    },
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
    const media = props.host.mediaSupported();
    return {
      ...WORKFLOW_FEATURES_V1,
      // An asset step uses a picture of the host's Library, or one that the person sends to the host.
      kinds: media ? [...WORKFLOW_FEATURES_V1.kinds, "image", "asset"] : WORKFLOW_FEATURES_V1.kinds,
      uploads: media,
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
