export const QUIT_GUARDS = ["working", "always", "never"] as const;
export type QuitGuard = (typeof QUIT_GUARDS)[number];
export const DEFAULT_QUIT_GUARD: QuitGuard = "working";

export interface AppBehaviorPreference {
  launchAtLogin: boolean | null;
  keepRunningInBackground: boolean | null;
  keepAwake: boolean | null;
  keepAwakeOnBattery: boolean | null;
  quitGuard: QuitGuard | null;
}

export interface AppBehaviorPreferenceChange {
  launchAtLogin?: boolean;
  keepRunningInBackground?: boolean;
  keepAwake?: boolean;
  keepAwakeOnBattery?: boolean;
  quitGuard?: QuitGuard;
}
