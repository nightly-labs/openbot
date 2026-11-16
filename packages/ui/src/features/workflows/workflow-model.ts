/**
 * What the workflow canvas offers. A host that cannot run a node kind, a trigger or an output does not
 * get it in the add menu or in the node's choices; the host still refuses it in a run.
 */

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
  type WorkflowMediaKind,
  type WorkflowNodeKind,
  type WorkflowOutputTarget,
  type WorkflowTriggerType,
} from "@openbot/contracts/ipc";
import { providerOffersModels } from "../../components/provider-model-options";
import type { AgentProfile } from "../../data";

export interface WorkflowFeatures {
  /** The node kinds that the add menu offers. */
  kinds: readonly WorkflowNodeKind[];
  /** The trigger types that a trigger node offers. */
  triggers: readonly WorkflowTriggerType[];
  /** The places that an output node offers. */
  outputs: readonly WorkflowOutputTarget[];
  /** Whether a node can take a file from the computer. */
  uploads: boolean;
  /** Whether the canvas shows the other people on it. */
  presence: boolean;
}

/** Image and file steps, file outputs and message triggers do not run in this version. */
export const WORKFLOW_FEATURES_V1: WorkflowFeatures = {
  kinds: WORKFLOW_NODE_KINDS.filter((kind) => kind !== "image" && kind !== "asset"),
  triggers: ["manual", "schedule", "webhook"],
  outputs: ["notify", "channel"],
  uploads: false,
  presence: false,
};

/** A place that a message trigger listens to or that an output posts to, such as a channel. */
export interface WorkflowPlace {
  connectionId: string;
  placeId: string;
  /** The name of the place, as the user knows it, such as "#general". */
  label: string;
  /** The app, the connection and the place name alone, so a list can group the places by connection. */
  platform: MessagingPlatform;
  connection: string;
  name: string;
}

/** A Discord server that a Discord trigger listens to or that a Discord output acts on. */
export interface WorkflowDiscordServer {
  /** The messaging connection of the server. */
  connectionId: string;
  name: string;
  channels: readonly { id: string; name: string }[];
  roles: readonly { id: string; name: string }[];
}

/** A Telegram chat that a Telegram trigger listens to or that a Telegram output acts on. */
export interface WorkflowTelegramChat {
  /** The messaging connection of the chat. One connection is one chat. */
  connectionId: string;
  name: string;
}

/** A Slack workspace that a Slack trigger listens to or that a Slack output acts on. */
export interface WorkflowSlackWorkspace {
  /** The messaging connection of the workspace. */
  connectionId: string;
  name: string;
  channels: readonly { id: string; name: string }[];
}

/** An OpenBot channel that an output posts its result to. */
export interface WorkflowChannel {
  id: string;
  name: string;
}

/** A model that an image step can draw with. */
export interface WorkflowImageModel {
  id: string;
  name: string;
  /** The logo of the model. */
  provider: ProviderLogoVariant;
  /** The company that makes the model. */
  maker: string;
  /** The subscription that pays for the file, such as "ChatGPT". */
  subscription: string;
  /** True when the provider uses an API key in place of the subscription, so each file costs money. */
  apiKey?: boolean;
  /** True when each file spends credits of the provider account, such as Sunra credits. */
  credits?: boolean;
  /** What the model can make. */
  kinds: readonly WorkflowMediaKind[];
  /** Whether a video can speak in a preset voice. */
  voices?: boolean;
  /** The aspect ratios that it makes. Every one when absent. */
  aspects?: readonly WorkflowMediaAspect[];
  /** The lengths of a video in seconds. The default lengths when absent. */
  durations?: readonly number[];
  /** The resolutions that it makes, the default first. */
  resolutions?: readonly string[];
  /** Whether an image can have a transparent background. */
  transparent?: boolean;
  /**
   * The accounts of the provider, when it has more than one and the host makes a file on the account
   * of the step (`workflows-media-account-v1`). The picker then has one entry for each account.
   */
  accounts?: readonly ProviderAccountStatus[];
}

/**
 * The choices that the nodes offer, from the host. A new node takes the first choice where it must
 * have one, such as the agent of an agent step or the model of a model call.
 */
export interface WorkflowCatalogs {
  agents: readonly AgentProfile[];
  models: readonly ClientAgentModelOption[];
  /** The providers of the host, so a model list leaves out the ones that are not connected. */
  status: AgentStatus;
  places: readonly WorkflowPlace[];
  /** The Discord servers of the host. Only the host that runs the workflow has them. */
  discord?: readonly WorkflowDiscordServer[] | undefined;
  /** The Telegram chats linked to the host. Only the host that runs the workflow has them. */
  telegram?: readonly WorkflowTelegramChat[] | undefined;
  /** The Slack workspaces of the host. Only the host that runs the workflow has them. */
  slack?: readonly WorkflowSlackWorkspace[] | undefined;
  /** The open OpenBot channels of the host. Only this computer gives them. */
  channels?: readonly WorkflowChannel[] | undefined;
  imageModels: readonly WorkflowImageModel[];
  /** The workspace files that an asset node can take, and the images that image steps made. */
  files: readonly StoredFileRow[];
  /**
   * The address of an image or a video that a media step made, from the attachment id of its result.
   * A host without it shows the results that `files` names.
   */
  media?: ((attachmentId: string, kind: WorkflowMediaKind) => string | undefined) | undefined;
  /**
   * Sends a picture from the computer to the host and answers it as a Library file. The host shows
   * why it refused one. Without it, a file from the computer stays in the page.
   */
  upload?: ((file: File) => Promise<StoredFileRow>) | undefined;
  /** The name of the user, which a new sticky note saves as its author. */
  self?: string | undefined;
}

/**
 * The providers that a model list offers, in the order of the first model of each: the ones that the
 * host can run now or soon, and `current`, so the model of a step stays in its list. A provider that
 * this build does not know comes from a newer host with its models, so it stays. When no provider is
 * left, the list offers all of them.
 */
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

/** The model that a new step takes: the first one of a provider that the host can run. */
export function defaultWorkflowModel(catalogs: WorkflowCatalogs): ClientAgentModelOption | undefined {
  const [provider] = workflowModelProviders(catalogs);
  return catalogs.models.find((option) => option.provider === provider);
}
