// The Gemini plan quota, read from Google's Code Assist service with the Antigravity CLI's token.
//
// Antigravity 1.5 has no `/usage` command. Its own quota page reads `retrieveUserQuotaSummary`, which
// gives each quota group with its buckets:
//
//   { "groups": [{ "displayName": "Claude and GPT models",
//                  "description": "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
//                  "buckets": [{ "displayName": "Weekly Limit Remaining", "window": "weekly",
//                                "resetTime": "2026-11-17T11:59:31Z", "remainingFraction": 1 }] }] }
//
// The call needs the account's Code Assist project, from `loadCodeAssist`, and Google refuses it
// (403) unless the User-Agent names Antigravity. OpenBot reads the access token from the CLI's token
// file and never refreshes it: the CLI refreshes it while it runs. A token that has expired, an API key
// sign-in, or a failed call gives no reading, and the usage popover then shows no Gemini usage.
//
// Google names the groups and can give a model a group of its own, such as Gemini 4 Argon on some
// plans (#3055). The reading carries every group, so the usage popover shows each one.

import { readFile } from "node:fs/promises";
import { usageGroupForModel } from "@openbot/contracts/ipc";
import { Effect, Option, Schema } from "effect";
import type {
  AccountRateLimitGroupResult,
  AccountRateLimitsReadResult,
  AccountRateLimitWindowResult,
} from "./protocol";

/** Google's Code Assist service, which the Antigravity CLI calls. */
const CODE_ASSIST_URL = "https://cloudcode-pa.googleapis.com/v1internal";

/**
 * A local fake of the service, for `scripts/antigravity-usage-e2e.ts`. Only a loopback `http` URL is
 * taken, because the access token goes to it.
 */
const DEV_CODE_ASSIST_URL = "OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL";

/** How long each quota call may take before the reading gives up. */
const QUOTA_CALL_TIMEOUT_MS = 10_000;

const FIVE_HOUR_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10_080;

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

const GROUP_MODELS = /^Models within this group:\s*(.+?)\.?$/iu;

/** The CLI's token file. Only a token that the CLI saved in a file can be read. */
const TokenFile = Schema.Struct({
  token: Schema.Struct({ access_token: Schema.String, expiry: Schema.optional(Schema.String) }),
});

const LoadCodeAssistAnswer = Schema.Struct({ cloudaicompanionProject: Schema.optional(Schema.String) });

const QuotaBucket = Schema.Struct({
  window: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  resetTime: Schema.optional(Schema.String),
  remainingFraction: Schema.optional(Schema.Number),
});

/** The `retrieveUserQuotaSummary` answer. Fields that OpenBot does not read are left out. */
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

/**
 * The plan usage of the Antigravity account whose token file is `tokenFile`, for `model`. Every
 * failure gives no reading. `version` is the CLI's version, which the User-Agent names.
 */
export const readAntigravityQuota = Effect.fn("AntigravityUsage.read")(function* (options: {
  tokenFile: string;
  version: string;
  model: string | null;
}) {
  const accessToken = yield* Effect.tryPromise(() => readFile(options.tokenFile, "utf8")).pipe(
    Effect.map(validAccessToken),
    Effect.orElseSucceed(() => null),
  );
  if (!accessToken) return NO_USAGE;
  const endpoint = codeAssistUrl(process.env[DEV_CODE_ASSIST_URL]);
  const call = <S extends Schema.Top>(method: string, body: { project?: string }, answer: S) =>
    Effect.tryPromise(async (signal) => {
      const response = await fetch(`${endpoint}:${method}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "User-Agent": antigravityUserAgent(options.version),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(QUOTA_CALL_TIMEOUT_MS)]),
      });
      if (!response.ok) throw new Error(`Code Assist answered ${response.status}.`);
      return await response.text();
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(answer))));
  return yield* call("loadCodeAssist", {}, LoadCodeAssistAnswer).pipe(
    Effect.flatMap(({ cloudaicompanionProject: project }) =>
      project ? call("retrieveUserQuotaSummary", { project }, AntigravityQuotaSummary) : Effect.succeed({}),
    ),
    Effect.map((summary) => antigravityRateLimits(summary, options.model)),
    Effect.orElseSucceed(() => NO_USAGE),
  );
});

function codeAssistUrl(override: string | undefined): string {
  const url = override && URL.canParse(override) ? new URL(override) : null;
  const local = url?.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  return local && override ? override.replace(/\/+$/u, "") : CODE_ASSIST_URL;
}

/**
 * The access token of the CLI's token file, or `null` when the file has none or it has expired: the
 * CLI refreshes it at its next call, and OpenBot does not keep the CLI's client secret.
 */
function validAccessToken(text: string): string | null {
  const token = Option.getOrNull(decodeTokenFile(text))?.token;
  const expiry = token?.expiry ? Date.parse(token.expiry) : Number.NaN;
  return token?.access_token && expiry > Date.now() + 60_000 ? token.access_token : null;
}

/** The CLI's own User-Agent, such as `antigravity/1.5.4 darwin/arm64`, in Go's platform names. */
function antigravityUserAgent(version: string): string {
  const os = process.platform === "win32" ? "windows" : process.platform;
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  return `antigravity/${version} ${os}/${arch}`;
}

/**
 * The windows of the group that limits `model` in a `retrieveUserQuotaSummary` answer. A five-hour
 * bucket is the first window and a weekly one the second, as for Codex. Without a model, the dock's
 * reading, it is the "Gemini Models" group. Some plans have no Gemini group, only "Claude and GPT
 * models": the dock then shows the group with the least room left, which the usage popover names, so
 * that the account still shows its plan. A model that no group lists has no reading: another group's
 * room does not say that it can run. When Google lists no models at all, the Gemini group covers
 * every model. `groups` holds every group that has a window.
 */
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

/** The group whose most used window has the least room left. */
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
      if (bucket.remainingFraction === undefined) continue;
      const label = `${bucket.window ?? ""} ${bucket.displayName ?? ""}`;
      const resetsAt = bucket.resetTime ? Date.parse(bucket.resetTime) : Number.NaN;
      const window: UsageWindow = {
        usedPercent: Math.max(0, Math.min(100, 100 - bucket.remainingFraction * 100)),
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
  return groups;
}

/** "Gemini Models" by name, else the first group whose name starts with Gemini. */
function geminiGroup(groups: readonly QuotaGroup[]): QuotaGroup | undefined {
  return (
    groups.find((group) => /^gemini models$/iu.test(group.name.trim())) ??
    groups.find((group) => /^gemini\b/iu.test(group.name))
  );
}

function bindingWindow(current: UsageWindow | null, next: UsageWindow): UsageWindow {
  return current && current.usedPercent >= next.usedPercent ? current : next;
}
