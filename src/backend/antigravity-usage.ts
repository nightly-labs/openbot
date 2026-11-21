import { readFile } from "node:fs/promises";
import { usageGroupForModel } from "@openbot/contracts/ipc";
import { Effect, Option, Schema } from "effect";
import type {
  AccountRateLimitGroupResult,
  AccountRateLimitsReadResult,
  AccountRateLimitWindowResult,
} from "./protocol";

const CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal";

const DAILY_CODE_ASSIST_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal";

const DESKTOP_VERSION = "2.24.0";
const DESKTOP_BUILD = "963137146";

const DEV_CODE_ASSIST_URL = "OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL";

const QUOTA_CALL_TIMEOUT_MS = 10_000;

const FIVE_HOUR_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10_080;

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

const GROUP_MODELS = /^Models within this group:\s*(.+?)\.?$/iu;

const TokenFile = Schema.Struct({
  token: Schema.Struct({ access_token: Schema.String, expiry: Schema.optional(Schema.String) }),
});

const TokenFileEmail = Schema.Struct({ id_token_email: Schema.optional(Schema.String) });

const decodeTokenFileEmail = Schema.decodeUnknownOption(Schema.fromJsonString(TokenFileEmail));

const LoadCodeAssistAnswer = Schema.Struct({ cloudaicompanionProject: Schema.optional(Schema.String) });

const IneligibleTiersAnswer = Schema.Struct({
  ineligibleTiers: Schema.optional(
    Schema.Array(
      Schema.Struct({ reasonCode: Schema.optional(Schema.String), validationUrl: Schema.optional(Schema.String) }),
    ),
  ),
});

const VALIDATION_REQUIRED = "VALIDATION_REQUIRED";

const QuotaBucket = Schema.Struct({
  window: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  resetTime: Schema.optional(Schema.String),
  remainingFraction: Schema.optional(Schema.Number),
  remainingAmount: Schema.optional(Schema.Union([Schema.String, Schema.Number])),
  disabled: Schema.optional(Schema.Boolean),
});
type QuotaBucket = typeof QuotaBucket.Type;

const AntigravityQuotaSummary = Schema.Struct({
  groups: Schema.optional(
    Schema.Array(
      Schema.Struct({
        displayName: Schema.optional(Schema.String),
        description: Schema.optional(Schema.String),
        buckets: Schema.optional(Schema.Array(QuotaBucket)),
      }),
    ),
  ),
});
type AntigravityQuotaSummary = typeof AntigravityQuotaSummary.Type;

const decodeTokenFile = Schema.decodeUnknownOption(Schema.fromJsonString(TokenFile));

type UsageWindow = AccountRateLimitWindowResult & { usedPercent: number };

type QuotaGroup = AccountRateLimitGroupResult & { primary: UsageWindow | null; secondary: UsageWindow | null };

type FetchFunction = (url: string, init: RequestInit) => Promise<Response>;

const codeAssistCall = Effect.fn("AntigravityUsage.codeAssistCall")(function* (options: {
  tokenFile: string;
  fetch?: FetchFunction | undefined;
}) {
  const send = options.fetch ?? fetch;
  const accessToken = yield* Effect.tryPromise(() => readFile(options.tokenFile, "utf8")).pipe(
    Effect.map(validAccessToken),
    Effect.orElseSucceed(() => null),
  );
  if (!accessToken) return null;
  const testEndpoint = localTestUrl(process.env[DEV_CODE_ASSIST_URL]);
  return <S extends Schema.Top>(endpoint: string, method: string, body: { project?: string }, answer: S) =>
    Effect.tryPromise(async (signal) => {
      const response = await send(`${testEndpoint ?? endpoint}:${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": antigravityUserAgent(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(QUOTA_CALL_TIMEOUT_MS)]),
      });
      if (!response.ok) throw new Error(`Code Assist answered ${response.status}.`);
      return await response.text();
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(answer))));
});

export const readAntigravityQuota = Effect.fn("AntigravityUsage.read")(function* (options: {
  tokenFile: string;
  model: string | null;
  fetch?: FetchFunction;
}) {
  const call = yield* codeAssistCall(options);
  if (!call) return NO_USAGE;
  return yield* call(CODE_ASSIST_URL, "loadCodeAssist", {}, LoadCodeAssistAnswer).pipe(
    Effect.flatMap(({ cloudaicompanionProject: project }) =>
      project
        ? call(DAILY_CODE_ASSIST_URL, "retrieveUserQuotaSummary", { project }, AntigravityQuotaSummary)
        : Effect.succeed({}),
    ),
    Effect.map((summary) => antigravityRateLimits(summary, options.model)),
    Effect.orElseSucceed(() => NO_USAGE),
  );
});

export const readAntigravityValidationLink = Effect.fn("AntigravityUsage.readValidationLink")(function* (options: {
  tokenFile: string;
  fetch?: FetchFunction | undefined;
}) {
  const call = yield* codeAssistCall(options);
  if (!call) return null;
  return yield* call(CODE_ASSIST_URL, "loadCodeAssist", {}, IneligibleTiersAnswer).pipe(
    Effect.map(
      ({ ineligibleTiers }) =>
        ineligibleTiers
          ?.filter((tier) => tier.reasonCode === VALIDATION_REQUIRED)
          .map((tier) => tier.validationUrl)
          .find(isGoogleAccountLink) ?? null,
    ),
    Effect.orElseSucceed(() => null),
  );
});

function isGoogleAccountLink(link: string | undefined): link is string {
  if (!link || !URL.canParse(link)) return false;
  const url = new URL(link);
  return url.protocol === "https:" && url.hostname === "accounts.google.com";
}

export const readAntigravityEmail = Effect.fn("AntigravityUsage.readEmail")(function* (tokenFile: string) {
  return yield* Effect.tryPromise(() => readFile(tokenFile, "utf8")).pipe(
    Effect.map((text) => Option.getOrNull(decodeTokenFileEmail(text))?.id_token_email?.trim() || null),
    Effect.orElseSucceed(() => null),
  );
});

function localTestUrl(override: string | undefined): string | null {
  const url = override && URL.canParse(override) ? new URL(override) : null;
  const local = url?.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  return local && override ? override.replace(/\/+$/u, "") : null;
}

function validAccessToken(text: string): string | null {
  const token = Option.getOrNull(decodeTokenFile(text))?.token;
  const expiry = token?.expiry ? Date.parse(token.expiry) : Number.NaN;
  return token?.access_token && expiry > Date.now() + 60_000 ? token.access_token : null;
}

function antigravityUserAgent(): string {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  return `antigravity/hub/${DESKTOP_VERSION} (aidev_client; os_type=${os}; arch=${arch}; cl=${DESKTOP_BUILD})`;
}

function antigravityRateLimits(
  summary: AntigravityQuotaSummary,
  model: string | null = null,
): AccountRateLimitsReadResult {
  const groups = quotaGroups(summary).filter((group) => group.primary || group.secondary);
  const listed = groups.some((group) => group.models.length > 0);
  const group =
    model && listed
      ? usageGroupForModel(groups, model)
      : (geminiGroup(groups) ?? (model ? undefined : leastRoom(groups)));
  if (!group) return NO_USAGE;
  return {
    rateLimits: { limitId: "antigravity", primary: group.primary, secondary: group.secondary },
    rateLimitsByLimitId: null,
    groups,
  };
}

function leastRoom(groups: readonly QuotaGroup[]): QuotaGroup | undefined {
  const used = (group: QuotaGroup) => Math.max(group.primary?.usedPercent ?? 0, group.secondary?.usedPercent ?? 0);
  return groups.reduce<QuotaGroup | undefined>(
    (most, group) => (most && used(most) >= used(group) ? most : group),
    undefined,
  );
}

function quotaGroups(summary: AntigravityQuotaSummary): QuotaGroup[] {
  const groups: QuotaGroup[] = [];
  for (const entry of summary.groups ?? []) {
    const name = entry.displayName?.trim();
    if (!name) continue;
    const listed = entry.description ? GROUP_MODELS.exec(entry.description.trim())?.[1] : undefined;
    const group: QuotaGroup = {
      name,
      models: (listed ?? "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean),
      primary: null,
      secondary: null,
    };
    for (const bucket of entry.buckets ?? []) {
      const remainingFraction = bucket.remainingFraction ?? omittedFraction(bucket);
      if (remainingFraction === undefined) continue;
      const label = `${bucket.window ?? ""} ${bucket.displayName ?? ""}`;
      const resetsAt = bucket.resetTime ? Date.parse(bucket.resetTime) : Number.NaN;
      const window: UsageWindow = {
        usedPercent: Math.max(0, Math.min(100, 100 - remainingFraction * 100)),
        windowDurationMins: /week/iu.test(label)
          ? WEEKLY_WINDOW_MINS
          : /\b5\s*-?\s*h|five.?hour/iu.test(label)
            ? FIVE_HOUR_WINDOW_MINS
            : null,
        resetsAt: Number.isFinite(resetsAt) ? resetsAt / 1_000 : null,
      };
      if (window.windowDurationMins === FIVE_HOUR_WINDOW_MINS) group.primary = bindingWindow(group.primary, window);
      else group.secondary = bindingWindow(group.secondary, window);
    }
    groups.push(group);
  }
  if (!groups.some((group) => group.models.length > 0)) return groups;
  return groups.map((group) => (group.models.length > 0 ? group : { ...group, models: [group.name] }));
}

function omittedFraction(bucket: QuotaBucket): number | undefined {
  const resets = bucket.resetTime !== undefined && Number.isFinite(Date.parse(bucket.resetTime));
  return resets && bucket.remainingAmount === undefined && bucket.disabled !== true ? 0 : undefined;
}

function geminiGroup(groups: readonly QuotaGroup[]): QuotaGroup | undefined {
  return (
    groups.find((group) => /^gemini models$/iu.test(group.name.trim())) ??
    groups.find((group) => /^gemini\b/iu.test(group.name))
  );
}

function bindingWindow(current: UsageWindow | null, next: UsageWindow): UsageWindow {
  return current && current.usedPercent >= next.usedPercent ? current : next;
}
