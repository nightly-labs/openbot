import { INPUT_LIMITS } from "./input-limits";
import { integerInRange, isBoundedString, isFiniteNumber, isIdentifier } from "./ipc-bounded-values";
import { isRoutineSchedule, type RoutineSchedule } from "./ipc-routines";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

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

export type WorkflowFieldValue = string | number | boolean;

export type WorkflowFields = Record<string, WorkflowFieldValue>;

export const WORKFLOW_GROUP_FIELDS = { id: "group", name: "groupName", folded: "groupFolded" } as const;
export const WORKFLOW_STEP_NAME_FIELD = "stepName";

export const WORKFLOW_MEDIA_KINDS = ["image", "video"] as const;
export type WorkflowMediaKind = (typeof WORKFLOW_MEDIA_KINDS)[number];

export const WORKFLOW_MEDIA_ASPECTS = ["1:1", "4:3", "16:9", "9:16", "4:5", "5:4", "21:9", "3:4"] as const;
export type WorkflowMediaAspect = (typeof WORKFLOW_MEDIA_ASPECTS)[number];
export const WORKFLOW_MEDIA_CATALOG_V1_ASPECTS: readonly WorkflowMediaAspect[] = [
  "1:1",
  "4:3",
  "16:9",
  "9:16",
  "4:5",
  "5:4",
];
const WORKFLOW_IMAGE_ASPECTS = WORKFLOW_MEDIA_CATALOG_V1_ASPECTS;
const WORKFLOW_VIDEO_ASPECTS: readonly WorkflowMediaAspect[] = ["1:1", "4:3", "16:9", "9:16"];
export const WORKFLOW_MEDIA_LEGACY_ASPECTS: readonly WorkflowMediaAspect[] = WORKFLOW_VIDEO_ASPECTS;

export const WORKFLOW_MEDIA_CUSTOM_ASPECT = "custom";
export const WORKFLOW_MEDIA_SIZE_MIN = 64;
export const WORKFLOW_MEDIA_SIZE_MAX = 4096;

export interface WorkflowMediaSize {
  width: number;
  height: number;
}

export type WorkflowMediaProvider = "codex" | "grok" | "sunra" | "higgsfield";

export interface WorkflowMediaModel {
  id: string;
  provider: WorkflowMediaProvider;
  name: string;
  maker: string;
  subscription: string;
  credits?: boolean;
  providerModel?: string;
  kinds: readonly WorkflowMediaKind[];
  voices: boolean;
  aspects?: readonly WorkflowMediaAspect[];
  durations?: readonly number[];
  resolutions?: readonly string[];
  transparent?: boolean;
  options?: readonly WorkflowMediaOption[];
  inputs?: readonly WorkflowMediaInput[];
  modes?: readonly WorkflowMediaMode[];
}

export interface WorkflowMediaOption {
  name: string;
  kind: "switch" | "choice";
  values: readonly string[];
  default: string;
}

export interface WorkflowMediaOptionValue {
  name: string;
  value: string;
}

export const WORKFLOW_MEDIA_INPUTS = ["frames", "references", "videos", "audios"] as const;
export type WorkflowMediaInput = (typeof WORKFLOW_MEDIA_INPUTS)[number];

export interface WorkflowMediaMode {
  value: string;
  inputs: readonly WorkflowMediaInput[];
}
export const WORKFLOW_MEDIA_MODE_OPTION = "mode";

export const WORKFLOW_MEDIA_OPTIONS_MAX = 16;
export const WORKFLOW_MEDIA_OPTION_VALUES_MAX = 16;
export const WORKFLOW_MEDIA_OPTION_TEXT_MAX = 64;
export const WORKFLOW_MEDIA_SWITCH_VALUES = ["off", "on"] as const;

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

export const WORKFLOW_PICTURE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"]);

export const WORKFLOW_VIDEO_DURATIONS = [6, 10] as const;
export const WORKFLOW_VIDEO_RESOLUTIONS = ["480p", "720p"] as const;

export const WORKFLOW_VIDEO_VOICES = [
  { id: "ara", name: "Ara" },
  { id: "eve", name: "Eve" },
  { id: "leo", name: "Leo" },
  { id: "rex", name: "Rex" },
] as const;
export type WorkflowVideoVoice = (typeof WORKFLOW_VIDEO_VOICES)[number]["id"];

export function workflowMediaKind(fields: WorkflowFields): WorkflowMediaKind {
  return fields.media === "video" ? "video" : "image";
}

type WorkflowMediaRange = Pick<WorkflowMediaModel, "aspects" | "durations" | "resolutions" | "transparent" | "options">;

export function workflowMediaAspects(
  model: WorkflowMediaRange | null | undefined,
  kind: WorkflowMediaKind,
): readonly WorkflowMediaAspect[] {
  return model?.aspects ?? (kind === "video" ? WORKFLOW_VIDEO_ASPECTS : WORKFLOW_IMAGE_ASPECTS);
}

export function workflowVideoDurations(model: WorkflowMediaRange | null | undefined): readonly number[] {
  return model?.durations ?? WORKFLOW_VIDEO_DURATIONS;
}

export const WORKFLOW_MEDIA_CATALOG_DURATIONS_MAX = 64;
const WORKFLOW_VIDEO_LENGTH_CHOICES = 5;

export function workflowVideoLengthChoices(durations: readonly number[]): number[] {
  const sorted = [...new Set(durations)].sort((left, right) => left - right);
  if (sorted.length <= WORKFLOW_VIDEO_LENGTH_CHOICES) return sorted;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return sorted.filter((value) => value === first || value === last || value % 5 === 0);
}

export function workflowMediaResolutions(
  model: WorkflowMediaRange | null | undefined,
  kind: WorkflowMediaKind,
): readonly string[] {
  return model?.resolutions ?? (kind === "video" ? WORKFLOW_VIDEO_RESOLUTIONS : []);
}

export function isWorkflowMediaSide(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= WORKFLOW_MEDIA_SIZE_MIN &&
    value <= WORKFLOW_MEDIA_SIZE_MAX
  );
}

export function workflowMediaSize(fields: WorkflowFields, kind: WorkflowMediaKind): WorkflowMediaSize | null {
  if (kind !== "image" || fields.aspect !== WORKFLOW_MEDIA_CUSTOM_ASPECT) return null;
  const { width, height } = fields;
  return isWorkflowMediaSide(width) && isWorkflowMediaSide(height) ? { width, height } : null;
}

function nearestAspect(aspects: readonly WorkflowMediaAspect[], size: WorkflowMediaSize): WorkflowMediaAspect {
  const wanted = Math.log(size.width / size.height);
  const distance = (aspect: WorkflowMediaAspect) => {
    const [width = 1, height = 1] = aspect.split(":").map(Number);
    return Math.abs(Math.log(width / height) - wanted);
  };
  return aspects.reduce((best, aspect) => (distance(aspect) < distance(best) ? aspect : best), aspects[0] ?? "1:1");
}

function resolutionPixels(resolution: string): number | null {
  const match = /^(\d+)K$/i.exec(resolution);
  return match ? Number(match[1]) * 1024 : null;
}

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

export interface WorkflowMediaSpecs {
  aspect: WorkflowMediaAspect;
  duration: number;
  resolution: string | null;
  transparent: boolean;
  size: WorkflowMediaSize | null;
  options: readonly WorkflowMediaOptionValue[];
}

export function workflowMediaOptions(
  fields: WorkflowFields,
  model: WorkflowMediaRange | null | undefined,
): WorkflowMediaOptionValue[] {
  const options = model?.options;
  if (!options?.length || typeof fields.options !== "string" || !fields.options) return [];
  let chosen: unknown;
  try {
    chosen = JSON.parse(fields.options);
  } catch {
    return [];
  }
  if (!isDynamicRecord(chosen)) return [];
  return options.flatMap((option) => {
    const value = chosen[option.name];
    return typeof value === "string" && option.values.includes(value) ? [{ name: option.name, value }] : [];
  });
}

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
  const preferred = (typeof fields.resolution === "string" ? fields.resolution : "720p").toLowerCase();
  const resolution = size
    ? resolutionForSize(resolutions, size)
    : (resolutions.find((value) => value.toLowerCase() === preferred) ?? resolutions[0] ?? null);
  const transparent = kind === "image" && model?.transparent === true && fields.background === "transparent";
  return { aspect, duration, resolution, transparent, size, options: workflowMediaOptions(fields, model) };
}

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

export interface WorkflowNodeSize {
  width?: number;
  height?: number;
  font?: number;
}

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  at: WorkflowPoint;
  size?: WorkflowNodeSize;
  locked?: boolean;
  fields: WorkflowFields;
  schedule?: RoutineSchedule;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  type: WorkflowPortType;
  branch?: WorkflowBranch;
}

export interface WorkflowStroke {
  id: string;
  brush: string;
  color: string;
  width: number;
  points: WorkflowPoint[];
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  strokes: WorkflowStroke[];
}

type LoopNode = { id: string; at?: { x: number; y: number } };
type LoopEdge = { id: string; from: string; to: string };

export function workflowLoopEdges(nodes: readonly LoopNode[], edges: readonly LoopEdge[]): Set<string> {
  const { order, cyclic } = walkOrder(nodes, edges);
  const loops = new Set(edges.filter((edge) => edge.from === edge.to).map((edge) => edge.id));
  if (!cyclic) return loops;
  const place = new Map(nodes.map((node) => [node.id, node.at]));
  const into = loopEdgesBy(edges, "to");
  const firstReached = (ids: readonly string[]) =>
    ids.reduce((best, id) =>
      (order.get(id) ?? Number.POSITIVE_INFINITY) < (order.get(best) ?? Number.POSITIVE_INFINITY) ? id : best,
    );
  const pending = [new Set(nodes.map((node) => node.id))];
  for (let group = pending.pop(); group; group = pending.pop()) {
    const inside = edges.filter((edge) => group.has(edge.from) && group.has(edge.to) && !loops.has(edge.id));
    for (const loop of loopGroups(group, inside)) {
      const entries = [...loop].filter((id) => (into.get(id) ?? []).some((edge) => !loop.has(edge.from)));
      const start = entries.length > 0 ? firstReached(topLeft(entries, place)) : firstReached([...loop]);
      for (const edge of inside) if (edge.to === start && loop.has(edge.from)) loops.add(edge.id);
      pending.push(loop);
    }
  }
  return loops;
}

function topLeft(ids: readonly string[], place: ReadonlyMap<string, { x: number; y: number } | undefined>): string[] {
  const placed = ids.filter((id) => place.get(id));
  if (placed.length < ids.length) return [...ids];
  const x = Math.min(...placed.map((id) => place.get(id)?.x ?? 0));
  const left = placed.filter((id) => place.get(id)?.x === x);
  const y = Math.min(...left.map((id) => place.get(id)?.y ?? 0));
  return left.filter((id) => place.get(id)?.y === y);
}

function walkOrder(
  nodes: readonly LoopNode[],
  edges: readonly LoopEdge[],
): { order: Map<string, number>; cyclic: boolean } {
  const next = loopEdgesBy(edges, "from");
  const entered = new Set(edges.map((edge) => edge.to));
  const starts = [...nodes.filter((node) => !entered.has(node.id)), ...nodes.filter((node) => entered.has(node.id))];
  const order = new Map<string, number>();
  const open = new Set<string>();
  let cyclic = false;
  for (const { id: start } of starts) {
    if (order.has(start)) continue;
    order.set(start, order.size);
    open.add(start);
    const stack = [{ id: start, index: 0 }];
    for (let top = stack.at(-1); top; top = stack.at(-1)) {
      const edge = next.get(top.id)?.[top.index];
      if (!edge) {
        stack.pop();
        open.delete(top.id);
        continue;
      }
      top.index += 1;
      if (open.has(edge.to)) cyclic = true;
      else if (!order.has(edge.to)) {
        order.set(edge.to, order.size);
        open.add(edge.to);
        stack.push({ id: edge.to, index: 0 });
      }
    }
  }
  return { order, cyclic };
}

function loopGroups(group: ReadonlySet<string>, inside: readonly LoopEdge[]): Set<string>[] {
  const next = loopEdgesBy(inside, "from");
  const back = loopEdgesBy(inside, "to");
  const placed = new Set<string>();
  const loops: Set<string>[] = [];
  for (const id of group) {
    if (placed.has(id)) continue;
    const behind = reachedBy(id, back, "from");
    const loop = new Set([...reachedBy(id, next, "to")].filter((each) => behind.has(each)));
    for (const each of loop) placed.add(each);
    if (loop.size > 1) loops.push(loop);
  }
  return loops;
}

function loopEdgesBy(edges: readonly LoopEdge[], end: "from" | "to"): Map<string, LoopEdge[]> {
  const map = new Map<string, LoopEdge[]>();
  for (const edge of edges) {
    const list = map.get(edge[end]);
    if (list) list.push(edge);
    else map.set(edge[end], [edge]);
  }
  return map;
}

function reachedBy(origin: string, edges: ReadonlyMap<string, readonly LoopEdge[]>, end: "from" | "to"): Set<string> {
  const seen = new Set([origin]);
  const pending = [origin];
  for (let id = pending.pop(); id !== undefined; id = pending.pop())
    for (const edge of edges.get(id) ?? [])
      if (!seen.has(edge[end])) {
        seen.add(edge[end]);
        pending.push(edge[end]);
      }
  return seen;
}

export type WorkflowGraphProblem = "annotation" | "port" | "branch" | "condition-branch" | "duplicate";

const ALL_PORTS = ["text", "image", "file"] as const satisfies readonly WorkflowPortType[];

export const WORKFLOW_PORTS: Readonly<
  Record<WorkflowNodeKind, { in: readonly WorkflowPortType[]; out: readonly WorkflowPortType[] }>
> = {
  trigger: { in: [], out: ["text"] },
  prompt: { in: [], out: ["text"] },
  asset: { in: [], out: ALL_PORTS },
  llm: { in: ALL_PORTS, out: ["text"] },
  agent: { in: ALL_PORTS, out: ["text"] },
  image: { in: ["text", "image", "file"], out: ["image", "file"] },
  condition: { in: ["text"], out: ["text"] },
  approval: { in: ["text"], out: ["text"] },
  output: { in: ALL_PORTS, out: [] },
  text: { in: [], out: [] },
  note: { in: [], out: [] },
  shape: { in: [], out: [] },
};

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

export function workflowGraphProblemAt(
  graph: WorkflowGraph,
): { problem: WorkflowGraphProblem; edge: WorkflowEdge } | null {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) return { problem: "port", edge };
    const problem = workflowEdgeProblem(from, to, edge);
    if (problem) return { problem, edge };
    const key = `${edge.from}\u0000${edge.to}\u0000${edge.type}\u0000${edge.branch ?? ""}`;
    if (seen.has(key)) return { problem: "duplicate", edge };
    seen.add(key);
  }
  return null;
}

export function workflowGraphProblem(graph: WorkflowGraph): WorkflowGraphProblem | null {
  return workflowGraphProblemAt(graph)?.problem ?? null;
}

export function nodeAgentId(node: WorkflowNode): string | null {
  const agentId = node.fields.agentId;
  return node.kind === "agent" && typeof agentId === "string" && agentId.length > 0 ? agentId : null;
}

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
export const WORKFLOW_AUTO_VERSION_INTERVAL_MS = 5 * 60_000;
export const WORKFLOW_MAX_VERSIONS = 50;

export interface WorkflowSummary {
  id: string;
  title: string;
  steps: number;
  updatedAt: string;
  lastRun: { status: WorkflowRunStatus; at: string } | null;
}

export interface WorkflowTriggerState {
  nodeId: string;
  type: WorkflowTriggerType;
  nextDueAt: string | null;
  webhookUrl: string | null;
}

export interface WorkflowDetail {
  summary: WorkflowSummary;
  graph: WorkflowGraph;
  revision: number;
  triggers: WorkflowTriggerState[];
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
  triggerNodeId: string | null;
  source: WorkflowRunSource;
  status: WorkflowRunStatus;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface WorkflowStep {
  id: string;
  workflowId: string;
  runId: string | null;
  nodeId: string;
  attempt: number;
  agentId: string | null;
  status: WorkflowStepStatus;
  output: string | null;
  branch: WorkflowBranch | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

export interface WorkflowStepSource {
  from: string;
  type: WorkflowPortType;
  stepId: string | null;
  attachmentId: string | null;
}

export interface WorkflowStepSettings {
  settings: WorkflowFields | null;
  sources: WorkflowStepSource[] | null;
}

export interface WorkflowRunDetail {
  run: WorkflowRun;
  steps: WorkflowStep[];
}

export interface WorkflowRunPage {
  runs: WorkflowRunDetail[];
  soloSteps: WorkflowStep[];
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
  requestId: string;
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

export interface WorkflowWebhookSecret {
  secret: string;
}

export const WORKFLOW_MAX_COORDINATE = 1_000_000;
const MAX_SIZE = 100_000;
const FIELD_NAME = 64;
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

export function isWorkflowFields(value: unknown): value is WorkflowFields {
  return isFields(value);
}

export function isWorkflowStepSource(value: unknown): value is WorkflowStepSource {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.from) &&
    isOneOf(WORKFLOW_PORT_TYPES, value.type) &&
    (value.stepId === null || isIdentifier(value.stepId)) &&
    (value.attachmentId === null || isIdentifier(value.attachmentId))
  );
}

export function isWorkflowStepSettings(value: unknown): value is WorkflowStepSettings {
  return (
    isDynamicRecord(value) &&
    (value.settings === null || isWorkflowFields(value.settings)) &&
    (value.sources === null || (Array.isArray(value.sources) && value.sources.every(isWorkflowStepSource)))
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

export interface WorkflowMediaProviders {
  sunra: boolean;
  higgsfield: boolean;
  accounts: readonly WorkflowMediaServiceAccount[] | null;
}

export const WORKFLOW_MEDIA_SERVICE_ACCOUNT_MAX = 32;
export const WORKFLOW_MEDIA_SERVICE_ACCOUNT_NAME_MAX = 80;

export interface WorkflowMediaServiceAccount {
  provider: WorkflowCatalogProvider;
  id: string;
  name: string | null;
}

export function isWorkflowMediaServiceAccount(value: unknown): value is WorkflowMediaServiceAccount {
  return (
    isDynamicRecord(value) &&
    isOneOf(WORKFLOW_CATALOG_PROVIDERS, value.provider) &&
    isIdentifier(value.id) &&
    (value.name === null || isBoundedString(value.name, WORKFLOW_MEDIA_SERVICE_ACCOUNT_NAME_MAX))
  );
}

const isNullableListOf = <T>(value: unknown, item: (entry: unknown) => entry is T): value is readonly T[] | null =>
  value === null || (Array.isArray(value) && value.length <= WORKFLOW_MEDIA_SERVICE_ACCOUNT_MAX && value.every(item));

export function isWorkflowMediaProviders(value: unknown): value is WorkflowMediaProviders {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.sunra) &&
    isBoolean(value.higgsfield) &&
    isNullableListOf(value.accounts, isWorkflowMediaServiceAccount)
  );
}

export interface WorkflowMediaCreditBalance {
  available: number;
  quota: number | null;
}

export interface WorkflowMediaCredits {
  sunra: WorkflowMediaCreditBalance | null;
  higgsfield: WorkflowMediaCreditBalance | null;
  accounts: readonly WorkflowMediaAccountCredits[] | null;
}

export interface WorkflowMediaAccountCredits extends WorkflowMediaServiceAccount {
  credits: WorkflowMediaCreditBalance | null;
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
    (value.higgsfield === null || isWorkflowMediaCreditBalance(value.higgsfield)) &&
    isNullableListOf(value.accounts, isWorkflowMediaAccountCredits)
  );
}

export function isWorkflowMediaAccountCredits(value: unknown): value is WorkflowMediaAccountCredits {
  return (
    isWorkflowMediaServiceAccount(value) &&
    isDynamicRecord(value) &&
    (value.credits === null || isWorkflowMediaCreditBalance(value.credits))
  );
}

export type WorkflowCatalogProvider = "sunra" | "higgsfield";
export const WORKFLOW_CATALOG_PROVIDERS: readonly WorkflowCatalogProvider[] = ["sunra", "higgsfield"];
export const WORKFLOW_MEDIA_CATALOG_MAX = 1000;

export const workflowCatalogProvider = (id: string): WorkflowCatalogProvider | null =>
  id.startsWith("sunra-") ? "sunra" : id.startsWith("higgsfield-") ? "higgsfield" : null;
const WORKFLOW_MEDIA_NAME_MAX = 160;
const WORKFLOW_MEDIA_MAKER_MAX = 120;
const WORKFLOW_MEDIA_RESOLUTION_MAX = 16;

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
  options?: readonly WorkflowMediaOption[];
  inputs?: readonly WorkflowMediaInput[];
  modes?: readonly WorkflowMediaMode[];
}

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
    isListOf(value.aspects, WORKFLOW_MEDIA_ASPECTS.length, (entry): entry is WorkflowMediaAspect =>
      isOneOf(WORKFLOW_MEDIA_ASPECTS, entry),
    ) &&
    isListOf(value.durations, WORKFLOW_MEDIA_CATALOG_DURATIONS_MAX, isCreditCount) &&
    isListOf(value.resolutions, 16, (entry): entry is string =>
      isBoundedString(entry, WORKFLOW_MEDIA_RESOLUTION_MAX),
    ) &&
    isBoolean(value.transparent) &&
    (value.options === undefined || isListOf(value.options, WORKFLOW_MEDIA_OPTIONS_MAX, isWorkflowMediaOption)) &&
    (value.inputs === undefined || isListOf(value.inputs, WORKFLOW_MEDIA_INPUTS.length, isWorkflowMediaInput)) &&
    (value.modes === undefined || isListOf(value.modes, WORKFLOW_MEDIA_OPTION_VALUES_MAX, isWorkflowMediaMode))
  );
}

const isWorkflowMediaInput = (value: unknown): value is WorkflowMediaInput => isOneOf(WORKFLOW_MEDIA_INPUTS, value);

function isWorkflowMediaMode(value: unknown): value is WorkflowMediaMode {
  return (
    isDynamicRecord(value) &&
    isOptionText(value.value) &&
    isListOf(value.inputs, WORKFLOW_MEDIA_INPUTS.length, isWorkflowMediaInput)
  );
}

const isOptionText = (value: unknown): value is string =>
  isBoundedString(value, WORKFLOW_MEDIA_OPTION_TEXT_MAX) && value.length > 0;

function isWorkflowMediaOption(value: unknown): value is WorkflowMediaOption {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.name) &&
    isOneOf(["switch", "choice"] as const, value.kind) &&
    isListOf(value.values, WORKFLOW_MEDIA_OPTION_VALUES_MAX, isOptionText) &&
    isOptionText(value.default)
  );
}

function isWorkflowMediaOptionValue(value: unknown): value is WorkflowMediaOptionValue {
  return isDynamicRecord(value) && isIdentifier(value.name) && isOptionText(value.value);
}

export function isWorkflowMediaCatalog(value: unknown): value is WorkflowMediaCatalog {
  return isDynamicRecord(value) && isListOf(value.models, WORKFLOW_MEDIA_CATALOG_MAX, isWorkflowMediaCatalogModel);
}

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
    ...(entry.options?.length ? { options: entry.options } : {}),
    ...(kind === "video" && entry.inputs ? { inputs: entry.inputs } : {}),
    ...(kind === "video" && entry.modes?.length ? { modes: entry.modes } : {}),
  };
}

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

export interface WorkflowMediaPriceRequest {
  model: string;
  kind: WorkflowMediaKind;
  aspect: WorkflowMediaAspect;
  duration: number;
  resolution: string | null;
  transparent: boolean;
  options?: readonly WorkflowMediaOptionValue[];
}

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
    isBoolean(value.transparent) &&
    (value.options === undefined || isListOf(value.options, WORKFLOW_MEDIA_OPTIONS_MAX, isWorkflowMediaOptionValue))
  );
}

export function isWorkflowMediaPrice(value: unknown): value is WorkflowMediaPrice {
  return (
    isDynamicRecord(value) &&
    (value.credits === null ||
      (isFiniteNumber(value.credits) && value.credits >= 0 && value.credits <= WORKFLOW_MEDIA_PRICE_MAX))
  );
}
