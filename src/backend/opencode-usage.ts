// The OpenCode Go quota, read from the endpoint the OpenCode console serves for the Go API key.
//
// OpenCode's ACP process does not report a quota, so this is a direct HTTPS request with the key the
// CLI uses: the key the user pasted into OpenBot, else the CLI's own key. The route is
// `packages/console/app/src/routes/zen/go/v1/usage.ts` in anomalyco/opencode; it answers
// `{ usage: { rolling, weekly, monthly } }`, each with an integer `percent` and an ISO `resetsAt`.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Option, Schema } from "effect";
import { openCodeDataDirectory } from "./process-confinement";
import { type AccountRateLimitsReadResult, type AccountRateLimitWindowResult, getRecord, getString } from "./protocol";

const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

const OPENCODE_GO_USAGE_TIMEOUT_MS = 10_000;
/** The Go plan's rolling window. The response carries the reset time but not the length. */
const ROLLING_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10_080;
const MONTHLY_WINDOW_MINS = 43_200;

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

/**
 * No key, a key the console rejects, and a key with no Go subscription all read as no usage, so the
 * dock hides the row instead of showing an error for the free catalog.
 */
class OpenCodeUsageFailed extends Schema.TaggedError<OpenCodeUsageFailed>()("OpenCodeUsageFailed", {
  cause: Schema.Defect(),
}) {}

const OPENCODE_CONSOLE_URL = "https://opencode.ai/console";
/** OpenCode keeps its database in WAL mode; a read waits this long for a writer, not more. */
const OPENCODE_DB_BUSY_TIMEOUT_MS = 100;

/** An API key in OpenCode's `auth.json` (OpenCode 1.x), the file `OPENCODE_AUTH_CONTENT` replaces. */
const AuthFileKey = Schema.Struct({ type: Schema.Literal("api"), key: Schema.String });
const AuthFile = Schema.Struct({ "opencode-go": Schema.optionalKey(Schema.Unknown) });
/** A key in the `credential` table of OpenCode 2's database. `server` names a self-hosted console. */
const StoredKey = Schema.Struct({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.Struct({ server: Schema.optionalKey(Schema.Unknown) }))),
});

/**
 * The OpenCode Go quota for the key the CLI uses. The CLI sends a saved key over every other key
 * (`opencode-config.ts`), so with one this reads that key only.
 */
export const readOpenCodeGoUsage = Effect.fn("OpenCode.readGoUsage")(function* (apiKey: string | null) {
  const keys = apiKey ? [apiKey] : yield* readOwnKeys();
  for (const key of keys) {
    const usage = yield* readGoUsage(key);
    if (usage) return usage;
  }
  return NO_USAGE;
});

/**
 * The keys of the user's own OpenCode set-up, in the order the CLI uses them: the OpenCode Console
 * connection in OpenCode 2's database, then the Go key. The Go key is the `opencode-go` key in
 * `auth.json`, which OpenCode applies after `OPENCODE_API_KEY`, or that variable when `auth.json` has
 * none. A rejected Console key moves the read to the Go key. `OPENCODE_AUTH_CONTENT` replaces the
 * local sign-in, the Console connection included.
 */
const readOwnKeys = Effect.fn("OpenCode.readOwnKeys")(function* () {
  const env = process.env;
  const dataDirectory = openCodeDataDirectory(env);
  const inlineAuth = env.OPENCODE_AUTH_CONTENT;
  const authText =
    inlineAuth ||
    (yield* Effect.tryPromise({
      try: () => readFile(join(dataDirectory, "auth.json"), "utf8"),
      catch: (cause) => new OpenCodeUsageFailed({ cause }),
    }).pipe(Effect.orElseSucceed(() => "")));
  const goKey = (authFileGoKey(authText) ?? env.OPENCODE_API_KEY)?.trim();
  const databaseFile = env.OPENCODE_DB || "opencode.db";
  const consoleKey =
    inlineAuth || databaseFile === ":memory:" ? undefined : yield* readConsoleKey(resolve(dataDirectory, databaseFile));
  return [...new Set([consoleKey, goKey].filter((key): key is string => Boolean(key)))];
});

function authFileGoKey(text: string): string | undefined {
  const file = Schema.decodeUnknownOption(Schema.fromJsonString(AuthFile))(text);
  if (Option.isNone(file)) return undefined;
  const entry = Schema.decodeUnknownOption(AuthFileKey)(file.value["opencode-go"]);
  return Option.isSome(entry) ? entry.value.key : undefined;
}

/**
 * The active OpenCode Console key, or none. The row is chosen before it is decoded, so an OAuth or
 * self-hosted connection cannot fall through to another stored account. A NULL `active` predates the
 * flag. No database, a locked one, or an older schema gives no key.
 */
const readConsoleKey = Effect.fn("OpenCode.readConsoleKey")(function* (databasePath: string) {
  return yield* Effect.try({
    try: () => {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        database.exec(`PRAGMA busy_timeout = ${OPENCODE_DB_BUSY_TIMEOUT_MS}`);
        const row = database
          .prepare(
            `SELECT value FROM credential
             WHERE integration_id = 'opencode' AND active IS NOT 0
             ORDER BY active DESC, time_created DESC, id DESC LIMIT 1`,
          )
          .get();
        const stored = Schema.decodeUnknownOption(Schema.fromJsonString(StoredKey))(row?.value);
        if (Option.isNone(stored)) return undefined;
        const server = stored.value.metadata?.server;
        if (typeof server === "string") {
          const url = new URL(server);
          if (`${url.origin}${url.pathname.replace(/\/+$/u, "")}` !== OPENCODE_CONSOLE_URL) return undefined;
        }
        return stored.value.key.trim() || undefined;
      } finally {
        database.close();
      }
    },
    catch: (cause) => new OpenCodeUsageFailed({ cause }),
  }).pipe(Effect.orElseSucceed(() => undefined));
});

/** The quota for one key, or null when the console rejects the key. */
const readGoUsage = Effect.fn("OpenCode.readGoUsageWithKey")(function* (apiKey: string) {
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(OPENCODE_GO_USAGE_URL, {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(OPENCODE_GO_USAGE_TIMEOUT_MS)]),
            }),
          catch: (cause) => new OpenCodeUsageFailed({ cause }),
        });
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok)
          return yield* new OpenCodeUsageFailed({
            cause: new Error(`OpenCode Go usage returned HTTP ${response.status}.`),
          });
        const body = yield* Effect.tryPromise({
          try: (): Promise<unknown> => response.json(),
          catch: (cause) => new OpenCodeUsageFailed({ cause }),
        });
        return openCodeGoRateLimits(body);
      }),
    (controller) => Effect.sync(() => controller.abort()),
  );
});

const UsageWindow = Schema.Struct({ percent: Schema.Finite, resetsAt: Schema.NullOr(Schema.String) });

/**
 * The account usage contract holds two windows, so the monthly and weekly readings share the second
 * one: whichever is closer to its limit, since that is the one that stops a turn first. When both
 * are spent, the one that resets later, since turns stay stopped until then.
 */
function openCodeGoRateLimits(value: unknown): AccountRateLimitsReadResult {
  const usage = getRecord(value, "usage");
  const rolling = usageWindow(getRecord(usage, "rolling"), ROLLING_WINDOW_MINS);
  const weekly = usageWindow(getRecord(usage, "weekly"), WEEKLY_WINDOW_MINS);
  const monthly = usageWindow(getRecord(usage, "monthly"), MONTHLY_WINDOW_MINS);
  const secondary = weekly && monthly ? bindingWindow(weekly, monthly) : (weekly ?? monthly);
  if (!rolling && !secondary) return NO_USAGE;
  return {
    rateLimits: { limitId: "opencode", primary: rolling, secondary },
    rateLimitsByLimitId: null,
  };
}

function bindingWindow<T extends { usedPercent: number; resetsAt?: number | null | undefined }>(
  weekly: T,
  monthly: T,
): T {
  if (weekly.usedPercent >= 100 && monthly.usedPercent >= 100) {
    return (monthly.resetsAt ?? Number.POSITIVE_INFINITY) >= (weekly.resetsAt ?? Number.POSITIVE_INFINITY)
      ? monthly
      : weekly;
  }
  return monthly.usedPercent > weekly.usedPercent ? monthly : weekly;
}

function usageWindow(
  window: DynamicRecord | null,
  windowDurationMins: number,
): (AccountRateLimitWindowResult & { usedPercent: number }) | null {
  if (!window) return null;
  const decoded = Schema.decodeUnknownOption(UsageWindow)({
    percent: window.percent,
    resetsAt: getString(window, "resetsAt"),
  });
  if (Option.isNone(decoded)) return null;
  const resetsAt = Date.parse(decoded.value.resetsAt ?? "");
  return {
    usedPercent: Math.max(0, Math.min(100, decoded.value.percent)),
    windowDurationMins,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt / 1_000 : null,
  };
}
