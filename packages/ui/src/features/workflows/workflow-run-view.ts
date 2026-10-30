/**
 * The runs of one workflow as the canvas shows them. The host sends pages of runs and, after each
 * change, the new state of a run or of a step that ran alone; these functions join them without
 * the database. `indexRunView` gives each node its status, its error, its results and the step that
 * Stop, Retry and an approval act on.
 */

import type { WorkflowRunDetail, WorkflowRunStatus, WorkflowStep, WorkflowStepStatus } from "@openbot/contracts/ipc";

export interface WorkflowRunView {
  /** Newest first. */
  runs: readonly WorkflowRunDetail[];
  /** The steps that ran alone, newest first. */
  soloSteps: readonly WorkflowStep[];
  /** Pass as `before` to read older runs; null on the last page. */
  nextBefore: string | null;
}

export const EMPTY_WORKFLOW_RUN_VIEW: WorkflowRunView = { runs: [], soloSteps: [], nextBefore: null };

/** The status a node shows. A stopped or skipped step shows none. */
export type WorkflowNodeRunStatus = "waiting" | "running" | "done" | "failed" | "approval";

/** One result of a node, from a run or from a run of the node alone. */
export interface WorkflowNodeResult {
  /** The step that made it. */
  id: string;
  /** The number of the run that made it. A step that ran alone has none. */
  run?: number;
  /** When the step ended, as an ISO time. */
  at: string;
  /** The answer, or why the step failed. */
  value: string;
  failed?: boolean;
}

export interface WorkflowNodeRunState {
  status: WorkflowNodeRunStatus | undefined;
  error: string | undefined;
  /** Oldest first. */
  results: readonly WorkflowNodeResult[];
  /** The newest step of the node, which Stop, Retry and an approval act on. */
  step: WorkflowStep;
}

const OPEN_RUN_STATUSES: readonly WorkflowRunStatus[] = ["running", "approval", "stopping"];

const NODE_STATUS = {
  running: "running",
  approval: "approval",
  done: "done",
  failed: "failed",
  stopped: undefined,
  skipped: undefined,
} as const satisfies Record<WorkflowStepStatus, WorkflowNodeRunStatus | undefined>;

const byStartNewestFirst = (left: { startedAt: string | null }, right: { startedAt: string | null }) =>
  (right.startedAt ?? "").localeCompare(left.startedAt ?? "");

/** The newest run that has not ended. */
export function activeRun(view: WorkflowRunView): WorkflowRunDetail | undefined {
  return view.runs.find((entry) => OPEN_RUN_STATUSES.includes(entry.run.status));
}

/**
 * The run state of each node that has a step. A node shows the status of its newest step in the
 * newest run, or of its newest step that ran alone after that run started.
 */
export function indexRunView(view: WorkflowRunView): ReadonlyMap<string, WorkflowNodeRunState> {
  const numbers = new Map(view.runs.map((entry) => [entry.run.id, entry.run.number]));
  const all = [...view.runs.flatMap((entry) => entry.steps), ...view.soloSteps];
  // Oldest first, so the last step of a node is its newest.
  all.sort((left, right) => -byStartNewestFirst(left, right) || left.attempt - right.attempt);
  const newestRun = view.runs[0];
  const results = new Map<string, WorkflowNodeResult[]>();
  const shown = new Map<string, WorkflowStep>();
  for (const step of all) {
    const result = resultOf(step, step.runId ? numbers.get(step.runId) : undefined);
    if (result) results.set(step.nodeId, [...(results.get(step.nodeId) ?? []), result]);
    if (step.runId === null || step.runId === newestRun?.run.id) shown.set(step.nodeId, step);
  }
  const index = new Map<string, WorkflowNodeRunState>();
  for (const [nodeId, step] of shown) {
    index.set(nodeId, {
      status: NODE_STATUS[step.status],
      error: step.status === "failed" ? (step.error ?? undefined) : undefined,
      results: results.get(nodeId) ?? [],
      step,
    });
  }
  return index;
}

function resultOf(step: WorkflowStep, run: number | undefined): WorkflowNodeResult | undefined {
  const at = step.endedAt ?? step.startedAt;
  if (!at) return undefined;
  const base = run === undefined ? { id: step.id, at } : { id: step.id, run, at };
  if (step.status === "done" && step.output !== null) return { ...base, value: step.output };
  if (step.status === "failed") return { ...base, value: step.error ?? "", failed: true };
  return undefined;
}
