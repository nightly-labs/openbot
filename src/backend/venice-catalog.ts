import { isAgentModel } from "@openbot/contracts/ipc";
import { Option, Schema } from "effect";

/** Venice's public text model list. It needs no key (https://docs.venice.ai/api-reference/api-spec). */
export const VENICE_MODELS_URL = "https://api.venice.ai/api/v1/models?type=text";

const Price = Schema.Struct({ usd: Schema.Finite });

/** One entry of `GET /models?type=text`. Fields that OpenBot does not read are ignored. */
export const VeniceCatalogEntry = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  model_spec: Schema.Struct({
    name: Schema.String,
    availableContextTokens: Schema.Finite,
    maxCompletionTokens: Schema.optional(Schema.Finite),
    offline: Schema.optional(Schema.Boolean),
    pricing: Schema.Struct({
      input: Price,
      output: Price,
      cache_input: Schema.optional(Price),
      cache_write: Schema.optional(Price),
    }),
    capabilities: Schema.Struct({
      supportsFunctionCalling: Schema.Boolean,
      supportsReasoning: Schema.Boolean,
      supportsVision: Schema.Boolean,
      supportsReasoningEffort: Schema.optional(Schema.Boolean),
      reasoningEffortOptions: Schema.optional(Schema.Array(Schema.String)),
    }),
  }),
});
export type VeniceCatalogEntry = typeof VeniceCatalogEntry.Type;

/** The list envelope is strict. An entry that does not decode is dropped alone. */
export const VeniceCatalogEnvelope = Schema.Struct({ data: Schema.Array(Schema.Unknown) });

const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

/** A chat model in the shape of Pi's `registerProvider` model config (Pi 1.1.0 `ProviderChatModelConfig`). */
export interface VeniceModel {
  readonly id: string;
  readonly name: string;
  readonly reasoning: boolean;
  readonly input: readonly ("text" | "image")[];
  readonly contextWindow: number;
  readonly maxTokens: number;
  readonly cost: {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
  };
  readonly thinkingLevelMap?: Readonly<Partial<Record<PiThinkingLevel, string | null>>>;
  readonly compat: {
    readonly supportsStore: false;
    readonly supportsDeveloperRole: false;
    readonly supportsReasoningEffort: boolean;
  };
}

/**
 * A coding agent needs tools. `e2ee-*` models need prompts that the client encrypts, which Pi cannot do,
 * and an id that `isAgentModel` refuses would fail the model list downstream.
 */
export function isVeniceAgentModel(entry: VeniceCatalogEntry): boolean {
  return (
    entry.type === "text" &&
    entry.model_spec.offline !== true &&
    entry.model_spec.capabilities.supportsFunctionCalling &&
    !entry.id.startsWith("e2ee-") &&
    isAgentModel(entry.id)
  );
}

/**
 * Venice names the efforts of each model (`reasoningEffortOptions`, such as `none`, `low`, `high`,
 * `max`). Pi's `off` is Venice's `none`; a level that Venice does not name is unsupported.
 */
function thinkingLevelMap(options: readonly string[]): Partial<Record<PiThinkingLevel, string | null>> {
  return Object.fromEntries(
    PI_THINKING_LEVELS.map((level) => {
      const venice = level === "off" ? "none" : level;
      return [level, options.includes(venice) ? venice : null];
    }),
  );
}

export function veniceModelConfig(entry: VeniceCatalogEntry): VeniceModel {
  const spec = entry.model_spec;
  const options = spec.capabilities.reasoningEffortOptions ?? [];
  const efforts = spec.capabilities.supportsReasoning && spec.capabilities.supportsReasoningEffort === true;
  return {
    id: entry.id,
    name: spec.name,
    reasoning: spec.capabilities.supportsReasoning,
    input: spec.capabilities.supportsVision ? ["text", "image"] : ["text"],
    contextWindow: spec.availableContextTokens,
    maxTokens: spec.maxCompletionTokens ?? Math.min(spec.availableContextTokens, 32_768),
    cost: {
      input: spec.pricing.input.usd,
      output: spec.pricing.output.usd,
      cacheRead: spec.pricing.cache_input?.usd ?? 0,
      cacheWrite: spec.pricing.cache_write?.usd ?? 0,
    },
    ...(efforts && options.length > 0 ? { thinkingLevelMap: thinkingLevelMap(options) } : {}),
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: efforts },
  };
}

/** The usable models of a decoded envelope, by id. */
export function veniceModels(entries: readonly unknown[]): VeniceModel[] {
  const decode = Schema.decodeUnknownOption(VeniceCatalogEntry);
  const models = new Map<string, VeniceModel>();
  for (const value of entries) {
    const entry = decode(value);
    if (Option.isNone(entry) || !isVeniceAgentModel(entry.value)) continue;
    models.set(entry.value.id, veniceModelConfig(entry.value));
  }
  return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
}
