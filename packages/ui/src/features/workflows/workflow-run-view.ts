import type { WorkflowRunDetail, WorkflowRunStatus, WorkflowStep, WorkflowStepStatus } from "@openbot/contracts/ipc";

export interface WorkflowRunView {
  runs: readonly WorkflowRunDetail[];
  soloSteps: readonly WorkflowStep[];
  nextBefore: string | null;
}

export const EMPTY_WORKFLOW_RUN_VIEW: WorkflowRunView = { runs: [], soloSteps: [], nextBefore: null };

export type WorkflowNodeRunStatus = "waiting" | "running" | "done" | "failed" | "approval";

export interface WorkflowNodeResult {
  id: string;
  run?: number;
  at: string;
  value: string;
  failed?: boolean;
}

export interface WorkflowNodeRunState {
  status: WorkflowNodeRunStatus | undefined;
  error: string | undefined;
  results: readonly WorkflowNodeResult[];
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

export function activeRun(view: WorkflowRunView): WorkflowRunDetail | undefined {
  return view.runs.find(isOpenRun);
}

export function isOpenRun(entry: WorkflowRunDetail): boolean {
  return OPEN_RUN_STATUSES.includes(entry.run.status);
}

export function indexRunView(view: WorkflowRunView, focusRunId?: string): ReadonlyMap<string, WorkflowNodeRunState> {
  const numbers = new Map(view.runs.map((entry) => [entry.run.id, entry.run.number]));
  const all = [...view.runs.flatMap((entry) => entry.steps), ...view.soloSteps];
  all.sort((left, right) => -byStartNewestFirst(left, right) || left.attempt - right.attempt);
  const focused = view.runs.find((entry) => entry.run.id === focusRunId) ?? view.runs[0];
  const results = new Map<string, WorkflowNodeResult[]>();
  const shown = new Map<string, WorkflowStep>();
  for (const step of all) {
    const result = resultOf(step, step.runId ? numbers.get(step.runId) : undefined);
    if (result) results.set(step.nodeId, [...(results.get(step.nodeId) ?? []), result]);
    if (step.runId === null || step.runId === focused?.run.id) shown.set(step.nodeId, step);
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
