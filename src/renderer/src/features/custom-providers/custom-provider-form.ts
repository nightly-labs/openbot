// The form side of the endpoint the user names. Its field names are the form's own
// (`providerId`, `displayName`), because they label inputs and index error messages; `SaveCustomProviderInput`
// from the contract is what submit produces, so the dialog's payload is literally the wire payload.
//
// Every bound and pattern comes from the contract rather than from here: the main parser checks the
// same input again, and a copy that drifted would show the user a form that passes and a save that
// fails, or the reverse.

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
): CustomProviderErrors {
  const providerId = draft.providerId.trim();
  const errors: CustomProviderErrors = {
    modelRows: draft.models.map(() => undefined),
    headerRows: draft.headers.map(() => undefined),
  };

  if (!providerId) errors.providerId = "Enter a provider ID.";
  else if (!CUSTOM_PROVIDER_ID_PATTERN.test(providerId)) {
    errors.providerId = "Use lowercase letters, numbers, hyphens or underscores, starting with a letter or number.";
  } else if (providerId.length > INPUT_LIMITS.identifier) {
    errors.providerId = `Keep the provider ID under ${INPUT_LIMITS.identifier} characters.`;
  } else if (AGENT_PROVIDERS.some((provider) => provider === providerId)) {
    errors.providerId = `OpenBot already has a provider called ${providerId}. Choose another ID.`;
  } else if (takenProviderIds.includes(providerId)) {
    // There is no edit path, so a saved ID is not a field the user can overwrite: main refuses the
    // save, and this says so before the round trip.
    errors.providerId = `An endpoint called ${providerId} is already saved. Remove it first, or choose another ID.`;
  }

  const displayName = draft.displayName.trim();
  if (!displayName) errors.displayName = "Enter a display name.";
  else if (displayName.length > INPUT_LIMITS.agentName) {
    errors.displayName = `Keep the display name under ${INPUT_LIMITS.agentName} characters.`;
  }

  errors.baseUrl = baseUrlError(draft.baseUrl.trim());

  if (draft.apiKey.length > CUSTOM_PROVIDER_LIMITS.apiKey) {
    errors.apiKey = `Keep the API key under ${CUSTOM_PROVIDER_LIMITS.apiKey} characters.`;
  }

  const filled = draft.models.filter((model) => !blankModel(model));
  if (filled.length === 0) errors.models = "Add at least one model.";
  else if (filled.length > CUSTOM_PROVIDER_LIMITS.models) {
    errors.models = `Add no more than ${CUSTOM_PROVIDER_LIMITS.models} models.`;
  }

  const seen = new Set<string>();
  draft.models.forEach((model, index) => {
    if (blankModel(model)) return;
    const id = model.id.trim();
    if (!id) {
      errors.modelRows[index] = "Enter a model ID.";
      return;
    }
    if (seen.has(id)) {
      errors.modelRows[index] = `This provider already lists ${id}.`;
      return;
    }
    seen.add(id);
    if (model.name.trim().length > INPUT_LIMITS.modelName) {
      errors.modelRows[index] = `Keep the display name under ${INPUT_LIMITS.modelName} characters.`;
      return;
    }
    // OpenCode reports this model as `<provider id>/<model id>`, and both the IPC and Team API list
    // decoders fail closed on the whole array when one id is malformed - which empties the picker
    // rather than hiding one row. So the composed id is checked here, where the user can still fix it.
    if (!errors.providerId && !isAgentModel(composedCustomModelId(providerId, id))) {
      errors.modelRows[index] = "This model ID cannot be used. Remove spaces, quotes and other punctuation.";
    }
  });

  const headerNames = new Set<string>();
  draft.headers.forEach((header, index) => {
    if (blankHeader(header)) return;
    const name = header.name.trim();
    if (!name) errors.headerRows[index] = "Enter a header name.";
    else if (!isCustomProviderHeaderName(name)) errors.headerRows[index] = "Use a valid HTTP header name.";
    else if (headerNames.has(name.toLowerCase())) errors.headerRows[index] = `This provider already sets ${name}.`;
    else if (!header.value.trim()) errors.headerRows[index] = "Enter a header value.";
    else headerNames.add(name.toLowerCase());
  });
  if (draft.headers.filter((header) => !blankHeader(header)).length > CUSTOM_PROVIDER_LIMITS.headers) {
    errors.headerRows[CUSTOM_PROVIDER_LIMITS.headers] = `Add no more than ${CUSTOM_PROVIDER_LIMITS.headers} headers.`;
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

function baseUrlError(baseUrl: string): string | undefined {
  if (!baseUrl) return "Enter a base URL.";
  if (baseUrl.length > CUSTOM_PROVIDER_LIMITS.baseUrl) {
    return `Keep the base URL under ${CUSTOM_PROVIDER_LIMITS.baseUrl} characters.`;
  }
  const parsed = parseUrl(baseUrl);
  if (!parsed) return "Enter a full URL, such as http://127.0.0.1:11434/v1.";
  // `http:` is the main case, not the exception: a custom provider is usually a model server on this
  // computer, which has no certificate. Anything else - `file:`, `ws:`, `javascript:` - is not an
  // endpoint OpenCode can call.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "Use an http:// or https:// URL.";
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
