import { INPUT_LIMITS } from "./input-limits";
import { integerInRange, isBoundedString, isFiniteNumber, isIdentifier } from "./ipc-bounded-values";
import { isRoutineSchedule, type RoutineSchedule } from "./ipc-routines";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

/**
 * Workflows: a canvas of nodes that a trigger starts. Any agent can be any step, and a step hands its
 * output on along the edges. A workflow belongs to a server, not to an agent. These IPC types also
 * cross the Team API through the frozen `workflows-v1` codec, so a field added here needs a new
 * capability before a joined client may read it.
 */

export const WORKFLOW_NODE_KINDS = [
  "text",
  "prompt",
  "asset",
  "llm",
  "agent",
  "image",
  "trigger",
  "condition",
  "approval",
  "output",
  "note",
  "shape",
] as const;
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

/** Nodes for people: a run never goes through them. */
export const WORKFLOW_ANNOTATION_KINDS = ["text", "note", "shape"] as const satisfies readonly WorkflowNodeKind[];

export function isWorkflowStepKind(kind: WorkflowNodeKind): boolean {
  return !isOneOf(WORKFLOW_ANNOTATION_KINDS, kind);
}

export const WORKFLOW_PORT_TYPES = ["text", "image", "file"] as const;
export type WorkflowPortType = (typeof WORKFLOW_PORT_TYPES)[number];

export const WORKFLOW_BRANCHES = ["yes", "no"] as const;
export type WorkflowBranch = (typeof WORKFLOW_BRANCHES)[number];

export const WORKFLOW_TRIGGER_TYPES = [
  "manual",
  "schedule",
  "webhook",
  "message",
  "github",
  "discord",
  "telegram",
  "slack",
] as const;
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

/**
 * `channel` is a place of a messaging connection, as its released name says. `chat-channel` is an
 * OpenBot channel of this computer.
 */
export const WORKFLOW_OUTPUT_TARGETS = [
  "notify",
  "channel",
  "file",
  "github",
  "discord",
  "telegram",
  "slack",
  "chat-channel",
] as const;
export type WorkflowOutputTarget = (typeof WORKFLOW_OUTPUT_TARGETS)[number];

/** A value that a node keeps: a text, a choice, a number or a switch. */
export type WorkflowFieldValue = string | number | boolean;

/**
 * The fields of a node, by name. The host reads only the names its runtime needs:
 * - trigger: `trigger` (a `WorkflowTriggerType`) and `timezone`; the schedule is `WorkflowNode.schedule`.
 *   For `github`: `repositories` ("owner/name", one a line) and `repository` (its first name; read both
 *   with `workflowGitHubTriggerRepositories`), `event` (a `WorkflowGitHubEvent`), `filters` and `labels`
 *   (lists, one name a line), `titleText` and `branch` (the values of those filters). For `discord`:
 *   `connectionId` (the Discord server's messaging connection), `event` (a `WorkflowDiscordEvent`),
 *   `placeId` (a channel id, "" for any channel), `roles` (role ids, one a line, "" for anyone) and
 *   `text` (a text the message must contain, "" for any). For `telegram`: `connectionId` (the Telegram
 *   chat's messaging connection, "" for any linked chat), `event` (a `WorkflowTelegramEvent`) and `text`.
 *   For `slack`: `connectionId` (the Slack workspace's messaging connection), `event` (a
 *   `WorkflowSlackEvent`), `placeId` (a channel id, "" for any channel) and `text` (a text the message
 *   must contain, "" for any).
 * - agent: `agentId`, `task`.
 * - llm: `provider`, `model`, `effort`, `prompt`, `system`.
 * - condition: `rule`, the yes-or-no question about its input, and `provider`, `model` and `effort`, as
 *   llm has them. A condition saved with no `model` lets the host choose the model of each run.
 * - approval: `question`.
 * - output: `target` (a `WorkflowOutputTarget`); for `channel`, `connectionId` and `placeId`. For
 *   `github`: `repository` ("owner/name", or "trigger" for the repository of the trigger's event), `item` ("event" for the item
 *   of the event, "input" for the number in the input), `action` (a `WorkflowGitHubAction`), `labels`
 *   (a list), `labelsFrom` and `person` ("agent" when the agent chooses), `reason` and `title`. For
 *   `discord`: `connectionId` ("trigger" for the trigger's server), `action` (a `WorkflowDiscordAction`),
 *   `placeId` (the channel of `post`) and `emoji` (the emoji of `react`). For `telegram`: `connectionId`
 *   ("trigger" for the trigger's chat), `action` (a `WorkflowTelegramAction`) and `emoji`. A chat is one
 *   connection, so a post needs no place. For `slack`: `connectionId` ("trigger" for the trigger's
 *   workspace), `action` (a `WorkflowSlackAction`), `placeId` (the channel of `post`) and `emoji` (the
 *   emoji of `react`). For `chat-channel`: `channelId`. The result shows in the channel as a note; no
 *   task starts.
 * - prompt: `text`.
 * - image: `media` (a `WorkflowMediaKind`, "image" when absent), `prompt`, `aspect` (one of
 *   `WORKFLOW_MEDIA_ASPECTS`, or `WORKFLOW_MEDIA_CUSTOM_ASPECT` for an image with `width` and `height`
 *   in pixels; see `workflowMediaSize`), `model` (an id of `WORKFLOW_MEDIA_MODELS`), `account` (the id of the
 *   account of the model's provider that pays for the file; empty or absent is the provider's own
 *   sign-in, and Sunra and Higgsfield ignore it), `resolution` (one of the
 *   model's resolutions, such as "720p" or "2K"), and for a video `duration` (seconds), `firstFrame`
 *   and `lastFrame` (the id of an image node that an
 *   `image` edge connects, whose picture is the first or the last frame) and `voice` (an id of
 *   `WORKFLOW_VIDEO_VOICES`), and for an image `background` ("transparent" for a picture with clear
 *   pixels around its subject, from a model with `transparent`; absent is the model's own background).
 *   The pictures of the other image nodes with an `image` edge into it are
 *   references. The output of its step is the id of the generated attachment.
 * Every other field is view state, such as a colour or a font, and the host keeps it as it is.
 */
export type WorkflowFields = Record<string, WorkflowFieldValue>;

export const WORKFLOW_MEDIA_KINDS = ["image", "video"] as const;
export type WorkflowMediaKind = (typeof WORKFLOW_MEDIA_KINDS)[number];

/**
 * Every aspect ratio of a step. A host reads "4:5" and "5:4" only with `workflows-media-size-v1`; an
 * older host reads them as the first aspect ratio of the model.
 */
export const WORKFLOW_MEDIA_ASPECTS = ["1:1", "4:3", "16:9", "9:16", "4:5", "5:4"] as const;
export type WorkflowMediaAspect = (typeof WORKFLOW_MEDIA_ASPECTS)[number];
/** The aspect ratios of a video model without `aspects`: no 4:5 or 5:4, which the video models do not make. */
const WORKFLOW_VIDEO_ASPECTS: readonly WorkflowMediaAspect[] = ["1:1", "4:3", "16:9", "9:16"];
/** The aspect ratios that a host without `workflows-media-size-v1` reads. */
export const WORKFLOW_MEDIA_LEGACY_ASPECTS: readonly WorkflowMediaAspect[] = WORKFLOW_VIDEO_ASPECTS;

/**
 * The `aspect` of an image node with a size of its own in pixels, its `width` and `height`. The model
 * makes the nearest aspect ratio, and the host crops and scales the picture to that size
 * (`workflows-media-size-v1`). A video has no custom size.
 */
export const WORKFLOW_MEDIA_CUSTOM_ASPECT = "custom";
/** The smallest and the largest side of a custom size, in pixels. */
export const WORKFLOW_MEDIA_SIZE_MIN = 64;
export const WORKFLOW_MEDIA_SIZE_MAX = 4096;

/** The size in pixels of an image with a custom size. */
export interface WorkflowMediaSize {
  width: number;
  height: number;
}

/**
 * The service that makes the file: the subscription of an agent provider (`codex`, `grok`), or Sunra or
 * Higgsfield, whose MCP server the user connects in Apps and whose credits pay for the file.
 */
export type WorkflowMediaProvider = "codex" | "grok" | "sunra" | "higgsfield";

/** A model that makes the image or the video of an `image` node, with the subscription of its provider. */
export interface WorkflowMediaModel {
  id: string;
  provider: WorkflowMediaProvider;
  name: string;
  maker: string;
  /** The name of the subscription, or of the credits with `credits`, that pays for the file. */
  subscription: string;
  /** True when each file spends credits of the provider account, not a subscription. */
  credits?: boolean;
  /** The id of the model at the provider, when it is not `id`. */
  providerModel?: string;
  kinds: readonly WorkflowMediaKind[];
  /** Whether a video can speak in a preset voice of `WORKFLOW_VIDEO_VOICES`. */
  voices: boolean;
  /** The aspect ratios that it makes. When absent, an image has each one and a video has no 4:5 or 5:4. */
  aspects?: readonly WorkflowMediaAspect[];
  /** The lengths of a video in seconds. `WORKFLOW_VIDEO_DURATIONS` when absent. */
  durations?: readonly number[];
  /**
   * The resolutions that it makes, the default first. A video has `WORKFLOW_VIDEO_RESOLUTIONS` when
   * absent; an image without them has no resolution choice.
   */
  resolutions?: readonly string[];
  /** Whether an image can have a transparent background (`background` "transparent"). */
  transparent?: boolean;
}

/** The Sunra image models, from Sunra's `list_models` (2026-11-12). */
const SUNRA_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
const SUNRA_VIDEO_RESOLUTIONS = ["720p", "1080p"] as const;

function sunraModel(
  id: string,
  name: string,
  maker: string,
  kind: WorkflowMediaKind,
  specs: Pick<WorkflowMediaModel, "aspects" | "durations" | "resolutions">,
): WorkflowMediaModel {
  return {
    id: `sunra-${id}`,
    provider: "sunra",
    providerModel: id,
    name,
    maker,
    subscription: "Sunra",
    credits: true,
    kinds: [kind],
    voices: false,
    ...specs,
  };
}

/**
 * The Higgsfield models, from Higgsfield's `models_explore` (2026-11-16). The resolutions are the
 * canvas names; the host sends them in lower case, as Higgsfield names them ("2k").
 */
const HIGGSFIELD_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
const HIGGSFIELD_VIDEO_RESOLUTIONS = ["720p", "1080p"] as const;
const HIGGSFIELD_VIDEO_DURATIONS = [5, 10, 15] as const;

function higgsfieldModel(
  id: string,
  name: string,
  maker: string,
  kind: WorkflowMediaKind,
  specs: Pick<WorkflowMediaModel, "aspects" | "durations" | "resolutions" | "transparent">,
): WorkflowMediaModel {
  return {
    id: `higgsfield-${id}`,
    provider: "higgsfield",
    providerModel: id,
    name,
    maker,
    subscription: "Higgsfield",
    credits: true,
    kinds: [kind],
    voices: false,
    ...specs,
  };
}

export const WORKFLOW_MEDIA_MODELS: readonly WorkflowMediaModel[] = [
  {
    id: "gpt-image",
    provider: "codex",
    name: "GPT Image",
    maker: "OpenAI",
    subscription: "ChatGPT",
    kinds: ["image"],
    voices: false,
    transparent: true,
  },
  {
    id: "grok-imagine",
    provider: "grok",
    name: "Grok Imagine",
    maker: "xAI",
    subscription: "Grok",
    kinds: ["image", "video"],
    voices: true,
    transparent: true,
  },
  sunraModel("nano-banana-pro", "Nano Banana Pro", "Google", "image", { resolutions: SUNRA_IMAGE_RESOLUTIONS }),
  sunraModel("gpt-image-2", "GPT Image 2", "OpenAI", "image", { resolutions: SUNRA_IMAGE_RESOLUTIONS }),
  sunraModel("seedream-5-pro", "Seedream 5.0 Pro", "ByteDance", "image", { resolutions: ["2K", "1K"] }),
  sunraModel("flux-3-image", "FLUX 3", "Black Forest Labs", "image", { resolutions: SUNRA_IMAGE_RESOLUTIONS }),
  sunraModel("seedance-2.0", "Seedance 2.0", "ByteDance", "video", {
    durations: [5, 10, 15],
    resolutions: SUNRA_VIDEO_RESOLUTIONS,
  }),
  sunraModel("kling-v4", "Kling 4.0", "Kuaishou", "video", {
    aspects: ["1:1", "16:9", "9:16"],
    durations: [5, 10, 15],
    resolutions: SUNRA_VIDEO_RESOLUTIONS,
  }),
  sunraModel("veo-3.1", "Veo 3.1", "Google", "video", {
    aspects: ["16:9", "9:16"],
    durations: [4, 6, 8],
    resolutions: SUNRA_VIDEO_RESOLUTIONS,
  }),
  higgsfieldModel("gpt_image_2_6", "GPT Image 2.6", "OpenAI", "image", {
    resolutions: HIGGSFIELD_IMAGE_RESOLUTIONS,
    transparent: true,
  }),
  higgsfieldModel("nano_banana_pro", "Nano Banana Pro", "Google", "image", {
    resolutions: HIGGSFIELD_IMAGE_RESOLUTIONS,
  }),
  higgsfieldModel("seedream_v5_pro", "Seedream 5.0 Pro", "ByteDance", "image", {
    resolutions: ["2K", "1K"],
    transparent: true,
  }),
  higgsfieldModel("flux_3_image", "FLUX 3", "Black Forest Labs", "image", {
    resolutions: HIGGSFIELD_IMAGE_RESOLUTIONS,
  }),
  higgsfieldModel("seedance_2_0", "Seedance 2.0", "ByteDance", "video", {
    durations: HIGGSFIELD_VIDEO_DURATIONS,
    resolutions: HIGGSFIELD_VIDEO_RESOLUTIONS,
  }),
  higgsfieldModel("kling4_0", "Kling 4.0", "Kuaishou", "video", {
    aspects: ["1:1", "16:9", "9:16"],
    durations: HIGGSFIELD_VIDEO_DURATIONS,
    resolutions: HIGGSFIELD_VIDEO_RESOLUTIONS,
  }),
  higgsfieldModel("wan2_7", "Wan 2.7", "Alibaba", "video", {
    durations: HIGGSFIELD_VIDEO_DURATIONS,
    resolutions: HIGGSFIELD_VIDEO_RESOLUTIONS,
  }),
];

/** The picture types that an asset step keeps and that image and video steps take as input. */
export const WORKFLOW_PICTURE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"]);

export const WORKFLOW_VIDEO_DURATIONS = [6, 10] as const;
export const WORKFLOW_VIDEO_RESOLUTIONS = ["480p", "720p"] as const;

/** The preset voices that a person in a Grok Imagine video can speak in (Grok CLI 1.0.77). */
export const WORKFLOW_VIDEO_VOICES = [
  { id: "ara", name: "Ara" },
  { id: "eve", name: "Eve" },
  { id: "leo", name: "Leo" },
  { id: "rex", name: "Rex" },
] as const;
export type WorkflowVideoVoice = (typeof WORKFLOW_VIDEO_VOICES)[number]["id"];

/** The media kind of an `image` node. */
export function workflowMediaKind(fields: WorkflowFields): WorkflowMediaKind {
  return fields.media === "video" ? "video" : "image";
}

/** The choices of a model, or of every model when it is not known. */
type WorkflowMediaRange = Pick<WorkflowMediaModel, "aspects" | "durations" | "resolutions" | "transparent">;

export function workflowMediaAspects(
  model: WorkflowMediaRange | null | undefined,
  kind: WorkflowMediaKind,
): readonly WorkflowMediaAspect[] {
  return model?.aspects ?? (kind === "video" ? WORKFLOW_VIDEO_ASPECTS : WORKFLOW_MEDIA_ASPECTS);
}

export function workflowVideoDurations(model: WorkflowMediaRange | null | undefined): readonly number[] {
  return model?.durations ?? WORKFLOW_VIDEO_DURATIONS;
}

/** The most lengths that a catalog model has: the limit of `workflows-media-catalog-v1`. */
export const WORKFLOW_MEDIA_CATALOG_DURATIONS_MAX = 64;
/** A model with more lengths than this lists only some of them; see `workflowVideoLengthChoices`. */
const WORKFLOW_VIDEO_LENGTH_CHOICES = 5;

/**
 * The lengths that a short list shows, in ascending order. A model with many lengths (3 to 30
 * seconds) shows its shortest and longest length and each multiple of 5 between them.
 */
export function workflowVideoLengthChoices(durations: readonly number[]): number[] {
  const sorted = [...new Set(durations)].sort((left, right) => left - right);
  if (sorted.length <= WORKFLOW_VIDEO_LENGTH_CHOICES) return sorted;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return sorted.filter((value) => value === first || value === last || value % 5 === 0);
}

/** The resolutions of a model for a kind. An image of a model without them has none. */
export function workflowMediaResolutions(
  model: WorkflowMediaRange | null | undefined,
  kind: WorkflowMediaKind,
): readonly string[] {
  return model?.resolutions ?? (kind === "video" ? WORKFLOW_VIDEO_RESOLUTIONS : []);
}

/** True for a whole number of pixels that a side of a custom size can have. */
export function isWorkflowMediaSide(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= WORKFLOW_MEDIA_SIZE_MIN &&
    value <= WORKFLOW_MEDIA_SIZE_MAX
  );
}

/**
 * The custom size of an image node, or null when it has none: its `aspect` is not
 * `WORKFLOW_MEDIA_CUSTOM_ASPECT`, it is a video, or a side is out of range.
 */
export function workflowMediaSize(fields: WorkflowFields, kind: WorkflowMediaKind): WorkflowMediaSize | null {
  if (kind !== "image" || fields.aspect !== WORKFLOW_MEDIA_CUSTOM_ASPECT) return null;
  const { width, height } = fields;
  return isWorkflowMediaSide(width) && isWorkflowMediaSide(height) ? { width, height } : null;
}

/** The aspect ratio of the list that is nearest to the shape of `size`. */
function nearestAspect(aspects: readonly WorkflowMediaAspect[], size: WorkflowMediaSize): WorkflowMediaAspect {
  const wanted = Math.log(size.width / size.height);
  const distance = (aspect: WorkflowMediaAspect) => {
    const [width = 1, height = 1] = aspect.split(":").map(Number);
    return Math.abs(Math.log(width / height) - wanted);
  };
  return aspects.reduce((best, aspect) => (distance(aspect) < distance(best) ? aspect : best), aspects[0] ?? "1:1");
}

/** The pixels of the longer side of an image resolution such as "2K", or null for another name. */
function resolutionPixels(resolution: string): number | null {
  const match = /^(\d+)K$/i.exec(resolution);
  return match ? Number(match[1]) * 1024 : null;
}

/**
 * The resolution that a custom size asks for: the smallest that is at least as large as the longer
 * side, else the largest. A model whose resolutions are not sizes such as "2K" keeps its default.
 */
function resolutionForSize(resolutions: readonly string[], size: WorkflowMediaSize): string | null {
  const long = Math.max(size.width, size.height);
  const sized = resolutions.flatMap((value) => {
    const pixels = resolutionPixels(value);
    return pixels === null ? [] : [{ value, pixels }];
  });
  if (sized.length === 0) return resolutions[0] ?? null;
  sized.sort((left, right) => left.pixels - right.pixels);
  return (sized.find((entry) => entry.pixels >= long) ?? sized[sized.length - 1])?.value ?? null;
}

/** The frame, the length and the resolution that an `image` node asks its model for. */
export interface WorkflowMediaSpecs {
  /** The aspect ratio that the model makes. With `size`, the nearest one to it. */
  aspect: WorkflowMediaAspect;
  /** Seconds. Only a video uses it. */
  duration: number;
  resolution: string | null;
  /** An image with a transparent background. Only an image of a model with `transparent` has one. */
  transparent: boolean;
  /** The size in pixels that the host crops and scales the image to, or null for the model's own size. */
  size: WorkflowMediaSize | null;
}

/**
 * The specs of an `image` node for its model. A value that the model does not make, such as a length
 * kept from another model, becomes the nearest length or the first choice of the model. The host and
 * the canvas read it the same way, so the canvas shows what the model gets.
 */
export function workflowMediaSpecs(
  fields: WorkflowFields,
  kind: WorkflowMediaKind,
  model: WorkflowMediaRange | null | undefined,
): WorkflowMediaSpecs {
  const aspects = workflowMediaAspects(model, kind);
  const size = workflowMediaSize(fields, kind);
  const aspect = size
    ? nearestAspect(aspects, size)
    : (aspects.find((value) => value === fields.aspect) ?? aspects[0] ?? "1:1");
  const durations = workflowVideoDurations(model);
  const asked = typeof fields.duration === "number" ? fields.duration : WORKFLOW_VIDEO_DURATIONS[0];
  const duration = durations.reduce(
    (best, value) => (Math.abs(value - asked) < Math.abs(best - asked) ? value : best),
    durations[0] ?? WORKFLOW_VIDEO_DURATIONS[0],
  );
  const resolutions = workflowMediaResolutions(model, kind);
  const preferred = typeof fields.resolution === "string" ? fields.resolution : "720p";
  const resolution = size
    ? resolutionForSize(resolutions, size)
    : resolutions.includes(preferred)
      ? preferred
      : (resolutions[0] ?? null);
  const transparent = kind === "image" && model?.transparent === true && fields.background === "transparent";
  return { aspect, duration, resolution, transparent, size };
}

/**
 * The model of an `image` node, or null when the node names a model the host does not know. A model
 * of `catalog`, the live models of the media services, comes before a fixed model with the same id.
 */
export function workflowMediaModel(
  fields: WorkflowFields,
  catalog: readonly WorkflowMediaModel[] = [],
): WorkflowMediaModel | null {
  const kind = workflowMediaKind(fields);
  const id = typeof fields.model === "string" && fields.model !== "" ? fields.model : null;
  const fits = (model: WorkflowMediaModel) => (id === null || model.id === id) && model.kinds.includes(kind);
  return (id === null ? null : catalog.find(fits)) ?? WORKFLOW_MEDIA_MODELS.find(fits) ?? null;
}

export interface WorkflowPoint {
  x: number;
  y: number;
}

/** A size the user set. A missing side keeps the default size of the node. */
export interface WorkflowNodeSize {
  width?: number;
  height?: number;
  /** The font size of a text node that the user scaled, in world pixels. */
  font?: number;
}

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  at: WorkflowPoint;
  size?: WorkflowNodeSize;
  locked?: boolean;
  fields: WorkflowFields;
  /** When a schedule trigger fires. Only a trigger node has one. */
  schedule?: RoutineSchedule;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  type: WorkflowPortType;
  /** The branch of a condition that the edge leaves from. */
  branch?: WorkflowBranch;
}

/** A line drawn on the canvas. */
export interface WorkflowStroke {
  id: string;
  brush: string;
  color: string;
  width: number;
  points: WorkflowPoint[];
}

/** Everything that a save writes. Nodes are in stack order: the last one is drawn on top. */
export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  strokes: WorkflowStroke[];
}

/**
 * The edges that go back to an earlier step and so close a loop. The host runs them as the next
 * pass of the loop and the canvas draws them as loops, so both must pick the same edges. A walk goes
 * depth first from the nodes that no edge enters, then from the rest, each in canvas order; an edge
 * to a node that the walk is still inside is a loop edge. Without the loop edges, the graph has no
 * loop.
 */
export function workflowLoopEdges(
  nodes: readonly { id: string }[],
  edges: readonly { id: string; from: string; to: string }[],
): Set<string> {
  const next = new Map<string, { id: string; to: string }[]>();
  const entered = new Set<string>();
  for (const edge of edges) {
    const list = next.get(edge.from);
    if (list) list.push(edge);
    else next.set(edge.from, [edge]);
    entered.add(edge.to);
  }
  const loops = new Set<string>();
  const done = new Set<string>();
  const open = new Set<string>();
  const starts = [...nodes.filter((node) => !entered.has(node.id)), ...nodes.filter((node) => entered.has(node.id))];
  // Without recursion: a long chain must not reach the stack limit.
  for (const { id: start } of starts) {
    if (done.has(start)) continue;
    const stack = [{ id: start, index: 0 }];
    open.add(start);
    for (let top = stack.at(-1); top; top = stack.at(-1)) {
      const edge = next.get(top.id)?.[top.index];
      if (!edge) {
        stack.pop();
        open.delete(top.id);
        done.add(top.id);
        continue;
      }
      top.index += 1;
      if (open.has(edge.to)) loops.add(edge.id);
      else if (!done.has(edge.to)) {
        open.add(edge.to);
        stack.push({ id: edge.to, index: 0 });
      }
    }
  }
  return loops;
}

export type WorkflowGraphProblem = "annotation" | "port" | "branch" | "condition-branch" | "duplicate";

const ALL_PORTS = ["text", "image", "file"] as const satisfies readonly WorkflowPortType[];

/**
 * The port types each step kind takes in and sends out. The host refuses a graph with another edge,
 * and the desktop canvas and the mobile editor offer only these, so the three read the same table.
 */
export const WORKFLOW_PORTS: Readonly<
  Record<WorkflowNodeKind, { in: readonly WorkflowPortType[]; out: readonly WorkflowPortType[] }>
> = {
  trigger: { in: [], out: ["text"] },
  prompt: { in: [], out: ["text"] },
  asset: { in: [], out: ALL_PORTS },
  llm: { in: ALL_PORTS, out: ["text"] },
  agent: { in: ALL_PORTS, out: ["text"] },
  image: { in: ["text", "image"], out: ["image"] },
  condition: { in: ["text"], out: ["text"] },
  approval: { in: ["text"], out: ["text"] },
  output: { in: ALL_PORTS, out: [] },
  text: { in: [], out: [] },
  note: { in: [], out: [] },
  shape: { in: [], out: [] },
};

/** Why one edge cannot be in a workflow that runs, or null when it can. */
export function workflowEdgeProblem(
  from: WorkflowNode,
  to: WorkflowNode,
  edge: WorkflowEdge,
): WorkflowGraphProblem | null {
  if (!isWorkflowStepKind(from.kind) || !isWorkflowStepKind(to.kind)) return "annotation";
  if (!WORKFLOW_PORTS[from.kind].out.includes(edge.type) || !WORKFLOW_PORTS[to.kind].in.includes(edge.type))
    return "port";
  if (from.kind === "condition") return edge.branch === undefined ? "condition-branch" : null;
  return edge.branch === undefined ? null : "branch";
}

/**
 * The first edge that stops the graph from running, with the reason, or null when it can run. A loop
 * is allowed: the run takes its edge back as the next pass (`workflowLoopEdges`). The shape and the
 * limits of a graph are `isWorkflowGraph`'s.
 */
export function workflowGraphProblemAt(
  graph: WorkflowGraph,
): { problem: WorkflowGraphProblem; edge: WorkflowEdge } | null {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    // `isWorkflowGraph` already holds every edge to two nodes of the graph.
    if (!from || !to) return { problem: "port", edge };
    const problem = workflowEdgeProblem(from, to, edge);
    if (problem) return { problem, edge };
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.type}\u0000${edge.branch ?? ""}`;
    if (seen.has(key)) return { problem: "duplicate", edge };
    seen.add(key);
  }
  return null;
}

/** Why the graph is not a workflow that can run, or null when it is. */
export function workflowGraphProblem(graph: WorkflowGraph): WorkflowGraphProblem | null {
  return workflowGraphProblemAt(graph)?.problem ?? null;
}

/** The agent of an agent node, or null for another kind or an agent node with no agent yet. */
export function nodeAgentId(node: WorkflowNode): string | null {
  const agentId = node.fields.agentId;
  return node.kind === "agent" && typeof agentId === "string" && agentId.length > 0 ? agentId : null;
}

/** The agent of each agent node of the graph. */
export function graphAgentIds(graph: WorkflowGraph): string[] {
  return graph.nodes.flatMap((node) => nodeAgentId(node) ?? []);
}

export const WORKFLOW_RUN_STATUSES = ["running", "approval", "stopping", "done", "failed", "stopped"] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_STEP_STATUSES = ["running", "approval", "done", "failed", "stopped", "skipped"] as const;
export type WorkflowStepStatus = (typeof WORKFLOW_STEP_STATUSES)[number];

export const WORKFLOW_RUN_SOURCES = [
  "manual",
  "schedule",
  "webhook",
  "github",
  "discord",
  "telegram",
  "slack",
] as const;
export type WorkflowRunSource = (typeof WORKFLOW_RUN_SOURCES)[number];

export const WORKFLOW_VERSION_KINDS = ["auto", "restore", "run"] as const;
export type WorkflowVersionKind = (typeof WORKFLOW_VERSION_KINDS)[number];
/** A save adds an `auto` version when the newest version is older than this. */
export const WORKFLOW_AUTO_VERSION_INTERVAL_MS = 5 * 60_000;
/** The versions that a workflow keeps. A new version removes the oldest. */
export const WORKFLOW_MAX_VERSIONS = 50;

export interface WorkflowSummary {
  id: string;
  title: string;
  /** The nodes that a run goes through. */
  steps: number;
  updatedAt: string;
  lastRun: { status: WorkflowRunStatus; at: string } | null;
}

/** What the host knows about one trigger node: when it fires next, and its webhook address. */
export interface WorkflowTriggerState {
  nodeId: string;
  type: WorkflowTriggerType;
  /** Null while the trigger is not a schedule, or has no next time. */
  nextDueAt: string | null;
  /** Null until the relay gives the webhook an address. */
  webhookUrl: string | null;
}

export interface WorkflowDetail {
  summary: WorkflowSummary;
  graph: WorkflowGraph;
  /** Goes up by one on each save. A save from an older revision is a conflict. */
  revision: number;
  triggers: WorkflowTriggerState[];
  /**
   * Set by the client when the host sent a node kind or a port type that this app does not know.
   * The app shows such a node as a locked note and must not save the graph, as the save would drop it.
   */
  needsNewerApp?: true;
}

export interface WorkflowVersion {
  id: string;
  at: string;
  kind: WorkflowVersionKind;
  revision: number;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  number: number;
  /** Null for a manual run of the whole workflow. */
  triggerNodeId: string | null;
  source: WorkflowRunSource;
  status: WorkflowRunStatus;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

/** One try of one node. A step that runs alone, outside a run, has no `runId`. */
export interface WorkflowStep {
  id: string;
  workflowId: string;
  runId: string | null;
  nodeId: string;
  attempt: number;
  agentId: string | null;
  status: WorkflowStepStatus;
  output: string | null;
  /** The answer of a condition. */
  branch: WorkflowBranch | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface WorkflowRunDetail {
  run: WorkflowRun;
  steps: WorkflowStep[];
}

/** Runs newest first. The first page also carries the newest steps that ran alone. */
export interface WorkflowRunPage {
  runs: WorkflowRunDetail[];
  soloSteps: WorkflowStep[];
  /** Pass as `before` to read older runs; null on the last page. */
  nextBefore: string | null;
}

export interface CreateWorkflowInput {
  title: string;
  graph?: WorkflowGraph;
}

export interface RenameWorkflowInput {
  workflowId: string;
  title: string;
}

export interface SaveWorkflowGraphInput {
  workflowId: string;
  baseRevision: number;
  graph: WorkflowGraph;
}

export type WorkflowSaveResult = { ok: true; revision: number } | { ok: false; conflict: WorkflowDetail };

export interface WorkflowVersionInput {
  workflowId: string;
  versionId: string;
}

export interface StartWorkflowRunInput {
  workflowId: string;
  /** Repeats of one request start one run. */
  requestId: string;
  /** Runs this node and what comes after it, with the newest results of the steps before it. */
  fromNodeId?: string;
}

export interface RunWorkflowStepInput {
  workflowId: string;
  nodeId: string;
  requestId: string;
}

export interface RetryWorkflowStepInput {
  stepId: string;
  requestId: string;
}

export interface DecideWorkflowStepInput {
  stepId: string;
  approved: boolean;
}

export interface WorkflowRunsInput {
  workflowId: string;
  before?: string;
  limit: number;
}

export interface WorkflowTriggerInput {
  workflowId: string;
  nodeId: string;
}

/** A new webhook secret. The host shows it once and keeps only its ciphertext. */
export interface WorkflowWebhookSecret {
  secret: string;
}

/** The largest coordinate a node may take; far beyond any canvas a person would build. */
export const WORKFLOW_MAX_COORDINATE = 1_000_000;
const MAX_SIZE = 100_000;
const FIELD_NAME = 64;
/** `<started at>|<run id>`, as `WorkflowRunPage.nextBefore` gives it. */
const RUN_CURSOR = 64;

function isCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && Math.abs(value) <= WORKFLOW_MAX_COORDINATE;
}

function isPoint(value: unknown): value is WorkflowPoint {
  return isDynamicRecord(value) && isCoordinate(value.x) && isCoordinate(value.y);
}

function isOptionalSize(value: unknown): boolean {
  return value === undefined || (isFiniteNumber(value) && value > 0 && value <= MAX_SIZE);
}

function isNodeSize(value: unknown): value is WorkflowNodeSize {
  return (
    isDynamicRecord(value) && isOptionalSize(value.width) && isOptionalSize(value.height) && isOptionalSize(value.font)
  );
}

function isFieldValue(value: unknown): value is WorkflowFieldValue {
  return isBoolean(value) || isFiniteNumber(value) || isBoundedString(value, INPUT_LIMITS.workflowNodeText);
}

function isFields(value: unknown): value is WorkflowFields {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= INPUT_LIMITS.workflowNodeFields &&
    entries.every(([name, field]) => name.length > 0 && name.length <= FIELD_NAME && isFieldValue(field))
  );
}

export function isWorkflowNode(value: unknown): value is WorkflowNode {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(WORKFLOW_NODE_KINDS, value.kind) &&
    isPoint(value.at) &&
    (value.size === undefined || isNodeSize(value.size)) &&
    (value.locked === undefined || isBoolean(value.locked)) &&
    isFields(value.fields) &&
    (value.schedule === undefined || (value.kind === "trigger" && isRoutineSchedule(value.schedule)))
  );
}

export function isWorkflowEdge(value: unknown): value is WorkflowEdge {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.from) &&
    isIdentifier(value.to) &&
    value.from !== value.to &&
    isOneOf(WORKFLOW_PORT_TYPES, value.type) &&
    (value.branch === undefined || isOneOf(WORKFLOW_BRANCHES, value.branch))
  );
}

function isStroke(value: unknown): value is WorkflowStroke {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.brush) &&
    isIdentifier(value.color) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    value.width <= MAX_SIZE &&
    Array.isArray(value.points) &&
    value.points.length <= INPUT_LIMITS.workflowStrokePoints &&
    value.points.every(isPoint)
  );
}

function uniqueIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

/**
 * The shape of a graph and its limits. Each edge must join two nodes of the graph. Rules that need
 * the meaning of the nodes, such as branch edges, are the host's.
 */
export function isWorkflowGraph(value: unknown): value is WorkflowGraph {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > INPUT_LIMITS.workflowNodes ||
    !value.nodes.every(isWorkflowNode) ||
    !Array.isArray(value.edges) ||
    value.edges.length > INPUT_LIMITS.workflowEdges ||
    !value.edges.every(isWorkflowEdge) ||
    !Array.isArray(value.strokes) ||
    value.strokes.length > INPUT_LIMITS.workflowStrokes ||
    !value.strokes.every(isStroke)
  )
    return false;
  const nodes = new Set(value.nodes.map((node) => node.id));
  return (
    nodes.size === value.nodes.length &&
    uniqueIds(value.edges) &&
    uniqueIds(value.strokes) &&
    value.edges.every((edge) => nodes.has(edge.from) && nodes.has(edge.to))
  );
}

function isTitle(value: unknown): value is string {
  return isBoundedString(value, INPUT_LIMITS.workflowTitle) && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isRevision(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value >= 0;
}

export function isWorkflowSummary(value: unknown): value is WorkflowSummary {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isTitle(value.title) &&
    isRevision(value.steps) &&
    isString(value.updatedAt) &&
    (value.lastRun === null ||
      (isDynamicRecord(value.lastRun) &&
        isOneOf(WORKFLOW_RUN_STATUSES, value.lastRun.status) &&
        isString(value.lastRun.at)))
  );
}

function isTriggerState(value: unknown): value is WorkflowTriggerState {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.nodeId) &&
    isOneOf(WORKFLOW_TRIGGER_TYPES, value.type) &&
    isNullableString(value.nextDueAt) &&
    isNullableString(value.webhookUrl)
  );
}

export function isWorkflowDetail(value: unknown): value is WorkflowDetail {
  return (
    isDynamicRecord(value) &&
    isWorkflowSummary(value.summary) &&
    isWorkflowGraph(value.graph) &&
    isRevision(value.revision) &&
    Array.isArray(value.triggers) &&
    value.triggers.every(isTriggerState) &&
    (value.needsNewerApp === undefined || value.needsNewerApp === true)
  );
}

export function isWorkflowSaveResult(value: unknown): value is WorkflowSaveResult {
  if (!isDynamicRecord(value)) return false;
  return value.ok === true ? isRevision(value.revision) : value.ok === false && isWorkflowDetail(value.conflict);
}

export function isWorkflowVersion(value: unknown): value is WorkflowVersion {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isString(value.at) &&
    isOneOf(WORKFLOW_VERSION_KINDS, value.kind) &&
    isRevision(value.revision)
  );
}

export function isWorkflowRun(value: unknown): value is WorkflowRun {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.workflowId) &&
    integerInRange(value.number, 1, Number.MAX_SAFE_INTEGER) &&
    (value.triggerNodeId === null || isIdentifier(value.triggerNodeId)) &&
    isOneOf(WORKFLOW_RUN_SOURCES, value.source) &&
    isOneOf(WORKFLOW_RUN_STATUSES, value.status) &&
    isNullableString(value.error) &&
    isString(value.startedAt) &&
    isNullableString(value.endedAt)
  );
}

export function isWorkflowStep(value: unknown): value is WorkflowStep {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.workflowId) &&
    (value.runId === null || isIdentifier(value.runId)) &&
    isIdentifier(value.nodeId) &&
    integerInRange(value.attempt, 1, Number.MAX_SAFE_INTEGER) &&
    (value.agentId === null || isIdentifier(value.agentId)) &&
    isOneOf(WORKFLOW_STEP_STATUSES, value.status) &&
    isNullableString(value.output) &&
    (value.branch === null || isOneOf(WORKFLOW_BRANCHES, value.branch)) &&
    isNullableString(value.error) &&
    isNullableString(value.startedAt) &&
    isNullableString(value.endedAt)
  );
}

export function isWorkflowRunDetail(value: unknown): value is WorkflowRunDetail {
  return (
    isDynamicRecord(value) &&
    isWorkflowRun(value.run) &&
    Array.isArray(value.steps) &&
    value.steps.every(isWorkflowStep)
  );
}

export function isWorkflowRunPage(value: unknown): value is WorkflowRunPage {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.runs) &&
    value.runs.every(isWorkflowRunDetail) &&
    Array.isArray(value.soloSteps) &&
    value.soloSteps.every(isWorkflowStep) &&
    isNullableString(value.nextBefore)
  );
}

export function isCreateWorkflowInput(value: unknown): value is CreateWorkflowInput {
  return isDynamicRecord(value) && isTitle(value.title) && (value.graph === undefined || isWorkflowGraph(value.graph));
}

export function isRenameWorkflowInput(value: unknown): value is RenameWorkflowInput {
  return isDynamicRecord(value) && isIdentifier(value.workflowId) && isTitle(value.title);
}

export function isSaveWorkflowGraphInput(value: unknown): value is SaveWorkflowGraphInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workflowId) &&
    isRevision(value.baseRevision) &&
    isWorkflowGraph(value.graph)
  );
}

export function isWorkflowVersionInput(value: unknown): value is WorkflowVersionInput {
  return isDynamicRecord(value) && isIdentifier(value.workflowId) && isIdentifier(value.versionId);
}

export function isStartWorkflowRunInput(value: unknown): value is StartWorkflowRunInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workflowId) &&
    isIdentifier(value.requestId) &&
    (value.fromNodeId === undefined || isIdentifier(value.fromNodeId))
  );
}

export function isRunWorkflowStepInput(value: unknown): value is RunWorkflowStepInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workflowId) &&
    isIdentifier(value.nodeId) &&
    isIdentifier(value.requestId)
  );
}

export function isRetryWorkflowStepInput(value: unknown): value is RetryWorkflowStepInput {
  return isDynamicRecord(value) && isIdentifier(value.stepId) && isIdentifier(value.requestId);
}

export function isDecideWorkflowStepInput(value: unknown): value is DecideWorkflowStepInput {
  return isDynamicRecord(value) && isIdentifier(value.stepId) && isBoolean(value.approved);
}

export function isWorkflowRunsInput(value: unknown): value is WorkflowRunsInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workflowId) &&
    (value.before === undefined || (isBoundedString(value.before, RUN_CURSOR) && value.before.length > 0)) &&
    integerInRange(value.limit, 1, INPUT_LIMITS.workflowRunsPage)
  );
}

export function isWorkflowTriggerInput(value: unknown): value is WorkflowTriggerInput {
  return isDynamicRecord(value) && isIdentifier(value.workflowId) && isIdentifier(value.nodeId);
}

export function isWorkflowWebhookSecret(value: unknown): value is WorkflowWebhookSecret {
  return isDynamicRecord(value) && isBoundedString(value.secret, INPUT_LIMITS.identifier) && value.secret.length > 0;
}

/**
 * The media services that the host can use now, beyond the agent providers. `sunra`: an enabled Sunra
 * row in the host's Apps is signed in, so the Sunra models of `WORKFLOW_MEDIA_MODELS` can run.
 * `higgsfield`: the same for a Higgsfield row and the Higgsfield models.
 */
export interface WorkflowMediaProviders {
  sunra: boolean;
  higgsfield: boolean;
}

export function isWorkflowMediaProviders(value: unknown): value is WorkflowMediaProviders {
  return isDynamicRecord(value) && isBoolean(value.sunra) && isBoolean(value.higgsfield);
}

/**
 * The credits of a media service that the host can spend now. `available`: the credits that the
 * signed-in account can spend. `quota`: the limit of a team member, or null for an account with no
 * limit of its own.
 */
export interface WorkflowMediaCreditBalance {
  available: number;
  quota: number | null;
}

/** The credits of each media service beyond the agent providers. Null when the host cannot read them. */
export interface WorkflowMediaCredits {
  sunra: WorkflowMediaCreditBalance | null;
  higgsfield: WorkflowMediaCreditBalance | null;
}

const isCreditCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function isWorkflowMediaCreditBalance(value: unknown): value is WorkflowMediaCreditBalance {
  return (
    isDynamicRecord(value) && isCreditCount(value.available) && (value.quota === null || isCreditCount(value.quota))
  );
}

export function isWorkflowMediaCredits(value: unknown): value is WorkflowMediaCredits {
  return (
    isDynamicRecord(value) &&
    (value.sunra === null || isWorkflowMediaCreditBalance(value.sunra)) &&
    (value.higgsfield === null || isWorkflowMediaCreditBalance(value.higgsfield))
  );
}

/** A media service whose model list the host reads live (`workflows-media-catalog-v1`). */
export type WorkflowCatalogProvider = "sunra" | "higgsfield";
export const WORKFLOW_CATALOG_PROVIDERS: readonly WorkflowCatalogProvider[] = ["sunra", "higgsfield"];
export const WORKFLOW_MEDIA_CATALOG_MAX = 1000;

/** The service of a catalog model id: its ids start with "sunra-" or "higgsfield-". */
export const workflowCatalogProvider = (id: string): WorkflowCatalogProvider | null =>
  id.startsWith("sunra-") ? "sunra" : id.startsWith("higgsfield-") ? "higgsfield" : null;
const WORKFLOW_MEDIA_NAME_MAX = 160;
const WORKFLOW_MEDIA_MAKER_MAX = 120;
const WORKFLOW_MEDIA_RESOLUTION_MAX = 16;

/**
 * A model from the live model list of a media service. `durations` is empty for an image, and
 * `resolutions` (the default first) is empty for a model with no resolution choice.
 */
export interface WorkflowMediaCatalogModel {
  id: string;
  provider: WorkflowCatalogProvider;
  providerModel: string;
  name: string;
  maker: string;
  kinds: readonly WorkflowMediaKind[];
  aspects: readonly WorkflowMediaAspect[];
  durations: readonly number[];
  resolutions: readonly string[];
  transparent: boolean;
}

/** The models of the signed-in media services. A service that did not answer gives its fixed models. */
export interface WorkflowMediaCatalog {
  models: readonly WorkflowMediaCatalogModel[];
}

const isListOf = <T>(value: unknown, max: number, item: (entry: unknown) => entry is T): value is readonly T[] =>
  Array.isArray(value) && value.length <= max && value.every(item);

export function isWorkflowMediaCatalogModel(value: unknown): value is WorkflowMediaCatalogModel {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isOneOf(WORKFLOW_CATALOG_PROVIDERS, value.provider) &&
    isIdentifier(value.providerModel) &&
    isBoundedString(value.name, WORKFLOW_MEDIA_NAME_MAX) &&
    isBoundedString(value.maker, WORKFLOW_MEDIA_MAKER_MAX) &&
    isListOf(value.kinds, 2, (entry): entry is WorkflowMediaKind => isOneOf(WORKFLOW_MEDIA_KINDS, entry)) &&
    isListOf(value.aspects, 6, (entry): entry is WorkflowMediaAspect => isOneOf(WORKFLOW_MEDIA_ASPECTS, entry)) &&
    isListOf(value.durations, WORKFLOW_MEDIA_CATALOG_DURATIONS_MAX, isCreditCount) &&
    isListOf(value.resolutions, 16, (entry): entry is string =>
      isBoundedString(entry, WORKFLOW_MEDIA_RESOLUTION_MAX),
    ) &&
    isBoolean(value.transparent)
  );
}

export function isWorkflowMediaCatalog(value: unknown): value is WorkflowMediaCatalog {
  return isDynamicRecord(value) && isListOf(value.models, WORKFLOW_MEDIA_CATALOG_MAX, isWorkflowMediaCatalogModel);
}

/** The canvas model of a catalog entry. A model with no aspect ratio or no kind has no canvas model. */
export function workflowCatalogMediaModel(entry: WorkflowMediaCatalogModel): WorkflowMediaModel | null {
  const kind = entry.kinds[0];
  if (kind === undefined || entry.aspects.length === 0) return null;
  if (kind === "video" && entry.durations.length === 0) return null;
  return {
    id: entry.id,
    provider: entry.provider,
    providerModel: entry.providerModel,
    name: entry.name,
    maker: entry.maker,
    subscription: entry.provider === "sunra" ? "Sunra" : "Higgsfield",
    credits: true,
    kinds: [kind],
    voices: false,
    aspects: entry.aspects,
    ...(kind === "video" ? { durations: entry.durations } : {}),
    resolutions: entry.resolutions,
    transparent: kind === "image" && entry.transparent,
  };
}

/** The catalog model of a fixed model of `WORKFLOW_MEDIA_MODELS`, with the choices that it has. */
export function workflowFixedCatalogModel(
  model: WorkflowMediaModel,
  provider: WorkflowCatalogProvider,
): WorkflowMediaCatalogModel {
  const kind = model.kinds[0] ?? "image";
  return {
    id: model.id,
    provider,
    providerModel: model.providerModel ?? model.id,
    name: model.name,
    maker: model.maker,
    kinds: [kind],
    aspects: workflowMediaAspects(model, kind),
    durations: kind === "video" ? workflowVideoDurations(model) : [],
    resolutions: workflowMediaResolutions(model, kind),
    transparent: kind === "image" && model.transparent === true,
  };
}

/** The choices of a step whose price the host asks the media service for. */
export interface WorkflowMediaPriceRequest {
  /** The `id` of a catalog model. */
  model: string;
  kind: WorkflowMediaKind;
  aspect: WorkflowMediaAspect;
  /** Seconds. Only a video uses it. */
  duration: number;
  resolution: string | null;
  transparent: boolean;
}

/** What one file costs, in the credits of the service, or null when the service gives no quote. */
export interface WorkflowMediaPrice {
  credits: number | null;
}

export const WORKFLOW_MEDIA_PRICE_MAX = 1_000_000_000;

export function isWorkflowMediaPriceRequest(value: unknown): value is WorkflowMediaPriceRequest {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.model) &&
    isOneOf(WORKFLOW_MEDIA_KINDS, value.kind) &&
    isOneOf(WORKFLOW_MEDIA_ASPECTS, value.aspect) &&
    isCreditCount(value.duration) &&
    (value.resolution === null || isBoundedString(value.resolution, WORKFLOW_MEDIA_RESOLUTION_MAX)) &&
    isBoolean(value.transparent)
  );
}

export function isWorkflowMediaPrice(value: unknown): value is WorkflowMediaPrice {
  return (
    isDynamicRecord(value) &&
    (value.credits === null ||
      (isFiniteNumber(value.credits) && value.credits >= 0 && value.credits <= WORKFLOW_MEDIA_PRICE_MAX))
  );
}
