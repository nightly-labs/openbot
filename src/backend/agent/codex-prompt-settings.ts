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
   * `tool_suggest` lists the account's plugins that are not installed and declares
   * `request_plugin_install` (about 430 tokens). Codex then waits for the client to install the
   * plugin, and OpenBot only shows Accept and Decline, so the install never completes.
   */
  "features.tool_suggest"?: false;
  /** `[[skills.config]]` entries: Codex selects a skill by `name` or by the `path` of its `SKILL.md`. */
  "skills.config"?: DynamicRecord[];
}

/**
 * The prompt settings of an OpenBot thread, without each one that the user's own Codex
 * configuration sets. `read` is the `config/read` answer with its layers; null when Codex did not
 * answer, and then OpenBot changes nothing.
 *
 * The merged `features` table also holds values that no file sets, so a feature counts as the
 * user's only when a file layer (the user's `config.toml` or the system one) sets it. A thread value
 * for `skills.config` replaces the whole merged list, so the user's entries go first, as they are,
 * and OpenBot adds only the skills that no entry names. An entry by `path` names the skill of its
 * folder, as `…/create-pet/SKILL.md` names `work-pets:create-pet`.
 */
export function codexPromptSettings(read: DynamicRecord | null): CodexPromptSettings {
  if (!read) return {};
  const settings: CodexPromptSettings = {};
  const layers = getArray(read, "layers").filter(isRecord);
  const userSets = (feature: string) =>
    layers.some((layer) => typeof getRecord(getRecord(layer, "config"), "features")?.[feature] === "boolean");
  if (!userSets("tool_suggest")) settings["features.tool_suggest"] = false;
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
