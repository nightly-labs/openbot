// Form side of a user-named ACP agent: a command that OpenBot starts on this computer and talks to
// over the Agent Client Protocol on stdio. The dialog hands the trimmed draft to its host, which
// turns it into the IPC input with `customAgentInput`.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AcpAgentPreset,
  type CheckCustomAgentInput,
  CUSTOM_AGENT_ENV_NAME_PATTERN,
  CUSTOM_AGENT_ID_PATTERN,
  CUSTOM_AGENT_LIMITS,
  type CustomAgentSummary,
  isCustomAgentId,
  type SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { currentText } from "../../text";

export interface CustomAcpEnvDraft {
  name: string;
  value: string;
  /**
   * The saved name whose value main holds. An empty value under this same name keeps that value,
   * because the value never comes back to the renderer.
   */
  savedName?: string;
}

export interface CustomAcpAgentDraft {
  agentId: string;
  displayName: string;
  command: string;
  /** Separated by spaces, as a user types them in a terminal. */
  args: string;
  env: CustomAcpEnvDraft[];
}

export interface CustomAcpAgentErrors {
  agentId?: string;
  displayName?: string;
  command?: string;
  envRows: (string | undefined)[];
}

/** The state of one trial start: OpenBot runs the command and sends `initialize`, then stops it. */
export type AcpAgentCheck =
  | { status: "idle" }
  | { status: "checking" }
  | {
      status: "ok";
      agentName: string;
      version?: string;
      protocolVersion: number;
      /** Capability names as the agent reports them, such as `loadSession` or `image`. */
      capabilities: readonly string[];
    }
  | { status: "failed"; message: string };

export function emptyCustomAcpAgentDraft(): CustomAcpAgentDraft {
  return { agentId: "", displayName: "", command: "", args: "", env: [{ name: "", value: "" }] };
}

export function presetAcpAgentDraft(preset: AcpAgentPreset): CustomAcpAgentDraft {
  return {
    agentId: preset.id,
    displayName: preset.name,
    command: preset.command,
    args: preset.args.join(" "),
    env: [{ name: "", value: "" }],
  };
}

/** The form for a saved agent: each saved variable is a row whose empty value keeps the saved one. */
export function savedAcpAgentDraft(agent: CustomAgentSummary): CustomAcpAgentDraft {
  return {
    agentId: agent.id,
    displayName: agent.name,
    command: agent.command,
    args: agent.args.join(" "),
    env:
      agent.envNames.length > 0
        ? agent.envNames.map((name) => ({ name, value: "", savedName: name }))
        : [{ name: "", value: "" }],
  };
}

function blankEnv(row: CustomAcpEnvDraft): boolean {
  return !row.name.trim() && !row.value.trim();
}

/** A saved variable whose value the user left empty. Main fills it in. */
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
  else if (!isCustomAgentId(agentId) || takenAgentIds.includes(agentId)) {
    errors.agentId = t("customProvider.acp.error.agentIdTaken", { id: agentId });
  }

  const displayName = draft.displayName.trim();
  if (!displayName) errors.displayName = t("customProvider.error.displayNameRequired");
  else if (displayName.length > INPUT_LIMITS.agentName) {
    errors.displayName = t("customProvider.error.displayNameLength", { max: INPUT_LIMITS.agentName });
  }

  if (!draft.command.trim()) errors.command = t("customProvider.acp.error.commandRequired");

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
  return Boolean(errors.agentId || errors.displayName || errors.command || errors.envRows.some(Boolean));
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
  };
}

/** Split as a shell splits plain words. Main refuses a line break and more than 32 arguments. */
function draftArgs(args: string): string[] {
  return args.split(/\s+/).filter(Boolean);
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
  };
}

/** A kept value is read from `savedAgentId`, so a check of an edited agent needs no retyped key. */
export function customAgentCheckInput(draft: CustomAcpAgentDraft, savedAgentId?: string): CheckCustomAgentInput {
  const value = customAcpAgentValue(draft);
  return {
    command: value.command,
    args: draftArgs(value.args),
    env: draftEnv(value),
    ...(savedAgentId === undefined ? {} : { savedAgentId }),
  };
}
