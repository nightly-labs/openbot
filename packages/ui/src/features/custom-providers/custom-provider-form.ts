// Form side of the user-named endpoint: field names are the form's own (labels/error index),
// submit produces the contract `SaveCustomProviderInput` verbatim. Every bound/pattern comes
// from the contract; main rechecks on save, so a drifted copy would pass the form and fail save.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { SaveCustomProviderInput } from "@openbot/contracts/ipc";
import {
  AGENT_PROVIDERS,
  CUSTOM_PROVIDER_ID_PATTERN,
  CUSTOM_PROVIDER_LIMITS,
  composedCustomModelId,
  isAgentModel,
  isCustomProviderHeaderName,
} from "@openbot/contracts/ipc";
import type { AppTranslate } from "@openbot/i18n";
import { currentText } from "../../text";

export interface CustomModelDraft {
  id: string;
  name: string;
}

export interface CustomHeaderDraft {
  name: string;
  value: string;
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
  baseUrl?: string;
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

/** A row the user has not filled in yet: carried by the form, ignored by validation and submit. */
function blankModel(model: CustomModelDraft): boolean {
  return !model.id.trim() && !model.name.trim();
}

function blankHeader(header: CustomHeaderDraft): boolean {
  return !header.name.trim() && !header.value.trim();
}

export function validateCustomProvider(
  draft: CustomProviderDraft,
  takenProviderIds: readonly string[] = [],
  t: AppTranslate = currentText().t,
): CustomProviderErrors {
  const providerId = draft.providerId.trim();
  const errors: CustomProviderErrors = {
    modelRows: draft.models.map(() => undefined),
    headerRows: draft.headers.map(() => undefined),
  };

  if (!providerId) errors.providerId = t("customProvider.error.providerIdRequired");
  else if (!CUSTOM_PROVIDER_ID_PATTERN.test(providerId)) {
    errors.providerId = t("customProvider.error.providerIdPattern");
  } else if (providerId.length > INPUT_LIMITS.identifier) {
    errors.providerId = t("customProvider.error.providerIdLength", { max: INPUT_LIMITS.identifier });
  } else if (AGENT_PROVIDERS.some((provider) => provider === providerId)) {
    errors.providerId = t("customProvider.error.providerIdBuiltIn", { id: providerId });
  } else if (takenProviderIds.includes(providerId)) {
    // There is no edit path, so a saved ID is not a field the user can overwrite: main refuses the
    // save, and this says so before the round trip.
    errors.providerId = t("customProvider.error.providerIdSaved", { id: providerId });
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
    else if (!header.value.trim()) errors.headerRows[index] = t("customProvider.error.headerValueRequired");
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

/** The wire payload: trimmed, with the blank placeholder rows dropped. */
export function customProviderValue(draft: CustomProviderDraft): SaveCustomProviderInput {
  const models = draft.models
    .filter((model) => !blankModel(model))
    .map((model) => ({ id: model.id.trim(), name: model.name.trim() || model.id.trim() }));
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
