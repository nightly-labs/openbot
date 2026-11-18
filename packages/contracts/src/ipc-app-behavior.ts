// How the desktop app starts and stops: at login, when its main window closes, when the
// computer is idle, and on `Cmd + Q`.

/**
 * When `Cmd + Q` on a Mac quits only after the user holds it or presses it twice: while an agent
 * works (the default), for every quit, or never.
 */
export const QUIT_GUARDS = ["working", "always", "never"] as const;
export type QuitGuard = (typeof QUIT_GUARDS)[number];
export const DEFAULT_QUIT_GUARD: QuitGuard = "working";

/** As it crosses IPC. Null marks a choice that this run of the app does not offer. */
export interface AppBehaviorPreference {
  /** Open OpenBot when the user signs in. Null in a development run and on a server. */
  launchAtLogin: boolean | null;
  /**
   * Hide the main window on close and show a tray icon, rather than quit. macOS always hides the
   * window and keeps the Dock icon: there it shows a menu bar icon, and it is on by default.
   * Null on a server.
   */
  keepRunningInBackground: boolean | null;
  /**
   * Stop the idle sleep of the computer while it is on its power adapter, so routines run on time.
   * Null on Linux, where Electron does not report a change of the power source, and on a server.
   */
  keepAwake: boolean | null;
  /** Keep the computer awake on battery power too. Null where `keepAwake` is null. */
  keepAwakeOnBattery: boolean | null;
  /** When `Cmd + Q` needs a hold or a second press. Null on Windows, on Linux and on a server. */
  quitGuard: QuitGuard | null;
}

/** The choices to change. A choice that is not given keeps its value. */
export interface AppBehaviorPreferenceChange {
  launchAtLogin?: boolean;
  keepRunningInBackground?: boolean;
  keepAwake?: boolean;
  keepAwakeOnBattery?: boolean;
  quitGuard?: QuitGuard;
}
