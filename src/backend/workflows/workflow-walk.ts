import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  DEFAULT_PROVIDER_ACCOUNT_ID,
  isWorkflowStepKind,
  WORKFLOW_VIDEO_VOICES,
  type WorkflowEdge,
  type WorkflowFields,
  type WorkflowGraph,
  type WorkflowMediaKind,
  type WorkflowMediaModel,
  type WorkflowMediaProvider,
  type WorkflowMediaSpecs,
  type WorkflowNode,
  type WorkflowStepSource,
  workflowLoopEdges,
} from "@openbot/contracts/ipc";
import { redactText } from "@openbot/logging";
import { runtimeFields } from "./workflow-graph";
import { isOpenStep, type StoredWorkflowStep } from "./workflow-run-store";

export function unsupportedNode(node: WorkflowNode): boolean {
  if (node.kind === "asset") return fieldText(node, "fileId") === "";
  if (node.kind === "trigger") return node.fields.trigger === "message";
  if (node.kind === "output") return node.fields.target === "file";
  return false;
}

export interface RunStart {
  triggerNodeId: string | null;
  fromNodeId: string | null;
}

export function runScope(
  graph: WorkflowGraph,
  start: RunStart,
  answered: ReadonlySet<string>,
): { nodes: Set<string>; reused: Set<string> } {
  const steps = new Map(graph.nodes.filter((node) => isWorkflowStepKind(node.kind)).map((node) => [node.id, node]));
  const origin = start.triggerNodeId ?? start.fromNodeId;
  if (origin === null || !steps.has(origin)) return { nodes: new Set(steps.keys()), reused: new Set() };
  const loops = workflowLoopEdges(graph.nodes, graph.edges);
  const forward = graph.edges.filter((edge) => !loops.has(edge.id));
  const ahead = reach(origin, outgoing(forward));
  const after = reach(origin, outgoing(graph.edges));
  const before = incoming(graph.edges);
  const nodes = new Set(after);
  const reused = new Set(
    start.fromNodeId === null ? [] : [...after].filter((id) => !ahead.has(id) && answered.has(id)),
  );
  const pending = [...after].filter((id) => !reused.has(id));
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) break;
    for (const edge of before.get(id) ?? []) {
      const source = steps.get(edge.from);
      if (!source || nodes.has(source.id)) continue;
      if (start.triggerNodeId !== null && source.kind === "trigger") continue;
      nodes.add(source.id);
      if (start.fromNodeId !== null && answered.has(source.id)) {
        reused.add(source.id);
        continue;
      }
      pending.push(source.id);
    }
  }
  return { nodes, reused: new Set(graphOrder(graph.nodes, forward, reused)) };
}

export function currentAnswers(
  graph: WorkflowGraph,
  answered: ReadonlyMap<string, StoredWorkflowStep>,
  ranWith: (step: StoredWorkflowStep) => WorkflowGraph | undefined,
): Map<string, StoredWorkflowStep> {
  const changed = [...answered.values()].flatMap((step) => {
    const earlier = ranWith(step);
    return earlier && nodeChanged(step.nodeId, earlier, graph) ? [step.nodeId] : [];
  });
  const loops = workflowLoopEdges(graph.nodes, graph.edges);
  const next = outgoing(graph.edges.filter((edge) => !loops.has(edge.id)));
  const stale = new Set(changed.flatMap((id) => [...reach(id, next)]));
  return new Map([...answered].filter(([id]) => !stale.has(id)));
}

function nodeChanged(id: string, earlier: WorkflowGraph, current: WorkflowGraph): boolean {
  const before = earlier.nodes.find((node) => node.id === id);
  const now = current.nodes.find((node) => node.id === id);
  if (!before || !now || before.kind !== now.kind) return true;
  return now.kind !== "trigger" && readsOf(before, earlier) !== readsOf(now, current);
}

function readsOf(node: WorkflowNode, graph: WorkflowGraph): string {
  const inputs = graph.edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => [edge.from, edge.type, edge.branch ?? null]);
  return JSON.stringify([runtimeFields(node), inputs]);
}

export type WalkAction = { nodeId: string; action: "run"; inputs: string[] } | { nodeId: string; action: "skip" };

export function nextActions(
  graph: WorkflowGraph,
  scope: ReadonlySet<string>,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): WalkAction[] {
  const loops = workflowLoopEdges(graph.nodes, graph.edges);
  const forward = graph.edges.filter((edge) => !loops.has(edge.id));
  const before = incoming(graph.edges);
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const reasons = { before, loops, latest };
  const due = new Set<string>();
  const thisRound = new Set<string>();
  const actions: WalkAction[] = [];
  for (const nodeId of graphOrder(graph.nodes, forward, scope)) {
    const current = latest.get(nodeId);
    if (current && isOpenStep(current)) continue;
    const edges = (before.get(nodeId) ?? []).filter((edge) => scope.has(edge.from));
    const ahead = edges.filter((edge) => !loops.has(edge.id));
    const back = edges.filter((edge) => loops.has(edge.id));
    const newer = (edge: WorkflowEdge) => {
      const source = latest.get(edge.from);
      return source !== undefined && (current === undefined || source.sequence > current.sequence);
    };
    const nextPass = back.some((edge) => {
      const source = latest.get(edge.from);
      return source !== undefined && edgeActive(edge, source) && newer(edge);
    });
    const inputChanges = ahead.some((edge) => newer(edge) || thisRound.has(edge.from));
    if (current && !nextPass && !inputChanges) continue;
    due.add(nodeId);
    if (!current || inputChanges) thisRound.add(nodeId);
    if (ahead.some((edge) => due.has(edge.from) || isWaiting(latest.get(edge.from)))) continue;
    const outside = (before.get(nodeId) ?? []).length > edges.length;
    const answered = edges.some((edge) => {
      const source = latest.get(edge.from);
      return source !== undefined && edgeActive(edge, source);
    });
    if (!answered && (ahead.length > 0 || outside)) {
      actions.push({ nodeId, action: "skip" });
      continue;
    }
    const join = isJoin(kinds.get(nodeId), before.get(nodeId) ?? [], loops);
    actions.push({ nodeId, action: "run", inputs: edgeInputs(join, textEdges(kinds, edges), reasons) });
  }
  return actions;
}

export function soloInputs(
  graph: WorkflowGraph,
  nodeId: string,
  answered: ReadonlyMap<string, StoredWorkflowStep>,
): string[] {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const loops = workflowLoopEdges(graph.nodes, graph.edges);
  const before = incoming(graph.edges);
  const edges = before.get(nodeId) ?? [];
  return edgeInputs(isJoin(kinds.get(nodeId), edges, loops), textEdges(kinds, edges), {
    before,
    loops,
    latest: answered,
  });
}

function textEdges(
  kinds: ReadonlyMap<string, WorkflowNode["kind"]>,
  edges: readonly WorkflowEdge[],
): readonly WorkflowEdge[] {
  return edges.filter((edge) => {
    const kind = kinds.get(edge.from);
    return kind !== "image" && kind !== "asset";
  });
}

export interface MediaInput {
  from: string;
  attachmentId: string;
  file?: true;
}

export function mediaInputs(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): MediaInput[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.edges.flatMap((edge) => {
    if (edge.to !== nodeId || (edge.type !== "image" && edge.type !== "file")) return [];
    const files = edgeFile(nodes.get(edge.from), latest);
    return edge.type === "file" ? files.map((input) => ({ ...input, file: true as const })) : files;
  });
}

export function agentFileInputs(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): string[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const files = graph.edges.flatMap((edge) => (edge.to === nodeId ? edgeFile(nodes.get(edge.from), latest) : []));
  return [...new Set(files.map((file) => file.attachmentId))];
}

export interface StepRecord {
  settings: WorkflowFields;
  sources: WorkflowStepSource[];
}

export function stepRecord(
  graph: WorkflowGraph,
  node: WorkflowNode,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): StepRecord {
  const nodes = new Map(graph.nodes.map((item) => [item.id, item]));
  const sources = graph.edges.flatMap((edge) => {
    if (edge.to !== node.id) return [];
    const source = latest.get(edge.from);
    const stepId = source && edgeActive(edge, source) ? source.id : null;
    const attachmentId = edgeFile(nodes.get(edge.from), latest)[0]?.attachmentId ?? null;
    return stepId === null && attachmentId === null ? [] : [{ from: edge.from, type: edge.type, stepId, attachmentId }];
  });
  return { settings: runtimeFields(node), sources };
}

export function usedMediaSettings(
  kind: WorkflowMediaKind,
  model: WorkflowMediaModel,
  specs: WorkflowMediaSpecs,
): WorkflowFields {
  return {
    model: model.id,
    ...(specs.size ? {} : { aspect: specs.aspect }),
    ...(kind === "image" && model.transparent ? { background: specs.transparent ? "transparent" : "solid" } : {}),
    ...(specs.resolution ? { resolution: specs.resolution } : {}),
    ...(kind === "video" ? { duration: specs.duration } : {}),
  };
}

function edgeFile(node: WorkflowNode | undefined, latest: ReadonlyMap<string, StoredWorkflowStep>): MediaInput[] {
  if (node?.kind === "asset") {
    const attachmentId = fieldText(node, "fileId");
    return attachmentId ? [{ from: node.id, attachmentId }] : [];
  }
  if (node?.kind !== "image") return [];
  const source = latest.get(node.id);
  return source?.status === "done" && source.output ? [{ from: node.id, attachmentId: source.output }] : [];
}

export type MediaImageRole = "first" | "last" | "reference" | "file";
export type MediaPictureRole = Exclude<MediaImageRole, "file">;

export function mediaImages(
  fields: WorkflowFields,
  kind: WorkflowMediaKind,
  inputs: readonly MediaInput[],
): { role: MediaImageRole; attachmentId: string }[] {
  const frame = (name: string) => (kind === "video" && typeof fields[name] === "string" ? fields[name] : null);
  const first = frame("firstFrame");
  const last = frame("lastFrame");
  return inputs.flatMap((input) => {
    if (input.file) return kind === "video" ? [{ role: "file" as const, attachmentId: input.attachmentId }] : [];
    const roles: MediaImageRole[] = [];
    if (input.from === first) roles.push("first");
    if (input.from === last) roles.push("last");
    if (roles.length === 0) roles.push("reference");
    return roles.map((role) => ({ role, attachmentId: input.attachmentId }));
  });
}

export function mediaVoice(fields: WorkflowFields, kind: WorkflowMediaKind, model: WorkflowMediaModel): string | null {
  const voice = fields.voice;
  if (kind !== "video" || !model.voices || typeof voice !== "string") return null;
  return WORKFLOW_VIDEO_VOICES.some((preset) => preset.id === voice) ? voice : null;
}

export function mediaAccount(fields: WorkflowFields): string | null {
  const account = fields.account;
  return typeof account === "string" && account !== "" && account !== DEFAULT_PROVIDER_ACCOUNT_ID ? account : null;
}

const MISSING_ERROR_LIMIT = 300;

interface Reasons {
  before: ReadonlyMap<string, readonly WorkflowEdge[]>;
  loops: ReadonlySet<string>;
  latest: ReadonlyMap<string, StoredWorkflowStep>;
}

function isJoin(
  kind: WorkflowNode["kind"] | undefined,
  edges: readonly WorkflowEdge[],
  loops: ReadonlySet<string>,
): boolean {
  return (kind === "llm" || kind === "agent") && edges.filter((edge) => !loops.has(edge.id)).length > 1;
}

function edgeInputs(join: boolean, edges: readonly WorkflowEdge[], reasons: Reasons): string[] {
  return edges.flatMap((edge) => {
    const source = reasons.latest.get(edge.from);
    if (!source) return [];
    if (edgeActive(edge, source)) return [source.output ?? ""];
    if (!join || reasons.loops.has(edge.id)) return [];
    const reason = missingAnswer(source, reasons, new Set());
    return reason ? [reason] : [];
  });
}

export function endedWithoutAnswer(
  graph: WorkflowGraph,
  nodeId: string,
  latest: ReadonlyMap<string, StoredWorkflowStep>,
): boolean {
  const source = latest.get(nodeId);
  if (!source) return false;
  const reasons = { before: incoming(graph.edges), loops: workflowLoopEdges(graph.nodes, graph.edges), latest };
  return missingAnswer(source, reasons, new Set()) !== null;
}

function missingAnswer(source: StoredWorkflowStep, reasons: Reasons, seen: Set<string>): string | null {
  if (source.status === "failed") return withError("No answer: this step failed.", source.error);
  if (source.status === "stopped") return withError("No answer: this step was stopped.", source.error);
  if (source.status !== "skipped" || seen.has(source.nodeId)) return null;
  seen.add(source.nodeId);
  for (const edge of reasons.before.get(source.nodeId) ?? []) {
    const earlier = reasons.latest.get(edge.from);
    if (reasons.loops.has(edge.id) || !earlier || earlier.status === "done") continue;
    const reason = missingAnswer(earlier, reasons, seen);
    if (reason) return reason.replace("No answer: this step", "No answer: a step before this one");
  }
  return null;
}

function withError(text: string, error: string | null | undefined): string {
  const clean = redactText(error?.trim() ?? "");
  if (!clean) return text;
  const characters = Array.from(clean);
  const quoted =
    characters.length > MISSING_ERROR_LIMIT ? `${characters.slice(0, MISSING_ERROR_LIMIT).join("")}…` : clean;
  return `${text} Error: ${quoted}`;
}

function edgeActive(edge: WorkflowEdge, source: StoredWorkflowStep): boolean {
  if (source.status !== "done") return false;
  return source.kind !== "condition" || edge.branch === source.branch;
}

function isWaiting(step: StoredWorkflowStep | undefined): boolean {
  return step === undefined || isOpenStep(step);
}

function graphOrder(
  nodes: readonly WorkflowNode[],
  forward: readonly WorkflowEdge[],
  scope: ReadonlySet<string>,
): string[] {
  const edges = forward.filter((edge) => scope.has(edge.from) && scope.has(edge.to));
  const remaining = new Map([...scope].map((id) => [id, 0]));
  for (const edge of edges) remaining.set(edge.to, (remaining.get(edge.to) ?? 0) + 1);
  const next = outgoing(edges);
  const ready = nodes.filter((node) => remaining.get(node.id) === 0).map((node) => node.id);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift();
    if (id === undefined) break;
    order.push(id);
    for (const edge of next.get(id) ?? []) {
      const left = (remaining.get(edge.to) ?? 1) - 1;
      remaining.set(edge.to, left);
      if (left === 0) ready.push(edge.to);
    }
  }
  return order;
}

function outgoing(edges: readonly WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  return edgesBy(edges, "from");
}

function incoming(edges: readonly WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  return edgesBy(edges, "to");
}

function edgesBy(edges: readonly WorkflowEdge[], end: "from" | "to"): Map<string, WorkflowEdge[]> {
  const map = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const list = map.get(edge[end]);
    if (list) list.push(edge);
    else map.set(edge[end], [edge]);
  }
  return map;
}

function reach(origin: string, next: ReadonlyMap<string, readonly WorkflowEdge[]>): Set<string> {
  const seen = new Set([origin]);
  const pending = [origin];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined) break;
    for (const edge of next.get(id) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      pending.push(edge.to);
    }
  }
  return seen;
}

export function fieldText(node: WorkflowNode, name: string): string {
  const value = node.fields[name];
  return typeof value === "string" ? value : "";
}

export function inputText(inputs: readonly string[]): string {
  const parts = inputs.map((input) => input.trim()).filter(Boolean);
  const text =
    parts.length <= 1 ? (parts[0] ?? "") : parts.map((part, index) => `Input ${index + 1}:\n\n${part}`).join("\n\n");
  return text.length > INPUT_LIMITS.workflowStepInput ? text.slice(0, INPUT_LIMITS.workflowStepInput) : text;
}

const AGENT_INPUT_BLOCK = "\n\n--- input ---\n";

export function agentStepText(workflowTitle: string, task: string, input: string): string {
  const parts = [`The workflow "${workflowTitle}" gives you one step.`];
  parts.push(task.trim() || "Do this step of the workflow with the input below.");
  const text = parts.join("\n\n");
  return input ? `${text}${AGENT_INPUT_BLOCK}${input}` : text;
}

export function agentHandoffText(text: string, files: number): string {
  if (files === 0) return text;
  const note =
    files === 1
      ? "The attached file comes from a step before this one. Use it as given: keep what it shows, and do not invent a substitute."
      : `The ${files} attached files come from the steps before this one. Use them together as given: keep what they show, and do not invent a substitute.`;
  const input = text.indexOf(AGENT_INPUT_BLOCK);
  return input < 0 ? `${text}\n\n${note}` : `${text.slice(0, input)}\n\n${note}${text.slice(input)}`;
}

export function modelStepPrompt(system: string, prompt: string, input: string): string {
  return [system.trim(), prompt.trim(), input ? `--- input ---\n${input}` : ""].filter(Boolean).join("\n\n");
}

const TRANSPARENT_ASK = {
  codex: "Give it a transparent background: a cut-out PNG with clear pixels around the subject.",
  grok: "Put the subject on one flat, solid background colour, with no shadow, floor, gradient or texture, and keep a margin around the subject. Use pure green #00FF00, or pure magenta #FF00FF when the subject is green. Do not use that colour in the subject.",
} as const satisfies Record<Exclude<WorkflowMediaProvider, "sunra" | "higgsfield" | "openbot">, string>;

export function mediaStepPrompt(
  fields: WorkflowFields,
  kind: WorkflowMediaKind,
  input: string,
  specs: WorkflowMediaSpecs,
  provider: WorkflowMediaProvider,
): string {
  const ask =
    provider === "sunra" || provider === "higgsfield" || provider === "openbot"
      ? ""
      : kind === "video"
        ? `Make one video of ${specs.duration} seconds at ${specs.resolution ?? "720p"}, aspect ratio ${specs.aspect}.`
        : [`Make one image, aspect ratio ${specs.aspect}.`, specs.transparent ? TRANSPARENT_ASK[provider] : ""]
            .filter(Boolean)
            .join(" ");
  const description = typeof fields.prompt === "string" ? fields.prompt.trim() : "";
  const fallback = ask || description || input ? "" : `Make one ${kind} from the input pictures.`;
  return [ask, description, input ? `--- input ---\n${input}` : "", fallback].filter(Boolean).join("\n\n");
}

const GROK_VIDEO_REFERENCE_LIMIT = 14;

export function mediaInputText(
  provider: WorkflowMediaProvider,
  kind: WorkflowMediaKind,
  images: readonly { role: MediaImageRole; path: string }[],
  voice: string | null,
): string {
  const paths = (role: MediaImageRole) => images.filter((image) => image.role === role).map((image) => image.path);
  const references = paths("reference");
  if (provider === "codex")
    return references.length > 0 ? "Use the attached pictures as references for the new image." : "";
  if (kind === "image")
    return references.length > 0
      ? [
          "Edit these pictures into the new image with the image_edit tool:",
          ...references.map((path) => `- ${path}`),
        ].join("\n")
      : "";
  if (images.length === 0 && !voice) return "";
  const lines = ["Make the video with the reference_to_video tool and these inputs:"];
  const first = paths("first")[0];
  const last = paths("last")[0];
  if (first) lines.push(`- first_frame: ${first}`);
  if (last) lines.push(`- last_frame: ${last}`);
  if (references.length > 0) {
    lines.push("- images, in this order; refer to each in the prompt with its <IMAGE_n> tag:");
    lines.push(...references.slice(0, GROK_VIDEO_REFERENCE_LIMIT).map((path) => `  - ${path}`));
  }
  if (voice) lines.push(`- voices: ["${voice}"]; the person who speaks is <AUDIO_1> in the prompt.`);
  return lines.join("\n");
}

export function conditionPrompt(rule: string, input: string): string {
  return [
    "You judge one condition of a workflow. Read the input, then answer with one English word: yes or no. Answer in English also when the condition or the input uses another language.",
    `Condition: ${rule.trim() || "The input is not empty."}`,
    `--- input ---\n${input || "(empty)"}`,
  ].join("\n\n");
}

export function conditionAnswer(text: string): "yes" | "no" | null {
  const word = /^[^a-z]*([a-z]+)/iu.exec(text.trim())?.[1]?.toLowerCase();
  if (word === "yes" || word === "true") return "yes";
  if (word === "no" || word === "false") return "no";
  return null;
}
