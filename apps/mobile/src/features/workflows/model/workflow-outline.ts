import {
  isWorkflowStepKind,
  type WorkflowBranch,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
  workflowGraphProblem,
  workflowLoopEdges,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";

/**
 * The phone edits a workflow as lists of steps, not as a canvas. A graph of this shape becomes an
 * outline, and a change to the outline writes the edges of its steps again:
 *
 *   trigger → main… → condition ┬ yes… ┐
 *                               └ no…  ┴→ after…
 *
 * The flow goes through agent, model and approval steps. The ports of the contract decide the rest
 * (`WORKFLOW_PORTS`): an output sends nothing, so it takes the output of the step before it and the
 * flow goes on from that step; a prompt takes nothing, so it feeds the next step of its list. A step
 * that no edge from the trigger reaches is "loose": it keeps its own edges until the person connects
 * or deletes it. One trigger, at most one condition, and each flow step has one way in, except the
 * step where the two paths join. Any other graph keeps its edges: the phone changes only the settings
 * of its steps. The positions of the nodes, the notes, the shapes and the drawings stay as they are.
 */

/** The step kinds that the phone shows, changes and moves. */
const OUTLINE_KINDS = [
  "trigger",
  "agent",
  "llm",
  "condition",
  "approval",
  "output",
  "prompt",
] as const satisfies readonly WorkflowNodeKind[];
export type OutlineKind = (typeof OUTLINE_KINDS)[number];

/** The kinds that the phone adds, in the order of the Add a step page. */
export const ADDABLE_KINDS = [
  "agent",
  "llm",
  "condition",
  "approval",
  "prompt",
  "output",
] as const satisfies readonly OutlineKind[];
export type AddableKind = (typeof ADDABLE_KINDS)[number];

export interface WorkflowOutline {
  trigger: string;
  /** The steps between the trigger and the condition, or all steps without a condition. */
  main: string[];
  condition: string | null;
  yes: string[];
  no: string[];
  /** The steps after the two paths join. Empty: each path ends by itself. */
  after: string[];
  /** The steps that the trigger does not reach. They keep their own edges. */
  loose: string[];
}

/** A list of the outline that holds steps. */
export type OutlineList = "main" | "yes" | "no" | "after" | "loose";
/** The lists that a run goes through, where a new step can go. */
export const FLOW_LISTS = ["main", "yes", "no", "after"] as const satisfies readonly OutlineList[];
export type FlowList = (typeof FLOW_LISTS)[number];
const ALL_LISTS: readonly OutlineList[] = [...FLOW_LISTS, "loose"];

/** How the phone can change a workflow. */
export type WorkflowEditMode =
  /** Steps can be added, moved and deleted. */
  | "outline"
  /** Only the settings of the steps change; the graph has a shape that the outline cannot hold. */
  | "fields"
  /** The workflow has a step of a newer app, and a save would drop it. */
  | "read-only";

/** A step of the outline that cannot run where it is. */
export type OutlineProblem =
  /** A prompt feeds the next step of its list, and there is none. */
  "prompt-target";

function isOutlineKind(kind: WorkflowNodeKind): kind is OutlineKind {
  return isOneOf(OUTLINE_KINDS, kind);
}

function stepNodes(graph: WorkflowGraph): WorkflowNode[] {
  return graph.nodes.filter((node) => isWorkflowStepKind(node.kind));
}

const byPosition = (nodes: ReadonlyMap<string, WorkflowNode>) => (left: string, right: string) => {
  const a = nodes.get(left)?.at;
  const b = nodes.get(right)?.at;
  return (a?.x ?? 0) - (b?.x ?? 0) || (a?.y ?? 0) - (b?.y ?? 0);
};

/** The trigger, the flow steps and the condition, as one chain with two paths. */
interface Core {
  main: string[];
  condition: string | null;
  yes: string[];
  no: string[];
  after: string[];
}

/** The chain of the steps that the trigger reaches, without its outputs and prompts. */
function coreChain(
  trigger: string,
  core: ReadonlySet<string>,
  kinds: ReadonlyMap<string, WorkflowNodeKind>,
  edges: readonly WorkflowEdge[],
): Core | null {
  const out = new Map<string, WorkflowEdge[]>();
  const incoming = new Map<string, number>();
  for (const edge of edges) {
    if (!core.has(edge.from) || !core.has(edge.to)) continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }
  for (const id of core) {
    const ways = out.get(id) ?? [];
    if (kinds.get(id) === "condition") {
      if (ways.some((edge) => !edge.branch)) return null;
      if (ways.filter((edge) => edge.branch === "yes").length > 1) return null;
      if (ways.filter((edge) => edge.branch === "no").length > 1) return null;
    } else if (ways.length > 1) return null;
  }
  if (incoming.has(trigger)) return null;

  const seen = new Set([trigger]);
  const next = (id: string) => out.get(id)?.[0]?.to;
  /** A list that each step enters only from the step before it. It ends at a join, an end or a condition. */
  const run = (first: string | undefined, stopAtCondition: boolean) => {
    const list: string[] = [];
    let current = first;
    while (current && (incoming.get(current) ?? 0) === 1) {
      if (seen.has(current)) return null;
      seen.add(current);
      if (kinds.get(current) === "condition") {
        if (!stopAtCondition) return null;
        return { list, condition: current, rest: undefined };
      }
      list.push(current);
      current = next(current);
    }
    return { list, condition: null, rest: current };
  };

  const start = run(next(trigger), true);
  if (!start || start.rest) return null;
  if (!start.condition)
    return seen.size === core.size ? { main: start.list, condition: null, yes: [], no: [], after: [] } : null;
  const condition = start.condition;
  const branch = (name: WorkflowBranch) => out.get(condition)?.find((edge) => edge.branch === name)?.to;
  const yes = run(branch("yes"), false);
  const no = run(branch("no"), false);
  if (!yes || !no || yes.rest !== no.rest) return null;
  const after: string[] = [];
  const join = yes.rest;
  if (join) {
    if (incoming.get(join) !== 2 || kinds.get(join) === "condition" || seen.has(join)) return null;
    seen.add(join);
    after.push(join);
    const rest = run(next(join), false);
    if (!rest || rest.rest) return null;
    after.push(...rest.list);
  }
  return seen.size === core.size ? { main: start.list, condition, yes: yes.list, no: no.list, after } : null;
}

/** The outline of a graph, or null when the graph has another shape. */
export function workflowOutline(graph: WorkflowGraph): WorkflowOutline | null {
  const steps = stepNodes(graph);
  if (steps.some((node) => !isOutlineKind(node.kind))) return null;
  const triggers = steps.filter((node) => node.kind === "trigger");
  const trigger = triggers[0];
  if (!trigger || triggers.length > 1 || steps.filter((node) => node.kind === "condition").length > 1) return null;
  const nodes = new Map(steps.map((node) => [node.id, node]));
  const kinds = new Map(steps.map((node) => [node.id, node.kind]));
  const edges = graph.edges;
  if (edges.some((edge) => edge.type !== "text" || !kinds.has(edge.from) || !kinds.has(edge.to))) return null;
  if (workflowGraphProblem(graph) || workflowLoopEdges(steps, edges).size > 0) return null;

  // The steps that the trigger reaches; a prompt is never one, as nothing goes into a prompt.
  const reached = new Set([trigger.id]);
  for (let queue = [trigger.id], id = queue.pop(); id; id = queue.pop())
    for (const edge of edges)
      if (edge.from === id && !reached.has(edge.to)) {
        reached.add(edge.to);
        queue.push(edge.to);
      }
  // A prompt that feeds one reached step belongs to that step.
  const prompts = new Map<string, string>();
  for (const node of steps) {
    if (node.kind !== "prompt") continue;
    const targets = edges.filter((edge) => edge.from === node.id).map((edge) => edge.to);
    if (targets.length === 0 || !targets.some((id) => reached.has(id))) continue;
    if (targets.length > 1 || !targets.every((id) => reached.has(id))) return null;
    const [target] = targets;
    if (target) prompts.set(node.id, target);
  }
  const loose = steps.map((node) => node.id).filter((id) => !reached.has(id) && !prompts.has(id));
  const looseSet = new Set(loose);
  // An edge from a loose step into the flow would give a flow step a second way in.
  if (edges.some((edge) => looseSet.has(edge.from) && !looseSet.has(edge.to))) return null;

  const core = new Set([...reached].filter((id) => kinds.get(id) !== "output"));
  const chain = coreChain(trigger.id, core, kinds, edges);
  if (!chain) return null;
  const lists: Record<FlowList, string[]> = { main: chain.main, yes: chain.yes, no: chain.no, after: chain.after };
  const listOf = (id: string) => FLOW_LISTS.find((name) => lists[name].includes(id));

  // Each output goes right after the step that feeds it, or before the join when both paths feed it.
  const placements = new Map<string, string[]>();
  const place = (key: string, id: string) => placements.set(key, [...(placements.get(key) ?? []), id]);
  const laneEnd = (name: WorkflowBranch) => {
    const last = lists[name].at(-1);
    return last ? { from: last, branch: undefined } : { from: chain.condition, branch: name };
  };
  for (const node of steps) {
    if (node.kind !== "output" || !reached.has(node.id)) continue;
    const feeds = edges.filter((edge) => edge.to === node.id && core.has(edge.from));
    const [first, second] = feeds;
    if (feeds.length === 1 && first) {
      if (first.from === chain.condition) {
        if (!first.branch) return null;
        place(`start:${first.branch}`, node.id);
      } else place(`after:${first.from}`, node.id);
    } else if (feeds.length === 2 && first && second && chain.condition) {
      const ends = [laneEnd("yes"), laneEnd("no")];
      const matches = (edge: WorkflowEdge) => ends.some((end) => end.from === edge.from && end.branch === edge.branch);
      if (!matches(first) || !matches(second) || (first.from === second.from && first.branch === second.branch))
        return null;
      place("start:after", node.id);
    } else return null;
  }
  const order = byPosition(nodes);
  const withOutputs = (name: FlowList, items: readonly string[]) => {
    const result = [...(placements.get(`start:${name}`) ?? []).sort(order)];
    if (name === "main") result.push(...(placements.get(`after:${trigger.id}`) ?? []).sort(order));
    for (const id of items) result.push(id, ...(placements.get(`after:${id}`) ?? []).sort(order));
    return result;
  };
  const outline: WorkflowOutline = {
    trigger: trigger.id,
    main: withOutputs("main", lists.main),
    condition: chain.condition,
    yes: withOutputs("yes", lists.yes),
    no: withOutputs("no", lists.no),
    after: withOutputs("after", lists.after),
    loose,
  };
  // Each prompt goes right before the step that it feeds; a prompt of the condition ends the steps before it.
  for (const [prompt, target] of [...prompts].sort(([left], [right]) => order(left, right))) {
    if (target === chain.condition) {
      outline.main.push(prompt);
      continue;
    }
    const name = FLOW_LISTS.find((list) => outline[list].includes(target)) ?? listOf(target);
    if (!name) return null;
    const items = outline[name];
    items.splice(items.indexOf(target), 0, prompt);
  }
  return outline;
}

/** The id that the desktop canvas gives an edge, so both apps write the same edge once. */
function workflowEdgeId(from: string, to: string, branch?: WorkflowBranch): string {
  return `${from}${branch ? `.${branch}` : ""}>${to}:text`;
}

/** The edges of an outline: the flow, each output from the step before it, and each prompt to the next step. */
function outlineEdges(outline: WorkflowOutline, graph: WorkflowGraph): WorkflowEdge[] {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const edges: WorkflowEdge[] = [];
  const link = (from: string, to: string, branch?: WorkflowBranch) =>
    edges.push({ id: workflowEdgeId(from, to, branch), from, to, type: "text", ...(branch ? { branch } : {}) });
  /** A source of the flow: a step, or the condition with the branch of its path. */
  type Source = { from: string; branch?: WorkflowBranch };
  /** Links the items of a list from `sources`, and answers the source after the list and its unfed prompts. */
  const walk = (items: readonly string[], start: Source[]) => {
    let sources = start;
    let prompts: string[] = [];
    for (const id of items) {
      const kind = kinds.get(id);
      if (kind === "prompt") {
        prompts.push(id);
        continue;
      }
      for (const source of sources) link(source.from, id, source.branch);
      for (const prompt of prompts) link(prompt, id);
      prompts = [];
      if (kind !== "output") sources = [{ from: id }];
    }
    return { sources, prompts };
  };
  const main = walk(outline.main, [{ from: outline.trigger }]);
  if (!outline.condition) return edges;
  for (const source of main.sources) link(source.from, outline.condition, source.branch);
  for (const prompt of main.prompts) link(prompt, outline.condition);
  const yes = walk(outline.yes, [{ from: outline.condition, branch: "yes" }]);
  const no = walk(outline.no, [{ from: outline.condition, branch: "no" }]);
  if (outline.after.length > 0) walk(outline.after, [...yes.sources, ...no.sources]);
  return edges;
}

/** The graph with the edges of its outline. The edges between loose steps stay. */
export function graphWithOutline(graph: WorkflowGraph, outline: WorkflowOutline): WorkflowGraph {
  const loose = new Set(outline.loose);
  return {
    ...graph,
    edges: [
      ...outlineEdges(outline, graph),
      ...graph.edges.filter((edge) => loose.has(edge.from) && loose.has(edge.to)),
    ],
  };
}

/** The steps of the outline that cannot run where they are. */
export function outlineProblems(outline: WorkflowOutline, graph: WorkflowGraph): Map<string, OutlineProblem> {
  const kinds = new Map(graph.nodes.map((node) => [node.id, node.kind]));
  const problems = new Map<string, OutlineProblem>();
  for (const name of FLOW_LISTS) {
    // The prompts at the end of the steps before a condition feed the condition.
    if (name === "main" && outline.condition) continue;
    const items = outline[name];
    for (let index = items.length - 1; index >= 0; index--) {
      const id = items[index];
      if (!id || kinds.get(id) !== "prompt") break;
      problems.set(id, "prompt-target");
    }
  }
  return problems;
}

/** The step ids in run order: the trigger, the steps, the condition, yes, no, then after the join. */
function outlineOrder(outline: WorkflowOutline): string[] {
  return [
    outline.trigger,
    ...outline.main,
    ...(outline.condition ? [outline.condition] : []),
    ...outline.yes,
    ...outline.no,
    ...outline.after,
  ];
}

/**
 * The step nodes of any graph in a reading order: the outline order and then the loose steps when
 * there is an outline, else from left to right and from top to bottom, as the canvas shows them.
 */
export function readingOrder(graph: WorkflowGraph): WorkflowNode[] {
  const steps = stepNodes(graph);
  const outline = workflowOutline(graph);
  if (outline) {
    const byId = new Map(steps.map((node) => [node.id, node]));
    return [...outlineOrder(outline), ...outline.loose].flatMap((id) => byId.get(id) ?? []);
  }
  return [...steps].sort((left, right) => left.at.x - right.at.x || left.at.y - right.at.y);
}

/** The width of a node on the canvas: its own size, else the width that the desktop gives its kind. */
const KIND_WIDTH: Partial<Record<WorkflowNodeKind, number>> = {
  prompt: 296,
  agent: 350,
  llm: 350,
  trigger: 280,
  output: 280,
  condition: 300,
  approval: 300,
};
const DEFAULT_WIDTH = 300;
/** The space that the desktop keeps between two cards when it puts a card into an edge. */
const NODE_GAP = 64;
/** How far a path of a condition sits above or below the condition. */
const LANE_OFFSET = 200;
/** The desktop snaps a card to this grid. */
const SNAP = 8;
const snap = (value: number) => Math.round(value / SNAP) * SNAP;

function nodeWidth(node: WorkflowNode): number {
  return node.size?.width ?? KIND_WIDTH[node.kind] ?? DEFAULT_WIDTH;
}

/** The list that holds a step, or null for the trigger and the condition. */
export function outlineListOf(outline: WorkflowOutline, id: string): OutlineList | null {
  return ALL_LISTS.find((list) => outline[list].includes(id)) ?? null;
}

/** The step that runs before position `index` of `list`. */
function stepBefore(outline: WorkflowOutline, list: FlowList, index: number): string {
  if (index > 0) return outline[list][index - 1] ?? outline.trigger;
  if (list === "main") return outline.trigger;
  if (list === "after") return outline.yes.at(-1) ?? outline.no.at(-1) ?? outline.condition ?? outline.trigger;
  return outline.condition ?? outline.trigger;
}

/** The steps that run after position `index` of `list`, which move right to make room for a new card. */
function stepsAfter(outline: WorkflowOutline, list: FlowList, index: number): string[] {
  const rest = outline[list].slice(index);
  if (list === "main") return [...rest, ...outlineOrder(outline).slice(1 + outline.main.length)];
  if (list === "yes" || list === "no") return [...rest, ...outline.after];
  return rest;
}

/**
 * Puts a step at position `index` of `list`. The card goes to the right of the step before it, and
 * the steps after it move right by its width, so the canvas keeps its order.
 */
export function insertStep(
  graph: WorkflowGraph,
  outline: WorkflowOutline,
  list: FlowList,
  index: number,
  node: WorkflowNode,
): { graph: WorkflowGraph; outline: WorkflowOutline } {
  const byId = new Map(graph.nodes.map((item) => [item.id, item]));
  const before = byId.get(stepBefore(outline, list, index));
  const width = nodeWidth(node);
  const x = before ? before.at.x + nodeWidth(before) + NODE_GAP : 0;
  const lane = list === "yes" ? -LANE_OFFSET : list === "no" ? LANE_OFFSET : 0;
  const y = before ? before.at.y + (index === 0 && before.kind === "condition" ? lane : 0) : 0;
  const shift = new Set(stepsAfter(outline, list, index));
  const placed: WorkflowNode = { ...node, at: { x: snap(x), y: snap(y) } };
  const nodes = graph.nodes.map((item) =>
    shift.has(item.id) ? { ...item, at: { x: item.at.x + width + NODE_GAP, y: item.at.y } } : item,
  );
  const items = [...outline[list]];
  items.splice(index, 0, node.id);
  return { graph: { ...graph, nodes: [...nodes, placed] }, outline: { ...outline, [list]: items } };
}

/** A new condition starts the two paths after the last step; the steps after it join the paths. */
export function insertCondition(
  graph: WorkflowGraph,
  outline: WorkflowOutline,
  index: number,
  node: WorkflowNode,
): { graph: WorkflowGraph; outline: WorkflowOutline } {
  const inserted = insertStep(graph, outline, "main", index, node);
  const main = inserted.outline.main;
  return {
    graph: inserted.graph,
    outline: {
      ...inserted.outline,
      main: main.slice(0, index),
      condition: node.id,
      after: [...main.slice(index + 1), ...inserted.outline.after],
    },
  };
}

/** Whether the graph has a condition, in the flow or loose. A workflow has one condition on the phone. */
export function hasCondition(graph: WorkflowGraph): boolean {
  return graph.nodes.some((node) => node.kind === "condition");
}

/**
 * Connects a loose step: it goes to the end of the steps, after the join when there is a condition.
 * Its own edges go, as the outline writes its edges. A loose condition does not connect: its paths
 * have no steps on the phone.
 */
export function connectStep(
  graph: WorkflowGraph,
  outline: WorkflowOutline,
  id: string,
): { graph: WorkflowGraph; outline: WorkflowOutline } | null {
  const node = graph.nodes.find((item) => item.id === id);
  if (!node || node.kind === "condition" || !outline.loose.includes(id)) return null;
  const list: FlowList = outline.condition ? "after" : "main";
  const without: WorkflowGraph = {
    ...graph,
    nodes: graph.nodes.filter((item) => item.id !== id),
    edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
  return insertStep(
    without,
    { ...outline, loose: outline.loose.filter((item) => item !== id) },
    list,
    outline[list].length,
    node,
  );
}

/** Removes a step. A condition takes its two paths with it, and the steps after the join follow the steps before it. */
export function removeStep(
  graph: WorkflowGraph,
  outline: WorkflowOutline,
  id: string,
): { graph: WorkflowGraph; outline: WorkflowOutline } {
  const dropEdges = (gone: ReadonlySet<string>) =>
    graph.edges.filter((edge) => !gone.has(edge.from) && !gone.has(edge.to));
  if (id === outline.condition) {
    const gone = new Set([id, ...outline.yes, ...outline.no]);
    return {
      graph: { ...graph, nodes: graph.nodes.filter((node) => !gone.has(node.id)), edges: dropEdges(gone) },
      outline: { ...outline, main: [...outline.main, ...outline.after], condition: null, yes: [], no: [], after: [] },
    };
  }
  const list = outlineListOf(outline, id);
  if (!list) return { graph, outline };
  return {
    graph: { ...graph, nodes: graph.nodes.filter((node) => node.id !== id), edges: dropEdges(new Set([id])) },
    outline: { ...outline, [list]: outline[list].filter((item) => item !== id) },
  };
}

/** Moves a step one place in its list. The two cards change places on the canvas too. */
export function moveStep(
  graph: WorkflowGraph,
  outline: WorkflowOutline,
  id: string,
  direction: -1 | 1,
): { graph: WorkflowGraph; outline: WorkflowOutline } | null {
  const list = outlineListOf(outline, id);
  if (!list || list === "loose") return null;
  const items = [...outline[list]];
  const index = items.indexOf(id);
  const other = items[index + direction];
  if (!other) return null;
  items[index] = other;
  items[index + direction] = id;
  const first = graph.nodes.find((node) => node.id === id);
  const second = graph.nodes.find((node) => node.id === other);
  if (!first || !second) return null;
  const nodes = graph.nodes.map((node) =>
    node.id === id ? { ...node, at: second.at } : node.id === other ? { ...node, at: first.at } : node,
  );
  return { graph: { ...graph, nodes }, outline: { ...outline, [list]: items } };
}

/** Whether a step can move up or down in its list. A loose step does not run, so it does not move. */
export function canMove(outline: WorkflowOutline, id: string, direction: -1 | 1): boolean {
  const list = outlineListOf(outline, id);
  if (!list || list === "loose") return false;
  const index = outline[list].indexOf(id);
  return index + direction >= 0 && index + direction < outline[list].length;
}
