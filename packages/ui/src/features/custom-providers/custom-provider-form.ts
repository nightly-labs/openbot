// Form side of the user-named endpoint: field names are the form's own (labels/error index),
// submit produces the contract `SaveCustomProviderInput` verbatim. Every bound/pattern comes
// from the contract; main rechecks on save, so a drifted copy would pass the form and fail save.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { CustomProviderSummary, SaveCustomProviderInput, UpdateCustomProviderInput } from "@openbot/contracts/ipc";
import {
  AGENT_PROVIDERS,
  CUSTOM_PROVIDER_ID_PATTERN,
  CUSTOM_PROVIDER_LIMITS,
  composedCustomModelId,
  isAgentModel,
  isCustomProviderContextWindow,
  isCustomProviderHeaderName,
} from "@openbot/contracts/ipc";
import type { AppFormat, AppTranslate } from "@openbot/i18n";
import { currentText } from "../../text";

export interface CustomModelDraft {
  id: string;
  name: string;
  /** Tokens, as typed. Blank keeps OpenCode's default. */
  contextWindow?: string;
}

export interface CustomHeaderDraft {
  name: string;
  value: string;
  /** The name of a saved header. Main holds its value, which an empty field keeps. */
  savedName?: string;
}

export interface CustomProviderDraft {
  providerId: string;
  displayName: string;
  baseUrl: string;
  apiKey: string;
  models: CustomModelDraft[];
  headers: CustomHeaderDraft[];
}

/** One message per field, plus one per repeatable row, indexed the way the form renders them. */
export interface CustomProviderErrors {
  providerId?: string;
  displayName?: string;
  baseUrl?: string | undefined;
  apiKey?: string;
  /** Nothing usable in the whole list, so no single row owns the message. */
  models?: string;
  modelRows: (string | undefined)[];
  headerRows: (string | undefined)[];
}

export function emptyCustomProviderDraft(): CustomProviderDraft {
  return {
    providerId: "",
    displayName: "",
    baseUrl: "",
    apiKey: "",
    models: [{ id: "", name: "" }],
    headers: [{ name: "", value: "" }],
  };
}

/** The header rows of a saved endpoint: each saved name, with an empty value that keeps the saved one. */
export function savedHeaderDrafts(names: readonly string[] | undefined): CustomHeaderDraft[] {
  return names && names.length > 0
    ? names.map((name) => ({ name, value: "", savedName: name }))
    : [{ name: "", value: "" }];
}

/**
 * The form for a saved endpoint. The key and the header values stay in main, so their fields open
 * blank, and blank fields keep them (`customProviderUpdate`).
 */
export function savedCustomProviderDraft(provider: CustomProviderSummary): CustomProviderDraft {
  return {
    providerId: provider.id,
    displayName: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: "",
    models:
      provider.models.length > 0
        ? provider.models.map((model) => ({
            id: model.id,
            name: model.name,
            contextWindow: model.contextWindow?.toString() ?? "",
          }))
        : [{ id: "", name: "" }],
    headers: savedHeaderDrafts(provider.headerNames),
  };
}

/** A row the user has not filled in yet: carried by the form, ignored by validation and submit. */
export function blankModel(model: CustomModelDraft): boolean {
  return !model.id.trim() && !model.name.trim() && !model.contextWindow?.trim();
}

/**
 * The typed context window: undefined when blank, null when it is not a usable token count. The text
 * is plain digits, or groups of three digits with one separator, so `128,000`, `128 000` and `128.000`
 * are all 128000. A decimal such as `200000.0` or `1300.5` is refused, not read as a larger number.
 */
function contextWindowValue(model: CustomModelDraft): number | null | undefined {
  const text = model.contextWindow?.trim() ?? "";
  if (!text) return undefined;
  if (!/^(?:\d+|\d{1,3}(?:([\s,._'’])\d{3})(?:\1\d{3})*)$/u.test(text)) return null;
  const value = Number(text.replace(/\D/gu, ""));
  return isCustomProviderContextWindow(value) ? value : null;
}

function blankHeader(header: CustomHeaderDraft): boolean {
  return !header.name.trim() && !header.value.trim();
}

/** A saved header whose value the user left empty. Main fills it in. */
export function keepsHeaderValue(header: CustomHeaderDraft): boolean {
  return header.savedName !== undefined && header.name.trim() === header.savedName && !header.value.trim();
}

/**
 * A locked ID names a saved endpoint, so it has no ID checks: main accepts a saved ID that a later
 * release made a built-in provider name, and the user cannot change a locked field.
 */
export function validateCustomProvider(
  draft: CustomProviderDraft,
  ids: { taken?: readonly string[] | undefined; locked?: boolean | undefined } = {},
  t: AppTranslate = currentText().t,
  format: AppFormat = currentText().format,
): CustomProviderErrors {
  const providerId = draft.providerId.trim();
  const errors: CustomProviderErrors = {
    modelRows: draft.models.map(() => undefined),
    headerRows: draft.headers.map(() => undefined),
  };

  if (!ids.locked) {
    if (!providerId) errors.providerId = t("customProvider.error.providerIdRequired");
    else if (!CUSTOM_PROVIDER_ID_PATTERN.test(providerId)) {
      errors.providerId = t("customProvider.error.providerIdPattern");
    } else if (providerId.length > INPUT_LIMITS.identifier) {
      errors.providerId = t("customProvider.error.providerIdLength", { max: INPUT_LIMITS.identifier });
    } else if (AGENT_PROVIDERS.some((provider) => provider === providerId)) {
      errors.providerId = t("customProvider.error.providerIdBuiltIn", { id: providerId });
    } else if (ids.taken?.includes(providerId)) {
      // There is no way to overwrite a saved ID: main refuses the save, and this says so before the
      // round trip.
      errors.providerId = t("customProvider.error.providerIdSaved", { id: providerId });
    }
  }

  const displayName = draft.displayName.trim();
  if (!displayName) errors.displayName = t("customProvider.error.displayNameRequired");
  else if (displayName.length > INPUT_LIMITS.agentName) {
    errors.displayName = t("customProvider.error.displayNameLength", { max: INPUT_LIMITS.agentName });
  }

  errors.baseUrl = baseUrlError(draft.baseUrl.trim(), t);

  if (draft.apiKey.length > CUSTOM_PROVIDER_LIMITS.apiKey) {
    errors.apiKey = t("customProvider.error.apiKeyLength", { max: CUSTOM_PROVIDER_LIMITS.apiKey });
  }

  const filled = draft.models.filter((model) => !blankModel(model));
  if (filled.length === 0) errors.models = t("customProvider.error.modelsRequired");
  else if (filled.length > CUSTOM_PROVIDER_LIMITS.models) {
    errors.models = t("customProvider.error.modelsLimit", { max: CUSTOM_PROVIDER_LIMITS.models });
  }

  const seen = new Set<string>();
  draft.models.forEach((model, index) => {
    if (blankModel(model)) return;
    const id = model.id.trim();
    if (!id) {
      errors.modelRows[index] = t("customProvider.error.modelIdRequired");
      return;
    }
    if (seen.has(id)) {
      errors.modelRows[index] = t("customProvider.error.modelIdDuplicate", { id });
      return;
    }
    seen.add(id);
    if (model.name.trim().length > INPUT_LIMITS.modelName) {
      errors.modelRows[index] = t("customProvider.error.displayNameLength", { max: INPUT_LIMITS.modelName });
      return;
    }
    if (contextWindowValue(model) === null) {
      errors.modelRows[index] = t("customProvider.error.contextWindowInvalid", {
        min: format.number(CUSTOM_PROVIDER_LIMITS.contextWindowMin),
        max: format.number(CUSTOM_PROVIDER_LIMITS.contextWindowMax),
      });
      return;
    }
    // OpenCode reports this model as `<provider id>/<model id>`, and both the IPC and Team API list
    // decoders fail closed on the whole array when one id is malformed - which empties the picker
    // rather than hiding one row. So the composed id is checked here, where the user can still fix it.
    if (!errors.providerId && !isAgentModel(composedCustomModelId(providerId, id))) {
      errors.modelRows[index] = t("customProvider.error.modelIdInvalid");
    }
  });

  const headerNames = new Set<string>();
  draft.headers.forEach((header, index) => {
    if (blankHeader(header)) return;
    const name = header.name.trim();
    if (!name) errors.headerRows[index] = t("customProvider.error.headerNameRequired");
    else if (!isCustomProviderHeaderName(name)) errors.headerRows[index] = t("customProvider.error.headerNameInvalid");
    else if (headerNames.has(name.toLowerCase()))
      errors.headerRows[index] = t("customProvider.error.headerDuplicate", { name });
    else if (!header.value.trim() && !keepsHeaderValue(header))
      errors.headerRows[index] = t("customProvider.error.headerValueRequired");
    else headerNames.add(name.toLowerCase());
  });
  if (draft.headers.filter((header) => !blankHeader(header)).length > CUSTOM_PROVIDER_LIMITS.headers) {
    errors.headerRows[CUSTOM_PROVIDER_LIMITS.headers] = t("customProvider.error.headersLimit", {
      max: CUSTOM_PROVIDER_LIMITS.headers,
    });
  }

  return errors;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** The base URL rules on their own, for an address that is not part of a full endpoint form. */
export function endpointUrlError(url: string, t: AppTranslate = currentText().t): string | undefined {
  return baseUrlError(url.trim(), t);
}

function baseUrlError(baseUrl: string, t: AppTranslate): string | undefined {
  if (!baseUrl) return t("customProvider.error.baseUrlRequired");
  if (baseUrl.length > CUSTOM_PROVIDER_LIMITS.baseUrl) {
    return t("customProvider.error.baseUrlLength", { max: CUSTOM_PROVIDER_LIMITS.baseUrl });
  }
  const parsed = parseUrl(baseUrl);
  if (!parsed) return t("customProvider.error.baseUrlInvalid", { example: "http://127.0.0.1:11434/v1" });
  // `http:` is the main case, not the exception: a custom provider is usually a model server on this
  // computer, which has no certificate. Anything else - `file:`, `ws:`, `javascript:` - is not an
  // endpoint OpenCode can call.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return t("customProvider.error.baseUrlProtocol");
  // A credential in the URL is stored and listed as plain text, because only the key and the headers
  // are encrypted. The user is told where it belongs instead.
  if (parsed.username || parsed.password) return t("customProvider.error.baseUrlCredential");
  return undefined;
}

export function hasCustomProviderError(errors: CustomProviderErrors): boolean {
  return Boolean(
    errors.providerId ||
      errors.displayName ||
      errors.baseUrl ||
      errors.apiKey ||
      errors.models ||
      errors.modelRows.some(Boolean) ||
      errors.headerRows.some(Boolean),
  );
}

/**
 * The wire payload: trimmed, with the blank placeholder rows dropped. A kept saved header has an
 * empty value, which only `customProviderUpdate` sends.
 */
export function customProviderValue(draft: CustomProviderDraft): SaveCustomProviderInput {
  const models = draft.models
    .filter((model) => !blankModel(model))
    .map((model) => {
      const id = model.id.trim();
      const name = model.name.trim() || id;
      const contextWindow = contextWindowValue(model);
      return typeof contextWindow === "number" ? { id, name, contextWindow } : { id, name };
    });
  return {
    id: draft.providerId.trim(),
    name: draft.displayName.trim(),
    baseUrl: draft.baseUrl.trim(),
    // An empty key is not an empty string downstream: it means "this endpoint needs no key", and a
    // blank `apiKey` in the OpenCode config would be sent as an empty Authorization header.
    apiKey: draft.apiKey.trim() || null,
    models,
    headers: draft.headers
      .filter((header) => !blankHeader(header))
      .map((header) => ({ name: header.name.trim(), value: header.value.trim() })),
  };
}

/**
 * An edit of a saved endpoint: a blank key keeps the stored one, and an empty header value keeps the
 * saved value of that name. The header list replaces the saved one, so a removed row removes its
 * header; main keeps the ciphertext when the list names every saved header unchanged. There is no
 * way to clear the key here, which is the rule of `customProviders.update`.
 */
export function customProviderUpdate(value: SaveCustomProviderInput): UpdateCustomProviderInput {
  return {
    id: value.id,
    name: value.name,
    baseUrl: value.baseUrl,
    models: value.models,
    ...(value.apiKey === null ? {} : { apiKey: value.apiKey }),
    headers: value.headers.map((header) => ({ name: header.name, value: header.value || null })),
  };
}

/** The address and credentials that a model list request needs. The form does not send it itself. */
export interface CustomProviderEndpoint {
  baseUrl: string;
  apiKey: string | null;
  headers: CustomHeaderDraft[];
  /** The saved endpoint that the form edits, so main can use its stored key for the same origin. */
  savedProviderId?: string;
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  /** For a saved model: the context window the user set, which Edit must keep. */
  contextWindow?: number;
}

/** The state of one `GET {baseUrl}/models` request, owned by the host that makes it. */
export type ModelDiscovery =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; models: readonly DiscoveredModel[] }
  | { status: "failed"; message: string };

export function customProviderEndpoint(draft: CustomProviderDraft): CustomProviderEndpoint {
  const value = customProviderValue(draft);
  return { baseUrl: value.baseUrl, apiKey: value.apiKey, headers: value.headers };
}
