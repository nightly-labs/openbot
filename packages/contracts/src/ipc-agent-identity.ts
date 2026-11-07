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

/** From the least reasoning to the most. Each provider lists the levels that a model takes. */
export const AGENT_REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type AgentReasoningEffort = (typeof AGENT_REASONING_EFFORTS)[number];

/**
 * The levels that released IPC and Team API peers know. Do not change this list: a peer that reads
 * only these levels refuses a model list that has another one.
 */
export const LEGACY_AGENT_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type LegacyAgentReasoningEffort = (typeof LEGACY_AGENT_REASONING_EFFORTS)[number];

/** The nearest level that a released peer knows: `none` and `minimal` are `low`, `ultra` is `max`. */
export function legacyReasoningEffort(effort: AgentReasoningEffort): LegacyAgentReasoningEffort {
  if (effort === "none" || effort === "minimal") return "low";
  return effort === "ultra" ? "max" : effort;
}

/**
 * The hues that released apps and Team API peers know. Do not change this list: released decoders
 * refuse another value. A new agent colour is an `AvatarColor`, not a new hue.
 */
export const AVATAR_HUES = [0, 30, 55, 100, 150, 185, 215, 245, 280, 320] as const;
export type AvatarHue = (typeof AVATAR_HUES)[number];

/**
 * An agent colour as `#rrggbb` in lower case. It is any colour, so a new preset or a brand colour needs
 * no new wire value. An agent with a colour also keeps the nearest hue (`nearestAvatarHue`) in
 * `avatarHue`, which released apps and peers read.
 */
export type AvatarColor = `#${string}`;

const AVATAR_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

export function isAvatarColor(value: unknown): value is AvatarColor {
  return isString(value) && AVATAR_COLOR_PATTERN.test(value);
}

/** Saturation under this limit has no clear hue, so such a colour gets the automatic hue. */
const NEUTRAL_SATURATION = 0.15;

/**
 * The hue that a released app or peer draws for a colour: the nearest of `AVATAR_HUES` on the colour
 * wheel, or null (automatic) for grey, black and white.
 */
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

// Square brackets are in the set because a provider CLI puts them there: the Claude CLI reports its
// 1M-context Fable variant as `claude-fable-5-1[1m]`, and every id this guard sees was minted by a
// CLI OpenBot does not control. `=` and `,` are there for the same reason: the Cursor CLI lists its
// variants as `gpt-5.6-sol[context=272k,reasoning=medium,fast=false]`, and takes that id back whole.
// Without them the model was unselectable and, worse, unlistable --
// `isAgentModelOption` refuses the option, and the list decoders on both the IPC and the Team API
// side fail closed on the whole array with it, so one such id emptied the model picker locally and
// took a remote server offline entirely. Failing closed is what the contract asks of a malformed
// known payload and it stays, which leaves this charset as the only thing between a legitimate CLI
// id and a bricked server -- so an id is a single opaque token here rather than a list of the models
// this build happens to know: no whitespace, quotes, control characters or path separators beyond
// the `/` a provider prefix uses, and nothing downstream builds a filesystem path or a URL out of
// one -- `/v1/agents/models` takes no model parameter.
export function isAgentModel(value: unknown): value is AgentModelId {
  return (
    isString(value) && value.length > 0 && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:/[\],=-]*$/.test(value)
  );
}

/**
 * The model each provider starts on, and the one the model picker marks as the default.
 *
 * A provider lists its own models, so an id here can be missing from a given CLI: every caller
 * falls back to the first model that provider does list, and the picker simply marks nothing.
 */
export function defaultProviderModel(provider: AgentProviderId): AgentModelId {
  return agentProviderDescriptor(provider).defaultModel;
}

/**
 * `codex` is the historical answer for a model no prefix claims, and it has to stay that way: an
 * import that never named a provider already landed there, and moving it would move those agents.
 */
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

/**
 * How the model picker of a server lists a model. `new`: the model came out in the last days, and the
 * picker labels it. `older`: the server shows a newer model in its place, so the picker folds it
 * under Older models. Absent: a plain row.
 */
export const AGENT_MODEL_LISTINGS = ["new", "older"] as const;
export type AgentModelListing = (typeof AGENT_MODEL_LISTINGS)[number];

export interface AgentModelOption {
  provider: AgentProviderId;
  id: AgentModelId;
  name: string;
  description: string;
  defaultReasoningEffort: AgentReasoningEffort;
  supportedReasoningEfforts: AgentReasoningEffort[];
  /**
   * False when the provider offers no reasoning setting for this model. `supportedReasoningEfforts`
   * still holds `medium`, which is what clients that predate this field show and save.
   */
  reasoningEffortConfigurable?: boolean;
  /**
   * The provider's id for the fast service tier of this model, such as Codex `priority`. Absent when
   * the model has no fast mode.
   */
  fastServiceTier?: string;
  /** See `AgentModelListing`. The released Team API model list does not carry it; `model-visibility-v1` does. */
  listing?: AgentModelListing;
}

export function isAgentModelOption(value: unknown): value is AgentModelOption {
  return isDynamicRecord(value) && isAgentProvider(value.provider) && hasAgentModelOptionFields(value);
}

/** A model that a client reads from a host. Its provider can be one that this OpenBot does not know. */
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
    (value.listing === undefined || isOneOf(AGENT_MODEL_LISTINGS, value.listing))
  );
}
