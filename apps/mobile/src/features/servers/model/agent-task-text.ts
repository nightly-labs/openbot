import type { AgentTask, AgentTaskHold, AgentTaskOutcome } from "@openbot/contracts/ipc";
import type { MobileTextKey, MobileTranslate } from "@openbot/i18n/mobile";
import type { MobileText } from "@/shared/lib/text";

const OUTCOME_TEXT = {
  completed: "mobile.server.threads.state.completed",
  failed: "mobile.server.threads.state.failed",
  interrupted: "mobile.server.threads.state.interrupted",
} as const satisfies Record<AgentTaskOutcome, MobileTextKey>;

const HOLD_TEXT = {
  "agent-restarting": "mobile.server.threads.hold.agentRestarting",
  "usage-limit": "mobile.server.threads.hold.usageLimit",
  "server-busy": "mobile.server.threads.hold.serverBusy",
  "agent-busy": "mobile.server.threads.hold.agentBusy",
  "one-turn": "mobile.server.threads.hold.oneTurn",
} as const satisfies Record<Exclude<AgentTaskHold, "task-limit">, MobileTextKey>;

export function agentTaskStatus(task: AgentTask, t: MobileTranslate, sourceText: MobileText["sourceText"]): string {
  if (task.state === "running")
    return task.progress ? sourceText(task.progress) : t("mobile.server.threads.state.running");
  if (task.state === "queued") return t("mobile.server.threads.state.queued");
  if (task.outcome === null) return t("mobile.server.threads.state.new");
  return t(OUTCOME_TEXT[task.outcome]);
}

export function agentTaskHoldText(task: AgentTask, limit: number, t: MobileTranslate): string | null {
  if (task.state !== "queued" || task.hold === null) return null;
  if (task.hold === "task-limit") return t("mobile.server.threads.hold.threadLimit", { count: limit });
  return t(HOLD_TEXT[task.hold]);
}
