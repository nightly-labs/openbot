import { basename, dirname } from "node:path";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { getArray, getRecord, getString, isRecord } from "../protocol";

/**
 * Skills that Codex lists in each request but that are about a host OpenBot is not: `openai-docs`
 * tells the model that "you" and "this app" mean Codex, the ChatGPT account's `work-pets` skills
 * manage pets of ChatGPT Work mode, and `plugin-management` installs Codex plugins. The five cost
 * about 620 tokens per request (`bun run bench:codex-prompt-settings`).
 */
export const CODEX_UNFIT_SKILLS = [
  "openai-docs",
  "plugin-management:plugin-management",
  "work-pets:create-pet",
  "work-pets:pets",
  "work-pets:update-pet",
] as const;

export interface CodexPromptSettings {
  /**
   * `tool_suggest` lists the account's plugins and ChatGPT apps that are not installed and declares
   * `list_available_plugins_to_install` and `request_plugin_install` (about 430 tokens).
   * `recommended_plugins` lists them in the first message. OpenBot cannot install a Codex plugin or
   * connect a ChatGPT app, so the agent tells the user about a prompt that never shows (#8515).
   * Always off, also when the user's `config.toml` turns them on: no OpenBot thread can use them.
   */
  "features.tool_suggest": false;
  "features.recommended_plugins": false;
  /** `[[skills.config]]` entries: Codex selects a skill by `name` or by the `path` of its `SKILL.md`. */
  "skills.config"?: DynamicRecord[];
  /**
   * Codex models default to no reasoning summary, and then the chat shows no thinking. Codex drops
   * the value for a provider or model that has no summaries.
   */
  model_reasoning_summary?: "auto";
}

/**
 * The prompt settings of an OpenBot thread. The plugin install features are always off. The other
 * settings leave out each one that the user's own Codex configuration sets. `read` is the
 * `config/read` answer with its layers; null when Codex did not answer, and then OpenBot changes
 * only the plugin install features.
 *
 * A thread value for `skills.config` replaces the whole merged list, so the user's entries go first,
 * as they are, and OpenBot adds only the skills that no entry names. An entry by `path` names the
 * skill of its folder, as `…/create-pet/SKILL.md` names `work-pets:create-pet`.
 */
export function codexPromptSettings(read: DynamicRecord | null): CodexPromptSettings {
  const settings: CodexPromptSettings = {
    "features.tool_suggest": false,
    "features.recommended_plugins": false,
  };
  if (!read) return settings;
  // No default fills this value, so the merged one is null unless a file sets it.
  if (getString(getRecord(read, "config"), "model_reasoning_summary") === null)
    settings.model_reasoning_summary = "auto";
  const own = getArray(getRecord(getRecord(read, "config"), "skills"), "config").filter(isRecord);
  const named = new Set(own.map((entry) => getString(entry, "name")));
  const folders = new Set(
    own.flatMap((entry) => getString(entry, "path") ?? []).map((path) => basename(dirname(path))),
  );
  const added = CODEX_UNFIT_SKILLS.filter(
    (name) => !named.has(name) && !folders.has(name.slice(name.lastIndexOf(":") + 1)),
  ).map((name) => ({ name, enabled: false }));
  if (added.length > 0) settings["skills.config"] = [...own, ...added];
  return settings;
}
