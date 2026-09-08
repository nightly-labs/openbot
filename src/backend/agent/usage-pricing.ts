import type { UsageTokens } from "@openbot/contracts/ipc";

// Standard API-equivalent rates per million tokens, verified 2026-09-07.
// These are not subscription charges. No guessed alias or default-model prices.
const OPENAI = "https://developers.openai.com/api/docs/pricing";
const CLAUDE = "https://platform.claude.com/docs/en/about-claude/pricing";
const GROK = "https://docs.x.ai/developers/pricing";
interface Price {
  input: number;
  cached: number;
  output: number;
  source: string;
}
const PRICES: Readonly<Record<string, Price>> = {
  "codex:gpt-6-astra": { input: 10, cached: 1, output: 50, source: OPENAI },
  "codex:gpt-5.6-sol": { input: 4, cached: 0.4, output: 20, source: OPENAI },
  "codex:gpt-5.6-terra": { input: 2, cached: 0.2, output: 12, source: OPENAI },
  "codex:gpt-5.6-luna": { input: 0.2, cached: 0.02, output: 1.2, source: OPENAI },
  "claude:claude-fable-5-1": { input: 10, cached: 0.25, output: 50, source: CLAUDE },
  "claude:claude-opus-4-6": { input: 5, cached: 0.5, output: 25, source: CLAUDE },
  "claude:claude-opus-4-7": { input: 5, cached: 0.5, output: 25, source: CLAUDE },
  "claude:claude-sonnet-4-6": { input: 3, cached: 0.3, output: 15, source: CLAUDE },
  "claude:claude-sonnet-5": { input: 2, cached: 0.2, output: 10, source: CLAUDE },
  "claude:claude-haiku-4-5": { input: 1, cached: 0.1, output: 5, source: CLAUDE },
  "grok:grok-4.6": { input: 2, cached: 0.5, output: 6, source: GROK },
  "grok:grok-build-0.1": { input: 1, cached: 0.2, output: 2, source: GROK },
};

export function estimateUsageCost(
  provider: string,
  model: string,
  tokens: UsageTokens,
  pricingInputTokens = (tokens.uncachedInput ?? 0) + (tokens.cachedInput ?? 0),
): { cost: number | null; basis: string | null } {
  const price = PRICES[`${provider}:${model}`];
  // Aggregates cannot establish long-context or cache-write TTL pricing. Leave these unpriced.
  if (
    !price ||
    tokens.uncachedInput === null ||
    tokens.cachedInput === null ||
    tokens.output === null ||
    tokens.cacheCreation !== 0 ||
    pricingInputTokens >= 200_000
  )
    return { cost: null, basis: null };
  return {
    cost:
      (tokens.uncachedInput * price.input + tokens.cachedInput * price.cached + tokens.output * price.output) /
      1_000_000,
    basis: JSON.stringify({ effectiveDate: "2026-09-07", model, ...price }),
  };
}
