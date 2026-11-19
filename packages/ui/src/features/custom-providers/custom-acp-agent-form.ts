import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AcpAgentPreset,
  type CheckCustomAgentInput,
  CUSTOM_AGENT_ENV_NAME_PATTERN,
  CUSTOM_AGENT_ID_PATTERN,
  CUSTOM_AGENT_LIMITS,
  type CustomAgentSummary,
  isCustomAgentUsagePrompt,
  isNewCustomAgentId,
  type SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { currentText } from "../../text";

export interface CustomAcpEnvDraft {
  name: string;
  value: string;
  savedName?: string;
}

export interface CustomAcpAgentDraft {
  agentId: string;
  displayName: string;
  command: string;
  args: string;
  env: CustomAcpEnvDraft[];
  usagePrompt: string;
}

export interface CustomAcpAgentErrors {
  agentId?: string;
  displayName?: string;
  command?: string;
  usagePrompt?: string;
  envRows: (string | undefined)[];
}

export type AcpAgentCheck =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "ok";
      agentName: string;
      version?: string;
      protocolVersion: number;
      capabilities: readonly string[];
      models: readonly string[];
    }
  | { status: "failed"; message: string };

export function emptyCustomAcpAgentDraft(): CustomAcpAgentDraft {
  return { agentId: "", displayName: "", command: "", args: "", env: [{ name: "", value: "" }], usagePrompt: "" };
}

export function presetAcpAgentDraft(preset: AcpAgentPreset): CustomAcpAgentDraft {
  return {
    agentId: preset.id,
    displayName: preset.name,
    command: preset.command,
    args: formatAgentArgs(preset.args),
    env: [{ name: "", value: "" }],
    usagePrompt: "",
  };
}

export function savedAcpAgentDraft(agent: CustomAgentSummary): CustomAcpAgentDraft {
  return {
    agentId: agent.id,
    displayName: agent.name,
    command: agent.command,
    args: formatAgentArgs(agent.args),
    env:
      agent.envNames.length > 0
        ? agent.envNames.map((name) => ({ name, value: "", savedName: name }))
        : [{ name: "", value: "" }],
    usagePrompt: agent.usagePrompt ?? "",
  };
}

function blankEnv(row: CustomAcpEnvDraft): boolean {
  return !row.name.trim() && !row.value.trim();
}

function keepsValue(row: CustomAcpEnvDraft): boolean {
  return row.savedName !== undefined && row.name.trim() === row.savedName && row.value === "";
}

export function validateCustomAcpAgent(
  draft: CustomAcpAgentDraft,
  takenAgentIds: readonly string[] = [],
  t: AppTranslate = currentText().t,
): CustomAcpAgentErrors {
  const agentId = draft.agentId.trim();
  const errors: CustomAcpAgentErrors = { envRows: draft.env.map(() => undefined) };

  if (!agentId) errors.agentId = t("customProvider.acp.error.agentIdRequired");
  else if (!CUSTOM_AGENT_ID_PATTERN.test(agentId)) errors.agentId = t("customProvider.acp.error.agentIdPattern");
  else if (!isNewCustomAgentId(agentId) || takenAgentIds.includes(agentId)) {
    errors.agentId = t("customProvider.acp.error.agentIdTaken", { id: agentId });
  }

  const displayName = draft.displayName.trim();
  if (!displayName) errors.displayName = t("customProvider.error.displayNameRequired");
  else if (displayName.length > INPUT_LIMITS.agentName) {
    errors.displayName = t("customProvider.error.displayNameLength", { max: INPUT_LIMITS.agentName });
  }

  if (!draft.command.trim()) errors.command = t("customProvider.acp.error.commandRequired");

  const usagePrompt = draft.usagePrompt.trim();
  if (usagePrompt && !isCustomAgentUsagePrompt(usagePrompt)) {
    errors.usagePrompt = t("customProvider.acp.error.usagePromptInvalid", { max: CUSTOM_AGENT_LIMITS.usagePrompt });
  }

  const names = new Set<string>();
  draft.env.forEach((row, index) => {
    if (blankEnv(row)) return;
    const name = row.name.trim();
    if (!CUSTOM_AGENT_ENV_NAME_PATTERN.test(name)) errors.envRows[index] = t("customProvider.acp.error.envNameInvalid");
    else if (names.has(name)) errors.envRows[index] = t("customProvider.acp.error.envDuplicate", { name });
    else if (!row.value && !keepsValue(row)) errors.envRows[index] = t("customProvider.acp.error.envValueRequired");
    else if (row.value.length > CUSTOM_AGENT_LIMITS.envValue) {
      errors.envRows[index] = t("customProvider.acp.error.envValueLength", { max: CUSTOM_AGENT_LIMITS.envValue });
    }
    names.add(name);
  });

  return errors;
}

export function hasCustomAcpAgentError(errors: CustomAcpAgentErrors): boolean {
  return Boolean(
    errors.agentId || errors.displayName || errors.command || errors.usagePrompt || errors.envRows.some(Boolean),
  );
}

export function customAcpAgentValue(draft: CustomAcpAgentDraft): CustomAcpAgentDraft {
  return {
    agentId: draft.agentId.trim(),
    displayName: draft.displayName.trim(),
    command: draft.command.trim(),
    args: draft.args.trim(),
    env: draft.env
      .filter((row) => !blankEnv(row))
      .map((row) => ({
        name: row.name.trim(),
        value: row.value,
        ...(row.savedName === undefined ? {} : { savedName: row.savedName }),
      })),
    usagePrompt: draft.usagePrompt.trim(),
  };
}

function draftArgs(text: string): string[] {
  const args: string[] = [];
  let current: string | null = null;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    const next = text.charAt(index + 1);
    if (quote) {
      if (char === quote) quote = null;
      else if (quote === '"' && char === "\\" && (next === '"' || next === "\\")) {
        current = (current ?? "") + next;
        index += 1;
      } else current = (current ?? "") + char;
    } else if (/\s/.test(char)) {
      if (current !== null) args.push(current);
      current = null;
    } else if (char === '"' || char === "'") {
      quote = char;
      current ??= "";
    } else current = (current ?? "") + char;
  }
  if (current !== null) args.push(current);
  return args;
}

export function formatAgentArgs(args: readonly string[]): string {
  return args.map((arg) => (/^[^\s"']+$/.test(arg) ? arg : `"${arg.replace(/["\\]/g, "\\$&")}"`)).join(" ");
}

function draftEnv(draft: CustomAcpAgentDraft): SaveCustomAgentInput["env"] {
  return customAcpAgentValue(draft).env.map((row) => ({ name: row.name, value: keepsValue(row) ? null : row.value }));
}

export function customAgentInput(draft: CustomAcpAgentDraft): SaveCustomAgentInput {
  const value = customAcpAgentValue(draft);
  return {
    id: value.agentId,
    name: value.displayName,
    command: value.command,
    args: draftArgs(value.args),
    env: draftEnv(value),
    usagePrompt: value.usagePrompt || null,
  };
}

export function customAgentCheckInput(draft: CustomAcpAgentDraft, savedAgentId?: string): CheckCustomAgentInput {
  const value = customAcpAgentValue(draft);
  return {
    command: value.command,
    args: draftArgs(value.args),
    env: draftEnv(value),
    ...(savedAgentId === undefined ? {} : { savedAgentId }),
  };
}
