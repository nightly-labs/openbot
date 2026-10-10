import { Effect, Schema } from "effect";

const ECB_HISTORICAL_RATES_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";
const ECB_TIMEOUT_MS = 10_000;
// The ECB historical document is currently about 8 MiB and grows over time. Keep a bounded
// margin for it without accepting an unbounded response.
const ECB_MAX_BYTES = 16 * 1024 * 1024;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export type BillingUsdCurrency = "eur" | "usd" | "pln";

export type BillingUsdResult = {
  /** The converted amount in whole US cents. */
  amountUsd: number;
  /** The ECB reference-rate date used for the conversion. */
  fxDate: string;
  /** USD per unit of the input currency. */
  fxRate: number;
};

/** A safe conversion failure. It never contains a database, network, or document payload. */
export class BillingUsdError extends Schema.TaggedError<BillingUsdError>()("BillingUsdError", {
  reason: Schema.Literals([
    "invalid_input",
    "database",
    "network",
    "response",
    "document",
    "missing_rate",
    "invalid_rate",
  ]),
}) {}

type HistoricalRate = {
  usd: number;
  pln: number;
};

type CachedRate = {
  day: unknown;
  source_day: unknown;
  usd_rate: unknown;
};

/**
 * Converts Stripe's EUR and PLN amounts to USD cents using dated ECB reference rates.
 *
 * The timestamp is a Unix timestamp in seconds, as used by Stripe events. Millisecond Unix
 * timestamps are accepted too because this service is also used by the history importer.
 */
export class BillingUsd {
  readonly #database: D1Database;
  readonly #fetch: (input: string, init: RequestInit) => Promise<Response>;

  constructor(options: { database: D1Database; fetch: (input: string, init: RequestInit) => Promise<Response> }) {
    this.#database = options.database;
    this.#fetch = options.fetch;
  }

  readonly convert = Effect.fn("BillingUsd.convert")(function* (
    this: BillingUsd,
    amountMinor: number,
    currency: BillingUsdCurrency,
    timestamp: number,
  ): Effect.fn.Return<BillingUsdResult, BillingUsdError> {
    const day = paymentDay(timestamp);
    if (
      day === null ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor < 0 ||
      (currency !== "eur" && currency !== "usd" && currency !== "pln")
    ) {
      return yield* new BillingUsdError({ reason: "invalid_input" });
    }

    if (currency === "usd") {
      return { amountUsd: amountMinor, fxDate: day, fxRate: 1 };
    }

    const cached = yield* this.#cachedRate(currency, day);
    const rate = cached ?? (yield* this.#loadRate(currency, day));
    const amountUsd = Math.round(amountMinor * rate.usdRate);
    if (!Number.isSafeInteger(amountUsd) || amountUsd < 0) {
      return yield* new BillingUsdError({ reason: "invalid_rate" });
    }
    return { amountUsd, fxDate: rate.fxDate, fxRate: rate.usdRate };
  }).bind(this);

  #cachedRate = Effect.fn("BillingUsd.cachedRate")(function* (
    this: BillingUsd,
    currency: Exclude<BillingUsdCurrency, "usd">,
    day: string,
  ): Effect.fn.Return<{ fxDate: string; usdRate: number } | null, BillingUsdError> {
    const row = yield* Effect.tryPromise({
      try: () =>
        this.#database
          .prepare(
            "SELECT day, COALESCE(source_day, day) AS source_day, usd_rate " +
              "FROM billing_fx_rates WHERE currency = ?1 AND day = ?2 LIMIT 1",
          )
          .bind(currency, day)
          .first<CachedRate>(),
      catch: () => new BillingUsdError({ reason: "database" }),
    });
    if (row === null) return null;
    if (!isDateString(row.day) || !isDateString(row.source_day))
      return yield* new BillingUsdError({ reason: "invalid_rate" });
    const usdRate = numberRate(row.usd_rate);
    if (usdRate === null) return yield* new BillingUsdError({ reason: "invalid_rate" });
    return { fxDate: row.source_day, usdRate };
  }).bind(this);

  #loadRate = Effect.fn("BillingUsd.loadRate")(function* (
    this: BillingUsd,
    currency: Exclude<BillingUsdCurrency, "usd">,
    day: string,
  ): Effect.fn.Return<{ fxDate: string; usdRate: number }, BillingUsdError> {
    const response = yield* Effect.tryPromise({
      try: (signal) =>
        this.#fetch(ECB_HISTORICAL_RATES_URL, {
          headers: { accept: "application/xml, text/xml" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(ECB_TIMEOUT_MS)]),
        }),
      catch: () => new BillingUsdError({ reason: "network" }),
    });
    if (!response.ok) return yield* new BillingUsdError({ reason: "response" });

    const document = yield* Effect.tryPromise({
      try: () => readBoundedText(response),
      catch: () => new BillingUsdError({ reason: "document" }),
    });
    const rates = parseHistoricalRates(document);
    if (rates === null) return yield* new BillingUsdError({ reason: "document" });

    const selected = latestRateOnOrBefore(rates, day, currency);
    if (selected === null) return yield* new BillingUsdError({ reason: "missing_rate" });

    const usdRate = currency === "eur" ? selected.rate.usd : selected.rate.usd / selected.rate.pln;
    if (numberRate(usdRate) === null) return yield* new BillingUsdError({ reason: "invalid_rate" });

    yield* Effect.tryPromise({
      try: () =>
        this.#database
          .prepare(
            "INSERT OR IGNORE INTO billing_fx_rates (day, currency, source_day, usd_rate) VALUES (?1, ?2, ?3, ?4)",
          )
          .bind(day, currency, selected.day, usdRate)
          .run(),
      catch: () => new BillingUsdError({ reason: "database" }),
    });
    const cached = yield* this.#cachedRate(currency, day);
    if (cached === null) return yield* new BillingUsdError({ reason: "database" });
    return cached;
  }).bind(this);
}

function paymentDay(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const milliseconds = timestamp >= 100_000_000_000 ? timestamp : timestamp * 1_000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function numberRate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > ECB_MAX_BYTES) throw new Error("document_too_large");
  }

  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > ECB_MAX_BYTES) throw new Error("document_too_large");
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > ECB_MAX_BYTES) throw new Error("document_too_large");
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function latestRateOnOrBefore(
  rates: ReadonlyMap<string, HistoricalRate>,
  day: string,
  currency: Exclude<BillingUsdCurrency, "usd">,
): { day: string; rate: HistoricalRate } | null {
  let selected: { day: string; rate: HistoricalRate } | null = null;
  for (const [candidateDay, rate] of rates) {
    if (candidateDay > day || !rateForCurrency(rate, currency)) continue;
    if (selected === null || candidateDay > selected.day) selected = { day: candidateDay, rate };
  }
  return selected;
}

function rateForCurrency(rate: HistoricalRate, currency: Exclude<BillingUsdCurrency, "usd">): boolean {
  return currency === "eur"
    ? numberRate(rate.usd) !== null
    : numberRate(rate.usd) !== null && numberRate(rate.pln) !== null;
}

/** Parses the ECB Cube hierarchy without relying on attribute order or line wrapping. */
function parseHistoricalRates(document: string): ReadonlyMap<string, HistoricalRate> | null {
  const rates = new Map<string, HistoricalRate>();
  const stack: Array<{ day: string | null }> = [];
  let cursor = 0;
  let sawCube = false;

  while (cursor < document.length) {
    const open = document.indexOf("<", cursor);
    if (open < 0) break;
    const close = document.indexOf(">", open + 1);
    if (close < 0) return null;
    const raw = document.slice(open + 1, close);
    cursor = close + 1;
    if (raw.startsWith("!--")) {
      const commentEnd = document.indexOf("-->", open + 4);
      if (commentEnd < 0) return null;
      cursor = commentEnd + 3;
      continue;
    }
    if (raw.startsWith("?")) continue;
    if (raw.startsWith("/")) {
      if (raw.slice(1).trim() !== "Cube") continue;
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }

    const nameEnd = raw.search(/[\s/]/u);
    const name = (nameEnd < 0 ? raw : raw.slice(0, nameEnd)).trim();
    if (name !== "Cube") continue;
    sawCube = true;
    const selfClosing = /\/\s*$/u.test(raw);
    const attrs = parseAttributes(nameEnd < 0 ? "" : raw.slice(nameEnd));
    if (attrs === null) return null;
    const time = attrs.get("time");
    const currency = attrs.get("currency");
    const rate = attrs.get("rate");
    if (time !== undefined) {
      if (currency !== undefined || rate !== undefined || !isDateString(time)) return null;
      if (!selfClosing) stack.push({ day: time });
      continue;
    }
    if (attrs.size === 0) {
      if (!selfClosing) stack.push({ day: null });
      continue;
    }
    const parent = stack.at(-1)?.day;
    if (parent === undefined || parent === null || currency === undefined || rate === undefined || attrs.size !== 2)
      return null;
    if (currency !== "USD" && currency !== "PLN") {
      if (!selfClosing) stack.push({ day: parent });
      continue;
    }
    const parsedRate = Number(rate);
    if (numberRate(parsedRate) === null) return null;
    const existing = rates.get(parent) ?? { usd: Number.NaN, pln: Number.NaN };
    if (
      (currency === "USD" && Number.isFinite(existing.usd)) ||
      (currency === "PLN" && Number.isFinite(existing.pln))
    ) {
      return null;
    }
    if (currency === "USD") existing.usd = parsedRate;
    else existing.pln = parsedRate;
    rates.set(parent, existing);
    if (!selfClosing) stack.push({ day: parent });
  }
  if (!sawCube || stack.length > 0 || rates.size === 0) return null;
  return rates;
}

function parseAttributes(raw: string): Map<string, string> | null {
  const attributes = new Map<string, string>();
  let cursor = 0;
  while (cursor < raw.length) {
    while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
    if (raw[cursor] === "/") {
      cursor += 1;
      while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
      if (cursor !== raw.length) return null;
      break;
    }
    if (cursor >= raw.length) break;
    const nameStart = cursor;
    while (/[A-Za-z0-9_:.-]/u.test(raw[cursor] ?? "")) cursor += 1;
    if (cursor === nameStart) return null;
    const name = raw.slice(nameStart, cursor);
    while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
    if (raw[cursor] !== "=") return null;
    cursor += 1;
    while (/\s/u.test(raw[cursor] ?? "")) cursor += 1;
    const quote = raw[cursor];
    if (quote !== '"' && quote !== "'") return null;
    cursor += 1;
    const valueStart = cursor;
    while (cursor < raw.length && raw[cursor] !== quote) cursor += 1;
    if (cursor >= raw.length || attributes.has(name)) return null;
    attributes.set(name, raw.slice(valueStart, cursor));
    cursor += 1;
  }
  return attributes;
}
