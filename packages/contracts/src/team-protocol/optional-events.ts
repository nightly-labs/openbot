import { type AgentAccessEvent, agentAccessEvent } from "./agent-access-v1";
import { type AgentHiddenEvent, agentHiddenEvent } from "./agent-hidden-v1";
import { type AgentNotificationLevelsEvent, agentNotificationLevelsEvent } from "./agent-notification-levels-v1";
import { type AgentSessionSettingsEvent, agentSessionSettingsEvent } from "./agent-session-settings-v1";
import { withAgentTaskEventUiBlocks } from "./agent-task-ui-blocks-v1";
import { type AgentTasksEvent, agentTasksEvent } from "./agent-tasks-v1";
import { type BrowserPageStateEvent, browserPageStateEvent } from "./browser-page-state-v1";
import { type BrowserUserControlEvent, browserUserControlEvent } from "./browser-user-control-v1";
// Events that optional capabilities add outside the frozen base event vocabularies. The base event
// adapters reject them, so each transport asks here first and sends or decodes them as they are.
import { type ChannelEvent, channelEvent } from "./channels-v1";
import { type HostRestartEvent, hostRestartEvent } from "./host-update-v1";
import { type MachineAlertEvent, machineAlertEvent } from "./machine-resources-v1";
import { type QuietTurnCompletedEvent, quietTurnEvent } from "./quiet-turn-v1";
import { type RoutineFlowsEvent, routineFlowsEvent } from "./routine-flows-v1";
import { type SkillsEvent, skillsEvent } from "./skills-events-v1";
import { type VaultEvent, vaultEvent } from "./vault-v1";
import { type WorkflowsEvent, workflowsEvent } from "./workflows-v1";

export type OptionalTeamEvent =
  | AgentAccessEvent
  | AgentHiddenEvent
  | AgentNotificationLevelsEvent
  | AgentSessionSettingsEvent
  | BrowserPageStateEvent
  | BrowserUserControlEvent
  | AgentTasksEvent
  | ChannelEvent
  | HostRestartEvent
  | MachineAlertEvent
  | SkillsEvent
  | QuietTurnCompletedEvent
  | RoutineFlowsEvent
  | VaultEvent
  | WorkflowsEvent;

export interface OptionalTeamEventOptions {
  /**
   * agent-task-ui-blocks-v1: a task conversation keeps its UI blocks. A host passes the negotiated
   * capability; a client passes `true`, because a host sends the blocks only when it was negotiated.
   */
  agentTaskUiBlocks?: boolean;
}

/** The optional event in `value`, or null for any other event. A malformed optional event throws. */
export function optionalTeamEvent(value: unknown, options?: OptionalTeamEventOptions): OptionalTeamEvent | null {
  const event =
    agentAccessEvent(value) ??
    agentHiddenEvent(value) ??
    agentNotificationLevelsEvent(value) ??
    agentSessionSettingsEvent(value) ??
    browserPageStateEvent(value) ??
    browserUserControlEvent(value) ??
    agentTasksEvent(value) ??
    channelEvent(value) ??
    hostRestartEvent(value) ??
    machineAlertEvent(value) ??
    skillsEvent(value) ??
    quietTurnEvent(value) ??
    routineFlowsEvent(value) ??
    vaultEvent(value) ??
    workflowsEvent(value);
  return event && options?.agentTaskUiBlocks ? withAgentTaskEventUiBlocks(event, value) : event;
}

/** Translate the optional wire event at each native transport boundary. */
export function optionalTeamEventToCurrent(event: OptionalTeamEvent) {
  return event.type === "quiet-turn-completed"
    ? { ...event, type: "turn-completed" as const, quiet: true as const }
    : event;
}
