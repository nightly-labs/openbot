/**
 * What the search box and the row labels are made of. Every function here takes its inputs and
 * returns a string or a boolean, so a filtering question can be answered without the component.
 */

import type { ChannelSummary, DirectThreadSummary, TeamPresenceMember } from "@openbot/contracts/ipc";
import type { AppFormat, AppTextKey, AppTranslate } from "@openbot/i18n";
import type { AgentProfile } from "../../data";
import { teamMemberName } from "../team/TeamPersonAvatar";
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

export function sidebarAgentStateLabel(state: SidebarAgentState, t: AppTranslate): string {
  if (state.kind === "waiting") {
    return state.detail
      ? `${t(SIDEBAR_WAIT_TITLE[state.reason])}: ${state.detail}`
      : t(SIDEBAR_WAIT_TITLE[state.reason]);
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

export function agentMatchesQuery(agent: AgentProfile, query: string): boolean {
  return !query || `${agent.name} ${agent.title} ${agent.description} ${agent.preview}`.toLowerCase().includes(query);
}

export function channelMatchesQuery(channel: ChannelSummary, query: string): boolean {
  return (
    !query ||
    `${channel.name} ${channel.title} ${channel.instructions} ${channel.lastMessage?.text ?? ""}`
      .toLowerCase()
      .includes(query)
  );
}

export function personMatchesQuery(
  member: TeamPresenceMember,
  thread: DirectThreadSummary | undefined,
  query: string,
): boolean {
  return (
    !query ||
    `${teamMemberName(member)} ${member.email ?? member.username} ${thread?.lastMessage.text ?? ""}`
      .toLowerCase()
      .includes(query)
  );
}
