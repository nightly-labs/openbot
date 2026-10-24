import { type AgentAccessEvent, agentAccessEvent } from "./agent-access-v1";
import { type AgentHiddenEvent, agentHiddenEvent } from "./agent-hidden-v1";
import { type AgentSessionSettingsEvent, agentSessionSettingsEvent } from "./agent-session-settings-v1";
import { type AgentTasksEvent, agentTasksEvent } from "./agent-tasks-v1";
import { type BrowserPageStateEvent, browserPageStateEvent } from "./browser-page-state-v1";
import { type BrowserUserControlEvent, browserUserControlEvent } from "./browser-user-control-v1";
// Events that optional capabilities add outside the frozen base event vocabularies. The base event
// adapters reject them, so each transport asks here first and sends or decodes them as they are.
import { type ChannelEvent, channelEvent } from "./channels-v1";
import { type DeviceToolEvent, deviceToolEvent } from "./device-tools-v1";
import { type HostRestartEvent, hostRestartEvent } from "./host-update-v1";
import { type QuietTurnCompletedEvent, quietTurnEvent } from "./quiet-turn-v1";
import { type RoutineFlowsEvent, routineFlowsEvent } from "./routine-flows-v1";
import { type SkillsEvent, skillsEvent } from "./skills-events-v1";

export type OptionalTeamEvent =
  | AgentAccessEvent
  | AgentHiddenEvent
  | AgentSessionSettingsEvent
  | BrowserPageStateEvent
  | BrowserUserControlEvent
  | DeviceToolEvent
  | AgentTasksEvent
  | ChannelEvent
  | HostRestartEvent
  | SkillsEvent
  | QuietTurnCompletedEvent
  | RoutineFlowsEvent;

/** The optional event in `value`, or null for any other event. A malformed optional event throws. */
export function optionalTeamEvent(value: unknown): OptionalTeamEvent | null {
  return (
    agentAccessEvent(value) ??
    agentHiddenEvent(value) ??
    agentSessionSettingsEvent(value) ??
    browserPageStateEvent(value) ??
    browserUserControlEvent(value) ??
    deviceToolEvent(value) ??
    agentTasksEvent(value) ??
    channelEvent(value) ??
    hostRestartEvent(value) ??
    skillsEvent(value) ??
    quietTurnEvent(value) ??
    routineFlowsEvent(value)
  );
}

/** Translate the optional wire event at each native transport boundary. */
export function optionalTeamEventToCurrent(event: OptionalTeamEvent) {
  return event.type === "quiet-turn-completed"
    ? { ...event, type: "turn-completed" as const, quiet: true as const }
    : event;
}
