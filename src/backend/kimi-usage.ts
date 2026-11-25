import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { kimiCodeHomeDirectory, kimiHomeDirectory } from "./process-confinement";
import {
  type AccountRateLimitsReadResult,
  type AccountRateLimitWindowResult,
  bindingWindow,
  getArray,
  getRecord,
} from "./protocol";

const KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1";
const KIMI_USAGE_TIMEOUT_MS = 10_000;
const ROLLING_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10_080;
const MONTHLY_WINDOW_MINS = 43_200;

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

class KimiUsageFailed extends Schema.TaggedError<KimiUsageFailed>()("KimiUsageFailed", {
  cause: Schema.Defect(),
}) {}

const MANAGED_PROVIDER_HEADER = /^\[\s*providers\.(?:"managed:kimi-code"|'managed:kimi-code')\s*\]\s*(?:#.*)?$/u;
const MANAGED_OAUTH_HEADER = /^\[\s*providers\.(?:"managed:kimi-code"|'managed:kimi-code')\.oauth\s*\]\s*(?:#.*)?$/u;
const quoted = (name: string) => new RegExp(`^${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "u");
const BASE_URL_LINE = quoted("base_url");
const KEY_LINE = quoted("key");
const INLINE_OAUTH_KEY = /^oauth\s*=\s*\{.*\bkey\s*=\s*(?:"([^"]*)"|'([^']*)')/u;

function managedProvider(config: string): { baseUrl: string | null; key: string | null } {
  let section: "provider" | "oauth" | null = null;
  let baseUrl: string | null = null;
  let key: string | null = null;
  for (const raw of config.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      section = MANAGED_PROVIDER_HEADER.test(line) ? "provider" : MANAGED_OAUTH_HEADER.test(line) ? "oauth" : null;
      continue;
    }
    const value = (match: RegExpMatchArray | null) => (match ? (match[1] ?? match[2] ?? null) : null);
    if (section === "provider") {
      baseUrl ??= value(line.match(BASE_URL_LINE));
      key ??= value(line.match(INLINE_OAUTH_KEY));
    } else if (section === "oauth") {
      key ??= value(line.match(KEY_LINE));
    }
  }
  return { baseUrl, key };
}

function credentialName(key: string): string | null {
  const name = key.startsWith("oauth/") ? key.slice("oauth/".length) : key;
  return name && !/[/\\]/u.test(name) && !name.startsWith(".") ? name : null;
}

function apiUrl(baseUrl: string): string | null {
  if (!URL.canParse(baseUrl)) return null;
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

const KimiToken = Schema.Struct({
  access_token: Schema.NonEmptyString,
  refresh_token: Schema.optional(Schema.NullOr(Schema.String)),
  expires_at: Schema.optional(Schema.Finite),
});

const readText = (path: string) =>
  Effect.tryPromise({ try: () => readFile(path, "utf8"), catch: (cause) => new KimiUsageFailed({ cause }) }).pipe(
    Effect.option,
  );

export interface KimiSavedSignIn {
  readonly managed: boolean;
  readonly path: string;
  readonly apiUrl: string;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: number | null;
}

export const readKimiSavedSignIn = Effect.fn("Kimi.readSavedSignIn")(function* (
  python: boolean,
  env: NodeJS.ProcessEnv,
) {
  const home = python ? kimiHomeDirectory(env) : kimiCodeHomeDirectory(env);
  const config = yield* readText(join(home, "config.toml"));
  if (Option.isNone(config)) return Option.none<KimiSavedSignIn>();
  const provider = managedProvider(config.value);
  const name = credentialName(provider.key ?? "oauth/kimi-code");
  const url = apiUrl(env.KIMI_CODE_BASE_URL?.trim() || provider.baseUrl || KIMI_CODE_BASE_URL);
  if (!name || !url) return Option.none<KimiSavedSignIn>();
  const path = join(home, "credentials", `${name}.json`);
  const text = yield* readText(path);
  if (Option.isNone(text)) return Option.none<KimiSavedSignIn>();
  const token = Schema.decodeUnknownOption(Schema.fromJsonString(KimiToken))(text.value);
  if (Option.isNone(token)) return Option.none<KimiSavedSignIn>();
  return Option.some<KimiSavedSignIn>({
    managed: provider.key !== null,
    path,
    apiUrl: url,
    accessToken: token.value.access_token,
    refreshToken: token.value.refresh_token || null,
    expiresAt: token.value.expires_at ?? null,
  });
});

export const readKimiUsage = Effect.fn("Kimi.readUsage")(function* (python: boolean, env: NodeJS.ProcessEnv) {
  const signIn = yield* readKimiSavedSignIn(python, env);
  if (Option.isNone(signIn)) return NO_USAGE;
  if (signIn.value.expiresAt !== null && signIn.value.expiresAt * 1_000 <= Date.now())
    return yield* new KimiUsageFailed({ cause: new Error("The Kimi sign-in token has expired.") });
  const usage = yield* getUsages(`${signIn.value.apiUrl}/usages`, signIn.value.accessToken);
  return usage === null ? NO_USAGE : kimiRateLimits(usage);
});

const getUsages = Effect.fn("Kimi.getUsages")(function* (url: string, accessToken: string) {
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(url, {
              headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
              redirect: "error",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(KIMI_USAGE_TIMEOUT_MS)]),
            }),
          catch: (cause) => new KimiUsageFailed({ cause }),
        });
        if (response.status === 401 || response.status === 403 || response.status === 404) return null;
        if (!response.ok)
          return yield* new KimiUsageFailed({ cause: new Error(`Kimi usage returned HTTP ${response.status}.`) });
        return yield* Effect.tryPromise({
          try: (): Promise<unknown> => response.json(),
          catch: (cause) => new KimiUsageFailed({ cause }),
        });
      }),
    (controller) => Effect.sync(() => controller.abort()),
  );
});

const Count = Schema.Union([Schema.Finite, Schema.FiniteFromString]);
const QuotaDetail = Schema.Struct({
  limit: Schema.optional(Count),
  used: Schema.optional(Count),
  remaining: Schema.optional(Count),
  resetTime: Schema.optional(Schema.String),
});
const QuotaWindow = Schema.Struct({ duration: Count, timeUnit: Schema.String });
const QuotaRatio = Schema.Struct({ used_ratio: Count, reset_time: Schema.optional(Schema.String) });

const TIME_UNIT_MINS: Readonly<Record<string, number>> = {
  TIME_UNIT_MINUTE: 1,
  TIME_UNIT_HOUR: 60,
  TIME_UNIT_DAY: 1_440,
};

function resetsAt(value: string | undefined): number | null {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time / 1_000 : null;
}

function percent(used: number): number {
  return Math.max(0, Math.min(100, used));
}

type KimiWindow = AccountRateLimitWindowResult & { usedPercent: number };

function detailWindow(value: unknown, windowDurationMins: number | null): KimiWindow | null {
  const detail = Schema.decodeUnknownOption(QuotaDetail)(value);
  if (Option.isNone(detail)) return null;
  const { limit, used, remaining, resetTime } = detail.value;
  const spent = used ?? (limit !== undefined && remaining !== undefined ? limit - remaining : undefined);
  if (!limit || limit <= 0 || spent === undefined) return null;
  return { usedPercent: percent((spent / limit) * 100), windowDurationMins, resetsAt: resetsAt(resetTime) };
}

function ratioWindow(value: unknown, windowDurationMins: number): KimiWindow | null {
  const ratio = Schema.decodeUnknownOption(QuotaRatio)(value);
  if (Option.isNone(ratio)) return null;
  return {
    usedPercent: percent(ratio.value.used_ratio * 100),
    windowDurationMins,
    resetsAt: resetsAt(ratio.value.reset_time),
  };
}

function rollingWindow(value: unknown[]): AccountRateLimitWindowResult | null {
  let shortest: AccountRateLimitWindowResult | null = null;
  for (const item of value) {
    const window = Schema.decodeUnknownOption(QuotaWindow)(getRecord(item, "window") ?? {});
    const unit = Option.isSome(window) ? TIME_UNIT_MINS[window.value.timeUnit] : undefined;
    const mins = Option.isSome(window) && unit ? window.value.duration * unit : null;
    const reading = detailWindow(getRecord(item, "detail") ?? item, mins);
    if (reading && (!shortest || (mins ?? Infinity) < (shortest.windowDurationMins ?? Infinity))) shortest = reading;
  }
  return shortest;
}

function kimiRateLimits(value: unknown): AccountRateLimitsReadResult {
  const usages = getRecord(value, "usages");
  const primary =
    rollingWindow(getArray(value, "limits")) ?? ratioWindow(getRecord(usages, "limit_5h"), ROLLING_WINDOW_MINS);
  const weekly =
    detailWindow(getRecord(value, "usage"), WEEKLY_WINDOW_MINS) ??
    ratioWindow(getRecord(usages, "limit_7d"), WEEKLY_WINDOW_MINS);
  const monthly = ratioWindow(getRecord(usages, "limit_month_total"), MONTHLY_WINDOW_MINS);
  const secondary = weekly && monthly ? bindingWindow(weekly, monthly) : (weekly ?? monthly);
  if (!primary && !secondary) return NO_USAGE;
  const tertiary = weekly && monthly ? (secondary === weekly ? monthly : weekly) : undefined;
  return {
    rateLimits: { limitId: "kimi", primary, secondary },
    ...(tertiary ? { tertiary } : {}),
    rateLimitsByLimitId: null,
  };
}
