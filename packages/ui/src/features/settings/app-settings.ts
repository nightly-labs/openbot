export type ExternalLinkTarget = "Default browser" | "OpenBot";

import { type AgentMemoryLimit, type BusyMessageMode, DEFAULT_AGENT_MEMORY_LIMIT } from "@openbot/contracts/ipc";
/** Which chord sends a message. Re-exported here so settings state can name the same type. */
import type { SendShortcutMode } from "../conversation/send-shortcut";

export type { SendShortcutMode };

/** The sound materials of sound feedback, by their cuelume theme names. */
export const SOUND_THEMES = ["default", "mech", "bubble", "press"] as const;
export type SoundTheme = (typeof SOUND_THEMES)[number];
/** The action sounds: none, or sounds in one theme. */
export type SoundChoice = "off" | SoundTheme;
/** The sound when a task finishes: none, the original tone ("classic"), or the success cue of one theme. */
export type TaskSoundChoice = "off" | "classic" | SoundTheme;
export const TASK_SOUND_CHOICES = ["off", "classic", ...SOUND_THEMES] as const satisfies readonly TaskSoundChoice[];
export const ACTION_SOUND_CHOICES = ["off", ...SOUND_THEMES] as const satisfies readonly SoundChoice[];

export interface GeneralSettingsValue {
  launchAtLogin: boolean;
  keepRunningInBackground: boolean;
  restoreLastWorkspace: boolean;
  externalLinkTarget: ExternalLinkTarget;
  desktopNotifications: boolean;
  /** Notifications show the start of the agent's reply, question or command. */
  notificationPreview: boolean;
  macBookNotch: boolean;
  macBookNotchHaptics: boolean;
  macBookNotchIdle: boolean;
  macBookNotchAdditionalDisplays: boolean;
  /** The compact Dynamic Island size, as percents of the default. */
  macBookNotchWidthPercent: number;
  macBookNotchHeightPercent: number;
  /** The user's choice for each server, by server id. A server with no choice uses `macBookNotchNewServers`. */
  macBookNotchServers: Record<string, boolean>;
  /** Whether the island shows a server with no choice of its own, such as a server added later. */
  macBookNotchNewServers: boolean;
  taskSound: TaskSoundChoice;
  /** How the user sends a message: plain Enter, or the platform modifier with Enter. */
  sendShortcut: SendShortcutMode;
  /** What a message sent to a busy agent does, unless the agent or the message sets its own. */
  busyMessageMode: BusyMessageMode;
  /** How many memories one agent on this computer can hold. */
  agentMemoryLimit: AgentMemoryLimit;
  /** Keep each joined server's connection between runs of the app, so the start is faster. */
  keepRemoteSessions: boolean;
  /** Short sounds that confirm the user's own actions, such as a click or a sent message. */
  soundFeedback: boolean;
  soundTheme: SoundTheme;
  autoDownloadUpdates: boolean;
  /** Owners and admins of a joined server can start an update of this computer. */
  allowRemoteUpdates: boolean;
  /** Restart into a downloaded update when no work runs. */
  autoInstallUpdates: boolean;
  productAnalytics: boolean;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettingsValue = {
  launchAtLogin: true,
  keepRunningInBackground: false,
  restoreLastWorkspace: true,
  externalLinkTarget: "Default browser",
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
  busyMessageMode: "queue",
  agentMemoryLimit: DEFAULT_AGENT_MEMORY_LIMIT,
  keepRemoteSessions: true,
  soundFeedback: false,
  soundTheme: "default",
  autoDownloadUpdates: true,
  allowRemoteUpdates: true,
  autoInstallUpdates: false,
  productAnalytics: true,
};
