/**
 * What the row labels are made of. Every function here takes its inputs and returns a string, so a
 * label can be computed without the component.
 */

import type { AppFormat, AppTextKey, AppTranslate } from "@openbot/i18n";
import type { SidebarAgentState, SidebarRoutinePhase, SidebarWaitReason } from "./sidebar-types";

/** The state line a waiting row reads out and shows as its tooltip title. */
export const SIDEBAR_WAIT_TITLE = {
  question: "sidebar.state.waitingQuestion",
  approval: "sidebar.state.waitingApproval",
  takeover: "sidebar.state.waitingTakeover",
} as const satisfies Record<SidebarWaitReason, AppTextKey>;

/** The chip in the time slot: what the user does next. */
export const SIDEBAR_WAIT_ACTION = {
  question: "sidebar.waiting.action.question",
  approval: "sidebar.waiting.action.approval",
  takeover: "sidebar.waiting.action.takeover",
} as const satisfies Record<SidebarWaitReason, AppTextKey>;

export const SIDEBAR_WAIT_HINT = {
  question: "sidebar.waiting.hint.question",
  approval: "sidebar.waiting.hint.approval",
  takeover: "sidebar.waiting.hint.takeover",
} as const satisfies Record<SidebarWaitReason, AppTextKey>;

export function sidebarAgentStateLabel(state: SidebarAgentState, t: AppTranslate, format: AppFormat): string {
  if (state.kind === "waiting") {
    const title = t(SIDEBAR_WAIT_TITLE[state.reason]);
    return state.detail ? t("sidebar.state.waitingDetail", { state: title, detail: state.detail }) : title;
  }
  if (state.kind === "limited") {
    const reset = sidebarUsageResetTime(state.resetsAt, format);
    return reset ? t("sidebar.state.usageLimitResets", { reset }) : t("sidebar.state.usageLimit");
  }
  if (state.kind === "working") return t("sidebar.state.working");
  if (state.kind === "responded") return t("sidebar.state.responded");
  if (state.kind === "routine") return routineStateLabel(state.phase, state.count, t);
  return t("sidebar.state.unread", { count: state.count });
}

function routineStateLabel(phase: SidebarRoutinePhase, count: number, t: AppTranslate): string {
  if (phase === "failed") return t("sidebar.state.routineFailed", { count });
  if (phase === "queued") return t("sidebar.state.routineWaiting", { count });
  return t("sidebar.state.routineRunning", { count });
}

/** When a plan limit resets: the time today, or the day and time later. Null when the provider gave none. */
export function sidebarUsageResetTime(resetsAt: number | null, format: AppFormat): string | null {
  if (resetsAt === null) return null;
  const date = new Date(resetsAt * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toDateString() === new Date().toDateString()
    ? format.date(date, { hour: "numeric", minute: "2-digit" })
    : format.date(date, { weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function sidebarMessageTime(value: string, format: AppFormat): string {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return format.date(date, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return format.date(date, {
    month: "short",
    day: "numeric",
  });
}
