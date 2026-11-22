import type { ProviderLogoVariant } from "@openbot/brand";
import { isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import {
  type AgentProviderRef,
  type AgentStatus,
  type ClientAgentModelOption,
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
  type WorkflowNodeKind,
  type WorkflowOutputTarget,
  type WorkflowStepSettings,
  type WorkflowTriggerType,
} from "@openbot/contracts/ipc";
import { providerOffersModels } from "../../components/provider-model-options";
import type { AgentProfile } from "../../data";

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
  mediaPrice?: ((request: WorkflowMediaPriceRequest) => Promise<WorkflowMediaPrice>) | undefined;
  creditBalance?: number | null | undefined;
  mediaSize?: boolean | undefined;
  agentFiles?: boolean | undefined;
  answers?: boolean | undefined;
  stepSettings?: ((stepId: string) => Promise<WorkflowStepSettings>) | undefined;
  files: readonly StoredFileRow[];
  media?: ((attachmentId: string, kind: WorkflowMediaKind) => string | null | undefined) | undefined;
  mediaPreview?: ((attachmentId: string) => string | null | undefined) | undefined;
  upload?: ((file: File) => Promise<StoredFileRow>) | undefined;
  self?: string | undefined;
}

export function workflowModelProviders(catalogs: WorkflowCatalogs, current?: AgentProviderRef): AgentProviderRef[] {
  const all = [...new Set(catalogs.models.map((option) => option.provider))];
  const offered = all.filter(
    (provider) =>
      provider === current ||
      !isKnownAgentProvider(provider) ||
      providerOffersModels(catalogs.status, catalogs.models, provider),
  );
  return offered.length ? offered : all;
}

export function defaultWorkflowModel(catalogs: WorkflowCatalogs): ClientAgentModelOption | undefined {
  const [provider] = workflowModelProviders(catalogs);
  return catalogs.models.find((option) => option.provider === provider);
}
