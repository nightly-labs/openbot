import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString } from "./ipc-bounded-values";
import {
  CUSTOM_PROVIDER_LIMITS,
  type CustomProviderHeader,
  type CustomProviderInputKind,
  type CustomProviderReasoningEffort,
  isCustomProviderContextWindow,
  isCustomProviderInputs,
  isCustomProviderMaxOutput,
  isCustomProviderReasoningEfforts,
  isNewCustomProviderId,
} from "./ipc-custom-providers";
import { isBoolean, isDynamicRecord } from "./runtime-values";

export const PROVIDER_DETECTION_LIMITS = {
  entries: 16,
  entryLength: 2_048,
  hidden: 64,
  models: 256,
} as const;

export const DEFAULT_MODEL_SERVERS = {
  ollama: { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  lmstudio: { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
} as const;

export type DefaultModelServerId = keyof typeof DEFAULT_MODEL_SERVERS;

export interface ProviderDetectionSettings {
  enabled: boolean;
  addresses: string[];
  folders: string[];
  hiddenIds: string[];
}

export const DEFAULT_PROVIDER_DETECTION_SETTINGS: ProviderDetectionSettings = {
  enabled: true,
  addresses: [],
  folders: [],
  hiddenIds: [],
};

export interface DetectedModel {
  id: string;
  inputs?: CustomProviderInputKind[];
  contextWindow?: number;
  maxOutput?: number;
  reasoningEfforts?: CustomProviderReasoningEffort[];
}

export interface DetectedModelServer {
  id: string;
  name: string;
  baseUrl: string;
  models: DetectedModel[];
}

export interface DiscoverModelsInput {
  baseUrl: string;
  apiKey: string | null;
  headers: CustomProviderHeader[];
  savedProviderId?: string;
}

export interface DiscoverModelsResult {
  models: DetectedModel[];
}

function isDetectedModel(value: unknown): value is DetectedModel {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.id, INPUT_LIMITS.identifier) &&
    value.id.length > 0 &&
    (value.inputs === undefined || isCustomProviderInputs(value.inputs)) &&
    (value.contextWindow === undefined || isCustomProviderContextWindow(value.contextWindow)) &&
    (value.maxOutput === undefined ||
      (value.contextWindow !== undefined && isCustomProviderMaxOutput(value.maxOutput))) &&
    (value.reasoningEfforts === undefined || isCustomProviderReasoningEfforts(value.reasoningEfforts))
  );
}

function isDetectedModels(value: unknown): value is DetectedModel[] {
  return Array.isArray(value) && value.length <= PROVIDER_DETECTION_LIMITS.models && value.every(isDetectedModel);
}

export function isDetectedModelServer(value: unknown): value is DetectedModelServer {
  return (
    isDynamicRecord(value) &&
    !("apiKey" in value) &&
    !("headers" in value) &&
    isNewCustomProviderId(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.agentName) &&
    isBoundedString(value.baseUrl, CUSTOM_PROVIDER_LIMITS.baseUrl) &&
    isDetectedModels(value.models)
  );
}

export function isDiscoverModelsResult(value: unknown): value is DiscoverModelsResult {
  return isDynamicRecord(value) && isDetectedModels(value.models);
}

function isEntryList(value: unknown, limit: number): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= limit &&
    value.every((entry) => isBoundedString(entry, PROVIDER_DETECTION_LIMITS.entryLength))
  );
}

export function isProviderDetectionSettings(value: unknown): value is ProviderDetectionSettings {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.enabled) &&
    isEntryList(value.addresses, PROVIDER_DETECTION_LIMITS.entries) &&
    isEntryList(value.folders, PROVIDER_DETECTION_LIMITS.entries) &&
    isEntryList(value.hiddenIds, PROVIDER_DETECTION_LIMITS.hidden)
  );
}

export function isDetectionFolder(value: string): boolean {
  if (value.includes("\0")) return false;
  return value.startsWith("/") || value.startsWith("~/") || value === "~" || /^[A-Za-z]:[\\/]/.test(value);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEFAULT_PORTS: Readonly<Record<string, string>> = { "http:": "80", "https:": "443" };

export function detectedModelServerKey(baseUrl: string): string {
  return `models:${customProviderEndpointKey(baseUrl) ?? baseUrl}`;
}

export function customProviderEndpointKey(baseUrl: string): string | null {
  const url = parseHttpUrl(baseUrl);
  if (!url) return null;
  const host = LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ? "127.0.0.1" : url.hostname.toLowerCase();
  const port = url.port && url.port !== DEFAULT_PORTS[url.protocol] ? `:${url.port}` : "";
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${host}${port}${path}`;
}

export function sameCustomProviderOrigin(a: string, b: string): boolean {
  const first = parseHttpUrl(a);
  const second = parseHttpUrl(b);
  return first !== null && second !== null && first.origin === second.origin;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
