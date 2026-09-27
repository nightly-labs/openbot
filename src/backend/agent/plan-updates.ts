import {
  type ConversationPlan,
  type ConversationPlanStep,
  type ConversationPlanStepStatus,
  clampConversationPlan,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { isRecord } from "../protocol";

/**
 * The notification that carries a turn's plan. It is the Codex app-server method, and the Claude
 * and ACP clients send the same shape, so the turn lifecycle reads one form:
 * `{ threadId, turnId, explanation?, plan: [{ step, status, activeText? }] }`, always the full list.
 */
export const PLAN_UPDATED_METHOD = "turn/plan/updated";

export interface PlanUpdateStep {
  step: string;
  status: ConversationPlanStepStatus;
  activeText?: string;
}

/** The plan in a `turn/plan/updated` notification, inside the stored bounds, or null. */
export function planFromNotification(params: unknown): ConversationPlan | null {
  if (!isRecord(params) || !Array.isArray(params.plan)) return null;
  const steps: ConversationPlanStep[] = params.plan.flatMap((entry, index) => {
    if (!isRecord(entry) || !isString(entry.step)) return [];
    const activeText = isString(entry.activeText) ? entry.activeText : undefined;
    return [
      {
        id: String(index),
        text: entry.step,
        status: planStepStatus(entry.status),
        ...(activeText ? { activeText } : {}),
      },
    ];
  });
  return clampConversationPlan({
    explanation: isString(params.explanation) ? params.explanation : null,
    steps,
  });
}

/** Codex writes `inProgress`; Claude and ACP write `in_progress`. Anything else is not started. */
export function planStepStatus(value: unknown): ConversationPlanStepStatus {
  if (value === "completed") return "completed";
  if (value === "inProgress" || value === "in_progress") return "inProgress";
  return "pending";
}

/** The steps of an ACP `plan` session update. ACP has a priority for each entry; it is not shown. */
export function acpPlanSteps(entries: unknown): PlanUpdateStep[] {
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) =>
    isRecord(entry) && isString(entry.content) ? [{ step: entry.content, status: planStepStatus(entry.status) }] : [],
  );
}

/**
 * The plan Claude keeps with its own tools. `TodoWrite` sends the full list each time. The task
 * tools (`TaskCreate`, `TaskUpdate`) change one task at a time, so the list is folded here. The
 * state lives with the Claude session, because a task made in one turn can be updated in the next.
 */
export interface ClaudePlanState {
  steps: Map<string, PlanUpdateStep>;
  /** A `TaskCreate` call waits for its result, which names the task id, under its tool-use id. */
  creates: Set<string>;
}

export function newClaudePlanState(): ClaudePlanState {
  return { steps: new Map(), creates: new Set() };
}

/**
 * Applies one Claude tool call. Returns the new full list when the call changed the plan, or null
 * when the tool is not a plan tool. Calls from a subagent never reach this: its todos would replace
 * the plan of the agent the person talks to.
 */
export function foldClaudePlanCall(
  state: ClaudePlanState,
  call: { id: string; name: string; input: unknown },
): PlanUpdateStep[] | null {
  const input = isRecord(call.input) ? call.input : {};
  if (call.name === "TodoWrite") {
    if (!Array.isArray(input.todos)) return null;
    state.steps.clear();
    state.creates.clear();
    input.todos.forEach((todo, index) => {
      if (!isRecord(todo) || !isString(todo.content)) return;
      state.steps.set(`todo-${index}`, {
        step: todo.content,
        status: planStepStatus(todo.status),
        ...(isString(todo.activeForm) ? { activeText: todo.activeForm } : {}),
      });
    });
    return [...state.steps.values()];
  }
  if (call.name === "TaskCreate") {
    if (!isString(input.subject)) return null;
    state.steps.set(call.id, {
      step: input.subject,
      status: "pending",
      ...(isString(input.activeForm) ? { activeText: input.activeForm } : {}),
    });
    state.creates.add(call.id);
    return [...state.steps.values()];
  }
  if (call.name === "TaskUpdate") {
    if (!isString(input.taskId)) return null;
    const current = state.steps.get(input.taskId);
    if (!current) return null;
    if (input.status === "deleted") {
      state.steps.delete(input.taskId);
      return [...state.steps.values()];
    }
    state.steps.set(input.taskId, {
      step: isString(input.subject) ? input.subject : current.step,
      status: input.status === undefined ? current.status : planStepStatus(input.status),
      ...(isString(input.activeForm)
        ? { activeText: input.activeForm }
        : current.activeText
          ? { activeText: current.activeText }
          : {}),
    });
    return [...state.steps.values()];
  }
  return null;
}

/**
 * Applies the result of a `TaskCreate` call: the task moves from its tool-use id to the task id
 * that later `TaskUpdate` calls name. The order stays the same. The SDK sends the task in
 * `tool_use_result`; the text of the result ("Task #3 created") is the fallback.
 */
export function foldClaudePlanResult(state: ClaudePlanState, toolUseId: string, result: unknown, text: string): void {
  if (!state.creates.delete(toolUseId)) return;
  const task = isRecord(result) && isRecord(result.task) ? result.task : null;
  const taskId = task && isString(task.id) ? task.id : /#(\d+)/u.exec(text)?.[1];
  if (!taskId || taskId === toolUseId || !state.steps.has(toolUseId)) return;
  const entries = [...state.steps.entries()].map(([id, step]): [string, PlanUpdateStep] => [
    id === toolUseId ? taskId : id,
    step,
  ]);
  state.steps = new Map(entries);
}
