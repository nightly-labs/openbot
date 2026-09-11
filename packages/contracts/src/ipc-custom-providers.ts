// A custom provider is an OpenAI-compatible endpoint the user names themselves. OpenBot serves it by
// merging a `provider` entry into the OpenCode CLI's config, so the wire identity stays `opencode`
// and no new `AgentProviderId` exists. What makes this file a contract rather than renderer state is
// the API key: it travels renderer-to-main on `save` and must never come back, so both directions
// need one agreed shape and the guard below is what enforces the asymmetry.

import { AGENT_PROVIDERS } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

/**
 * A custom provider is served by the OpenCode CLI, so its bounds are OpenCode's config shape rather
 * than an OpenBot object: the id becomes a `provider` key, and `<id>/<model id>` becomes the model id
 * OpenCode reports back. `INPUT_LIMITS` has no entry for a key or an endpoint because no other
 * OpenBot payload has ever carried one.
 */
export const CUSTOM_PROVIDER_LIMITS = {
  apiKey: 4_096,
  baseUrl: 2_048,
  models: 64,
  headers: 32,
} as const;

/** A `provider` key in OpenCode's config, so lowercase and free of separators. */
export const CUSTOM_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** RFC 9110 field-name token characters. */
export const CUSTOM_PROVIDER_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export interface CustomProviderModel {
  id: string;
  name: string;
}

export interface CustomProviderHeader {
  name: string;
  value: string;
}

/**
 * Renderer to main. This is the one renderer-to-main payload that carries a secret, so nothing on
 * this path may log it.
 *
 * `apiKey: null` means "this endpoint needs no key". It never means "keep the one you have": there is
 * no edit path, and a save always replaces the stored secret bundle outright.
 */
export interface SaveCustomProviderInput {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  models: CustomProviderModel[];
  headers: CustomProviderHeader[];
}

export interface DeleteCustomProviderInput {
  id: string;
}

/** Main to renderer. The key never comes back; `hasApiKey` is all the renderer may know about it. */
export interface CustomProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  /**
   * The models the user listed for this endpoint, which is how the renderer names one before the
   * CLI has listed it: onboarding must record a custom model for a custom choice, and the endpoint
   * may have been saved in an earlier run. A model id and its label are not credentials.
   */
  models: CustomProviderModel[];
}

/**
 * Why a saved endpoint's models may not have appeared yet. One `opencode acp` process serves every
 * OpenCode agent, and it reads the config only at spawn, so a change needs a respawn that OpenBot
 * will not force through a turn in progress.
 */
export const CUSTOM_PROVIDER_RESTARTS = ["restarted", "skipped-busy", "not-running"] as const;
export type CustomProviderRestart = (typeof CUSTOM_PROVIDER_RESTARTS)[number];

export interface CustomProviderResult {
  providers: CustomProviderSummary[];
  restart: CustomProviderRestart;
}

export function isCustomProviderId(value: unknown): value is string {
  return (
    isBoundedString(value, INPUT_LIMITS.identifier) &&
    CUSTOM_PROVIDER_ID_PATTERN.test(value) &&
    !AGENT_PROVIDERS.some((provider) => provider === value)
  );
}

/**
 * Rejects a record that carries an `apiKey` key at all, not merely one whose key is a string. That
 * makes "the renderer never sees the key" a fact the boundary checks rather than a habit the main
 * process is trusted to keep, and it costs one assertion to prove. Like `isAgentModelOption`, it
 * fails closed: one bad row empties the whole list rather than hiding itself.
 */
export function isCustomProviderSummary(value: unknown): value is CustomProviderSummary {
  return (
    isDynamicRecord(value) &&
    !("apiKey" in value) &&
    !("headers" in value) &&
    isCustomProviderId(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.baseUrl, CUSTOM_PROVIDER_LIMITS.baseUrl) &&
    typeof value.hasApiKey === "boolean" &&
    Array.isArray(value.models) &&
    value.models.length <= CUSTOM_PROVIDER_LIMITS.models &&
    value.models.every(isCustomProviderModel)
  );
}

function isCustomProviderModel(value: unknown): value is CustomProviderModel {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.id, INPUT_LIMITS.identifier) &&
    isBoundedString(value.name, INPUT_LIMITS.modelName)
  );
}

export function isCustomProviderResult(value: unknown): value is CustomProviderResult {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.providers) &&
    value.providers.every(isCustomProviderSummary) &&
    isOneOf(CUSTOM_PROVIDER_RESTARTS, value.restart)
  );
}

/**
 * The id OpenCode reports the model as. Verified against OpenCode 1.18.27: a `provider` entry keyed
 * `studio-local` with a model keyed `qwen3-coder:30b` is listed as `studio-local/qwen3-coder:30b`.
 *
 * Both the IPC and the Team API list decoders fail closed on a whole model array when one id is
 * malformed, so every caller that accepts a custom model id checks the composed form with
 * `isAgentModel` rather than the two halves on their own.
 */
export function composedCustomModelId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

/** Whether a model id came from a custom provider rather than from OpenCode's own catalogue. */
export function isCustomProviderModelId(modelId: string, providerIds: ReadonlySet<string>): boolean {
  const separator = modelId.indexOf("/");
  return separator > 0 && providerIds.has(modelId.slice(0, separator));
}

/** A header name is compared case-insensitively, the way HTTP does. */
export function isCustomProviderHeaderName(value: unknown): value is string {
  return isString(value) && value.length > 0 && CUSTOM_PROVIDER_HEADER_NAME_PATTERN.test(value);
}
