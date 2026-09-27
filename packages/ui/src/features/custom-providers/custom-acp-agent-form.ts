// Form side of a user-named ACP agent: a command that OpenBot starts on this computer and talks to
// over the Agent Client Protocol on stdio. There is no contract for it yet, so the form hands the
// trimmed draft to its host.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { AGENT_PROVIDERS, CUSTOM_PROVIDER_ID_PATTERN } from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { currentText } from "../../text";

export interface CustomAcpEnvDraft {
  name: string;
  value: string;
}

export interface CustomAcpAgentDraft {
  agentId: string;
  displayName: string;
  command: string;
  /** Separated by spaces, as a user types them in a terminal. */
  args: string;
  env: CustomAcpEnvDraft[];
}

/** A known agent whose command fills the form. The host owns the list. */
export interface CustomAcpAgentPreset {
  id: string;
  name: string;
  command: string;
  args: string;
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

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function emptyCustomAcpAgentDraft(): CustomAcpAgentDraft {
  return { agentId: "", displayName: "", command: "", args: "", env: [{ name: "", value: "" }] };
}

export function presetAcpAgentDraft(preset: CustomAcpAgentPreset): CustomAcpAgentDraft {
  return {
    agentId: preset.id,
    displayName: preset.name,
    command: preset.command,
    args: preset.args,
    env: [{ name: "", value: "" }],
  };
}

function blankEnv(row: CustomAcpEnvDraft): boolean {
  return !row.name.trim() && !row.value.trim();
}

export function validateCustomAcpAgent(
  draft: CustomAcpAgentDraft,
  takenAgentIds: readonly string[] = [],
  t: AppTranslate = currentText().t,
): CustomAcpAgentErrors {
  const agentId = draft.agentId.trim();
  const errors: CustomAcpAgentErrors = { envRows: draft.env.map(() => undefined) };

  if (!agentId) errors.agentId = t("customProvider.acp.error.agentIdRequired");
  else if (!CUSTOM_PROVIDER_ID_PATTERN.test(agentId)) errors.agentId = t("customProvider.error.providerIdPattern");
  else if (AGENT_PROVIDERS.some((provider) => provider === agentId) || takenAgentIds.includes(agentId)) {
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
    if (!ENV_NAME_PATTERN.test(name)) errors.envRows[index] = t("customProvider.acp.error.envNameInvalid");
    else if (names.has(name)) errors.envRows[index] = t("customProvider.acp.error.envDuplicate", { name });
    else names.add(name);
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
    env: draft.env.filter((row) => !blankEnv(row)).map((row) => ({ name: row.name.trim(), value: row.value })),
  };
}
