import {
  AGENT_DEFAULT_KEYS,
  type AgentDefaults,
  DEFAULT_AGENT_DEFAULTS,
  isAutomationRunsPerHour,
  isPlanStartAfterMs,
} from "@openbot/contracts/ipc";
import { isBoolean, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { PreferenceStore } from "./preference-file";

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
      if (isBoolean(parsed.commitCoAuthor)) defaults.commitCoAuthor = parsed.commitCoAuthor;
      return defaults;
    },
  });
}
