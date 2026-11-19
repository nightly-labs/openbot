import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  CUSTOM_PROVIDER_ID_PATTERN,
  type CustomProviderSummary,
  composedCustomModelId,
  DEFAULT_MODEL_SERVERS,
  isAgentModel,
  isCustomProviderHeaderName,
  isNewCustomProviderId,
  type SaveCustomProviderInput,
  type UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import type { PairItem } from "@/features/servers/components/repeatable-fields";
import type { MobileText } from "@/shared/lib/text";

export const CUSTOM_PROVIDER_URL_EXAMPLE = DEFAULT_MODEL_SERVERS.ollama.baseUrl;

export interface CustomProviderDraft {
  name: string;
  id: string;
  idEdited: boolean;
  baseUrl: string;
  apiKey: string;
  models: PairItem[];
  headers: PairItem[];
}

const CUSTOM_PROVIDER_PRESETS = ["ollama", "lmstudio", "openai-compatible"] as const;
export type CustomProviderPreset = (typeof CUSTOM_PROVIDER_PRESETS)[number];

export function isCustomProviderPreset(value: unknown): value is CustomProviderPreset {
  return isOneOf(CUSTOM_PROVIDER_PRESETS, value);
}

export function presetCustomProviderDraft(preset: CustomProviderPreset): CustomProviderDraft {
  const server = preset === "openai-compatible" ? null : DEFAULT_MODEL_SERVERS[preset];
  return {
    name: server?.name ?? "",
    id: server ? preset : "",
    idEdited: false,
    baseUrl: server?.baseUrl ?? "",
    apiKey: "",
    models: [{ key: "", value: "" }],
    headers: [],
  };
}

export function savedCustomProviderDraft(saved: CustomProviderSummary): CustomProviderDraft {
  return {
    name: saved.name,
    id: saved.id,
    idEdited: true,
    baseUrl: saved.baseUrl,
    apiKey: "",
    models: saved.models.map((model) => ({ key: model.id, value: model.name === model.id ? "" : model.name })),
    headers: (saved.headerNames ?? []).map((name) => ({ key: name, value: "" })),
  };
}

export function suggestedCustomProviderId(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^[-_]+/u, "")
    .slice(0, INPUT_LIMITS.identifier)
    .replace(/[-_]+$/u, "");
}

export function customProviderDraftChanged(draft: CustomProviderDraft, initial: CustomProviderDraft): boolean {
  const values = (value: CustomProviderDraft) => JSON.stringify(customProviderInput(value));
  return values(draft) !== values(initial);
}

function blank(pair: PairItem): boolean {
  return !pair.key.trim() && !pair.value.trim();
}

export interface CustomProviderErrors {
  id?: string;
  baseUrl?: string;
  models?: string;
  headers?: string;
}

export function customProviderErrors(
  draft: CustomProviderDraft,
  taken: readonly string[],
  t: MobileText["t"],
  saved?: CustomProviderSummary,
): CustomProviderErrors {
  const errors: CustomProviderErrors = {};
  const id = draft.id.trim();
  if (id && !saved) {
    if (!CUSTOM_PROVIDER_ID_PATTERN.test(id)) errors.id = t("mobile.server.customProviders.idPattern");
    else if (!isNewCustomProviderId(id)) errors.id = t("mobile.server.customProviders.idBuiltIn", { id });
    else if (taken.includes(id)) errors.id = t("mobile.server.customProviders.idTaken", { id });
  }

  const baseUrl = draft.baseUrl.trim();
  if (baseUrl) errors.baseUrl = baseUrlError(baseUrl, t);

  const modelIds = new Set<string>();
  for (const model of draft.models) {
    if (blank(model)) continue;
    const modelId = model.key.trim();
    if (!modelId) errors.models = t("mobile.server.customProviders.modelIdRequired");
    else if (modelIds.has(modelId))
      errors.models = t("mobile.server.customProviders.modelIdDuplicate", { id: modelId });
    else if (!isAgentModel(composedCustomModelId(id || "custom", modelId)))
      errors.models = t("mobile.server.customProviders.modelIdInvalid");
    modelIds.add(modelId);
    if (errors.models) break;
  }

  const headerNames = new Set<string>();
  for (const header of draft.headers) {
    if (blank(header)) continue;
    const name = header.key.trim();
    if (!name) errors.headers = t("mobile.server.customProviders.headerNameRequired");
    else if (!isCustomProviderHeaderName(name)) errors.headers = t("mobile.server.customProviders.headerNameInvalid");
    else if (headerNames.has(name.toLowerCase()))
      errors.headers = t("mobile.server.customProviders.headerDuplicate", { name });
    else if (!header.value.trim() && !savedHeader(saved, name))
      errors.headers = t("mobile.server.customProviders.headerValueRequired");
    headerNames.add(name.toLowerCase());
    if (errors.headers) break;
  }
  return errors;
}

function baseUrlError(baseUrl: string, t: MobileText["t"]): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return t("mobile.server.customProviders.baseUrlInvalid", { example: CUSTOM_PROVIDER_URL_EXAMPLE });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return t("mobile.server.customProviders.baseUrlProtocol");
  if (parsed.username || parsed.password) return t("mobile.server.customProviders.baseUrlCredential");
  return undefined;
}

export function customProviderReady(draft: CustomProviderDraft, errors: CustomProviderErrors): boolean {
  return (
    Boolean(draft.name.trim() && draft.id.trim() && draft.baseUrl.trim()) &&
    draft.models.some((model) => model.key.trim()) &&
    !errors.id &&
    !errors.baseUrl &&
    !errors.models &&
    !errors.headers
  );
}

export function customProviderInput(draft: CustomProviderDraft): SaveCustomProviderInput {
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim() || null,
    models: draft.models
      .filter((model) => !blank(model))
      .map((model) => ({ id: model.key.trim(), name: model.value.trim() || model.key.trim() })),
    headers: draft.headers
      .filter((header) => !blank(header))
      .map((header) => ({ name: header.key.trim(), value: header.value.trim() })),
  };
}

function savedHeader(saved: CustomProviderSummary | undefined, name: string): boolean {
  return saved?.headerNames?.includes(name) ?? false;
}

export function customProviderUpdateInput(
  draft: CustomProviderDraft,
  saved: CustomProviderSummary,
): UpdateCustomProviderInput {
  const { name, baseUrl, apiKey, models } = customProviderInput(draft);
  return {
    id: saved.id,
    name,
    baseUrl,
    models,
    ...(apiKey ? { apiKey } : {}),
    headers: draft.headers
      .filter((header) => !blank(header))
      .map((header) => {
        const headerName = header.key.trim();
        const value = header.value.trim();
        return { name: headerName, value: !value && savedHeader(saved, headerName) ? null : value };
      }),
  };
}
