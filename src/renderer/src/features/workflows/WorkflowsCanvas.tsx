import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type ProviderAccountStatus,
  WORKFLOW_MEDIA_MODELS,
  type WorkflowCatalogProvider,
  type WorkflowMediaCatalogModel,
  type WorkflowMediaModel,
  type WorkflowMediaServiceAccount,
  workflowCatalogMediaModel,
} from "@openbot/contracts/ipc";
import { providerAvailability, providerTurnedOff } from "@openbot/ui/components/provider-model-options";
import { WorkflowCanvas } from "@openbot/ui/features/workflows/WorkflowCanvas";
import {
  WORKFLOW_FEATURES_V1,
  type WorkflowCatalogs,
  type WorkflowFeatures,
} from "@openbot/ui/features/workflows/workflow-model";
import { currentText } from "@openbot/ui/text";
import { createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { mediaServiceAccountName } from "./workflow-media-credits";
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
  /** The server of the host. The page shows the workflow of its last visit while it reads the host. */
  serverId?: string | undefined;
}) {
  // The keyed parent mounts a new canvas for each server, so the host does not change.
  const workflows = createWorkflowsController(
    untrack(() => props.host),
    () => desktopAnalytics.scope(),
    untrack(() => props.request),
    untrack(() => props.serverId),
  );
  // Sunra and Higgsfield make files on the host's sign-in of that service, which the person makes in
  // Apps and finishes in the browser. The canvas reads them, and the live models of both, again when
  // the window comes back to the front. A failed read keeps the last answer.
  const [sunra, setSunra] = createSignal(false);
  const [higgsfield, setHiggsfield] = createSignal(false);
  // The accounts of both services, or null when the host makes each file on the first account.
  const [serviceAccounts, setServiceAccounts] = createSignal<readonly WorkflowMediaServiceAccount[] | null>(null);
  const [catalog, setCatalog] = createSignal<readonly WorkflowMediaCatalogModel[]>([]);
  let disposed = false;
  const readMediaProviders = () => {
    if (!props.host.mediaSupported()) return;
    void props.host.workflows
      .mediaProviders()
      .then((providers) => {
        if (disposed) return;
        setSunra(providers.sunra);
        setHiggsfield(providers.higgsfield);
        setServiceAccounts(providers.accounts);
      })
      .catch(() => undefined);
    void props.host.workflows
      .mediaCatalog()
      .then((answer) => {
        if (!disposed) setCatalog(answer.models);
      })
      .catch(() => undefined);
  };
  /**
   * The models of Sunra and Higgsfield: the live list of the host, then each fixed model that the live
   * list does not have. An older host gives no live list. The host still runs a fixed model, so a step
   * saved with one keeps its model.
   */
  const serviceModels = (provider: "sunra" | "higgsfield"): readonly WorkflowMediaModel[] => {
    const live = catalog()
      .filter((entry) => entry.provider === provider)
      .flatMap((entry) => workflowCatalogMediaModel(entry) ?? []);
    const ids = new Set(live.map((model) => model.id));
    return [...live, ...WORKFLOW_MEDIA_MODELS.filter((model) => model.provider === provider && !ids.has(model.id))];
  };
  /**
   * The accounts of a service as the picker lists them, when it has more than one: the first is the
   * step's default, so it saves no account, and each other one saves the id of its Apps row.
   */
  const serviceAccountRows = (provider: WorkflowCatalogProvider): readonly ProviderAccountStatus[] | undefined => {
    const accounts = serviceAccounts()?.filter((account) => account.provider === provider) ?? [];
    if (accounts.length < 2) return undefined;
    return accounts.map((account, index) => ({
      id: index === 0 ? DEFAULT_PROVIDER_ACCOUNT_ID : account.id,
      label: mediaServiceAccountName(account),
      email: null,
      state: "connected",
      message: null,
    }));
  };
  readMediaProviders();
  window.addEventListener("focus", readMediaProviders);
  onCleanup(() => {
    disposed = true;
    window.removeEventListener("focus", readMediaProviders);
  });
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
    // subscription, or with the provider's API key when it uses one. Sunra and Higgsfield models need
    // the host's sign-in of that service, and its credits pay for each file.
    get imageModels() {
      if (!props.host.mediaSupported()) return [];
      const fixed = WORKFLOW_MEDIA_MODELS.flatMap((model) => {
        // Sunra and Higgsfield models come after, from the live list.
        if (model.provider === "sunra" || model.provider === "higgsfield") return [];
        if (providerTurnedOff(props.status, model.provider)) return [];
        const status = providerAvailability(props.status, props.models, model.provider, currentText().t);
        if (status.state !== "available") return [];
        // The picker lists each account of a provider that has more than one, when the host makes the
        // file on the account of the step.
        const accounts = props.host.mediaAccountSupported()
          ? props.status.providers?.find((row) => row.id === model.provider)?.accounts
          : undefined;
        // An older host ignores the background of a step, so its models make no transparent image.
        const { transparent, ...rest } = model;
        return [
          {
            ...rest,
            ...(transparent && props.host.mediaTransparentSupported() ? { transparent } : {}),
            ...(status.apiKeyInUse ? { apiKey: true } : {}),
            ...(accounts && accounts.length > 1 ? { accounts } : {}),
          },
        ];
      });
      // An older host ignores the background of a step, so its models make no transparent image.
      // A host that lists the accounts of a service makes the file on the account of the step.
      const service = (provider: WorkflowCatalogProvider, on: boolean) => {
        if (!on) return [];
        const accounts = serviceAccountRows(provider);
        return serviceModels(provider).map(({ transparent, ...rest }) => ({
          ...rest,
          ...(transparent && props.host.mediaTransparentSupported() ? { transparent } : {}),
          ...(accounts ? { accounts } : {}),
        }));
      };
      return [...fixed, ...service("sunra", sunra()), ...service("higgsfield", higgsfield())];
    },
    get mediaPrice() {
      return props.host.mediaSupported() ? props.host.workflows.mediaPrice : undefined;
    },
    get mediaSize() {
      return props.host.mediaSizeSupported();
    },
    get media() {
      return props.host.mediaSupported() ? props.host.mediaUrl : undefined;
    },
    get mediaPreview() {
      return props.host.mediaSupported() ? props.host.mediaPreviewUrl : undefined;
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
