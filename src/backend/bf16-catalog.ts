import { isAgentModel } from "@openbot/contracts/ipc";
import { Option, Schema } from "effect";

/** bf16.ai public OpenAI-compatible model catalog. Needs no API key. */
export const BF16_MODELS_URL = "https://api.bf16.ai/v1/models";

const Bf16PricingUsd = Schema.Struct({
  input: Schema.String,
  output: Schema.String,
  cached_input: Schema.optional(Schema.String),
});

const Bf16Metadata = Schema.Struct({
  display_name: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  modification_method: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  context_window: Schema.optional(Schema.Finite),
  max_output_tokens: Schema.optional(Schema.Finite),
  supports_reasoning: Schema.optional(Schema.Boolean),
  supports_tools: Schema.optional(Schema.Boolean),
  supports_vision: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.String),
  pricing_usd_per_1m: Schema.optional(Bf16PricingUsd),
});

/** One entry of `GET https://api.bf16.ai/v1/models`. Extra fields are ignored. */
export const Bf16CatalogEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  context_window: Schema.optional(Schema.Finite),
  context_length: Schema.optional(Schema.Finite),
  max_output_tokens: Schema.optional(Schema.Finite),
  max_tokens: Schema.optional(Schema.Finite),
  supports_reasoning: Schema.optional(Schema.Boolean),
  supports_tools: Schema.optional(Schema.Boolean),
  supports_vision: Schema.optional(Schema.Boolean),
  supported_parameters: Schema.optional(Schema.Array(Schema.String)),
  bf16: Schema.optional(Bf16Metadata),
});
export type Bf16CatalogEntry = typeof Bf16CatalogEntry.Type;

/** The list envelope is strict. An entry that does not decode is skipped alone. */
export const Bf16CatalogEnvelope = Schema.Struct({ data: Schema.Array(Schema.Unknown) });

const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

/** A chat model in the shape of Pi's `registerProvider` model config. */
export interface Bf16Model {
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

const ROUTER_DEFAULT_CONTEXT = 1_048_576;
const ROUTER_DEFAULT_MAX_TOKENS = 65_536;

const DEFAULT_THINKING_LEVEL_MAP: Readonly<Partial<Record<PiThinkingLevel, string | null>>> = {
  off: "none",
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: null,
  max: "max",
};

function parseUsd(raw: string | undefined): number {
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function isRouterEntry(entry: Bf16CatalogEntry): boolean {
  return entry.bf16?.family === "router" || entry.bf16?.modification_method === "smart_router";
}

/**
 * Coding agents need tool calling and a valid model id. Inactive models are skipped.
 */
export function isBf16AgentModel(entry: Bf16CatalogEntry): boolean {
  if (!isAgentModel(entry.id)) return false;
  if (entry.bf16?.status !== undefined && entry.bf16.status !== "active") return false;
  if (isRouterEntry(entry)) return true;
  const supportsTools = entry.supports_tools ?? entry.bf16?.supports_tools ?? false;
  return supportsTools;
}

function routerDisplayName(entry: Bf16CatalogEntry): string {
  if (entry.id === "bf16/auto") return "bf16 Auto Router";
  if (entry.id === "bf16/auto:fast") return "bf16 Auto Router (Fast)";
  if (entry.id === "bf16/auto:coding") return "bf16 Auto Router (Coding)";
  if (entry.id === "bf16/auto:reasoning") return "bf16 Auto Router (Reasoning)";
  return entry.bf16?.description ?? entry.id;
}

export function bf16ModelConfig(entry: Bf16CatalogEntry): Bf16Model {
  if (isRouterEntry(entry)) {
    const vision = entry.id === "bf16/auto" || entry.id === "bf16/auto:fast";
    return {
      id: entry.id,
      name: routerDisplayName(entry),
      reasoning: true,
      input: vision ? ["text", "image"] : ["text"],
      contextWindow: ROUTER_DEFAULT_CONTEXT,
      maxTokens: ROUTER_DEFAULT_MAX_TOKENS,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false },
    };
  }

  const contextWindow = entry.context_window ?? entry.context_length ?? entry.bf16?.context_window ?? 1_048_576;
  const maxTokens =
    entry.max_output_tokens ?? entry.max_tokens ?? entry.bf16?.max_output_tokens ?? Math.min(contextWindow, 65_536);
  const reasoning = entry.supports_reasoning ?? entry.bf16?.supports_reasoning ?? false;
  const vision = entry.supports_vision ?? entry.bf16?.supports_vision ?? false;
  const supportsEffort = reasoning && (entry.supported_parameters?.includes("reasoning_effort") ?? false);
  const pricing = entry.bf16?.pricing_usd_per_1m;

  return {
    id: entry.id,
    name: entry.name ?? entry.bf16?.display_name ?? entry.id,
    reasoning,
    input: vision ? ["text", "image"] : ["text"],
    contextWindow,
    maxTokens,
    cost: {
      input: parseUsd(pricing?.input),
      output: parseUsd(pricing?.output),
      cacheRead: parseUsd(pricing?.cached_input),
      cacheWrite: 0,
    },
    ...(supportsEffort ? { thinkingLevelMap: DEFAULT_THINKING_LEVEL_MAP } : {}),
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: supportsEffort },
  };
}

/** Returns all usable agent models from a decoded `/v1/models` envelope, sorted by id. */
export function bf16Models(entries: readonly unknown[]): Bf16Model[] {
  const decode = Schema.decodeUnknownOption(Bf16CatalogEntry);
  const models = new Map<string, Bf16Model>();
  for (const value of entries) {
    const entry = decode(value);
    if (Option.isNone(entry) || !isBf16AgentModel(entry.value)) continue;
    models.set(entry.value.id, bf16ModelConfig(entry.value));
  }
  return [...models.values()].sort((left, right) => left.id.localeCompare(right.id));
}
