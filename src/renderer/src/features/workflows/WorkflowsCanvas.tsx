import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type ProviderAccountStatus,
  WORKFLOW_MEDIA_MODELS,
  type WorkflowCatalogProvider,
  type WorkflowMediaCatalogModel,
  type WorkflowMediaModel,
  type WorkflowMediaServiceAccount,
  type WorkflowMediaUnavailableModel,
  workflowCatalogMediaModel,
  workflowCatalogSource,
} from "@openbot/contracts/ipc";
import { Spinner } from "@openbot/ui";
import { providerAvailability, providerTurnedOff } from "@openbot/ui/components/provider-model-options";
import { WorkflowCanvas } from "@openbot/ui/features/workflows/WorkflowCanvas";
import type { WorkflowAgentProgress } from "@openbot/ui/features/workflows/workflow-board";
import {
  WORKFLOW_FEATURES_V1,
  type WorkflowCatalogs,
  type WorkflowFeatures,
} from "@openbot/ui/features/workflows/workflow-model";
import { currentText, useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, onCleanup, Show, untrack } from "solid-js";
import { desktopAnalytics } from "../../analytics";
import { mediaServiceAccountName, noteMediaStepEnded } from "./workflow-media-credits";
import { createWorkflowsController, type WorkflowRequest } from "./workflows-controller";
import type { WorkflowHost } from "./workflows-port";

export function WorkflowsCanvas(props: {
  host: WorkflowHost;
  admin: boolean;
  agents: WorkflowCatalogs["agents"];
  models: WorkflowCatalogs["models"];
  status: WorkflowCatalogs["status"];
  self?: WorkflowCatalogs["self"];
  request?: WorkflowRequest | undefined;
  serverId?: string | undefined;
  agentProgress?: ((agentId: string) => WorkflowAgentProgress | undefined) | undefined;
}) {
  const { t } = useText();
  const workflows = createWorkflowsController(
    untrack(() => props.host),
    () => desktopAnalytics.scope(),
    untrack(() => props.request),
    untrack(() => props.serverId),
  );
  const [sunra, setSunra] = createSignal(false);
  const [higgsfield, setHiggsfield] = createSignal(false);
  const [openbot, setOpenbot] = createSignal(false);
  const [serviceAccounts, setServiceAccounts] = createSignal<readonly WorkflowMediaServiceAccount[] | null>(null);
  const [catalog, setCatalog] = createSignal<readonly WorkflowMediaCatalogModel[]>([]);
  const [providersRead, setProvidersRead] = createSignal(false);
  const [catalogRead, setCatalogRead] = createSignal(false);
  const [unavailable, setUnavailable] = createSignal<readonly WorkflowMediaUnavailableModel[]>([]);
  const [creditBalance, setCreditBalance] = createSignal<number | null>(null);
  let disposed = false;
  let balanceRequest = 0;
  const readCreditBalance = () => {
    if (!props.host.mediaSupported()) return;
    balanceRequest += 1;
    const sent = balanceRequest;
    void props.host.workflows
      .mediaCredits()
      .then((answer) => {
        if (!disposed && sent === balanceRequest) setCreditBalance(answer.openbot?.available ?? null);
      })
      .catch(() => undefined);
  };
  const readMediaProviders = () => {
    if (!props.host.mediaSupported()) return;
    void props.host.workflows
      .mediaProviders()
      .then((providers) => {
        if (disposed) return;
        setSunra(providers.sunra);
        setHiggsfield(providers.higgsfield);
        setOpenbot(providers.openbot === true);
        setServiceAccounts(providers.accounts);
        setProvidersRead(true);
        if (providers.openbot === true) readCreditBalance();
      })
      .catch(() => undefined);
    void props.host.workflows
      .mediaCatalog()
      .then((answer) => {
        if (disposed) return;
        setCatalog(answer.models);
        setUnavailable(answer.unavailable ?? []);
        setCatalogRead(true);
      })
      .catch(() => undefined);
  };
  const serviceModels = (provider: "sunra" | "higgsfield"): readonly WorkflowMediaModel[] => {
    const live = catalog()
      .filter((entry) => entry.provider === provider)
      .flatMap((entry) => workflowCatalogMediaModel(entry) ?? []);
    const ids = new Set(live.map((model) => model.id));
    return [...live, ...WORKFLOW_MEDIA_MODELS.filter((model) => model.provider === provider && !ids.has(model.id))];
  };
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
  let shown: { workflowId: string; since: string; ends: Set<string> } | null = null;
  createEffect(
    () => ({ view: workflows.props.runs, workflow: workflows.detail() }),
    ({ view, workflow }) => {
      if (!workflow) return;
      const steps = [...view.runs.flatMap((run) => run.steps), ...view.soloSteps].filter(
        (step) => step.workflowId === workflow.summary.id,
      );
      if (shown?.workflowId !== workflow.summary.id) {
        const times = steps.flatMap((step) => [step.startedAt ?? "", step.endedAt ?? ""]);
        shown = {
          workflowId: workflow.summary.id,
          since: times.reduce((a, b) => (b > a ? b : a), ""),
          ends: new Set(),
        };
        return;
      }
      let ended = false;
      for (const step of steps) {
        if (step.endedAt === null || step.endedAt <= shown.since) continue;
        const end = `${step.id}:${step.attempt}`;
        if (shown.ends.has(end)) continue;
        shown.ends.add(end);
        const model = workflow.graph.nodes.find((node) => node.id === step.nodeId)?.fields.model;
        if (typeof model === "string" && workflowCatalogSource(model)) ended = true;
      }
      if (!ended) return;
      noteMediaStepEnded();
      if (openbot()) readCreditBalance();
    },
  );
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
    get imageModels() {
      if (!props.host.mediaSupported()) return [];
      const fixed = WORKFLOW_MEDIA_MODELS.flatMap((model) => {
        if (model.provider === "sunra" || model.provider === "higgsfield" || model.provider === "openbot") return [];
        if (providerTurnedOff(props.status, model.provider)) return [];
        const status = providerAvailability(props.status, props.models, model.provider, currentText().t);
        if (status.state !== "available") return [];
        const accounts = props.host.mediaAccountSupported()
          ? props.status.providers?.find((row) => row.id === model.provider)?.accounts
          : undefined;
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
      const service = (provider: WorkflowCatalogProvider, on: boolean) => {
        if (!on) return [];
        const accounts = serviceAccountRows(provider);
        return serviceModels(provider).map(({ transparent, ...rest }) => ({
          ...rest,
          ...(transparent && props.host.mediaTransparentSupported() ? { transparent } : {}),
          ...(accounts ? { accounts } : {}),
        }));
      };
      const credit = openbot()
        ? catalog()
            .filter((entry) => entry.provider === "openbot")
            .flatMap((entry) => workflowCatalogMediaModel(entry) ?? [])
        : [];
      return [...credit, ...fixed, ...service("sunra", sunra()), ...service("higgsfield", higgsfield())];
    },
    get imageModelsReady() {
      return !props.host.mediaSupported() || (providersRead() && catalogRead());
    },
    get unavailableModels() {
      if (!props.host.mediaSupported()) return [];
      const hidden = openbot()
        ? []
        : catalog()
            .filter((entry) => entry.provider === "openbot")
            .map(({ id, name, kinds }) => ({ id, name, kinds }));
      return [...unavailable(), ...hidden];
    },
    get mediaPrice() {
      return props.host.mediaSupported() ? props.host.workflows.mediaPrice : undefined;
    },
    get creditBalance() {
      return openbot() ? creditBalance() : null;
    },
    get mediaSize() {
      return props.host.mediaSizeSupported();
    },
    get agentFiles() {
      return props.host.agentFilesSupported();
    },
    get answers() {
      return props.host.answersSupported();
    },
    get stepSettings() {
      return props.host.stepSettingsSupported() ? props.host.workflows.stepSettings : undefined;
    },
    get media() {
      return props.host.mediaSupported() ? props.host.mediaUrl : undefined;
    },
    get mediaPreview() {
      return props.host.mediaSupported() ? props.host.mediaPreviewUrl : undefined;
    },
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
    get download() {
      return props.host.mediaSupported() ? workflows.downloadMedia : undefined;
    },
    get self() {
      return props.self;
    },
  };
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
      kinds: media ? [...WORKFLOW_FEATURES_V1.kinds, "image", "asset"] : WORKFLOW_FEATURES_V1.kinds,
      uploads: media,
      triggers: [...WORKFLOW_FEATURES_V1.triggers, ...added],
      outputs: [...outputs, ...added],
      format: workflows.detail()?.hostFormat ?? WORKFLOW_FEATURES_V1.format,
    };
  });
  return (
    <Show
      when={workflows.detail()}
      fallback={
        <main class="window-page workflows-notice">
          <Show when={!workflows.failed()}>
            <Spinner size="lg" label={t("workflow.canvas.opening")} />
          </Show>
        </main>
      }
    >
      {(workflow) => (
        <WorkflowCanvas
          workflow={workflow()}
          features={features()}
          catalogs={catalogs}
          github={workflows.github}
          frame="window"
          server={props.serverId}
          readOnly={workflows.readOnly()}
          agentProgress={props.agentProgress}
          {...workflows.props}
          onRotateWebhookSecret={props.admin ? workflows.props.onRotateWebhookSecret : undefined}
        />
      )}
    </Show>
  );
}
