import type { ProviderLogoVariant } from "@openbot/brand";
import {
  isFreeOpencodeModel,
  isKnownAgentProvider,
  OPENCODE_DEFAULT_FREE_MODEL,
} from "@openbot/contracts/agent-providers";
import {
  type AgentProviderRef,
  type AgentStatus,
  type ClientAgentModelOption,
  defaultProviderModel,
  type MessagingPlatform,
  type ProviderAccountStatus,
  type StoredFileRow,
  WORKFLOW_NODE_KINDS,
  type WorkflowMediaAspect,
  type WorkflowMediaInput,
  type WorkflowMediaKind,
  type WorkflowMediaMode,
  type WorkflowMediaOption,
  type WorkflowMediaPrice,
  type WorkflowMediaPriceRequest,
  type WorkflowMediaUnavailableModel,
  type WorkflowNodeKind,
  type WorkflowOutputTarget,
  type WorkflowStepSettings,
  type WorkflowTriggerType,
} from "@openbot/contracts/ipc";
import { providerOffersModels } from "../../components/provider-model-options";
import type { AgentProfile } from "../../data";
import { currentText } from "../../text";
import type { CreationPreference } from "../agents/agent-creation-model";

export interface WorkflowFeatures {
  kinds: readonly WorkflowNodeKind[];
  triggers: readonly WorkflowTriggerType[];
  outputs: readonly WorkflowOutputTarget[];
  uploads: boolean;
  presence: boolean;
  format: number;
}

export const WORKFLOW_FEATURES_V1: WorkflowFeatures = {
  kinds: WORKFLOW_NODE_KINDS.filter((kind) => kind !== "image" && kind !== "asset"),
  triggers: ["manual", "schedule", "webhook"],
  outputs: ["notify", "channel"],
  uploads: false,
  presence: false,
  format: 1,
};

export interface WorkflowPlace {
  connectionId: string;
  placeId: string;
  label: string;
  platform: MessagingPlatform;
  connection: string;
  name: string;
}

export interface WorkflowDiscordServer {
  connectionId: string;
  name: string;
  channels: readonly { id: string; name: string }[];
  roles: readonly { id: string; name: string }[];
}

export interface WorkflowTelegramChat {
  connectionId: string;
  name: string;
}

export interface WorkflowSlackWorkspace {
  connectionId: string;
  name: string;
  channels: readonly { id: string; name: string }[];
}

export interface WorkflowChannel {
  id: string;
  name: string;
}

export interface WorkflowImageModel {
  id: string;
  name: string;
  provider: ProviderLogoVariant;
  maker: string;
  subscription: string;
  apiKey?: boolean;
  credits?: boolean;
  kinds: readonly WorkflowMediaKind[];
  voices?: boolean;
  aspects?: readonly WorkflowMediaAspect[];
  durations?: readonly number[];
  defaultDuration?: number;
  frameCount?: number;
  resolutions?: readonly string[];
  transparent?: boolean;
  options?: readonly WorkflowMediaOption[];
  inputs?: readonly WorkflowMediaInput[];
  modes?: readonly WorkflowMediaMode[];
  accounts?: readonly ProviderAccountStatus[];
}

export interface WorkflowCatalogs {
  agents: readonly AgentProfile[];
  models: readonly ClientAgentModelOption[];
  status: AgentStatus;
  places: readonly WorkflowPlace[];
  discord?: readonly WorkflowDiscordServer[] | undefined;
  telegram?: readonly WorkflowTelegramChat[] | undefined;
  slack?: readonly WorkflowSlackWorkspace[] | undefined;
  channels?: readonly WorkflowChannel[] | undefined;
  imageModels: readonly WorkflowImageModel[];
  imageModelsReady?: boolean | undefined;
  unavailableModels?: readonly WorkflowMediaUnavailableModel[] | undefined;
  mediaPrice?: ((request: WorkflowMediaPriceRequest) => Promise<WorkflowMediaPrice>) | undefined;
  creditBalance?: number | null | undefined;
  mediaSize?: boolean | undefined;
  agentFiles?: boolean | undefined;
  answers?: boolean | undefined;
  preference?: CreationPreference | null | undefined;
  stepSettings?: ((stepId: string) => Promise<WorkflowStepSettings>) | undefined;
  files: readonly StoredFileRow[];
  media?: ((attachmentId: string, kind: WorkflowMediaKind) => string | null | undefined) | undefined;
  mediaPreview?: ((attachmentId: string) => string | null | undefined) | undefined;
  upload?: ((file: File) => Promise<StoredFileRow>) | undefined;
  download?: ((attachmentId: string) => Promise<void>) | undefined;
  self?: string | undefined;
}

const FREE_MODEL_PROVIDER: AgentProviderRef = "opencode";

export function offeredModelProviders(catalogs: WorkflowCatalogs, current?: AgentProviderRef): AgentProviderRef[] {
  return [...new Set(catalogs.models.map((option) => option.provider))].filter(
    (provider) =>
      provider === current ||
      !isKnownAgentProvider(provider) ||
      providerOffersModels(catalogs.status, catalogs.models, provider, currentText().t),
  );
}

export function workflowModelProviders(catalogs: WorkflowCatalogs, current?: AgentProviderRef): AgentProviderRef[] {
  const offered = offeredModelProviders(catalogs, current);
  return offered.length ? offered : [...new Set(catalogs.models.map((option) => option.provider))];
}

function startingModel(
  provider: AgentProviderRef,
  options: readonly ClientAgentModelOption[],
  preference: CreationPreference | null | undefined,
): ClientAgentModelOption | undefined {
  const preferred =
    preference?.preferredProvider === provider && preference.preferredModel
      ? options.find((option) => option.id === preference.preferredModel)
      : undefined;
  if (preferred) return preferred;
  if (provider === FREE_MODEL_PROVIDER)
    return (
      options.find((option) => option.id === OPENCODE_DEFAULT_FREE_MODEL) ??
      options.find((option) => isFreeOpencodeModel(option.id, option.name)) ??
      options[0]
    );
  const usual = isKnownAgentProvider(provider) ? defaultProviderModel(provider) : undefined;
  return options.find((option) => option.id === usual) ?? options[0];
}

export function defaultWorkflowModel(catalogs: WorkflowCatalogs): ClientAgentModelOption | undefined {
  const providers = workflowModelProviders(catalogs);
  const preferred = catalogs.preference?.preferredProvider;
  const ranked = [
    ...providers.filter((provider) => provider === preferred),
    ...providers.filter((provider) => provider !== preferred && provider !== FREE_MODEL_PROVIDER),
    ...providers.filter((provider) => provider !== preferred && provider === FREE_MODEL_PROVIDER),
  ];
  for (const provider of ranked) {
    const options = catalogs.models.filter((option) => option.provider === provider && option.listing !== "kept");
    const model = startingModel(provider, options, catalogs.preference);
    if (model) return model;
  }
  const fallback = catalogs.models.filter((option) => option.provider === providers[0]);
  return fallback.find((option) => option.listing !== "kept") ?? fallback[0];
}
