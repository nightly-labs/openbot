/**
 * Whether the Claude agents of this computer load the user's own Claude Code setup: the user
 * settings, CLAUDE.md, skills, agents, hooks and plugins of `~/.claude`, and the skills of
 * `~/.agents/skills`. Off, each turn sends a shorter prompt, so a day of many agents costs less.
 * The project files of an agent's workspace load in both cases.
 */

import { isBoolean, isDynamicRecord } from "./runtime-values";

export interface ClaudeUserSetupSetting {
  enabled: boolean;
}

/**
 * Off, so that each turn sends the shorter prompt. An upgrade turns it off too, because a file
 * exists only after the user changed the switch.
 */
export const DEFAULT_CLAUDE_USER_SETUP: ClaudeUserSetupSetting = { enabled: false };

export function decodeClaudeUserSetupSetting(value: unknown): ClaudeUserSetupSetting {
  if (!isDynamicRecord(value) || !isBoolean(value.enabled)) throw new Error("Invalid Claude setup setting.");
  return { enabled: value.enabled };
}
