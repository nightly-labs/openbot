import { AGENT_PROVIDERS, type AgentProviderId } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { type AgentReasoningEffort, isAgentModel } from "./ipc-agent-identity";
import { isBoundedString } from "./ipc-bounded-values";
import { isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export const CUSTOM_PROVIDER_LIMITS = {
  apiKey: 4_096,
  baseUrl: 2_048,
  models: 64,
  headers: 32,
  contextWindowMin: 1_024,
  contextWindowMax: 100_000_000,
  maxOutputMin: 256,
  maxOutputMax: 1_000_000,
} as const;

export const CUSTOM_PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export const CUSTOM_PROVIDER_HEADER_NAME_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

export const CUSTOM_PROVIDER_HARNESSES = ["opencode", "pi"] as const satisfies readonly AgentProviderId[];
export type CustomProviderHarness = (typeof CUSTOM_PROVIDER_HARNESSES)[number];
export const DEFAULT_CUSTOM_PROVIDER_HARNESS: CustomProviderHarness = "opencode";

export function isCustomProviderHarness(value: unknown): value is CustomProviderHarness {
  return isOneOf(CUSTOM_PROVIDER_HARNESSES, value);
}

export interface CustomProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxOutput?: number;
  reasoningEfforts?: CustomProviderReasoningEffort[];
  inputs?: CustomProviderInputKind[];
}

export const CUSTOM_PROVIDER_INPUT_KINDS = ["image", "pdf"] as const;
export type CustomProviderInputKind = (typeof CUSTOM_PROVIDER_INPUT_KINDS)[number];

export const CUSTOM_PROVIDER_HARNESS_INPUT_KINDS: Readonly<
  Record<CustomProviderHarness, readonly CustomProviderInputKind[]>
> = { opencode: CUSTOM_PROVIDER_INPUT_KINDS, pi: ["image"] };

export const CUSTOM_PROVIDER_DEFAULT_INPUTS: Readonly<
  Record<CustomProviderHarness, readonly CustomProviderInputKind[]>
> = { opencode: ["image"], pi: [] };

export function isCustomProviderInputs(value: unknown): value is CustomProviderInputKind[] {
  return (Array.isArray(value) && value.length === 0) || isOrderedSubset(CUSTOM_PROVIDER_INPUT_KINDS, value);
}

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

export function isCustomProviderReasoningEfforts(value: unknown): value is CustomProviderReasoningEffort[] {
  return isOrderedSubset(CUSTOM_PROVIDER_REASONING_EFFORTS, value);
}

export function isCustomProviderModelEfforts(value: unknown): value is CustomProviderReasoningEffort[] {
  return (Array.isArray(value) && value.length === 0) || isCustomProviderReasoningEfforts(value);
}

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

export function isCustomProviderContextWindow(value: unknown): value is number {
  return (
    isNumber(value) &&
    Number.isSafeInteger(value) &&
    value >= CUSTOM_PROVIDER_LIMITS.contextWindowMin &&
    value <= CUSTOM_PROVIDER_LIMITS.contextWindowMax
  );
}

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

export interface CustomProviderHeaderInput {
  name: string;
  value: string | null;
}

export interface SaveCustomProviderInput {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string | null;
  models: CustomProviderModel[];
  headers: CustomProviderHeader[];
  harness?: CustomProviderHarness;
}

export interface UpdateCustomProviderInput {
  id: string;
  name: string;
  baseUrl: string;
  models: CustomProviderModel[];
  apiKey?: string;
  headers?: CustomProviderHeaderInput[];
  harness?: CustomProviderHarness;
}

export interface DeleteCustomProviderInput {
  id: string;
}

export interface CustomProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  headerNames?: string[];
  models: CustomProviderModel[];
  harness?: CustomProviderHarness;
}

export const CUSTOM_PROVIDER_RESTARTS = ["restarted", "skipped-busy", "not-running"] as const;
export type CustomProviderRestart = (typeof CUSTOM_PROVIDER_RESTARTS)[number];

export interface CustomProviderResult {
  providers: CustomProviderSummary[];
  restart: CustomProviderRestart;
}

const RESERVED_AT_RELEASE = ["codex", "claude", "grok", "opencode"] as const;

export function isCustomProviderId(value: unknown): value is string {
  return (
    isBoundedString(value, INPUT_LIMITS.identifier) &&
    CUSTOM_PROVIDER_ID_PATTERN.test(value) &&
    !isOneOf(RESERVED_AT_RELEASE, value)
  );
}

export function isNewCustomProviderId(value: unknown): value is string {
  return isCustomProviderId(value) && !isOneOf(AGENT_PROVIDERS, value);
}

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
    (value.reasoningEfforts === undefined || isCustomProviderModelEfforts(value.reasoningEfforts)) &&
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

const ESCAPED_MODEL_CHARACTERS = /[!#$%&()*+;<>?@^{|}~=]/g;
const ESCAPABLE_MODEL_ID = /^[A-Za-z0-9._:/[\],!#$%&()*+;<>?@^{|}~=-]*$/;

function escapedModelCharacter(character: string): string {
  return `=${character.charCodeAt(0).toString(16).toUpperCase()}`;
}

export function composedCustomModelId(providerId: string, modelId: string): string {
  const plain = `${providerId}/${modelId}`;
  if (isAgentModel(plain) || !ESCAPABLE_MODEL_ID.test(modelId)) return plain;
  return `${providerId}/${modelId.replace(ESCAPED_MODEL_CHARACTERS, escapedModelCharacter)}`;
}

export function customModelKey(providerId: string, modelId: string): string {
  return composedCustomModelId(providerId, modelId).slice(providerId.length + 1);
}

const ENCODED_MODEL = "b64:";

function base64Url(value: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function encodedModelId(prefix: string, value: string): string {
  const plain = `${prefix}${value}`;
  return isAgentModel(plain) && !value.startsWith(ENCODED_MODEL)
    ? plain
    : `${prefix}${ENCODED_MODEL}${base64Url(value)}`;
}

export function savedCustomModelId(
  endpointId: string,
  harness: CustomProviderHarness | undefined,
  modelId: string,
): string {
  return (harness ?? DEFAULT_CUSTOM_PROVIDER_HARNESS) === "pi"
    ? encodedModelId(`${endpointId}/`, modelId)
    : composedCustomModelId(endpointId, modelId);
}

export function isCustomProviderModelId(modelId: string, providerIds: ReadonlySet<string>): boolean {
  const separator = modelId.indexOf("/");
  return separator > 0 && providerIds.has(modelId.slice(0, separator));
}

export function customProviderOfModel<T extends { readonly id: string }>(
  modelId: string | null | undefined,
  providers: readonly T[],
): T | undefined {
  const separator = modelId?.indexOf("/") ?? -1;
  if (!modelId || separator <= 0) return undefined;
  const providerId = modelId.slice(0, separator);
  return providers.find((provider) => provider.id === providerId);
}

export function isCustomProviderHeaderName(value: unknown): value is string {
  return isString(value) && value.length > 0 && CUSTOM_PROVIDER_HEADER_NAME_PATTERN.test(value);
}
