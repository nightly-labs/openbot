import type { UsageTokens } from "@openbot/contracts/ipc";

// Standard API-equivalent rates per million tokens, verified 2026-10-21.
// These are not subscription charges. No guessed alias or default-model prices.
// Claude turns are priced by the Claude SDK's own cost report. These Claude rates apply only when
// that report gives no cost for a turn, as on the first turn of a resumed process.
const EFFECTIVE_DATE = "2026-10-21";
const OPENAI = "https://developers.openai.com/api/docs/pricing";
const CLAUDE = "https://platform.claude.com/docs/en/about-claude/pricing";
const GROK = "https://docs.x.ai/developers/pricing";
const GEMINI = "https://ai.google.dev/gemini-api/docs/pricing";
interface Rates {
  input: number;
  cached: number;
  /** The rate of a cache write. Without one, an update that writes the cache stays unpriced. */
  cacheWrite?: number;
  output: number;
}
interface Price {
  source: string;
  /** The date these rates were read, when it is later than `EFFECTIVE_DATE`. */
  verified?: string;
  short: Rates;
  /** A request whose prompt has at least `from` input tokens bills all its tokens at these rates. */
  long?: Rates & { from: number };
  /** From this UTC date (`YYYY-MM-DD`), these rates replace `short`. */
  change?: { on: string; short: Rates };
}
// OpenAI: "Long context: >272K input tokens". Codex sets no cache lifetime, so a write is the
// default 30-minute write. GPT-5.5 has no cache-write charge: a write bills as input.
const OPENAI_LONG = 272_001;
// xAI: "Long context ≥ 200k tokens". It lists no cache-write rate. ACP reports no prompt for each
// request, so a Grok update at or over the threshold stays unpriced.
const GROK_LONG = 200_000;
// Anthropic, verified 2026-10-24: "Claude 4.6 and later models (except Claude Haiku 5.5) include the
// full 1M token context window at standard pricing"; Haiku 5.5 pays more "for prompts over 100,000
// tokens". Claude Code writes the 1-hour cache: its own costs match the 1-hour write rate, 2x input.
// Server tools, such as web search, bill apart from tokens and are not in these estimates.
const HAIKU_5_5_LONG = 100_001;
const claude = (input: number, cached: number, output: number): Price => ({
  source: CLAUDE,
  short: { input, cached, cacheWrite: input * 2, output },
});
// Google, verified 2026-10-28: Antigravity "model inference is charged at standard Gemini list rates".
// Gemini 4 Argon and Gemini 3.8 Flash list no long-context rates and no cache-write rate (Argon
// caches only implicitly), and each list doubles on a set date. Antigravity also runs Claude models.
// Its cache lifetime is unknown, so a Claude update through it that writes the cache stays unpriced.
const ANTIGRAVITY_VERIFIED = "2026-10-28";
const antigravityClaude = (input: number, cached: number, output: number): Price => ({
  source: CLAUDE,
  verified: ANTIGRAVITY_VERIFIED,
  short: { input, cached, output },
});
const PRICES: Readonly<Record<string, Price>> = {
  "codex:gpt-6-astra": {
    source: OPENAI,
    short: { input: 10, cached: 1, cacheWrite: 12.5, output: 50 },
    long: { from: OPENAI_LONG, input: 20, cached: 2, cacheWrite: 25, output: 75 },
  },
  "codex:gpt-6.1-sol": {
    source: OPENAI,
    short: { input: 2, cached: 0.1, cacheWrite: 2.5, output: 10 },
    long: { from: OPENAI_LONG, input: 4, cached: 0.2, cacheWrite: 5, output: 15 },
  },
  "codex:gpt-6.1-terra": {
    source: OPENAI,
    short: { input: 1, cached: 0.05, cacheWrite: 1.25, output: 5 },
    long: { from: OPENAI_LONG, input: 2, cached: 0.1, cacheWrite: 2.5, output: 7.5 },
  },
  "codex:gpt-6-sol": {
    source: OPENAI,
    short: { input: 2, cached: 0.2, cacheWrite: 2.5, output: 10 },
    long: { from: OPENAI_LONG, input: 4, cached: 0.4, cacheWrite: 5, output: 15 },
  },
  "codex:gpt-6-luna": {
    source: OPENAI,
    short: { input: 0.1, cached: 0.01, cacheWrite: 0.125, output: 0.5 },
    long: { from: OPENAI_LONG, input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 0.75 },
  },
  "codex:gpt-5.6-sol": {
    source: OPENAI,
    short: { input: 4, cached: 0.4, cacheWrite: 5, output: 20 },
    long: { from: OPENAI_LONG, input: 8, cached: 0.8, cacheWrite: 10, output: 30 },
  },
  "codex:gpt-5.6-terra": {
    source: OPENAI,
    short: { input: 2, cached: 0.2, cacheWrite: 2.5, output: 12 },
    long: { from: OPENAI_LONG, input: 4, cached: 0.4, cacheWrite: 5, output: 18 },
  },
  "codex:gpt-5.6-luna": {
    source: OPENAI,
    short: { input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
    long: { from: OPENAI_LONG, input: 0.4, cached: 0.04, cacheWrite: 0.5, output: 1.8 },
  },
  "codex:gpt-5.5": {
    source: OPENAI,
    short: { input: 5, cached: 0.5, cacheWrite: 5, output: 30 },
    long: { from: OPENAI_LONG, input: 10, cached: 1, cacheWrite: 10, output: 45 },
  },
  "grok:grok-4.6": {
    source: GROK,
    short: { input: 2, cached: 0.5, output: 6 },
    long: { from: GROK_LONG, input: 4, cached: 1, output: 12 },
  },
  "grok:grok-build-0.1": {
    source: GROK,
    short: { input: 1, cached: 0.2, output: 2 },
    long: { from: GROK_LONG, input: 2, cached: 0.4, output: 4 },
  },
  "claude:claude-fable-5-1": claude(10, 0.25, 50),
  "claude:claude-fable-5": claude(10, 1, 50),
  "claude:claude-opus-5-5": claude(4, 0.2, 20),
  "claude:claude-opus-5": claude(5, 0.5, 25),
  "claude:claude-opus-4-8": claude(5, 0.5, 25),
  "claude:claude-opus-4-7": claude(5, 0.5, 25),
  "claude:claude-opus-4-6": claude(5, 0.5, 25),
  "claude:claude-sonnet-5-5": claude(2, 0.1, 10),
  "claude:claude-sonnet-5": claude(2, 0.2, 10),
  "claude:claude-sonnet-4-6": claude(3, 0.3, 15),
  "claude:claude-haiku-5-5": {
    source: CLAUDE,
    short: { input: 0.1, cached: 0.01, cacheWrite: 0.2, output: 0.5 },
    long: { from: HAIKU_5_5_LONG, input: 0.5, cached: 0.05, cacheWrite: 1, output: 2.5 },
  },
  "claude:claude-haiku-4-5": claude(1, 0.1, 5),
  "antigravity:gemini-4-argon": {
    source: GEMINI,
    verified: ANTIGRAVITY_VERIFIED,
    short: { input: 2, cached: 0.1, output: 10 },
    change: { on: "2026-12-01", short: { input: 4, cached: 0.2, output: 20 } },
  },
  "antigravity:gemini-3.8-flash": {
    source: GEMINI,
    verified: ANTIGRAVITY_VERIFIED,
    short: { input: 0.75, cached: 0.075, output: 3.75 },
    change: { on: "2027-01-01", short: { input: 1.5, cached: 0.15, output: 7.5 } },
  },
  "antigravity:claude-opus-5-5": antigravityClaude(4, 0.2, 20),
  "antigravity:claude-sonnet-5-5": antigravityClaude(2, 0.1, 10),
};

function priceOf(provider: string, model: string): Price | undefined {
  // Claude Code names the 1M context window `[1m]`. It is priced at the model's standard rates.
  return PRICES[`${provider}:${provider === "claude" ? model.replace(/\[1m\]$/, "") : model}`];
}

/** The standard input rate per million tokens, or null for a model with no known price. */
export function inputPrice(provider: string, model: string): number | null {
  return priceOf(provider, model)?.short.input ?? null;
}

/**
 * Prices the tokens of one update. `lastRequestInputTokens` is the prompt of the last request in it,
 * when the provider reports one. An update under the long-context threshold cannot hold a request
 * over it. An update over it is one known request only when its input equals that last prompt;
 * otherwise it can mix short and long requests and stays unpriced. `smallestRequestInputTokens` is the
 * smallest prompt of all the update's requests, when the provider reports each request: at or over
 * the threshold, every request in the update is long. `occurredAt` (ISO) picks the rates of a dated change.
 */
export function estimateUsageCost(
  provider: string,
  model: string,
  tokens: UsageTokens,
  lastRequestInputTokens: number | null,
  smallestRequestInputTokens: number | null = null,
  occurredAt: string = new Date().toISOString(),
): { cost: number | null; basis: string | null } {
  const price = priceOf(provider, model);
  if (
    !price ||
    tokens.uncachedInput === null ||
    tokens.cachedInput === null ||
    tokens.cacheCreation === null ||
    tokens.output === null
  )
    return { cost: null, basis: null };
  const input = tokens.uncachedInput + tokens.cachedInput + tokens.cacheCreation;
  const long = price.long;
  const context =
    !long || input < long.from
      ? "short"
      : input === lastRequestInputTokens ||
          (smallestRequestInputTokens !== null && smallestRequestInputTokens >= long.from)
        ? "long"
        : null;
  const changed = price.change && occurredAt >= price.change.on ? price.change : null;
  const rates = context === "short" ? (changed?.short ?? price.short) : context === "long" ? long : null;
  if (!rates || (tokens.cacheCreation !== 0 && rates.cacheWrite === undefined)) return { cost: null, basis: null };
  return {
    cost:
      (tokens.uncachedInput * rates.input +
        tokens.cachedInput * rates.cached +
        tokens.cacheCreation * (rates.cacheWrite ?? 0) +
        tokens.output * rates.output) /
      1_000_000,
    basis: JSON.stringify({
      effectiveDate: changed?.on ?? price.verified ?? EFFECTIVE_DATE,
      model,
      context,
      input: rates.input,
      cached: rates.cached,
      ...(rates.cacheWrite === undefined ? {} : { cacheWrite: rates.cacheWrite }),
      output: rates.output,
      source: price.source,
    }),
  };
}
