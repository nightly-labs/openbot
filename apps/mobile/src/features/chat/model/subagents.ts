import type {
  ConversationSubagent,
  ConversationSubagentStatus,
  ConversationSubagentStep,
} from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import type { MobileText } from "@/shared/lib/text";

export const SUBAGENT_STATE_LABELS = {
  running: "mobile.chat.subagents.state.running",
  completed: "mobile.chat.subagents.state.completed",
  failed: "mobile.chat.subagents.state.failed",
  stopped: "mobile.chat.subagents.state.stopped",
} as const satisfies Record<ConversationSubagentStatus, MobileTextKey>;

export const GENERAL_AGENT_TYPE = "general-purpose";

function timeOf(value: string | null, fallback: number): number {
  const time = value === null ? Number.NaN : Date.parse(value);
  return Number.isFinite(time) ? time : fallback;
}

export function subagentElapsedMs(subagent: ConversationSubagent, now: number): number {
  return timeOf(subagent.endedAt, now) - timeOf(subagent.startedAt, now);
}

export function subagentGroupElapsedMs(subagents: readonly ConversationSubagent[], now: number): number {
  if (subagents.length === 0) return 0;
  const start = Math.min(...subagents.map((subagent) => timeOf(subagent.startedAt, now)));
  const running = subagents.some((subagent) => subagent.status === "running");
  const end = running ? now : Math.max(...subagents.map((subagent) => timeOf(subagent.endedAt, now)));
  return end - start;
}

export function subagentDuration(ms: number, { t, format }: Pick<MobileText, "t" | "format">): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  if (total < 60) return t("mobile.chat.subagents.seconds", { seconds: format.number(total) });
  return t("mobile.chat.subagents.minutes", {
    minutes: format.number(Math.floor(total / 60)),
    seconds: format.number(total % 60, { minimumIntegerDigits: 2 }),
  });
}

export function subagentShownStep(subagent: ConversationSubagent): ConversationSubagentStep | undefined {
  const last = subagent.steps.at(-1);
  if (subagent.status === "running") return last;
  return subagent.status !== "failed" && last?.kind === "text" ? last : undefined;
}
