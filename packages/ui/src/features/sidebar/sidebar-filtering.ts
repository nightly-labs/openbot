/**
 * What the search box and the row labels are made of. Every function here takes its inputs and
 * returns a string or a boolean, so a filtering question can be answered without the component.
 */

import type { ChannelSummary, DirectThreadSummary, TeamPresenceMember } from "@openbot/contracts/ipc";
import type { AgentProfile } from "../../data";
import { teamMemberName } from "../team/TeamPersonAvatar";
import type { SidebarAgentState, SidebarRoutinePhase } from "./sidebar-types";

export function sidebarAgentStateLabel(state: SidebarAgentState): string {
  if (state.kind === "working") return "Thinking";
  if (state.kind === "responded") return "Responded";
  if (state.kind === "routine") return routineStateLabel(state.phase, state.count);
  return `${state.count} new ${state.count === 1 ? "reply" : "replies"}`;
}

function routineStateLabel(phase: SidebarRoutinePhase, count: number): string {
  if (phase === "needs-attention") {
    return count === 1 ? "Routine needs attention" : `${count} routines need attention`;
  }
  if (phase === "failed") return count === 1 ? "Routine failed" : `${count} routines failed`;
  if (phase === "queued") return count === 1 ? "Routine waiting" : `${count} routines waiting`;
  return count === 1 ? "Routine running" : `${count} routines running`;
}

export function sidebarMessageTime(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
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
