/**
 * A workflow that a model drafts from a chat in the user's words. The model writes a short reply and
 * the steps and the connections as JSON, or only a question; this module gives the ids, the port types
 * and the positions, and checks the draft with the same rules as a save. Annotations and drawings of
 * the current graph stay.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isRoutineSchedule,
  isWorkflowGraph,
  isWorkflowStepKind,
  WORKFLOW_PORTS,
  type WorkflowChatMessage,
  type WorkflowEdge,
  type WorkflowFields,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeKind,
  workflowGraphProblemAt,
  workflowLoopEdges,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";

/** What the model may choose from on this host. */
export interface WorkflowDraftContext {
  agents: readonly { id: string; name: string; description: string; provider: string; model: string }[];
  places: readonly { connectionId: string; placeId: string; label: string }[];
}

/** The kinds a draft may use. Assets and images need files and image models that a draft cannot pick. */
const DRAFT_KINDS = ["trigger", "prompt", "llm", "agent", "condition", "approval", "output"] as const;
const DRAFT_TRIGGERS = ["manual", "schedule", "webhook"] as const;
const DRAFT_OUTPUTS = ["notify", "channel"] as const;
/** The field names a draft may set on each kind; the host reads these (see `WorkflowFields`). */
const DRAFT_FIELDS = {
  trigger: ["trigger"],
  prompt: ["text"],
  llm: ["prompt", "system"],
  agent: ["agentId", "task"],
  condition: ["rule"],
  approval: ["question"],
  output: ["target", "connectionId", "placeId"],
} as const satisfies Record<(typeof DRAFT_KINDS)[number], readonly string[]>;

/** The default card size and the gaps of the layout, in world pixels, as a new card on the canvas. */
const COLUMN = 300 + 80;
const ROW = 240 + 60;

export function draftPrompt(
  request: string,
  history: readonly WorkflowChatMessage[],
  current: WorkflowGraph,
  context: WorkflowDraftContext,
  problem?: string,
): string {
  const steps = current.nodes
    .filter((node) => isWorkflowStepKind(node.kind))
    .map(({ id, kind, fields, schedule }) => ({ id, kind, fields, ...(schedule ? { schedule } : {}) }));
  const edges = current.edges.map(({ from, to, branch }) => ({ from, to, ...(branch ? { branch } : {}) }));
  const agents = context.agents.map(({ id, name, description }) => ({ id, name, description }));
  return [
    "You build workflows for OpenBot. A workflow is a graph of steps that a trigger starts. Each step",
    "gets the text of the steps before it and hands its own output on along the edges.",
    "",
    "Step kinds and their fields (all field values are strings):",
    '- trigger: starts the run. fields.trigger is "manual", "schedule" or "webhook". A schedule trigger',
    '  also has "schedule": one of {"kind":"hourly","minute":0}, {"kind":"daily","time":"09:00"},',
    '  {"kind":"weekdays","time":"09:00"}, {"kind":"weekly","weekday":1,"time":"09:00"} (0 is Sunday),',
    '  {"kind":"monthly","day":1,"time":"09:00"}. No edge goes into a trigger.',
    "- prompt: fixed text that feeds the next steps. fields.text. No edge goes into a prompt.",
    "- llm: one model answer without tools. fields.prompt, and optional fields.system.",
    "- agent: one of the agents below does a task with its tools. fields.agentId (an id from the list) and fields.task.",
    "- condition: a yes-or-no question about its input. fields.rule. Each edge out of it has",
    '  "branch": "yes" or "no".',
    "- approval: waits for a person to approve. fields.question.",
    '- output: the end of a branch. fields.target is "notify" (a notification on this computer) or',
    '  "channel" (a post; then fields.connectionId and fields.placeId from the places below). No edge goes out of an output.',
    "",
    `Agents: ${JSON.stringify(agents)}`,
    `Places: ${JSON.stringify(context.places)}`,
    "",
    `The current workflow: ${JSON.stringify({ nodes: steps, edges })}`,
    "Keep the id of each current step that you keep. Give each new step a new short id.",
    "If the request does not need the current steps, replace them.",
    "",
    ...(history.length > 0
      ? [`The chat before this request: ${JSON.stringify(history.map(({ role, text }) => ({ role, text })))}`]
      : []),
    `The request: ${request}`,
    ...(problem ? ["", `Your last answer was refused: ${problem} Fix it.`] : []),
    "",
    "Answer with JSON only, no other text.",
    'To change the workflow: {"reply","nodes":[{"id","kind","fields","schedule"?}],"edges":[{"from","to","branch"?}]}.',
    '"reply" tells the user in one or two short sentences what you changed.',
    'If the request is not clear enough to build, ask one short question and change nothing: {"reply"}.',
  ].join("\n");
}

/**
 * The model's answer: a reply with a graph that can run, a reply with no graph (a question), or the
 * reason to give the model when the answer cannot be used.
 */
export function draftedGraph(
  answer: string,
  current: WorkflowGraph,
  context: WorkflowDraftContext,
  newId: () => string = () => crypto.randomUUID(),
): { reply: string; graph: WorkflowGraph | null } | { problem: string } {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  let draft: unknown;
  try {
    draft = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return { problem: "The answer was not JSON." };
  }
  if (!isDynamicRecord(draft)) return { problem: "The answer must be a JSON object." };
  const reply = typeof draft.reply === "string" ? draft.reply.trim().slice(0, INPUT_LIMITS.workflowDraftRequest) : "";
  if (draft.nodes === undefined && draft.edges === undefined)
    return reply ? { reply, graph: null } : { problem: 'A question needs a "reply".' };
  if (!Array.isArray(draft.nodes) || !Array.isArray(draft.edges))
    return { problem: 'The answer must have "nodes" and "edges" lists.' };
  if (draft.nodes.length === 0) return { problem: "The workflow has no steps." };

  const kept = new Map(current.nodes.filter((node) => isWorkflowStepKind(node.kind)).map((node) => [node.id, node]));
  /** The id of each drafted step on the canvas: a kept step keeps its id, a new one gets a new id. */
  const ids = new Map<string, string>();
  const steps: WorkflowNode[] = [];
  for (const node of draft.nodes) {
    if (!isDynamicRecord(node) || typeof node.id !== "string" || node.id.length === 0)
      return { problem: "Each node needs a string id." };
    if (ids.has(node.id)) return { problem: `Two nodes have the id "${node.id}".` };
    if (!isOneOf(DRAFT_KINDS, node.kind))
      return {
        problem: `Node "${node.id}" has kind ${JSON.stringify(node.kind)}; use one of ${DRAFT_KINDS.join(", ")}.`,
      };
    const kind = node.kind;
    const given = isDynamicRecord(node.fields) ? node.fields : {};
    const fields: WorkflowFields = {};
    for (const name of DRAFT_FIELDS[kind]) {
      const value = given[name];
      if (typeof value === "string" && value.length > 0) fields[name] = value.slice(0, INPUT_LIMITS.workflowNodeText);
    }
    const problem = fieldProblem(node.id, kind, fields, context);
    if (problem) return { problem };
    if (kind === "agent") {
      const agent = context.agents.find((candidate) => candidate.id === fields.agentId);
      // The card shows the agent's model, as one that a person adds.
      if (agent) Object.assign(fields, { provider: agent.provider, model: agent.model });
    }
    const before = kept.get(node.id);
    const base = before?.kind === kind ? before : undefined;
    const id = base ? node.id : newId();
    ids.set(node.id, id);
    // The view state of a kept step, such as its size or colour, stays.
    const step: WorkflowNode = {
      id,
      kind,
      at: { x: 0, y: 0 },
      ...(base?.size ? { size: base.size } : {}),
      ...(base?.locked === undefined ? {} : { locked: base.locked }),
      fields: base ? { ...base.fields, ...fields } : fields,
    };
    if (kind === "trigger" && fields.trigger === "schedule") {
      if (!isRoutineSchedule(node.schedule) || node.schedule.kind === "once")
        return { problem: `Schedule trigger "${node.id}" needs a valid "schedule".` };
      step.schedule = node.schedule;
    }
    steps.push(step);
  }

  const edges: WorkflowEdge[] = [];
  for (const edge of draft.edges) {
    if (!isDynamicRecord(edge)) return { problem: "Each edge must be an object." };
    const from = typeof edge.from === "string" ? ids.get(edge.from) : undefined;
    const to = typeof edge.to === "string" ? ids.get(edge.to) : undefined;
    const source = steps.find((step) => step.id === from);
    const target = steps.find((step) => step.id === to);
    if (!from || !to || !source || !target)
      return { problem: `Edge ${JSON.stringify(edge)} names a node that is not in "nodes".` };
    const type = WORKFLOW_PORTS[source.kind].out.find((port) => WORKFLOW_PORTS[target.kind].in.includes(port));
    if (!type) return { problem: `A ${source.kind} step cannot connect to a ${target.kind} step.` };
    const branch = edge.branch === "yes" || edge.branch === "no" ? edge.branch : undefined;
    if (source.kind === "condition" && !branch)
      return { problem: `Each edge out of condition "${edge.from}" needs "branch": "yes" or "no".` };
    edges.push({ id: newId(), from, to, type, ...(source.kind === "condition" ? { branch } : {}) });
  }

  layout(steps, edges, [...kept.values()]);
  const graph: WorkflowGraph = {
    nodes: [...current.nodes.filter((node) => !isWorkflowStepKind(node.kind)), ...steps],
    edges,
    strokes: current.strokes,
  };
  if (!isWorkflowGraph(graph)) return { problem: "The workflow is too large or has a field that is too long." };
  const refused = workflowGraphProblemAt(graph);
  if (refused)
    return {
      problem: `The edge from "${refused.edge.from}" to "${refused.edge.to}" is not allowed (${refused.problem}).`,
    };
  return { reply, graph };
}

function fieldProblem(
  id: string,
  kind: WorkflowNodeKind,
  fields: WorkflowFields,
  context: WorkflowDraftContext,
): string | null {
  switch (kind) {
    case "trigger":
      return isOneOf(DRAFT_TRIGGERS, fields.trigger)
        ? null
        : `Trigger "${id}" needs fields.trigger: ${DRAFT_TRIGGERS.join(", ")}.`;
    case "agent":
      return context.agents.some((agent) => agent.id === fields.agentId)
        ? null
        : `Agent step "${id}" needs fields.agentId from the agent list.`;
    case "output":
      if (!isOneOf(DRAFT_OUTPUTS, fields.target)) return `Output "${id}" needs fields.target: notify or channel.`;
      return fields.target === "notify" ||
        context.places.some((place) => place.connectionId === fields.connectionId && place.placeId === fields.placeId)
        ? null
        : `Output "${id}" needs fields.connectionId and fields.placeId from the place list.`;
    default:
      return null;
  }
}

/**
 * Puts each step in a column by its distance from the start, and the steps of one column in a row.
 * The grid starts at the top left of the steps that were there before, so the canvas does not jump.
 * ponytail: every step moves to the grid, also a kept one; keep kept positions if people complain.
 */
function layout(steps: WorkflowNode[], edges: readonly WorkflowEdge[], before: readonly WorkflowNode[]): void {
  const loops = workflowLoopEdges(steps, edges);
  const forward = edges.filter((edge) => !loops.has(edge.id));
  const column = new Map(steps.map((step) => [step.id, 0]));
  // Without loop edges the graph has no cycle, so each pass can only push a step further right.
  for (let pass = 0; pass < steps.length; pass += 1)
    for (const edge of forward)
      column.set(edge.to, Math.max(column.get(edge.to) ?? 0, (column.get(edge.from) ?? 0) + 1));
  const origin = {
    x: before.length > 0 ? Math.min(...before.map((node) => node.at.x)) : 0,
    y: before.length > 0 ? Math.min(...before.map((node) => node.at.y)) : 0,
  };
  const rows = new Map<number, number>();
  for (const step of steps) {
    const x = column.get(step.id) ?? 0;
    const y = rows.get(x) ?? 0;
    rows.set(x, y + 1);
    step.at = { x: origin.x + x * COLUMN, y: origin.y + y * ROW };
  }
}
