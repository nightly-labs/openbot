import type { AgentTask, AgentTaskOutcome } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { TaskMark, type TaskMarkState } from "@openbot/ui/features/conversation/TaskList";
import { type TextValue, useText } from "@openbot/ui/text";
import { Show } from "solid-js";

const OUTCOME_TEXT = {
  completed: "conversation.tasks.state.completed",
  failed: "conversation.tasks.state.failed",
  interrupted: "conversation.tasks.state.interrupted",
} as const satisfies Record<AgentTaskOutcome, AppTextKey>;

/** What a running task waits for from the person, if anything. */
export type AgentTaskWait = "approval" | "answer" | undefined;

function taskMarkState(task: AgentTask): TaskMarkState {
  if (task.state === "running") return "active";
  if (task.state === "queued" || task.outcome === null) return "pending";
  return task.outcome === "completed" ? "done" : "failed";
}

/**
 * The state of a task in a few words: that a running task waits for the person, what it does now,
 * else how its last turn ended.
 */
export function agentTaskStatus(task: AgentTask, t: TextValue["t"], wait?: AgentTaskWait): string {
  if (task.state === "running" && wait === "approval") return t("conversation.tasks.state.waitingApproval");
  if (task.state === "running" && wait === "answer") return t("conversation.tasks.state.waitingAnswer");
  if (task.state === "running") return task.progress ?? t("conversation.tasks.state.running");
  if (task.state === "queued") return t("conversation.tasks.state.queued");
  if (task.outcome === null) return t("conversation.tasks.state.new");
  return t(OUTCOME_TEXT[task.outcome]);
}

/**
 * The state glyph of a task, with its state as the accessible name. `decorative` hides it where the
 * state is already in the text beside it.
 */
export function AgentTaskMark(props: { task: AgentTask; decorative?: boolean; wait?: AgentTaskWait }) {
  const { t } = useText();
  return (
    <Show
      when={!props.decorative}
      fallback={
        <span class="agent-tasks-mark" aria-hidden="true">
          <TaskMark state={taskMarkState(props.task)} />
        </span>
      }
    >
      <span
        class="agent-tasks-mark"
        role="img"
        aria-label={agentTaskStatus(props.task, t, props.wait)}
        title={agentTaskStatus(props.task, t, props.wait)}
      >
        <TaskMark state={taskMarkState(props.task)} />
      </span>
    </Show>
  );
}
