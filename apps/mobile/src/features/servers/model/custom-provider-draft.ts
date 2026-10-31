import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  CUSTOM_PROVIDER_ID_PATTERN,
  composedCustomModelId,
  DEFAULT_MODEL_SERVERS,
  isAgentModel,
  isCustomProviderHeaderName,
  isNewCustomProviderId,
  type SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import type { PairItem } from "@/features/servers/components/repeatable-fields";
import type { MobileText } from "@/shared/lib/text";

/** The example address of a base URL: Ollama on the server's own computer, as on desktop. */
export const CUSTOM_PROVIDER_URL_EXAMPLE = DEFAULT_MODEL_SERVERS.ollama.baseUrl;

/**
 * What the Add custom provider page edits. A model is a pair of its ID and display name, and a header
 * of its name and value. The Team API has no edit route, so the page only adds an endpoint.
 */
export interface CustomProviderDraft {
  name: string;
  id: string;
  /** False until the user types an ID. Until then the ID follows the display name. */
  idEdited: boolean;
  baseUrl: string;
  apiKey: string;
  models: PairItem[];
  headers: PairItem[];
}

/** The starting points of the add flow, as on desktop. A preset only fills the form. */
const CUSTOM_PROVIDER_PRESETS = ["ollama", "lmstudio", "openai-compatible"] as const;
export type CustomProviderPreset = (typeof CUSTOM_PROVIDER_PRESETS)[number];

export function isCustomProviderPreset(value: unknown): value is CustomProviderPreset {
  return isOneOf(CUSTOM_PROVIDER_PRESETS, value);
}

/** The form of a preset: a local model server has its name, ID and default address on the host. */
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

/** A provider ID from a display name: "LM Studio" gives `lm-studio`. */
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

/** Whether the user changed the form that the preset opened with. */
export function customProviderDraftChanged(draft: CustomProviderDraft, initial: CustomProviderDraft): boolean {
  const values = (value: CustomProviderDraft) => JSON.stringify(customProviderInput(value));
  return values(draft) !== values(initial);
}

function blank(pair: PairItem): boolean {
  return !pair.key.trim() && !pair.value.trim();
}

/** The message of each field that has a problem, as the page shows it. An empty field has none: Add stays off. */
export interface CustomProviderErrors {
  id?: string;
  baseUrl?: string;
  /** The first problem of the model rows. */
  models?: string;
  /** The first problem of the header rows. */
  headers?: string;
}

/**
 * The checks of the desktop form, with the bounds of the contract. The host checks the same rules on
 * save, so a value that passes here does not fail there.
 */
export function customProviderErrors(
  draft: CustomProviderDraft,
  taken: readonly string[],
  t: MobileText["t"],
): CustomProviderErrors {
  const errors: CustomProviderErrors = {};
  const id = draft.id.trim();
  if (id) {
    if (!CUSTOM_PROVIDER_ID_PATTERN.test(id)) errors.id = t("mobile.server.customProviders.idPattern");
    // The field stops at the length limit, so only a built-in provider name fails here.
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
    // The host reports the model as `<provider id>/<model id>`, and a malformed one empties the list.
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
    else if (!header.value.trim()) errors.headers = t("mobile.server.customProviders.headerValueRequired");
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
  // A model server on the host's computer has no certificate, so `http:` is the usual case.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    return t("mobile.server.customProviders.baseUrlProtocol");
  // The host keeps the address as plain text. Only the key and the headers are encrypted.
  if (parsed.username || parsed.password) return t("mobile.server.customProviders.baseUrlCredential");
  return undefined;
}

/** All required fields have a value, and no field has a problem. */
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

/** The save payload: trimmed, without empty rows. An empty key means that the endpoint needs no key. */
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
