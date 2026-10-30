// How the desktop app starts and stops: at login, when its main window closes, and when the
// computer is idle.

/** As it crosses IPC. Null marks a choice that this run of the app does not offer. */
export interface AppBehaviorPreference {
  /** Open OpenBot when the user signs in. Null in a development run and on a server. */
  launchAtLogin: boolean | null;
  /**
   * Hide the main window on close and show a tray icon, rather than quit. Null on macOS, where
   * OpenBot always keeps running after its window closes, and on a server.
   */
  keepRunningInBackground: boolean | null;
  /**
   * Stop the idle sleep of the computer while it is on its power adapter, so routines run on time.
   * Null on Linux, where Electron does not report a change of the power source, and on a server.
   */
  keepAwake: boolean | null;
  /** Keep the computer awake on battery power too. Null where `keepAwake` is null. */
  keepAwakeOnBattery: boolean | null;
}

/** The choices to change. A choice that is not given keeps its value. */
export interface AppBehaviorPreferenceChange {
  launchAtLogin?: boolean;
  keepRunningInBackground?: boolean;
  keepAwake?: boolean;
  keepAwakeOnBattery?: boolean;
}
