/**
 * What the search box and the row labels are made of. Every function here takes its inputs and
 * returns a string or a boolean, so a filtering question can be answered without the component.
 */

import type { ChannelSummary, DirectThreadSummary, TeamPresenceMember } from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import type { AgentProfile } from "../../data";
import { teamMemberName } from "../team/TeamPersonAvatar";
import type { SidebarAgentState, SidebarRoutinePhase } from "./sidebar-types";

export function sidebarAgentStateLabel(state: SidebarAgentState, t: AppTranslate): string {
  if (state.kind === "working") return t("sidebar.state.working");
  if (state.kind === "responded") return t("sidebar.state.responded");
  if (state.kind === "routine") return routineStateLabel(state.phase, state.count, t);
  return t("sidebar.state.unread", { count: state.count });
}

function routineStateLabel(phase: SidebarRoutinePhase, count: number, t: AppTranslate): string {
  if (phase === "needs-attention") return t("sidebar.state.routineAttention", { count });
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
