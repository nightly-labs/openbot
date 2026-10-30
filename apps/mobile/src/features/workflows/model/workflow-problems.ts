import { type WorkflowGraphProblem, workflowGraphProblemAt } from "@openbot/contracts/ipc";
import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { draftGraph, type WorkflowDraft } from "./workflow-draft";
import { outlineProblems } from "./workflow-outline";
import { stepLabel, stepProblem } from "./workflow-steps";

const GRAPH_PROBLEM = {
  annotation: "mobile.workflow.problem.annotation",
  port: "mobile.workflow.problem.port",
  branch: "mobile.workflow.problem.branch",
  "condition-branch": "mobile.workflow.problem.branch",
  duplicate: "mobile.workflow.problem.duplicate",
} as const satisfies Record<WorkflowGraphProblem, MobileTextKey>;

export interface DraftProblems {
  /** The problem of each step, which its row and its page show. */
  steps: ReadonlyMap<string, string>;
  /** The first problem, with the step that has it, for the line at the top of the editor. */
  first: { nodeId: string | null; text: string } | null;
}

/**
 * What stops a save, step by step: the checks of the phone first, then the edge rules of the host, so
 * the editor names the step before the host refuses the graph.
 */
export function draftProblems(draft: WorkflowDraft, agents: readonly MobileAgent[], t: MobileTranslate): DraftProblems {
  const steps = new Map<string, string>();
  const nodes = new Map(draft.graph.nodes.map((node) => [node.id, node]));
  const trigger = draft.graph.nodes.find((node) => node.kind === "trigger");
  if (trigger && draft.triggerProblem) steps.set(trigger.id, t("mobile.workflow.problem.schedule"));
  for (const node of draft.graph.nodes) {
    const problem = stepProblem(node, agents, t);
    if (problem && !steps.has(node.id)) steps.set(node.id, problem);
  }
  if (draft.outline && draft.mode === "outline")
    for (const [id] of outlineProblems(draft.outline, draft.graph))
      if (!steps.has(id)) steps.set(id, t("mobile.workflow.problem.promptTarget"));
  if (steps.size === 0) {
    const found = workflowGraphProblemAt(draftGraph(draft));
    if (found) steps.set(found.edge.to, t(GRAPH_PROBLEM[found.problem]));
  }
  const title = draft.title.trim() ? null : t("mobile.workflow.problem.noTitle");
  const [entry] = steps;
  const node = entry ? nodes.get(entry[0]) : undefined;
  return {
    steps,
    first: title
      ? { nodeId: null, text: title }
      : entry
        ? {
            nodeId: entry[0],
            text: node
              ? t("mobile.workflow.problem.inStep", { step: stepLabel(node, agents, t), problem: entry[1] })
              : entry[1],
          }
        : null,
  };
}
