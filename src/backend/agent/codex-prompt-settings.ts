import { basename, dirname } from "node:path";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { getArray, getRecord, getString, isRecord } from "../protocol";

export const CODEX_UNFIT_SKILLS = [
  "openai-docs",
  "plugin-management:plugin-management",
  "work-pets:create-pet",
  "work-pets:pets",
  "work-pets:update-pet",
] as const;

export interface CodexPromptSettings {
  "features.tool_suggest": false;
  "features.recommended_plugins": false;
  "skills.config"?: DynamicRecord[];
  model_reasoning_summary?: "auto";
}

export function codexPromptSettings(read: DynamicRecord | null): CodexPromptSettings {
  const settings: CodexPromptSettings = {
    "features.tool_suggest": false,
    "features.recommended_plugins": false,
  };
  if (!read) return settings;
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
