import {
  type AgentProviderRef,
  agentProviderDescriptor,
  isAgentProviderRef,
  isKnownAgentProvider,
} from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import {
  AGENT_MODEL_INPUTS,
  AGENT_MODEL_LISTINGS,
  type AgentModelId,
  type AgentModelInput,
  type AgentModelListing,
  isAgentModel,
} from "./ipc-agent-identity";
import { isBoundedString } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isOneOf } from "./runtime-values";

export const MODEL_VISIBILITY_LIMIT = 10_000;

export interface ProviderModelEntry {
  id: AgentModelId;
  name: string;
}

export interface ProviderModelVisibility {
  provider: AgentProviderRef;
  models: ProviderModelEntry[];
  shown: AgentModelId[];
  changed: boolean;
}

export interface ProviderModelVisibilityChange {
  provider: AgentProviderRef;
  shown: AgentModelId[] | null;
}

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

export function withKeptModels<Model extends { provider: string; id: string; listing?: AgentModelListing }>(
  models: readonly Model[],
  kept: readonly AgentSteeringModel[],
): Model[] {
  const keys = new Set(kept.map((entry) => `${entry.provider}\u0000${entry.id}`));
  return models.map((model) =>
    keys.has(`${model.provider}\u0000${model.id}`) ? { ...model, listing: "kept" } : model,
  );
}

export interface AgentSteeringModel {
  provider: AgentProviderRef;
  id: AgentModelId;
}

export function decodeAgentSteeringModels(value: unknown): AgentSteeringModel[] {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.models) ||
    value.models.length > MODEL_VISIBILITY_LIMIT ||
    !value.models.every(
      (model: unknown) => isDynamicRecord(model) && isAgentProviderRef(model.provider) && isAgentModel(model.id),
    )
  )
    throw new Error("Invalid model list.");
  return value.models.map((model: AgentSteeringModel) => ({ provider: model.provider, id: model.id }));
}

export function withSteeringModels<Model extends { provider: string; id: string; steersTurns?: boolean }>(
  models: readonly Model[],
  steering: readonly AgentSteeringModel[],
): Model[] {
  const keys = new Set(steering.map((entry) => `${entry.provider}\u0000${entry.id}`));
  return models.map((model) =>
    keys.has(`${model.provider}\u0000${model.id}`) ? { ...model, steersTurns: true } : model,
  );
}

export interface AgentModelInputsEntry {
  provider: AgentProviderRef;
  id: AgentModelId;
  inputs: AgentModelInput[];
}

export function decodeAgentModelInputs(value: unknown): AgentModelInputsEntry[] {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.models) ||
    value.models.length > MODEL_VISIBILITY_LIMIT ||
    !value.models.every(
      (model: unknown) =>
        isDynamicRecord(model) &&
        isAgentProviderRef(model.provider) &&
        isAgentModel(model.id) &&
        Array.isArray(model.inputs) &&
        model.inputs.every((input: unknown) => isOneOf(AGENT_MODEL_INPUTS, input)),
    )
  )
    throw new Error("Invalid model list.");
  return value.models.map((model: AgentModelInputsEntry) => ({
    provider: model.provider,
    id: model.id,
    inputs: model.inputs,
  }));
}

export function withModelInputs<Model extends { provider: string; id: string; inputs?: AgentModelInput[] }>(
  models: readonly Model[],
  entries: readonly AgentModelInputsEntry[],
): Model[] {
  const byKey = new Map(entries.map((entry) => [`${entry.provider}\u0000${entry.id}`, entry.inputs]));
  return models.map((model) => {
    const inputs = byKey.get(`${model.provider}\u0000${model.id}`);
    return inputs ? { ...model, inputs } : model;
  });
}

export function withWorkspaceOnlyLimit<
  Model extends { provider: AgentProviderRef; workspaceOnlyUnavailable?: boolean },
>(models: readonly Model[], limited: boolean): Model[] {
  return models.map((model) => {
    const unavailable =
      limited &&
      isKnownAgentProvider(model.provider) &&
      agentProviderDescriptor(model.provider).workspaceEnforcement === "confined-process";
    if (unavailable) return { ...model, workspaceOnlyUnavailable: true };
    return model.workspaceOnlyUnavailable === undefined ? model : { ...model, workspaceOnlyUnavailable: false };
  });
}
