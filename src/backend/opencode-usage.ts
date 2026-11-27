import { existsSync, readFileSync } from "node:fs";
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
const AuthFile = Schema.Struct({
  "opencode-go": Schema.optionalKey(Schema.Unknown),
  opencode: Schema.optionalKey(Schema.Unknown),
});
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
  const authFile = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(AuthFile))(authText));
  const goKey = (authFileApiKey(authFile, "opencode-go")?.key ?? env.OPENCODE_API_KEY)?.trim();
  const consoleFile = authFileApiKey(authFile, "opencode");
  const consoleFileKey = consoleFile?.servedByConsole ? consoleFile.key.trim() : undefined;
  const databasePath = openCodeDatabasePath(env);
  const consoleKey = inlineAuth || !databasePath ? undefined : yield* readConsoleKey(databasePath);
  return [...new Set([consoleKey, goKey, consoleFileKey].filter((key): key is string => Boolean(key)))];
});

const AuthFileEntries = Schema.Record(Schema.String, Schema.Unknown);
const AuthFileEntry = Schema.Struct({ type: Schema.String });

const readAuthFileProviders = Effect.fn("OpenCode.readAuthFileProviders")(function* (env: NodeJS.ProcessEnv) {
  const authText =
    env.OPENCODE_AUTH_CONTENT ||
    (yield* Effect.try({
      try: () => readFileSync(join(openCodeDataDirectory(env), "auth.json"), "utf8"),
      catch: (cause) => new OpenCodeUsageFailed({ cause }),
    }).pipe(Effect.orElseSucceed(() => "")));
  const entries = Schema.decodeUnknownOption(Schema.fromJsonString(AuthFileEntries))(authText);
  if (Option.isNone(entries)) return [];
  return Object.entries(entries.value)
    .filter(([, entry]) => Option.isSome(Schema.decodeUnknownOption(AuthFileEntry)(entry)))
    .map(([provider]) => provider);
});

const PROVIDER_CREDENTIAL_QUERY = "SELECT 1 FROM credential WHERE integration_id = ? AND active IS NOT 0 LIMIT 1";
const ACTIVE_CREDENTIAL_PROVIDERS_QUERY = "SELECT DISTINCT integration_id FROM credential WHERE active IS NOT 0";

const hasStoredCredential = Effect.fn("OpenCode.hasStoredCredential")(function* (
  env: NodeJS.ProcessEnv,
  query: string,
  provider: string,
) {
  const databasePath = openCodeDatabasePath(env);
  if (env.OPENCODE_AUTH_CONTENT || !databasePath) return false;
  return yield* Effect.try({
    try: () => readOpenCodeDatabase(databasePath, (database) => database.prepare(query).get(provider) !== undefined),
    catch: (cause) => new OpenCodeUsageFailed({ cause }),
  }).pipe(Effect.orElseSucceed(() => false));
});

export const hasOpenCodeProviderKey = Effect.fn("OpenCode.hasProviderKey")(function* (
  provider: string,
  env: NodeJS.ProcessEnv,
) {
  if ((yield* readAuthFileProviders(env)).includes(provider)) return true;
  return yield* hasStoredCredential(env, PROVIDER_CREDENTIAL_QUERY, provider);
});

const readStoredCredentialProviders = Effect.fn("OpenCode.readStoredCredentialProviders")(function* (
  env: NodeJS.ProcessEnv,
) {
  const databasePath = openCodeDatabasePath(env);
  if (env.OPENCODE_AUTH_CONTENT || !databasePath) return [];
  return yield* Effect.try({
    try: () =>
      readOpenCodeDatabase(databasePath, (database) =>
        database
          .prepare(ACTIVE_CREDENTIAL_PROVIDERS_QUERY)
          .all()
          .flatMap((row) => (typeof row.integration_id === "string" ? [row.integration_id] : [])),
      ),
    catch: (cause) => new OpenCodeUsageFailed({ cause }),
  }).pipe(Effect.orElseSucceed((): string[] => []));
});

export interface OpenCodeMediaProviders {
  readonly providers: ReadonlySet<string>;
  readonly keyVariables: ReadonlySet<string>;
}

const OPENCODE_ZEN_PROVIDER = "opencode";
const OPENCODE_CATALOG_KEYS = ["models-dev:v3:catalog", "models-dev:v2:catalog"] as const;
const MEDIA_MODEL_TYPES: ReadonlySet<string> = new Set(["image", "video"]);

const ZEN_MEDIA_PROVIDERS: OpenCodeMediaProviders = {
  providers: new Set([OPENCODE_ZEN_PROVIDER]),
  keyVariables: new Set(["OPENCODE_API_KEY"]),
};

const CatalogMeta = Schema.fromJsonString(Schema.Struct({ digest: Schema.String }));
const CatalogProviders = Schema.Record(
  Schema.String,
  Schema.Struct({
    env: Schema.optionalKey(Schema.Array(Schema.String)),
    models: Schema.Record(Schema.String, Schema.Struct({ type: Schema.optionalKey(Schema.String) })),
  }),
);
const Catalog = Schema.fromJsonString(
  Schema.Struct({ body: Schema.Union([CatalogProviders, Schema.fromJsonString(CatalogProviders)]) }),
);

let catalogCache: { readonly source: string; readonly media: OpenCodeMediaProviders } | null = null;

function mediaProvidersOf(catalog: typeof CatalogProviders.Type): OpenCodeMediaProviders {
  const media = Object.entries(catalog).filter(([, provider]) =>
    Object.values(provider.models).some((model) => model.type !== undefined && MEDIA_MODEL_TYPES.has(model.type)),
  );
  return {
    providers: new Set([...ZEN_MEDIA_PROVIDERS.providers, ...media.map(([id]) => id)]),
    keyVariables: new Set([
      ...ZEN_MEDIA_PROVIDERS.keyVariables,
      ...media.flatMap(([, provider]) => provider.env ?? []).map((name) => name.toUpperCase()),
    ]),
  };
}

function readCatalogMediaProviders(database: DatabaseSync, databasePath: string): OpenCodeMediaProviders {
  const select = database.prepare("SELECT value FROM kv WHERE key = ?");
  for (const key of OPENCODE_CATALOG_KEYS) {
    const meta = Schema.decodeUnknownOption(CatalogMeta)(select.get(`${key}:meta`)?.value);
    if (Option.isNone(meta)) continue;
    const source = `${databasePath}\n${key}\n${meta.value.digest}`;
    if (catalogCache?.source === source) return catalogCache.media;
    const catalog = Schema.decodeUnknownOption(Catalog)(select.get(key)?.value);
    if (Option.isNone(catalog)) continue;
    catalogCache = { source, media: mediaProvidersOf(catalog.value.body) };
    return catalogCache.media;
  }
  return ZEN_MEDIA_PROVIDERS;
}

export const readOpenCodeMediaProviders = Effect.fn("OpenCode.readMediaProviders")(function* (env: NodeJS.ProcessEnv) {
  const databasePath = openCodeDatabasePath(env);
  if (!databasePath || !existsSync(databasePath)) return ZEN_MEDIA_PROVIDERS;
  return yield* Effect.try({
    try: () => readOpenCodeDatabase(databasePath, (database) => readCatalogMediaProviders(database, databasePath)),
    catch: (cause) => new OpenCodeUsageFailed({ cause }),
  }).pipe(Effect.orElseSucceed(() => ZEN_MEDIA_PROVIDERS));
});

function hasMediaKeyVariable(env: NodeJS.ProcessEnv, keyVariables: ReadonlySet<string>): boolean {
  return Object.entries(env).some(([name, value]) => {
    const variable = name.toUpperCase();
    return variable.endsWith("_API_KEY") && keyVariables.has(variable) && Boolean(value?.trim());
  });
}

export const hasOpenCodeMediaSignIn = Effect.fn("OpenCode.hasMediaSignIn")(function* (
  env: NodeJS.ProcessEnv,
  media: OpenCodeMediaProviders,
) {
  if (hasMediaKeyVariable(env, media.keyVariables)) return true;
  if ((yield* readAuthFileProviders(env)).some((provider) => media.providers.has(provider))) return true;
  return (yield* readStoredCredentialProviders(env)).some((provider) => media.providers.has(provider));
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

interface AuthFileApiKey {
  readonly key: string;
  readonly servedByConsole: boolean;
}

function authFileApiKey(
  file: typeof AuthFile.Type | undefined,
  integration: "opencode" | "opencode-go",
): AuthFileApiKey | undefined {
  const entry = file?.[integration];
  const decoded = Schema.decodeUnknownOption(AuthFileKey)(entry);
  if (Option.isNone(decoded)) return undefined;
  return {
    key: decoded.value.key,
    servedByConsole: servedByOpenCodeConsole(getRecord(entry, "metadata")?.server),
  };
}

function servedByOpenCodeConsole(server: unknown): boolean {
  if (typeof server !== "string") return true;
  const url = URL.parse(server);
  return url !== null && `${url.origin}${url.pathname.replace(/\/+$/u, "")}` === OPENCODE_CONSOLE_URL;
}

function newestStoredKey(databasePath: string, integration: string) {
  const row = readOpenCodeDatabase(databasePath, (database) =>
    database
      .prepare(
        `SELECT value FROM credential
         WHERE integration_id = ? AND active IS NOT 0
         ORDER BY active DESC, time_created DESC, id DESC LIMIT 1`,
      )
      .get(integration),
  );
  return Schema.decodeUnknownOption(Schema.fromJsonString(StoredKey))(row?.value);
}

export const readOpenCodeStoredKey = Effect.fn("OpenCode.readStoredKey")(function* (
  integration: string,
  env: NodeJS.ProcessEnv,
) {
  const databasePath = openCodeDatabasePath(env);
  if (!databasePath) return null;
  return yield* Effect.try({
    try: () => {
      const stored = newestStoredKey(databasePath, integration);
      return Option.isSome(stored) ? stored.value.key.trim() || null : null;
    },
    catch: (cause) => new OpenCodeUsageFailed({ cause }),
  }).pipe(Effect.orElseSucceed(() => null));
});

const readConsoleKey = Effect.fn("OpenCode.readConsoleKey")(function* (databasePath: string) {
  return yield* Effect.try({
    try: () => {
      const stored = newestStoredKey(databasePath, "opencode");
      if (Option.isNone(stored) || !servedByOpenCodeConsole(stored.value.metadata?.server)) return undefined;
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
