import type { UsageTokens } from "@openbot/contracts/ipc";

const EFFECTIVE_DATE = "2026-10-21";
const OPENAI = "https://developers.openai.com/api/docs/pricing";
const CLAUDE = "https://platform.claude.com/docs/en/about-claude/pricing";
const GROK = "https://docs.x.ai/developers/pricing";
const GEMINI = "https://ai.google.dev/gemini-api/docs/pricing";
const DEEPSEEK = "https://api-docs.deepseek.com/quick_start/pricing";
interface Rates {
  input: number;
  cached: number;
  cacheWrite?: number;
  output: number;
}
interface PeakHours {
  utcWeekdays: readonly number[];
  utcHours: readonly (readonly [from: number, to: number])[];
  offPeakShare: number;
}
interface Price {
  source: string;
  verified?: string;
  short: Rates;
  long?: Rates & { from: number };
  change?: { on: string; short: Rates };
  peak?: PeakHours;
}
const OPENAI_LONG = 272_001;
const GROK_LONG = 200_000;
const HAIKU_5_5_LONG = 100_001;
const claude = (input: number, cached: number, output: number): Price => ({
  source: CLAUDE,
  short: { input, cached, cacheWrite: input * 2, output },
});
const ANTIGRAVITY_VERIFIED = "2026-10-28";
const antigravityClaude = (input: number, cached: number, output: number): Price => ({
  source: CLAUDE,
  verified: ANTIGRAVITY_VERIFIED,
  short: { input, cached, output },
});
const DEEPSEEK_PEAK: PeakHours = {
  utcWeekdays: [1, 2, 3, 4, 5],
  utcHours: [
    [1, 4],
    [6, 10],
  ],
  offPeakShare: 0.5,
};
const deepseek = (input: number, cached: number, output: number): Price => ({
  source: DEEPSEEK,
  verified: "2026-11-27",
  short: { input, cached, cacheWrite: 0, output },
  peak: DEEPSEEK_PEAK,
});
const DEEPSEEK_FLASH = deepseek(0.3, 0.006, 1.2);
const PRICES: Readonly<Record<string, Price>> = {
  "codex:gpt-6-astra": {
    source: OPENAI,
    short: { input: 10, cached: 1, cacheWrite: 12.5, output: 50 },
    long: { from: OPENAI_LONG, input: 20, cached: 2, cacheWrite: 25, output: 75 },
  },
  "codex:gpt-6.2-astra": {
    source: OPENAI,
    verified: "2026-11-17",
    short: { input: 8, cached: 0.4, cacheWrite: 10, output: 40 },
    long: { from: OPENAI_LONG, input: 16, cached: 0.8, cacheWrite: 20, output: 60 },
  },
  "codex:gpt-6.2-sol": {
    source: OPENAI,
    verified: "2026-11-17",
    short: { input: 2, cached: 0.1, cacheWrite: 2.5, output: 10 },
    long: { from: OPENAI_LONG, input: 4, cached: 0.2, cacheWrite: 5, output: 15 },
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
  "antigravity:gemini-4-carbon": {
    source: GEMINI,
    verified: "2026-11-27",
    short: { input: 2, cached: 0.1, output: 10 },
    change: { on: "2026-12-01", short: { input: 4, cached: 0.2, output: 20 } },
  },
  "antigravity:gemini-4-hydrogen": {
    source: GEMINI,
    verified: "2026-11-18",
    short: { input: 1.5, cached: 0.075, output: 7.5 },
  },
  "antigravity:gemini-4-neon": {
    source: GEMINI,
    verified: "2026-11-22",
    short: { input: 3, cached: 0.15, output: 15 },
  },
  "antigravity:gemini-3.8-flash": {
    source: GEMINI,
    verified: ANTIGRAVITY_VERIFIED,
    short: { input: 0.75, cached: 0.075, output: 3.75 },
    change: { on: "2027-01-01", short: { input: 1.5, cached: 0.15, output: 7.5 } },
  },
  "antigravity:claude-opus-5-5": antigravityClaude(4, 0.2, 20),
  "antigravity:claude-sonnet-5-5": antigravityClaude(2, 0.1, 10),
  "deepseek:deepseek-flash": DEEPSEEK_FLASH,
  "deepseek:deepseek-v4-flash": DEEPSEEK_FLASH,
  "deepseek:deepseek-v4-flash-vision-exp": DEEPSEEK_FLASH,
  "deepseek:deepseek-v4-pro": deepseek(1.32, 0.044, 3.96),
};

function priceOf(provider: string, model: string): Price | undefined {
  const price = PRICES[`${provider}:${provider === "claude" ? model.replace(/\[1m\]$/, "") : model}`];
  if (price || provider !== "antigravity") return price;
  const effort = /-(minimal|low|medium|high)$/.exec(model);
  return effort ? PRICES[`${provider}:${model.slice(0, effort.index)}`] : undefined;
}

function pricingPeriod(peak: PeakHours, occurredAt: string): "peak" | "off-peak" {
  const at = new Date(occurredAt);
  if (Number.isNaN(at.getTime())) return "peak";
  const hour = at.getUTCHours();
  return peak.utcWeekdays.includes(at.getUTCDay()) && peak.utcHours.some(([from, to]) => hour >= from && hour < to)
    ? "peak"
    : "off-peak";
}

function share(rates: Rates, part: number): Rates {
  return {
    input: rates.input * part,
    cached: rates.cached * part,
    ...(rates.cacheWrite === undefined ? {} : { cacheWrite: rates.cacheWrite * part }),
    output: rates.output * part,
  };
}

export function inputPrice(provider: string, model: string): number | null {
  return priceOf(provider, model)?.short.input ?? null;
}

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
  const listed = context === "short" ? (changed?.short ?? price.short) : context === "long" ? long : null;
  const period = price.peak ? pricingPeriod(price.peak, occurredAt) : null;
  const rates = listed && price.peak && period === "off-peak" ? share(listed, price.peak.offPeakShare) : listed;
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
      ...(period === null ? {} : { period }),
      input: rates.input,
      cached: rates.cached,
      ...(rates.cacheWrite === undefined ? {} : { cacheWrite: rates.cacheWrite }),
      output: rates.output,
      source: price.source,
    }),
  };
}
