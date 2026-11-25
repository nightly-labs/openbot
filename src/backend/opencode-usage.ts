import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect, Option, Schema } from "effect";
import { openCodeDataDirectory } from "./process-confinement";
import {
  type AccountRateLimitsReadResult,
  type AccountRateLimitWindowResult,
  bindingWindow,
  getRecord,
  getString,
} from "./protocol";

const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

const OPENCODE_GO_USAGE_TIMEOUT_MS = 10_000;
const ROLLING_WINDOW_MINS = 300;
const WEEKLY_WINDOW_MINS = 10_080;
const MONTHLY_WINDOW_MINS = 43_200;

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

class OpenCodeUsageFailed extends Schema.TaggedError<OpenCodeUsageFailed>()("OpenCodeUsageFailed", {
  cause: Schema.Defect(),
}) {}

const OPENCODE_CONSOLE_URL = "https://opencode.ai/console";
const OPENCODE_DB_BUSY_TIMEOUT_MS = 100;

export function openCodeDatabasePath(env: NodeJS.ProcessEnv, home?: string): string | null {
  const databaseFile = env.OPENCODE_DB || "opencode.db";
  return databaseFile === ":memory:" ? null : resolve(openCodeDataDirectory(env, home), databaseFile);
}

export function readOpenCodeDatabase<A>(databasePath: string, read: (database: DatabaseSync) => A): A {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    database.exec(`PRAGMA busy_timeout = ${OPENCODE_DB_BUSY_TIMEOUT_MS}`);
    return read(database);
  } finally {
    database.close();
  }
}

const AuthFileKey = Schema.Struct({ type: Schema.Literal("api"), key: Schema.String });
const AuthFile = Schema.Struct({ "opencode-go": Schema.optionalKey(Schema.Unknown) });
const StoredKey = Schema.Struct({
  type: Schema.Literal("key"),
  key: Schema.String,
  metadata: Schema.optionalKey(Schema.NullOr(Schema.Struct({ server: Schema.optionalKey(Schema.Unknown) }))),
});

export const readOpenCodeGoUsage = Effect.fn("OpenCode.readGoUsage")(function* (apiKey: string | null) {
  const keys = apiKey ? [apiKey] : yield* readOwnKeys();
  for (const key of keys) {
    const usage = yield* readGoUsage(key);
    if (usage) return usage;
  }
  return NO_USAGE;
});

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
  const databasePath = openCodeDatabasePath(env);
  const consoleKey = inlineAuth || !databasePath ? undefined : yield* readConsoleKey(databasePath);
  return [...new Set([consoleKey, goKey].filter((key): key is string => Boolean(key)))];
});

const AuthFileEntries = Schema.Record(Schema.String, Schema.Unknown);
const AuthFileEntry = Schema.Struct({ type: Schema.String });

export const hasOpenCodeProviderKey = Effect.fn("OpenCode.hasProviderKey")(function* (
  provider: string,
  env: NodeJS.ProcessEnv,
) {
  const dataDirectory = openCodeDataDirectory(env);
  const inlineAuth = env.OPENCODE_AUTH_CONTENT;
  const authText =
    inlineAuth ||
    (yield* Effect.try({
      try: () => readFileSync(join(dataDirectory, "auth.json"), "utf8"),
      catch: (cause) => new OpenCodeUsageFailed({ cause }),
    }).pipe(Effect.orElseSucceed(() => "")));
  const entries = Schema.decodeUnknownOption(Schema.fromJsonString(AuthFileEntries))(authText);
  if (
    Option.isSome(entries) &&
    Object.hasOwn(entries.value, provider) &&
    Option.isSome(Schema.decodeUnknownOption(AuthFileEntry)(entries.value[provider]))
  )
    return true;
  if (inlineAuth) return false;
  return yield* hasOpenCodeSavedCredential(provider, env);
});

export const hasOpenCodeSavedCredential = Effect.fn("OpenCode.hasSavedCredential")(function* (
  provider: string,
  env: NodeJS.ProcessEnv,
) {
  const databasePath = openCodeDatabasePath(env);
  if (!databasePath) return false;
  return yield* Effect.try({
    try: () =>
      readOpenCodeDatabase(
        databasePath,
        (database) =>
          database
            .prepare("SELECT 1 FROM credential WHERE integration_id = ? AND active IS NOT 0 LIMIT 1")
            .get(provider) !== undefined,
      ),
    catch: (cause) => new OpenCodeUsageFailed({ cause }),
  }).pipe(Effect.orElseSucceed(() => false));
});

const RefusedTurn = Schema.Struct({
  error: Schema.Struct({ type: Schema.Literal("provider.auth"), status: Schema.Finite }),
});

export const readOpenCodeRefusalStatus = Effect.fn("OpenCode.readRefusalStatus")(function* (
  sessionId: string,
  env: NodeJS.ProcessEnv,
) {
  const databasePath = openCodeDatabasePath(env);
  if (!databasePath) return null;
  const row = yield* Effect.try({
    try: () =>
      readOpenCodeDatabase(databasePath, (database) =>
        database
          .prepare("SELECT data FROM session_message WHERE session_id = ? ORDER BY seq DESC LIMIT 1")
          .get(sessionId),
      ),
    catch: (cause) => new OpenCodeUsageFailed({ cause }),
  }).pipe(Effect.orElseSucceed(() => undefined));
  const refused = Schema.decodeUnknownOption(Schema.fromJsonString(RefusedTurn))(row?.data);
  return Option.isSome(refused) ? refused.value.error.status : null;
});

function authFileGoKey(text: string): string | undefined {
  const file = Schema.decodeUnknownOption(Schema.fromJsonString(AuthFile))(text);
  if (Option.isNone(file)) return undefined;
  const entry = Schema.decodeUnknownOption(AuthFileKey)(file.value["opencode-go"]);
  return Option.isSome(entry) ? entry.value.key : undefined;
}

const readConsoleKey = Effect.fn("OpenCode.readConsoleKey")(function* (databasePath: string) {
  return yield* Effect.try({
    try: () => {
      const row = readOpenCodeDatabase(databasePath, (database) =>
        database
          .prepare(
            `SELECT value FROM credential
             WHERE integration_id = 'opencode' AND active IS NOT 0
             ORDER BY active DESC, time_created DESC, id DESC LIMIT 1`,
          )
          .get(),
      );
      const stored = Schema.decodeUnknownOption(Schema.fromJsonString(StoredKey))(row?.value);
      if (Option.isNone(stored)) return undefined;
      const server = stored.value.metadata?.server;
      if (typeof server === "string") {
        const url = new URL(server);
        if (`${url.origin}${url.pathname.replace(/\/+$/u, "")}` !== OPENCODE_CONSOLE_URL) return undefined;
      }
      return stored.value.key.trim() || undefined;
    },
    catch: (cause) => new OpenCodeUsageFailed({ cause }),
  }).pipe(Effect.orElseSucceed(() => undefined));
});

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

function openCodeGoRateLimits(value: unknown): AccountRateLimitsReadResult {
  const usage = getRecord(value, "usage");
  const rolling = usageWindow(getRecord(usage, "rolling"), ROLLING_WINDOW_MINS);
  const weekly = usageWindow(getRecord(usage, "weekly"), WEEKLY_WINDOW_MINS);
  const monthly = usageWindow(getRecord(usage, "monthly"), MONTHLY_WINDOW_MINS);
  const secondary = weekly && monthly ? bindingWindow(weekly, monthly) : (weekly ?? monthly);
  if (!rolling && !secondary) return NO_USAGE;
  const tertiary = weekly && monthly ? (secondary === weekly ? monthly : weekly) : undefined;
  return {
    rateLimits: { limitId: "opencode", primary: rolling, secondary },
    ...(tertiary ? { tertiary } : {}),
    rateLimitsByLimitId: null,
  };
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
