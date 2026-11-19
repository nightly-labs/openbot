import {
  ACP_AGENT_PRESETS,
  CUSTOM_AGENT_ENV_NAME_PATTERN,
  CUSTOM_AGENT_ID_PATTERN,
  type CustomAgentSummary,
  isCustomAgentUsagePrompt,
  isNewCustomAgentId,
  type SaveCustomAgentInput,
} from "@openbot/contracts/ipc";
import type { PairItem } from "@/features/servers/components/repeatable-fields";
import type { MobileText } from "@/shared/lib/text";

export const CUSTOM_AGENT_ID_LIMIT = 40;

export interface CustomAgentDraft {
  name: string;
  id: string;
  idEdited: boolean;
  command: string;
  args: string[];
  env: PairItem[];
  usagePrompt: string;
}

export function customAgentDraft(agent: CustomAgentSummary | undefined): CustomAgentDraft {
  return {
    name: agent?.name ?? "",
    id: agent?.id ?? "",
    idEdited: agent !== undefined,
    command: agent?.command ?? "",
    args: [...(agent?.args ?? [])],
    env: agent?.envNames.map((name) => ({ key: name, value: "" })) ?? [],
    usagePrompt: agent?.usagePrompt ?? "",
  };
}

export function presetCustomAgentDraft(draft: CustomAgentDraft, presetId: string): CustomAgentDraft {
  const preset = ACP_AGENT_PRESETS.find((candidate) => candidate.id === presetId);
  if (!preset) return draft;
  return {
    ...draft,
    name: preset.name,
    id: preset.id,
    idEdited: false,
    command: preset.command,
    args: [...preset.args],
  };
}

export function suggestedCustomAgentId(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, CUSTOM_AGENT_ID_LIMIT)
    .replace(/-+$/u, "");
}

function blank(pair: PairItem): boolean {
  return !pair.key.trim() && !pair.value;
}

export interface CustomAgentErrors {
  id?: string;
  env?: string;
  usagePrompt?: string;
}

export function customAgentErrors(
  draft: CustomAgentDraft,
  saved: CustomAgentSummary | undefined,
  taken: readonly string[],
  t: MobileText["t"],
): CustomAgentErrors {
  const errors: CustomAgentErrors = {};
  const id = draft.id.trim();
  if (!saved && id) {
    if (!CUSTOM_AGENT_ID_PATTERN.test(id)) errors.id = t("mobile.server.customAgents.idPattern");
    else if (!isNewCustomAgentId(id)) errors.id = t("mobile.server.customAgents.idBuiltIn", { id });
    else if (taken.includes(id)) errors.id = t("mobile.server.customAgents.idTaken", { id });
  }
  const usagePrompt = draft.usagePrompt.trim();
  if (usagePrompt && !isCustomAgentUsagePrompt(usagePrompt))
    errors.usagePrompt = t("mobile.server.customAgents.usagePromptInvalid");
  const names = new Set<string>();
  for (const row of draft.env) {
    if (blank(row)) continue;
    const name = row.key.trim();
    if (!CUSTOM_AGENT_ENV_NAME_PATTERN.test(name)) errors.env = t("mobile.server.customAgents.envNameInvalid");
    else if (names.has(name)) errors.env = t("mobile.server.customAgents.envDuplicate", { name });
    else if (!row.value && !saved?.envNames.includes(name))
      errors.env = t("mobile.server.customAgents.envValueRequired");
    names.add(name);
    if (errors.env) break;
  }
  return errors;
}

export function customAgentReady(draft: CustomAgentDraft, errors: CustomAgentErrors): boolean {
  return (
    Boolean(draft.name.trim() && draft.id.trim() && draft.command.trim()) &&
    !errors.id &&
    !errors.env &&
    !errors.usagePrompt
  );
}

export function customAgentInput(draft: CustomAgentDraft, saved: CustomAgentSummary | undefined): SaveCustomAgentInput {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    command: draft.command.trim(),
    args: draft.args.filter((arg, index) => arg !== "" || saved?.args[index] === ""),
    env: draft.env
      .filter((row) => !blank(row))
      .map((row) => {
        const name = row.key.trim();
        return { name, value: !row.value && saved?.envNames.includes(name) ? null : row.value };
      }),
    usagePrompt: draft.usagePrompt.trim() || null,
  };
}

export function customAgentDraftChanged(draft: CustomAgentDraft, saved: CustomAgentSummary | undefined): boolean {
  return (
    JSON.stringify(customAgentInput(draft, saved)) !== JSON.stringify(customAgentInput(customAgentDraft(saved), saved))
  );
}
