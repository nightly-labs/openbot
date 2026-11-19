import {
  AGENT_PROVIDER_DESCRIPTORS,
  type AgentProviderId,
  type AgentProviderRef,
  agentProviderDescriptor,
  isAgentProvider,
  isAgentProviderRef,
} from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { isBoundedString } from "./ipc-bounded-values";
import { type DynamicRecord, isBoolean, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export type AgentModelId = string;

export const AGENT_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number];

export const LEGACY_AGENT_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type LegacyAgentReasoningEffort = (typeof LEGACY_AGENT_REASONING_EFFORTS)[number];

export function legacyReasoningEffort(effort: AgentReasoningEffort): LegacyAgentReasoningEffort {
  if (effort === "none" || effort === "minimal") return "low";
  return effort === "ultra" ? "max" : effort;
}

export const AVATAR_HUES = [0, 30, 55, 100, 150, 185, 215, 245, 280, 320] as const;
export type AvatarHue = (typeof AVATAR_HUES)[number];

export type AvatarColor = `#${string}`;

const AVATAR_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export function isAvatarColor(value: unknown): value is AvatarColor {
  return isString(value) && AVATAR_COLOR_PATTERN.test(value);
}

const NEUTRAL_SATURATION = 0.15;

export function nearestAvatarHue(color: AvatarColor): AvatarHue | null {
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (saturation < NEUTRAL_SATURATION) return null;
  const sector =
    max === red
      ? ((green - blue) / delta + 6) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  const angle = sector * 60;
  let nearest: AvatarHue = AVATAR_HUES[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const hue of AVATAR_HUES) {
    const distance = Math.min(Math.abs(angle - hue), 360 - Math.abs(angle - hue));
    if (distance < nearestDistance) {
      nearest = hue;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function isAgentModel(value: unknown): value is AgentModelId {
  return (
    isString(value) && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]*$/.test(value)
  );
}

export function defaultProviderModel(provider: AgentProviderId): AgentModelId {
  return agentProviderDescriptor(provider).defaultModel;
}

export function providerForLegacyModel(model: AgentModelId): AgentProviderId {
  for (const descriptor of AGENT_PROVIDER_DESCRIPTORS) {
    if (descriptor.legacyModelPrefix !== null && model.startsWith(descriptor.legacyModelPrefix)) return descriptor.id;
  }
  return "codex";
}

export function isReasoningEffort(value: unknown): value is AgentReasoningEffort {
  return isOneOf(AGENT_REASONING_EFFORTS, value);
}

export const AVATAR_SEED_PATTERN = /^[a-z0-9:-]{1,128}$/;

export function isAvatarSeed(value: unknown): value is string {
  return isString(value) && AVATAR_SEED_PATTERN.test(value);
}

export function isAvatarHue(value: unknown): value is AvatarHue {
  return isOneOf(AVATAR_HUES, value);
}

export const AGENT_MODEL_LISTINGS = ["new", "older"] as const;
export type AgentModelListing = (typeof AGENT_MODEL_LISTINGS)[number];

export interface AgentModelOption {
  provider: AgentProviderId;
  id: AgentModelId;
  name: string;
  description: string;
  defaultReasoningEffort: AgentReasoningEffort;
  supportedReasoningEfforts: AgentReasoningEffort[];
  reasoningEffortConfigurable?: boolean;
  fastServiceTier?: string;
  ultrafastServiceTier?: string;
  listing?: AgentModelListing;
  steersTurns?: boolean;
  workspaceOnlyUnavailable?: boolean;
}

export function isAgentModelOption(value: unknown): value is AgentModelOption {
  return isDynamicRecord(value) && isAgentProvider(value.provider) && hasAgentModelOptionFields(value);
}

export type ClientAgentModelOption = Omit<AgentModelOption, "provider"> & { provider: AgentProviderRef };

export function isClientAgentModelOption(value: unknown): value is ClientAgentModelOption {
  return isDynamicRecord(value) && isAgentProviderRef(value.provider) && hasAgentModelOptionFields(value);
}

function hasAgentModelOptionFields(value: DynamicRecord): boolean {
  return (
    isAgentModel(value.id) &&
    isBoundedString(value.name, INPUT_LIMITS.modelName) &&
    isBoundedString(value.description, INPUT_LIMITS.agentDescription) &&
    isReasoningEffort(value.defaultReasoningEffort) &&
    Array.isArray(value.supportedReasoningEfforts) &&
    value.supportedReasoningEfforts.every(isReasoningEffort) &&
    (value.reasoningEffortConfigurable === undefined || isBoolean(value.reasoningEffortConfigurable)) &&
    (value.fastServiceTier === undefined || isBoundedString(value.fastServiceTier, INPUT_LIMITS.serviceTier)) &&
    (value.ultrafastServiceTier === undefined ||
      isBoundedString(value.ultrafastServiceTier, INPUT_LIMITS.serviceTier)) &&
    (value.listing === undefined || isOneOf(AGENT_MODEL_LISTINGS, value.listing)) &&
    (value.steersTurns === undefined || isBoolean(value.steersTurns))
  );
}
