/**
 * What the workflow canvas offers. A host that cannot run a node kind, a trigger or an output does not
 * get it in the add menu or in the node's choices; the host still refuses it in a run.
 */

import type { ProviderLogoVariant } from "@openbot/brand";
import {
  type ClientAgentModelOption,
  type StoredFileRow,
  WORKFLOW_NODE_KINDS,
  type WorkflowNodeKind,
  type WorkflowOutputTarget,
  type WorkflowTriggerType,
} from "@openbot/contracts/ipc";
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
}

/** A model that an image step can draw with. */
export interface WorkflowImageModel {
  id: string;
  name: string;
  /** The logo of the model. */
  provider: ProviderLogoVariant;
  /** The company that makes the model. */
  maker: string;
}

/**
 * The choices that the nodes offer, from the host. A new node takes the first choice where it must
 * have one, such as the agent of an agent step or the model of a model call.
 */
export interface WorkflowCatalogs {
  agents: readonly AgentProfile[];
  models: readonly ClientAgentModelOption[];
  places: readonly WorkflowPlace[];
  imageModels: readonly WorkflowImageModel[];
  /** The workspace files that an asset node can take, and the images that image steps made. */
  files: readonly StoredFileRow[];
  /** The name of the user, which a new sticky note saves as its author. */
  self?: string | undefined;
}
