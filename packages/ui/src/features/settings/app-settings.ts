import {
  type AgentDefaults,
  type AgentMemoryLimit,
  type BusyMessageMode,
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_AGENT_MEMORY_LIMIT,
  DEFAULT_EXTERNAL_LINK_PREFERENCE,
  type ExternalLinkTarget,
} from "@openbot/contracts/ipc";
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
  /** Null hides the switch: a development run and a server cannot open at login. */
  launchAtLogin: boolean | null;
  /** Null hides the switch: macOS always keeps running, and a server has no window. */
  keepRunningInBackground: boolean | null;
  /** Null hides the switch: Linux does not report a change of the power source, and a server never sleeps. */
  keepAwake: boolean | null;
  /** Null where `keepAwake` is null. */
  keepAwakeOnBattery: boolean | null;
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
  /** The steps of an agent's turn (thinking, progress, memory changes) are open at first. */
  showAgentSteps: boolean;
  /** What a message sent to a busy agent does, unless the agent or the message sets its own. */
  busyMessageMode: BusyMessageMode;
  /** What an agent of this computer does when it has no value of its own for the setting. */
  agentDefaults: AgentDefaults;
  /** How many memories one agent on this computer can hold. Read only here: Server settings set it. */
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
  launchAtLogin: null,
  keepRunningInBackground: null,
  keepAwake: null,
  keepAwakeOnBattery: null,
  restoreLastWorkspace: true,
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
  busyMessageMode: "queue",
  agentDefaults: DEFAULT_AGENT_DEFAULTS,
  agentMemoryLimit: DEFAULT_AGENT_MEMORY_LIMIT,
  keepRemoteSessions: true,
  soundFeedback: false,
  soundTheme: "default",
  autoDownloadUpdates: true,
  allowRemoteUpdates: true,
  autoInstallUpdates: false,
  // Opt-in: main reads the saved choice, and an older install with no choice reads as on.
  productAnalytics: false,
};
