/**
 * The models that the model picker of a server shows for one provider (`model-visibility-v1`), as
 * the desktop main process, the preload and the browser client read them. On the wire the route
 * codec has already checked the fields; this gives them their IPC type and fails closed on anything else.
 */

import { type AgentProviderRef, isAgentProviderRef } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { AGENT_MODEL_LISTINGS, type AgentModelId, type AgentModelListing, isAgentModel } from "./ipc-agent-identity";
import { isBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

/** The most models one provider can list on the wire. OpenCode with many services lists about a thousand. */
export const MODEL_VISIBILITY_LIMIT = 10_000;

/** One model of the provider, as the Models section lists it. */
export interface ProviderModelEntry {
  id: AgentModelId;
  name: string;
}

export interface ProviderModelVisibility {
  provider: AgentProviderRef;
  /** Every model the provider lists now, in the provider's order. */
  models: ProviderModelEntry[];
  /**
   * The models that the model picker shows. A model that no admin turned on or off follows the host's
   * default, which shows the newest models; see `docs/architecture/servers.md`.
   */
  shown: AgentModelId[];
  /** True when an admin turned a model of this provider on or off, so a reset has something to undo. */
  changed: boolean;
}

export interface ProviderModelVisibilityChange {
  provider: AgentProviderRef;
  /** The models that the picker shows. Null resets the provider to the host's default. */
  shown: AgentModelId[] | null;
}

/** A model that the picker lists in a special way, from the `model-visibility-v1` listing route. */
export interface AgentModelListingEntry {
  provider: AgentProviderRef;
  id: AgentModelId;
  listing: AgentModelListing;
}

function isModelIdList(value: unknown): value is AgentModelId[] {
  return Array.isArray(value) && value.length <= MODEL_VISIBILITY_LIMIT && value.every(isAgentModel);
}

function isProviderModelEntry(value: unknown): value is ProviderModelEntry {
  return isDynamicRecord(value) && isAgentModel(value.id) && isBoundedString(value.name, INPUT_LIMITS.modelName);
}

export function parseProviderModelVisibilityProvider(value: unknown): AgentProviderRef {
  if (!isAgentProviderRef(value)) throw new Error("Provider is required.");
  return value;
}

export function parseProviderModelVisibilityChange(value: unknown): ProviderModelVisibilityChange {
  if (!isDynamicRecord(value) || !isAgentProviderRef(value.provider)) throw new Error("Invalid model list.");
  if (value.shown === null) return { provider: value.provider, shown: null };
  if (!isModelIdList(value.shown)) throw new Error("Invalid model list.");
  return { provider: value.provider, shown: [...new Set(value.shown)] };
}

export function decodeProviderModelVisibility(value: unknown): ProviderModelVisibility {
  if (
    !isDynamicRecord(value) ||
    !isAgentProviderRef(value.provider) ||
    !Array.isArray(value.models) ||
    value.models.length > MODEL_VISIBILITY_LIMIT ||
    !value.models.every(isProviderModelEntry) ||
    !isModelIdList(value.shown) ||
    !isBoolean(value.changed)
  )
    throw new Error("Invalid model list.");
  return {
    provider: value.provider,
    models: value.models.map((model) => ({ id: model.id, name: model.name })),
    shown: value.shown,
    changed: value.changed,
  };
}

function isAgentModelListingEntry(value: unknown): value is AgentModelListingEntry {
  return (
    isDynamicRecord(value) &&
    isAgentProviderRef(value.provider) &&
    isAgentModel(value.id) &&
    isOneOf(AGENT_MODEL_LISTINGS, value.listing)
  );
}

export function decodeAgentModelListings(value: unknown): AgentModelListingEntry[] {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.models) ||
    value.models.length > MODEL_VISIBILITY_LIMIT ||
    !value.models.every(isAgentModelListingEntry)
  )
    throw new Error("Invalid model list.");
  return value.models.map((model) => ({ provider: model.provider, id: model.id, listing: model.listing }));
}

/** Gives each model of `models` its listing from the listing route, as `withFastServiceTiers` gives the fast tier. */
export function withModelListings<Model extends { provider: string; id: string; listing?: AgentModelListing }>(
  models: readonly Model[],
  listings: readonly AgentModelListingEntry[],
): Model[] {
  const byKey = new Map(listings.map((entry) => [`${entry.provider}\u0000${entry.id}`, entry.listing]));
  return models.map((model) => {
    const listing = byKey.get(`${model.provider}\u0000${model.id}`);
    return listing ? { ...model, listing } : model;
  });
}
