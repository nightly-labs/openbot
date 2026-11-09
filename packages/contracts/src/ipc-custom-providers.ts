// A custom provider is an OpenAI-compatible endpoint the user names themselves. OpenBot serves it
// through the harness the user chooses: OpenCode, which reads a `provider` entry merged into its
// config, or Pi, which reads an extension that registers the endpoint. The wire identity stays the
// harness, `opencode` or `pi`, and no new `AgentProviderId` exists. What makes this file a contract rather than renderer state is
// the API key: it travels renderer-to-main on `save` and must never come back, so both directions
// need one agreed shape and the guard below is what enforces the asymmetry.

import { AGENT_PROVIDERS, type AgentProviderId } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import type { AgentReasoningEffort } from "./ipc-agent-identity";
import { isBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

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
  /**
   * The context window of one model, in tokens. OpenCode's own prompt and tools take about 12K
   * tokens, so a smaller window compacts on every turn.
   */
  contextWindowMin: 1_024,
  contextWindowMax: 100_000_000,
  /**
   * The largest completion of one model, in tokens. No model returns a million, so the ceiling only
   * stops a typo from reaching the endpoint as `max_completion_tokens`.
   */
  maxOutputMin: 256,
  maxOutputMax: 1_000_000,
} as const;

/** A `provider` key in OpenCode's config, so lowercase and free of separators. */
export const CUSTOM_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** RFC 9110 field-name token characters. */
export const CUSTOM_PROVIDER_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** The providers that can run a custom endpoint. The first one is the default and the released one. */
export const CUSTOM_PROVIDER_HARNESSES = ["opencode", "pi"] as const satisfies readonly AgentProviderId[];
export type CustomProviderHarness = (typeof CUSTOM_PROVIDER_HARNESSES)[number];
export const DEFAULT_CUSTOM_PROVIDER_HARNESS: CustomProviderHarness = "opencode";

export function isCustomProviderHarness(value: unknown): value is CustomProviderHarness {
  return isOneOf(CUSTOM_PROVIDER_HARNESSES, value);
}

export interface CustomProviderModel {
  id: string;
  name: string;
  /**
   * The context window in tokens. Absent: OpenCode assumes its own default, 200K tokens in OpenCode
   * 2.1.4. This computer only: a Team API list and save keep their released model fields.
   */
  contextWindow?: number;
  /**
   * The largest completion the model returns, in tokens (#4234). Absent: OpenBot writes a guess of
   * at most 16,384, or half a small window. The form asks for a `contextWindow` with it, because the
   * OpenCode entry writes no limit without a window. This computer only, like `contextWindow`.
   */
  maxOutput?: number;
  /**
   * The reasoning efforts that the endpoint accepts for this model, in `CUSTOM_PROVIDER_REASONING_EFFORTS`
   * order, never empty (#4154). Absent: OpenCode offers its own Low, Medium and High, and Pi offers no
   * effort. This computer only, like `contextWindow`.
   */
  reasoningEfforts?: CustomProviderReasoningEffort[];
  /**
   * The input kinds that the model accepts in addition to text, in `CUSTOM_PROVIDER_INPUT_KINDS`
   * order (#4154). Empty: text only. Absent: the harness's own default, `CUSTOM_PROVIDER_DEFAULT_INPUTS`.
   * Pi takes images only, so it ignores `pdf`. This computer only, like `contextWindow`.
   */
  inputs?: CustomProviderInputKind[];
}

/** The input kinds that a custom model can declare: the `modalities.input` values of OpenCode beside text. */
export const CUSTOM_PROVIDER_INPUT_KINDS = ["image", "pdf"] as const;
export type CustomProviderInputKind = (typeof CUSTOM_PROVIDER_INPUT_KINDS)[number];

/** The input kinds that each harness can send to a model. Pi's model `input` is `("text" | "image")[]`. */
export const CUSTOM_PROVIDER_HARNESS_INPUT_KINDS: Readonly<
  Record<CustomProviderHarness, readonly CustomProviderInputKind[]>
> = { opencode: CUSTOM_PROVIDER_INPUT_KINDS, pi: ["image"] };

/**
 * What a model with no saved `inputs` accepts beside text. OpenCode 2.2.5 gives a configured model
 * text and image input (`Capabilities.default` in `packages/schema/src/model.ts`); OpenBot gives a Pi
 * model text only.
 */
export const CUSTOM_PROVIDER_DEFAULT_INPUTS: Readonly<
  Record<CustomProviderHarness, readonly CustomProviderInputKind[]>
> = { opencode: ["image"], pi: [] };

/** A list of input kinds, maybe empty, each one time, in `CUSTOM_PROVIDER_INPUT_KINDS` order. */
export function isCustomProviderInputs(value: unknown): value is CustomProviderInputKind[] {
  return (Array.isArray(value) && value.length === 0) || isOrderedSubset(CUSTOM_PROVIDER_INPUT_KINDS, value);
}

/**
 * The efforts that a custom model can declare: the `reasoning_effort` values of OpenAI-compatible
 * endpoints, and Pi's thinking levels, with `none` for Pi's `off`.
 */
export const CUSTOM_PROVIDER_REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly AgentReasoningEffort[];
export type CustomProviderReasoningEffort = (typeof CUSTOM_PROVIDER_REASONING_EFFORTS)[number];

/** A non-empty list of efforts, each one time, in `CUSTOM_PROVIDER_REASONING_EFFORTS` order. */
export function isCustomProviderReasoningEfforts(value: unknown): value is CustomProviderReasoningEffort[] {
  return isOrderedSubset(CUSTOM_PROVIDER_REASONING_EFFORTS, value);
}

/** A non-empty list of known values, each one time, in the order of `known`. */
function isOrderedSubset(known: readonly unknown[], value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  let previous = -1;
  for (const item of value) {
    const index = known.indexOf(item);
    if (index <= previous) return false;
    previous = index;
  }
  return true;
}

/** A context window that OpenCode can use for a model. */
export function isCustomProviderContextWindow(value: unknown): value is number {
  return (
    isNumber(value) &&
    Number.isSafeInteger(value) &&
    value >= CUSTOM_PROVIDER_LIMITS.contextWindowMin &&
    value <= CUSTOM_PROVIDER_LIMITS.contextWindowMax
  );
}

/** A completion cap that OpenCode can use for a model. */
export function isCustomProviderMaxOutput(value: unknown): value is number {
  return (
    isNumber(value) &&
    Number.isSafeInteger(value) &&
    value >= CUSTOM_PROVIDER_LIMITS.maxOutputMin &&
    value <= CUSTOM_PROVIDER_LIMITS.maxOutputMax
  );
}

export interface CustomProviderHeader {
  name: string;
  value: string;
}

/** A header of an edit. `value: null` keeps the value that main holds for this name. */
export interface CustomProviderHeaderInput {
  name: string;
  value: string | null;
}

/**
 * Renderer to main. This is the one renderer-to-main payload that carries a secret, so nothing on
 * this path may log it.
 *
 * `apiKey: null` means "this endpoint needs no key". It never means "keep the one you have": a save
 * adds a new endpoint. `UpdateCustomProviderInput` is the edit path.
 */
export interface SaveCustomProviderInput {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  models: CustomProviderModel[];
  headers: CustomProviderHeader[];
  /** The provider that runs the endpoint. Absent: OpenCode. This computer only, like `headerNames`. */
  harness?: CustomProviderHarness;
}

/**
 * Renderer to main, for this computer or for a joined server's host with `custom-provider-edit-v1`.
 * The id names a saved endpoint and does not change. A field that is absent keeps its stored value, so the form can send
 * a blank key without discarding the key that the user does not type again. `headers` replaces the
 * saved list: a header with a `null` value keeps its saved value, and a saved header that is not in
 * the list is removed. There is no way to clear a stored key here: remove the endpoint and add it
 * again for that.
 */
export interface UpdateCustomProviderInput {
  id: string;
  name: string;
  baseUrl: string;
  models: CustomProviderModel[];
  apiKey?: string;
  headers?: CustomProviderHeaderInput[];
  /** Absent: the saved harness stays. This computer only: a host keeps the harness on a Team API edit. */
  harness?: CustomProviderHarness;
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
   * The names of the saved headers, so Edit can show them. The values never come back. Absent in a
   * `providers-v1` or `custom-provider-harness-v1` list, which keeps its released fields.
   */
  headerNames?: string[];
  /**
   * The models the user listed for this endpoint, which is how the renderer names one before the
   * CLI has listed it: onboarding must record a custom model for a custom choice, and the endpoint
   * may have been saved in an earlier run. A model id and its label are not credentials.
   */
  models: CustomProviderModel[];
  /** The provider that runs the endpoint. Absent in a Team API list, which keeps its released fields. */
  harness?: CustomProviderHarness;
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

/**
 * The provider ids that no endpoint could have when endpoints shipped. A provider added later is
 * refused only for a new endpoint (`isNewCustomProviderId`): an endpoint saved under that name
 * before the upgrade must stay readable and removable, because one bad row empties the whole list.
 */
const RESERVED_AT_RELEASE = ["codex", "claude", "grok", "opencode"] as const;

/** A saved endpoint id: what the list decoders and a delete accept. */
export function isCustomProviderId(value: unknown): value is string {
  return (
    isBoundedString(value, INPUT_LIMITS.identifier) &&
    CUSTOM_PROVIDER_ID_PATTERN.test(value) &&
    !isOneOf(RESERVED_AT_RELEASE, value)
  );
}

/** The id of an endpoint to save. It must not be the name of a built-in provider. */
export function isNewCustomProviderId(value: unknown): value is string {
  return isCustomProviderId(value) && !isOneOf(AGENT_PROVIDERS, value);
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
    (value.headerNames === undefined || isHeaderNames(value.headerNames)) &&
    (value.harness === undefined || isCustomProviderHarness(value.harness)) &&
    Array.isArray(value.models) &&
    value.models.length <= CUSTOM_PROVIDER_LIMITS.models &&
    value.models.every(isCustomProviderModel)
  );
}

function isHeaderNames(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= CUSTOM_PROVIDER_LIMITS.headers &&
    value.every((name) => isCustomProviderHeaderName(name) && name.length <= INPUT_LIMITS.identifier)
  );
}

function isCustomProviderModel(value: unknown): value is CustomProviderModel {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.id, INPUT_LIMITS.identifier) &&
    isBoundedString(value.name, INPUT_LIMITS.modelName) &&
    (value.contextWindow === undefined || isCustomProviderContextWindow(value.contextWindow)) &&
    (value.maxOutput === undefined || isCustomProviderMaxOutput(value.maxOutput)) &&
    (value.reasoningEfforts === undefined || isCustomProviderReasoningEfforts(value.reasoningEfforts)) &&
    (value.inputs === undefined || isCustomProviderInputs(value.inputs))
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

/** The custom provider that a model id names before its first `/`, as `composedCustomModelId` makes it. */
export function customProviderOfModel<T extends { readonly id: string }>(
  modelId: string | null | undefined,
  providers: readonly T[],
): T | undefined {
  const separator = modelId?.indexOf("/") ?? -1;
  if (!modelId || separator <= 0) return undefined;
  const providerId = modelId.slice(0, separator);
  return providers.find((provider) => provider.id === providerId);
}

/** A header name is compared case-insensitively, the way HTTP does. */
export function isCustomProviderHeaderName(value: unknown): value is string {
  return isString(value) && value.length > 0 && CUSTOM_PROVIDER_HEADER_NAME_PATTERN.test(value);
}
