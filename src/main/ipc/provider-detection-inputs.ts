// The model list request and the detection settings. The list request can carry a key, so no
// message here quotes the input.

import type { DiscoverModelsInput, ProviderDetectionSettings } from "@openbot/contracts/ipc";
import {
  customProviderEndpointKey,
  isCustomProviderId,
  isDetectionFolder,
  PROVIDER_DETECTION_LIMITS,
} from "@openbot/contracts/ipc";
import { isBoolean, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { parseApiKey, parseBaseUrl, parseHeaders } from "./custom-provider-inputs";
import { isObject } from "./validation";

export function parseDiscoverModels(input: unknown): DiscoverModelsInput {
  if (!isObject(input)) throw new Error("Invalid endpoint.");
  const savedProviderId = input.savedProviderId;
  if (savedProviderId !== undefined && !isCustomProviderId(savedProviderId)) {
    throw new Error(sourceText("error.provider.idInvalid"));
  }
  return {
    baseUrl: parseBaseUrl(input.baseUrl),
    apiKey: parseApiKey(input.apiKey),
    headers: parseHeaders(input.headers),
    ...(savedProviderId === undefined ? {} : { savedProviderId }),
  };
}

function parseList(value: unknown, limit: number, check: (entry: string) => boolean): string[] {
  if (!Array.isArray(value)) throw new Error("The list is not a list.");
  const entries: string[] = [];
  for (const entry of value) {
    if (!isString(entry) || entry.length > PROVIDER_DETECTION_LIMITS.entryLength) {
      throw new Error("A list entry is not valid text.");
    }
    const trimmed = entry.trim();
    // A blank row is the form's empty field, not an entry.
    if (!trimmed) continue;
    if (!check(trimmed)) throw new Error(sourceText("error.provider.detectionEntryInvalid"));
    if (!entries.includes(trimmed)) entries.push(trimmed);
  }
  if (entries.length > limit) throw new Error(sourceText("error.provider.detectionEntriesTooMany"));
  return entries;
}

function isScanAddress(value: string): boolean {
  if (!customProviderEndpointKey(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password;
}

const HIDDEN_ID_PATTERN = /^(models|agent):/;

export function parseProviderDetectionSettings(input: unknown): ProviderDetectionSettings {
  if (!isObject(input) || !isBoolean(input.enabled)) throw new Error("Invalid detection settings.");
  return {
    enabled: input.enabled,
    addresses: parseList(input.addresses, PROVIDER_DETECTION_LIMITS.entries, isScanAddress),
    folders: parseList(input.folders, PROVIDER_DETECTION_LIMITS.entries, isDetectionFolder),
    hiddenIds: parseList(input.hiddenIds, PROVIDER_DETECTION_LIMITS.hidden, (entry) => HIDDEN_ID_PATTERN.test(entry)),
  };
}
