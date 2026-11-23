import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  CustomProviderHarness,
  CustomProviderHeader,
  CustomProviderHeaderInput,
  CustomProviderModel,
  DeleteCustomProviderInput,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import {
  CUSTOM_PROVIDER_LIMITS,
  composedCustomModelId,
  isAgentModel,
  isCustomProviderContextWindow,
  isCustomProviderHarness,
  isCustomProviderHeaderName,
  isCustomProviderId,
  isCustomProviderInputs,
  isCustomProviderMaxOutput,
  isCustomProviderModelEfforts,
  isNewCustomProviderId,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { isObject, requireString } from "./validation";

function parseProviderId(value: unknown): string {
  if (!isNewCustomProviderId(value)) throw new Error(sourceText("error.provider.idInvalid"));
  return value;
}

function parseSavedProviderId(value: unknown): string {
  if (!isCustomProviderId(value)) throw new Error(sourceText("error.provider.idInvalid"));
  return value;
}

export function parseBaseUrl(value: unknown): string {
  const text = requireString(value, "Base URL", CUSTOM_PROVIDER_LIMITS.baseUrl);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(sourceText("error.provider.baseUrlInvalid"));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(sourceText("error.provider.baseUrlProtocol"));
  }
  if (url.username || url.password) {
    throw new Error(sourceText("error.provider.baseUrlCredentials"));
  }
  return text;
}

function parseModels(providerId: string, value: unknown): CustomProviderModel[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(sourceText("error.provider.modelsRequired"));
  if (value.length > CUSTOM_PROVIDER_LIMITS.models) throw new Error(sourceText("error.provider.modelsTooMany"));
  const models: CustomProviderModel[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isObject(entry)) throw new Error("Every model needs an ID and a name.");
    const id = requireString(entry.id, "Model ID", INPUT_LIMITS.identifier);
    const listed = composedCustomModelId(providerId, id);
    if (!isAgentModel(listed)) throw new Error(sourceText("error.provider.modelIdCharacter"));
    if (seen.has(listed)) throw new Error(sourceText("error.provider.modelIdDuplicate"));
    seen.add(listed);
    const name = requireString(entry.name, "Model name", INPUT_LIMITS.modelName);
    const model: CustomProviderModel = { id, name };
    if (entry.contextWindow !== undefined) {
      if (!isCustomProviderContextWindow(entry.contextWindow)) {
        throw new Error(
          sourceText("error.provider.contextWindowInvalid", {
            min: CUSTOM_PROVIDER_LIMITS.contextWindowMin,
            max: CUSTOM_PROVIDER_LIMITS.contextWindowMax,
          }),
        );
      }
      model.contextWindow = entry.contextWindow;
    }
    if (entry.maxOutput !== undefined) {
      if (!isCustomProviderMaxOutput(entry.maxOutput)) {
        throw new Error(
          sourceText("error.provider.maxOutputInvalid", {
            min: CUSTOM_PROVIDER_LIMITS.maxOutputMin,
            max: CUSTOM_PROVIDER_LIMITS.maxOutputMax,
          }),
        );
      }
      model.maxOutput = entry.maxOutput;
    }
    if (entry.reasoningEfforts !== undefined) {
      if (!isCustomProviderModelEfforts(entry.reasoningEfforts))
        throw new Error(sourceText("error.provider.reasoningEffortsInvalid"));
      model.reasoningEfforts = [...entry.reasoningEfforts];
    }
    if (entry.inputs !== undefined) {
      if (!isCustomProviderInputs(entry.inputs)) throw new Error(sourceText("error.provider.inputsInvalid"));
      model.inputs = [...entry.inputs];
    }
    models.push(model);
  }
  return models;
}

export function parseHeaders(value: unknown): CustomProviderHeader[] {
  return parseHeaderList(value, parseHeaderValue);
}

function parseHeaderInputs(value: unknown): CustomProviderHeaderInput[] {
  return parseHeaderList(value, (entry) => (entry === null ? null : parseHeaderValue(entry)));
}

function parseHeaderValue(value: unknown): string {
  if (!isString(value) || value.length > CUSTOM_PROVIDER_LIMITS.apiKey) {
    throw new Error(sourceText("error.provider.headerValueInvalid"));
  }
  return value;
}

function parseHeaderList<T extends string | null>(
  value: unknown,
  parseValue: (value: unknown) => T,
): { name: string; value: T }[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("The headers are not a list.");
  if (value.length > CUSTOM_PROVIDER_LIMITS.headers) throw new Error(sourceText("error.provider.headersTooMany"));
  const headers: { name: string; value: T }[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isObject(entry)) throw new Error("Every header needs a name and a value.");
    if (!isCustomProviderHeaderName(entry.name)) throw new Error(sourceText("error.provider.headerNameCharacter"));
    if (entry.name.length > INPUT_LIMITS.identifier) throw new Error(sourceText("error.provider.headerNameTooLong"));
    const lower = entry.name.toLowerCase();
    if (seen.has(lower)) throw new Error(sourceText("error.provider.headerNameDuplicate"));
    seen.add(lower);
    headers.push({ name: entry.name, value: parseValue(entry.value) });
  }
  return headers;
}

export function parseApiKey(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!isString(value)) throw new Error("The API key is not text.");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > CUSTOM_PROVIDER_LIMITS.apiKey) throw new Error(sourceText("error.provider.apiKeyTooLong"));
  return trimmed;
}

function parseHarness(value: unknown): CustomProviderHarness | undefined {
  if (value === undefined) return undefined;
  if (!isCustomProviderHarness(value)) throw new Error("Invalid harness.");
  return value;
}

export function parseSaveCustomProvider(input: unknown): SaveCustomProviderInput {
  if (!isObject(input)) throw new Error("Invalid endpoint.");
  const id = parseProviderId(input.id);
  const harness = parseHarness(input.harness);
  return {
    id,
    name: requireString(input.name, "Display name", INPUT_LIMITS.agentName),
    baseUrl: parseBaseUrl(input.baseUrl),
    apiKey: parseApiKey(input.apiKey),
    models: parseModels(id, input.models),
    headers: parseHeaders(input.headers),
    ...(harness ? { harness } : {}),
  };
}

export function parseUpdateCustomProvider(input: unknown): UpdateCustomProviderInput {
  if (!isObject(input)) throw new Error("Invalid endpoint.");
  const id = parseSavedProviderId(input.id);
  if (input.apiKey === null) throw new Error("The API key is not text.");
  const apiKey = input.apiKey === undefined ? null : parseApiKey(input.apiKey);
  const harness = parseHarness(input.harness);
  return {
    id,
    name: requireString(input.name, "Display name", INPUT_LIMITS.agentName),
    baseUrl: parseBaseUrl(input.baseUrl),
    models: parseModels(id, input.models),
    ...(apiKey ? { apiKey } : {}),
    ...(input.headers === undefined ? {} : { headers: parseHeaderInputs(input.headers) }),
    ...(harness ? { harness } : {}),
  };
}

export function parseDeleteCustomProvider(input: unknown): DeleteCustomProviderInput {
  if (!isObject(input)) throw new Error("Invalid endpoint.");
  return { id: parseSavedProviderId(input.id) };
}
