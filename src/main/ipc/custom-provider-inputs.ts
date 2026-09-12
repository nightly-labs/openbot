// The one renderer-to-main payload that carries a secret. No message here quotes any part of the
// input, because the field it would name is the API key or a header value.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CustomProviderHeader,
  CustomProviderModel,
  DeleteCustomProviderInput,
  SaveCustomProviderInput,
} from "@openbot/contracts/ipc";
import {
  CUSTOM_PROVIDER_LIMITS,
  composedCustomModelId,
  isAgentModel,
  isCustomProviderHeaderName,
  isCustomProviderId,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { isObject, requireString } from "./validation";

function parseProviderId(value: unknown): string {
  // `isCustomProviderId` also refuses `codex`, `claude`, `grok` and `opencode`: an endpoint under a
  // built-in provider's name would shadow that provider's own models in the picker.
  if (!isCustomProviderId(value)) throw new Error("A provider ID must be lowercase letters, digits, `-` or `_`.");
  return value;
}

function parseBaseUrl(value: unknown): string {
  const text = requireString(value, "Base URL", CUSTOM_PROVIDER_LIMITS.baseUrl);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("The base URL is not a URL.");
  }
  // The CLI is given this URL to call. A `file:` or `data:` endpoint is not an HTTP API, and every
  // other scheme is a way to make the provider process read something local.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The base URL must start with http:// or https://.");
  }
  // `https://user:password@host/v1` is a credential in a field that is not a credential field: the
  // base URL is stored outside the encrypted secret and is read back to the renderer for the
  // endpoint list, so it would be kept and shown as plain text, on a computer with no secure storage
  // as well. The key field and the headers are the two places a credential may go.
  if (url.username || url.password) {
    throw new Error("The base URL must hold no username or password. Put the credential in a header.");
  }
  return text;
}

function parseModels(providerId: string, value: unknown): CustomProviderModel[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("At least one model is required.");
  if (value.length > CUSTOM_PROVIDER_LIMITS.models) throw new Error("There are too many models.");
  const models: CustomProviderModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isObject(entry)) throw new Error("Every model needs an ID and a name.");
    const id = requireString(entry.id, "Model ID", INPUT_LIMITS.identifier);
    // The composed id is what reaches the agent roster, the model picker and the Team API, and every
    // one of those list decoders rejects a whole array when a single id is malformed. Checking the
    // halves would let a legal id and a legal provider name compose into an illegal model.
    if (!isAgentModel(composedCustomModelId(providerId, id))) throw new Error("A model ID has an unusable character.");
    if (seen.has(id)) throw new Error("Two models have the same ID.");
    seen.add(id);
    models.push({ id, name: requireString(entry.name, "Model name", INPUT_LIMITS.modelName) });
  }
  return models;
}

function parseHeaders(value: unknown): CustomProviderHeader[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("The headers are not a list.");
  if (value.length > CUSTOM_PROVIDER_LIMITS.headers) throw new Error("There are too many headers.");
  const headers: CustomProviderHeader[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isObject(entry)) throw new Error("Every header needs a name and a value.");
    if (!isCustomProviderHeaderName(entry.name)) throw new Error("A header name has a character HTTP does not allow.");
    if (entry.name.length > INPUT_LIMITS.identifier) throw new Error("A header name is too long.");
    const lower = entry.name.toLowerCase();
    if (seen.has(lower)) throw new Error("Two headers have the same name.");
    seen.add(lower);
    // A header value is bounded like the key, because it is as often a credential as the key is.
    if (!isString(entry.value) || entry.value.length > CUSTOM_PROVIDER_LIMITS.apiKey) {
      throw new Error("A header value is missing or too long.");
    }
    headers.push({ name: entry.name, value: entry.value });
  }
  return headers;
}

/**
 * `apiKey: null` is accepted and kept as null: a local endpoint that needs no key is the common case,
 * and an empty string would be sent as a blank Authorization header.
 */
function parseApiKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!isString(value)) throw new Error("The API key is not text.");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CUSTOM_PROVIDER_LIMITS.apiKey) throw new Error("The API key is too long.");
  return trimmed;
}

export function parseSaveCustomProvider(input: unknown): SaveCustomProviderInput {
  if (!isObject(input)) throw new Error("Invalid endpoint.");
  const id = parseProviderId(input.id);
  return {
    id,
    name: requireString(input.name, "Display name", INPUT_LIMITS.agentName),
    baseUrl: parseBaseUrl(input.baseUrl),
    apiKey: parseApiKey(input.apiKey),
    models: parseModels(id, input.models),
    headers: parseHeaders(input.headers),
  };
}

export function parseDeleteCustomProvider(input: unknown): DeleteCustomProviderInput {
  if (!isObject(input)) throw new Error("Invalid endpoint.");
  return { id: parseProviderId(input.id) };
}
