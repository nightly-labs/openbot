import {
  type AgentDefaults,
  type AgentMemoryLimit,
  type BusyMessageMode,
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_AGENT_MEMORY_LIMIT,
  DEFAULT_BUSY_MESSAGE_MODE,
  DEFAULT_EXTERNAL_LINK_PREFERENCE,
  type ExternalLinkTarget,
  type QuitGuard,
} from "@openbot/contracts/ipc";
import type { SendShortcutMode } from "../conversation/send-shortcut";

export type { SendShortcutMode };

export const SOUND_THEMES = ["default", "mech", "bubble", "press"] as const;
export type SoundTheme = (typeof SOUND_THEMES)[number];
export type SoundChoice = "off" | SoundTheme;
export type TaskSoundChoice = "off" | "classic" | SoundTheme;
export const TASK_SOUND_CHOICES = ["off", "classic", ...SOUND_THEMES] as const satisfies readonly TaskSoundChoice[];
export const ACTION_SOUND_CHOICES = ["off", ...SOUND_THEMES] as const satisfies readonly SoundChoice[];

export interface GeneralSettingsValue {
  launchAtLogin: boolean | null;
  keepRunningInBackground: boolean | null;
  keepAwake: boolean | null;
  keepAwakeOnBattery: boolean | null;
  restoreLastWorkspace: boolean;
  quitGuard: QuitGuard | null;
  externalLinkTarget: ExternalLinkTarget;
  desktopNotifications: boolean;
  notificationPreview: boolean;
  macBookNotch: boolean;
  macBookNotchHaptics: boolean;
  macBookNotchIdle: boolean;
  macBookNotchAdditionalDisplays: boolean;
  macBookNotchWidthPercent: number;
  macBookNotchHeightPercent: number;
  macBookNotchServers: Record<string, boolean>;
  macBookNotchNewServers: boolean;
  taskSound: TaskSoundChoice;
  sendShortcut: SendShortcutMode;
  showAgentSteps: boolean;
  compactMessageActions: boolean;
  busyMessageMode: BusyMessageMode;
  agentDefaults: AgentDefaults;
  agentMemoryLimit: AgentMemoryLimit;
  keepRemoteSessions: boolean;
  soundFeedback: boolean;
  soundTheme: SoundTheme;
  autoDownloadUpdates: boolean;
  allowRemoteUpdates: boolean;
  autoInstallUpdates: boolean;
  productAnalytics: boolean;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsValue = {
  launchAtLogin: null,
  keepRunningInBackground: null,
  keepAwake: null,
  keepAwakeOnBattery: null,
  restoreLastWorkspace: true,
  quitGuard: null,
  externalLinkTarget: DEFAULT_EXTERNAL_LINK_PREFERENCE.target,
  desktopNotifications: true,
  notificationPreview: true,
  macBookNotch: true,
  macBookNotchHaptics: true,
  macBookNotchIdle: true,
  macBookNotchAdditionalDisplays: true,
  macBookNotchWidthPercent: 100,
  macBookNotchHeightPercent: 100,
  macBookNotchServers: {},
  macBookNotchNewServers: true,
  taskSound: "classic",
  sendShortcut: "enter",
  showAgentSteps: false,
  compactMessageActions: true,
  busyMessageMode: DEFAULT_BUSY_MESSAGE_MODE,
  agentDefaults: DEFAULT_AGENT_DEFAULTS,
  agentMemoryLimit: DEFAULT_AGENT_MEMORY_LIMIT,
  keepRemoteSessions: true,
  soundFeedback: false,
  soundTheme: "default",
  autoDownloadUpdates: true,
  allowRemoteUpdates: true,
  autoInstallUpdates: false,
  productAnalytics: false,
};
