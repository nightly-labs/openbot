import { type AgentAccessEvent, agentAccessEvent } from "./agent-access-v1";
import { type AgentColorsEvent, agentColorsEvent } from "./agent-colors-v1";
import { type AgentHiddenEvent, agentHiddenEvent } from "./agent-hidden-v1";
import { type AgentNotificationLevelsEvent, agentNotificationLevelsEvent } from "./agent-notification-levels-v1";
import { type AgentSessionSettingsEvent, agentSessionSettingsEvent } from "./agent-session-settings-v1";
import { withAgentTaskEventUiBlocks } from "./agent-task-ui-blocks-v1";
import { type AgentTasksEvent, agentTasksEvent } from "./agent-tasks-v1";
import { type BrowserHttpSignInEvent, browserHttpSignInEvent } from "./browser-http-sign-in-v1";
import { type BrowserPageStateEvent, browserPageStateEvent } from "./browser-page-state-v1";
import { type BrowserPermissionsEvent, browserPermissionsEvent } from "./browser-permissions-v1";
import { type BrowserProfilesEvent, browserProfilesEvent } from "./browser-profiles-events-v1";
import { type BrowserUserControlEvent, browserUserControlEvent } from "./browser-user-control-v1";
import { type ChannelEvent, channelEvent } from "./channels-v1";
import { type ChatColorsEvent, chatColorsEvent } from "./chat-colors-v1";
import { type ClientBrowserCommandEvent, clientBrowserCommandEvent } from "./client-browser-v1";
import { type CrmEvent, crmEvent } from "./crm-v1";
import { type HostAppearanceEvent, hostAppearanceEvent } from "./host-appearance-v1";
import { type HostTurnLimitsEvent, hostTurnLimitsEvent } from "./host-turn-limits-events-v1";
import { type HostRestartEvent, hostRestartEvent } from "./host-update-v1";
import { type LibraryFoldersEvent, libraryFoldersEvent } from "./library-folders-events-v1";
import { type LiveVoiceEvent, liveVoiceEvent } from "./live-voice-v1";
import { type MachineAlertEvent, machineAlertEvent } from "./machine-resources-v1";
import { type MessagePinsEvent, messagePinsEvent } from "./message-pins-v1";
import { type OpenBotCreditsEvent, openBotCreditsEvent } from "./openbot-credits-events-v1";
import { type QuietTurnCompletedEvent, quietTurnEvent } from "./quiet-turn-v1";
import { type RemoteChatContentEvent, remoteChatContentEvent } from "./remote-chat-content-v1";
import { type RoutineFlowsEvent, routineFlowsEvent } from "./routine-flows-v1";
import {
  type RoutineThreadTurnCompletedEvent,
  routineThreadTurnEvent,
  routineThreadTurnToCurrent,
} from "./routine-thread-turn-v1";
import { type SidebarFoldersEvent, sidebarFoldersEvent } from "./sidebar-folders-v1";
import { type SidebarPinsEvent, sidebarPinsEvent } from "./sidebar-pins-v1";
import { type SkillsEvent, skillsEvent } from "./skills-events-v1";
import { type UsageCreditsEvent, usageCreditsEvent } from "./usage-credits-v1";
import { type VaultEvent, vaultEvent } from "./vault-v1";
import { type WorkflowFoldersEvent, workflowFoldersEvent } from "./workflow-folders-v1";
import { type WorkflowSpotEvent, workflowSpotEvent } from "./workflow-presence-v1";
import { type WorkflowsEvent, workflowsEvent } from "./workflows-v1";

export type OptionalTeamEvent =
  | AgentAccessEvent
  | AgentColorsEvent
  | AgentHiddenEvent
  | AgentNotificationLevelsEvent
  | AgentSessionSettingsEvent
  | ChatColorsEvent
  | ClientBrowserCommandEvent
  | BrowserHttpSignInEvent
  | BrowserPageStateEvent
  | BrowserPermissionsEvent
  | BrowserProfilesEvent
  | BrowserUserControlEvent
  | AgentTasksEvent
  | ChannelEvent
  | HostAppearanceEvent
  | RemoteChatContentEvent
  | HostRestartEvent
  | HostTurnLimitsEvent
  | LibraryFoldersEvent
  | LiveVoiceEvent
  | MachineAlertEvent
  | MessagePinsEvent
  | OpenBotCreditsEvent
  | SidebarPinsEvent
  | SidebarFoldersEvent
  | SkillsEvent
  | QuietTurnCompletedEvent
  | RoutineThreadTurnCompletedEvent
  | RoutineFlowsEvent
  | UsageCreditsEvent
  | VaultEvent
  | WorkflowsEvent
  | WorkflowFoldersEvent
  | WorkflowSpotEvent
  | CrmEvent;

export interface OptionalTeamEventOptions {
  agentTaskUiBlocks?: boolean;
}

export function optionalTeamEvent(value: unknown, options?: OptionalTeamEventOptions): OptionalTeamEvent | null {
  const event =
    agentAccessEvent(value) ??
    agentColorsEvent(value) ??
    agentHiddenEvent(value) ??
    agentNotificationLevelsEvent(value) ??
    agentSessionSettingsEvent(value) ??
    chatColorsEvent(value) ??
    clientBrowserCommandEvent(value) ??
    browserHttpSignInEvent(value) ??
    browserPageStateEvent(value) ??
    browserPermissionsEvent(value) ??
    browserProfilesEvent(value) ??
    browserUserControlEvent(value) ??
    agentTasksEvent(value) ??
    channelEvent(value) ??
    hostAppearanceEvent(value) ??
    remoteChatContentEvent(value) ??
    hostRestartEvent(value) ??
    hostTurnLimitsEvent(value) ??
    libraryFoldersEvent(value) ??
    liveVoiceEvent(value) ??
    machineAlertEvent(value) ??
    messagePinsEvent(value) ??
    openBotCreditsEvent(value) ??
    sidebarPinsEvent(value) ??
    sidebarFoldersEvent(value) ??
    skillsEvent(value) ??
    quietTurnEvent(value) ??
    routineThreadTurnEvent(value) ??
    routineFlowsEvent(value) ??
    usageCreditsEvent(value) ??
    vaultEvent(value) ??
    workflowsEvent(value) ??
    workflowFoldersEvent(value) ??
    workflowSpotEvent(value) ??
    crmEvent(value);
  return event && options?.agentTaskUiBlocks ? withAgentTaskEventUiBlocks(event, value) : event;
}

export function optionalTeamEventToCurrent(event: OptionalTeamEvent) {
  if (event.type === "sidebar-folders-changed")
    return { type: "sidebar-layout-changed" as const, layout: event.layout };
  if (event.type === "routine-thread-turn-completed") return routineThreadTurnToCurrent(event);
  return event.type === "quiet-turn-completed"
    ? { ...event, type: "turn-completed" as const, quiet: true as const }
    : event;
}
