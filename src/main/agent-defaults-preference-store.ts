import {
  AGENT_DEFAULT_KEYS,
  type AgentDefaults,
  DEFAULT_AGENT_DEFAULTS,
  isAutomationRunsPerHour,
  isPlanStartAfterMs,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { PreferenceStore } from "./preference-file";

/**
 * The account defaults of the agent settings in `AGENT_DEFAULT_KEYS`. An agent with no value of its
 * own follows them, and the backend reads them for each check. A missing file reads as all off, which
 * is what every agent had before the defaults existed; so does a key that is missing or not a boolean.
 * A missing or invalid plan card start time reads as 10 s, and a missing or invalid local script limit
 * as 30 runs an hour: the values that every agent had before they existed.
 */
export type AgentDefaultsPreferenceStore = PreferenceStore<AgentDefaults>;

export function createAgentDefaultsPreferenceStore(path: string): AgentDefaultsPreferenceStore {
  return new PreferenceStore({
    path,
    defaultValue: DEFAULT_AGENT_DEFAULTS,
    decode: (parsed) => {
      if (!isDynamicRecord(parsed) || parsed.version !== 1) return null;
      const defaults = { ...DEFAULT_AGENT_DEFAULTS };
      for (const key of AGENT_DEFAULT_KEYS) {
        const value = parsed[key];
        if (isBoolean(value)) defaults[key] = value;
      }
      if (isPlanStartAfterMs(parsed.planStartAfterMs)) defaults.planStartAfterMs = parsed.planStartAfterMs;
      if (isAutomationRunsPerHour(parsed.automationRunsPerHour))
        defaults.automationRunsPerHour = parsed.automationRunsPerHour;
      return defaults;
    },
  });
}
