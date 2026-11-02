import type {
  RoutineSchedule,
  WorkflowBranch,
  WorkflowDetail,
  WorkflowFieldValue,
  WorkflowGraph,
  WorkflowNode,
} from "@openbot/contracts/ipc";
import * as Crypto from "expo-crypto";
import { create } from "zustand";
import {
  type AddableKind,
  connectStep,
  type FlowList,
  graphWithOutline,
  hasCondition,
  insertCondition,
  insertStep,
  moveStep,
  outlineListOf,
  removeStep,
  type WorkflowEditMode,
  type WorkflowOutline,
  workflowOutline,
} from "./workflow-outline";

/**
 * The workflow that the editor sheet changes. Its pages share one draft: the step and trigger pages
 * change it, and the first page saves it. A new workflow has no id and no revision.
 */
export interface WorkflowDraft {
  serverId: string;
  workflowId: string | null;
  baseRevision: number;
  title: string;
  graph: WorkflowGraph;
  outline: WorkflowOutline | null;
  mode: WorkflowEditMode;
  /** The title and graph as saved, to tell a change from the saved workflow. */
  savedTitle: string;
  savedGraph: string;
  /** The path of the condition that the outline shows. */
  branch: WorkflowBranch;
  /** The schedule on the trigger page cannot be saved, such as a custom schedule without an expression. */
  triggerProblem: boolean;
}

/** What a new step of each kind starts with. An output tells the person; the phone does not choose a place. */
const NEW_FIELDS: Record<AddableKind, Record<string, WorkflowFieldValue>> = {
  agent: {},
  llm: {},
  condition: {},
  approval: {},
  prompt: {},
  output: { target: "notify" },
};

/** A new manual workflow: one trigger, as the desktop starts one. */
const NEW_WORKFLOW_GRAPH: WorkflowGraph = {
  nodes: [{ id: "trigger-start", kind: "trigger", at: { x: 0, y: 0 }, fields: { trigger: "manual" } }],
  edges: [],
  strokes: [],
};

function graphValue(graph: WorkflowGraph, outline: WorkflowOutline | null): string {
  return JSON.stringify(outline ? graphWithOutline(graph, outline) : graph);
}

export function draftFrom(serverId: string, detail: WorkflowDetail | null, title = ""): WorkflowDraft {
  const graph = detail?.graph ?? NEW_WORKFLOW_GRAPH;
  const outline = workflowOutline(graph);
  const name = detail?.summary.title ?? title;
  return {
    serverId,
    workflowId: detail?.summary.id ?? null,
    baseRevision: detail?.revision ?? 0,
    title: name,
    graph,
    outline,
    mode: detail?.needsNewerApp ? "read-only" : outline ? "outline" : "fields",
    savedTitle: name.trim(),
    savedGraph: graphValue(graph, outline),
    branch: "yes",
    triggerProblem: false,
  };
}

/** The graph that a save sends: the outline writes the edges of its steps. */
export function draftGraph(draft: WorkflowDraft): WorkflowGraph {
  return draft.outline ? graphWithOutline(draft.graph, draft.outline) : draft.graph;
}

export function draftGraphChanged(draft: WorkflowDraft): boolean {
  return graphValue(draft.graph, draft.outline) !== draft.savedGraph;
}

export function draftChanged(draft: WorkflowDraft): boolean {
  return draft.title.trim() !== draft.savedTitle || draftGraphChanged(draft);
}

interface DraftStore {
  draft: WorkflowDraft | null;
  start: (draft: WorkflowDraft) => void;
  clear: () => void;
  setTitle: (title: string) => void;
  /** The graph is saved as `revision`: a later save starts from it. */
  graphSaved: (revision: number) => void;
  setBranch: (branch: WorkflowBranch) => void;
  setTriggerProblem: (problem: boolean) => void;
  /** Sets fields of a node; `undefined` removes a field. */
  setFields: (nodeId: string, fields: Record<string, WorkflowFieldValue | undefined>) => void;
  setSchedule: (nodeId: string, schedule: RoutineSchedule | undefined) => void;
  /** Adds a step at `index` of `list` and answers its id. */
  add: (kind: AddableKind, list: FlowList, index: number) => string | null;
  /** Puts a loose step at the end of the steps that run. */
  connect: (nodeId: string) => void;
  remove: (nodeId: string) => void;
  move: (nodeId: string, direction: -1 | 1) => boolean;
  duplicate: (nodeId: string) => string | null;
}

const newNode = (kind: WorkflowNode["kind"], fields: Record<string, WorkflowFieldValue>): WorkflowNode => ({
  id: `${kind}-${Crypto.randomUUID()}`,
  kind,
  at: { x: 0, y: 0 },
  fields: { ...fields },
});

const mapNode = (graph: WorkflowGraph, nodeId: string, change: (node: WorkflowNode) => WorkflowNode) => ({
  ...graph,
  nodes: graph.nodes.map((node) => (node.id === nodeId ? change(node) : node)),
});

export const useWorkflowDraft = create<DraftStore>((set, get) => {
  /** Changes the draft of an outline workflow; a draft of another mode keeps its steps. */
  const changeOutline = (change: (draft: WorkflowDraft, outline: WorkflowOutline) => Partial<WorkflowDraft> | null) => {
    const draft = get().draft;
    if (!draft?.outline || draft.mode !== "outline") return false;
    const next = change(draft, draft.outline);
    if (!next) return false;
    set({ draft: { ...draft, ...next } });
    return true;
  };
  return {
    draft: null,
    start: (draft) => set({ draft }),
    clear: () => set({ draft: null }),
    setTitle: (title) => {
      const draft = get().draft;
      if (draft) set({ draft: { ...draft, title } });
    },
    graphSaved: (revision) => {
      const draft = get().draft;
      if (draft)
        set({ draft: { ...draft, baseRevision: revision, savedGraph: graphValue(draft.graph, draft.outline) } });
    },
    setBranch: (branch) => {
      const draft = get().draft;
      if (draft) set({ draft: { ...draft, branch } });
    },
    setTriggerProblem: (triggerProblem) => {
      const draft = get().draft;
      if (draft && draft.triggerProblem !== triggerProblem) set({ draft: { ...draft, triggerProblem } });
    },
    setFields: (nodeId, fields) => {
      const draft = get().draft;
      if (!draft || draft.mode === "read-only") return;
      const graph = mapNode(draft.graph, nodeId, (node) => {
        const next = { ...node.fields };
        for (const [name, value] of Object.entries(fields)) {
          if (value === undefined) delete next[name];
          else next[name] = value;
        }
        return { ...node, fields: next };
      });
      set({ draft: { ...draft, graph } });
    },
    setSchedule: (nodeId, schedule) => {
      const draft = get().draft;
      if (!draft || draft.mode === "read-only") return;
      const graph = mapNode(draft.graph, nodeId, (node) => {
        const { schedule: _old, ...rest } = node;
        return schedule ? { ...rest, schedule } : rest;
      });
      set({ draft: { ...draft, graph } });
    },
    add: (kind, list, index) => {
      const node = newNode(kind, NEW_FIELDS[kind]);
      const added = changeOutline((draft, outline) => {
        const next =
          kind === "condition"
            ? hasCondition(draft.graph) || list !== "main"
              ? null
              : insertCondition(draft.graph, outline, index, node)
            : insertStep(draft.graph, outline, list, index, node);
        if (!next) return null;
        return { ...next, branch: list === "no" ? "no" : list === "yes" ? "yes" : draft.branch };
      });
      return added ? node.id : null;
    },
    connect: (nodeId) => {
      changeOutline((draft, outline) => connectStep(draft.graph, outline, nodeId));
    },
    remove: (nodeId) => {
      changeOutline((draft, outline) => removeStep(draft.graph, outline, nodeId));
    },
    move: (nodeId, direction) => changeOutline((draft, outline) => moveStep(draft.graph, outline, nodeId, direction)),
    duplicate: (nodeId) => {
      const draft = get().draft;
      const source = draft?.graph.nodes.find((node) => node.id === nodeId);
      const list = draft?.outline ? outlineListOf(draft.outline, nodeId) : null;
      if (!draft?.outline || !source || !list || list === "loose" || source.kind === "condition") return null;
      const copy: WorkflowNode = {
        ...newNode(source.kind, source.fields),
        ...(source.size ? { size: source.size } : {}),
      };
      const index = draft.outline[list].indexOf(nodeId) + 1;
      const added = changeOutline((current, outline) => insertStep(current.graph, outline, list, index, copy));
      return added ? copy.id : null;
    },
  };
});
