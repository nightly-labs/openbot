import { isBoolean, isDynamicRecord } from "./runtime-values";

export interface ClaudeUserSetupSetting {
  enabled: boolean;
}

export const DEFAULT_CLAUDE_USER_SETUP: ClaudeUserSetupSetting = { enabled: false };

export function decodeClaudeUserSetupSetting(value: unknown): ClaudeUserSetupSetting {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Invalid Claude setup setting.");
  return { enabled: value.enabled };
}
