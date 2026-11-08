export const PROFILE_PICKER_CASES = [
  "selected-readiness",
  "global-available",
  "inherited-readiness",
  "inherited-available",
  "selected-loading",
  "selected-error",
  "selected-missing",
  "dormant-first-choice",
  "profile-generations",
  "reopen-generation",
] as const;

export type ProfilePickerCase = (typeof PROFILE_PICKER_CASES)[number];

export interface ProfilePickerResult {
  name: ProfilePickerCase;
  passed: boolean;
  checks: string[];
  requests: string[];
  runtimeUpdates: unknown[];
  saved: unknown;
  optimistic: unknown;
  connected: string[];
  error?: string;
}

export interface ProfilePickerReport {
  passed: boolean;
  interface: string;
  cases: ProfilePickerResult[];
}
