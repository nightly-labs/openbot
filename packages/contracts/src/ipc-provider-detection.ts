// Local model servers that the host finds without the user's help, and the model list of one
// endpoint that the user types. Main makes every request: the renderer's content security policy
// does not let the page call a local address, and a stored key must not travel back to the page to
// make one.
//
// A scan never sends a key. A model list for a saved endpoint may use the stored key and headers,
// but only while the address has the same origin as the saved one.

import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString } from "./ipc-bounded-values";
import { CUSTOM_PROVIDER_LIMITS, type CustomProviderHeader, isNewCustomProviderId } from "./ipc-custom-providers";
import { isBoolean, isDynamicRecord } from "./runtime-values";

export const PROVIDER_DETECTION_LIMITS = {
  /** Extra addresses, and extra folders, in the detection settings. */
  entries: 16,
  entryLength: 2_048,
  /** Detection keys that the user hid. */
  hidden: 64,
  /** Models that one list request can return. A longer list is cut, not refused. */
  models: 256,
} as const;

/** Where the host looks, besides the default addresses and PATH, and the rows the user hid. */
export interface ProviderDetectionSettings {
  enabled: boolean;
  /** Base URLs of more OpenAI-compatible servers. */
  addresses: string[];
  /** More folders to search for known ACP agent commands. */
  folders: string[];
  /** Detection keys: `models:<endpoint key>` or `agent:<command path>`. */
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
}

/** One server that answered `GET {baseUrl}/models` with no key. */
export interface DetectedModelServer {
  /** A free endpoint id to suggest, such as `ollama` or `server-192-168-1-20-11434`. */
  id: string;
  /** The server's product name when the address is a known default, or its host and port. */
  name: string;
  baseUrl: string;
  models: DetectedModel[];
}

/**
 * The model list of one endpoint that the user types. `savedProviderId` names the endpoint that the
 * user edits: main then uses its stored key and headers for a blank key and no headers, but only for
 * the same origin, so an edited address can never receive the old credentials.
 */
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
  return isDynamicRecord(value) && isBoundedString(value.id, INPUT_LIMITS.identifier) && value.id.length > 0;
}

function isDetectedModels(value: unknown): value is DetectedModel[] {
  return Array.isArray(value) && value.length <= PROVIDER_DETECTION_LIMITS.models && value.every(isDetectedModel);
}

/** Fails closed like `isCustomProviderSummary`: a row with a key or headers is refused. */
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

/** An absolute path or a path in the home folder. A NUL character ends a path in the system call. */
export function isDetectionFolder(value: string): boolean {
  if (value.includes("\0")) return false;
  return value.startsWith("/") || value.startsWith("~/") || value === "~" || /^[A-Za-z]:[\\/]/.test(value);
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEFAULT_PORTS: Readonly<Record<string, string>> = { "http:": "80", "https:": "443" };

/**
 * One form of an endpoint address, so the same server found twice, or saved and found, is one row:
 * the host is lowercase, a loopback name is `127.0.0.1`, the default port is dropped, and so is a
 * trailing `/`. Null for a text that is not an http or https URL.
 */
export function customProviderEndpointKey(baseUrl: string): string | null {
  const url = parseHttpUrl(baseUrl);
  if (!url) return null;
  const host = LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ? "127.0.0.1" : url.hostname.toLowerCase();
  const port = url.port && url.port !== DEFAULT_PORTS[url.protocol] ? `:${url.port}` : "";
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${host}${port}${path}`;
}

/** Whether two addresses have the same scheme, host and port, with loopback names as one host. */
export function sameCustomProviderOrigin(a: string, b: string): boolean {
  const first = parseHttpUrl(a);
  const second = parseHttpUrl(b);
  if (!first || !second) return false;
  const origin = (url: URL) => customProviderEndpointKey(`${url.protocol}//${url.host}`);
  return origin(first) === origin(second);
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
