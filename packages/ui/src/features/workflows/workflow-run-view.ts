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
  branch?: string;
}

export interface WorkflowNodePending {
  id: string;
  at: string;
}

export interface WorkflowNodeRunState {
  status: WorkflowNodeRunStatus | undefined;
  error: string | undefined;
  results: readonly WorkflowNodeResult[];
  pending: readonly WorkflowNodePending[];
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
  const pending = new Map<string, WorkflowNodePending[]>();
  for (const step of all) {
    const result = resultOf(step, step.runId ? numbers.get(step.runId) : undefined);
    if (result) results.set(step.nodeId, [...(results.get(step.nodeId) ?? []), result]);
    if (step.runId !== null && step.runId !== focused?.run.id) continue;
    shown.set(step.nodeId, step);
    if (step.status === "running" && step.startedAt)
      pending.set(step.nodeId, [...(pending.get(step.nodeId) ?? []), { id: step.id, at: step.startedAt }]);
  }
  const index = new Map<string, WorkflowNodeRunState>();
  for (const [nodeId, step] of shown) {
    index.set(nodeId, {
      status: NODE_STATUS[step.status],
      error: step.status === "failed" ? (step.error ?? undefined) : undefined,
      results: results.get(nodeId) ?? [],
      pending: pending.get(nodeId) ?? [],
      step,
    });
  }
  return index;
}

function resultOf(step: WorkflowStep, run: number | undefined): WorkflowNodeResult | undefined {
  const at = step.endedAt ?? step.startedAt;
  if (!at) return undefined;
  const base = run === undefined ? { id: step.id, at } : { id: step.id, run, at };
  if (step.status === "done" && step.output !== null)
    return step.branch ? { ...base, value: step.output, branch: step.branch } : { ...base, value: step.output };
  if (step.status === "failed") return { ...base, value: step.error ?? "", failed: true };
  return undefined;
}

export const sameWorkflowStep = (left: WorkflowStep, right: WorkflowStep): boolean =>
  left.id === right.id &&
  left.workflowId === right.workflowId &&
  left.runId === right.runId &&
  left.nodeId === right.nodeId &&
  left.attempt === right.attempt &&
  left.agentId === right.agentId &&
  left.status === right.status &&
  left.output === right.output &&
  left.branch === right.branch &&
  left.error === right.error &&
  left.startedAt === right.startedAt &&
  left.endedAt === right.endedAt &&
  left.waiting === right.waiting;

const sameResult = (left: WorkflowNodeResult, right: WorkflowNodeResult | undefined): boolean =>
  left.id === right?.id &&
  left.run === right.run &&
  left.at === right.at &&
  left.value === right.value &&
  left.failed === right.failed &&
  left.branch === right.branch;

const samePending = (left: WorkflowNodePending, right: WorkflowNodePending | undefined): boolean =>
  left.id === right?.id && left.at === right.at;

export const sameNodeRunState = (
  left: WorkflowNodeRunState | undefined,
  right: WorkflowNodeRunState | undefined,
): boolean => {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.status === right.status &&
    left.error === right.error &&
    sameWorkflowStep(left.step, right.step) &&
    left.results.length === right.results.length &&
    left.pending.length === right.pending.length &&
    left.results.every((result, index) => sameResult(result, right.results[index])) &&
    left.pending.every((pending, index) => samePending(pending, right.pending[index]))
  );
};
