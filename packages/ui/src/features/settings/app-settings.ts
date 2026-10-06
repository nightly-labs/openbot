export type ExternalLinkTarget = "Default browser" | "OpenBot";

/** Which chord sends a message. Re-exported here so settings state can name the same type. */
import type { SendShortcutMode } from "../conversation/send-shortcut";

export type { SendShortcutMode };

/** The sound materials of sound feedback, by their cuelume theme names. */
export const SOUND_THEMES = ["default", "mech", "bubble", "press"] as const;
export type SoundTheme = (typeof SOUND_THEMES)[number];
/** What the sound picker shows: no sounds, or sounds in one theme. */
export type SoundChoice = "off" | SoundTheme;

export interface GeneralSettingsValue {
  launchAtLogin: boolean;
  keepRunningInBackground: boolean;
  restoreLastWorkspace: boolean;
  externalLinkTarget: ExternalLinkTarget;
  desktopNotifications: boolean;
  macBookNotch: boolean;
  macBookNotchHaptics: boolean;
  macBookNotchIdle: boolean;
  macBookNotchAdditionalDisplays: boolean;
  /** The compact Dynamic Island size, as percents of the default. */
  macBookNotchWidthPercent: number;
  macBookNotchHeightPercent: number;
  taskCompletionSound: boolean;
  /** How the user sends a message: plain Enter, or the platform modifier with Enter. */
  sendShortcut: SendShortcutMode;
  /** Short sounds that confirm the user's own actions, such as a click or a sent message. */
  soundFeedback: boolean;
  soundTheme: SoundTheme;
  /**
   * Turbo mode. Agents run commands and change files without asking. Permission grants and site
   * publishing still ask, so this is not the same as "no boundary at all".
   */
  turboMode: boolean;
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
  macBookNotch: true,
  macBookNotchHaptics: true,
  macBookNotchIdle: true,
  macBookNotchAdditionalDisplays: true,
  macBookNotchWidthPercent: 100,
  macBookNotchHeightPercent: 100,
  taskCompletionSound: true,
  sendShortcut: "enter",
  soundFeedback: false,
  soundTheme: "default",
  turboMode: false,
  autoDownloadUpdates: true,
  allowRemoteUpdates: true,
  autoInstallUpdates: false,
  productAnalytics: true,
};
