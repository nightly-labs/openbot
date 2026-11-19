import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect, Option, Schema } from "effect";
import { type AccountRateLimitsReadResult, type AccountRateLimitWindowResult, getRecord } from "./protocol";

const CURSOR_API_ENDPOINT = "https://api2.cursor.sh";
const CURRENT_PERIOD_USAGE_PATH = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const PLAN_INFO_PATH = "/aiserver.v1.DashboardService/GetPlanInfo";
const CURSOR_USAGE_TIMEOUT_MS = 10_000;
const KEYCHAIN_TIMEOUT_MS = 3_000;

const execFileAsync = promisify(execFile);

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

class CursorUsageFailed extends Schema.TaggedError<CursorUsageFailed>()("CursorUsageFailed", {
  cause: Schema.Defect(),
}) {}

export function cursorAuthFile(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  switch (platform()) {
    case "win32":
      return join(env.APPDATA || join(home, "AppData", "Roaming"), "Cursor", "auth.json");
    case "darwin":
      return join(home, ".cursor", "auth.json");
    default:
      return join(env.XDG_CONFIG_HOME || join(home, ".config"), "cursor", "auth.json");
  }
}

const CursorAuth = Schema.Struct({ accessToken: Schema.NonEmptyString });

const readAccessToken = Effect.fn("Cursor.readAccessToken")(function* () {
  if (platform() === "darwin") {
    const keychain = yield* Effect.tryPromise({
      try: () =>
        execFileAsync(
          "/usr/bin/security",
          ["find-generic-password", "-a", "cursor-user", "-s", "cursor-access-token", "-w"],
          { timeout: KEYCHAIN_TIMEOUT_MS },
        ),
      catch: (cause) => new CursorUsageFailed({ cause }),
    }).pipe(Effect.option);
    const token = Option.isSome(keychain) ? keychain.value.stdout.trim() : "";
    if (token) return token;
  }
  const text = yield* Effect.tryPromise({
    try: () => readFile(cursorAuthFile(), "utf8"),
    catch: (cause) => new CursorUsageFailed({ cause }),
  }).pipe(Effect.option);
  if (Option.isNone(text)) return null;
  const auth = Schema.decodeUnknownOption(Schema.fromJsonString(CursorAuth))(text.value);
  return Option.isSome(auth) ? auth.value.accessToken : null;
});

const postDashboard = Effect.fn("Cursor.postDashboard")(function* (
  endpoint: string,
  path: string,
  accessToken: string,
) {
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${endpoint.replace(/\/+$/u, "")}${path}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: "{}",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CURSOR_USAGE_TIMEOUT_MS)]),
            }),
          catch: (cause) => new CursorUsageFailed({ cause }),
        });
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok)
          return yield* new CursorUsageFailed({
            cause: new Error(`Cursor usage returned HTTP ${response.status}.`),
          });
        return yield* Effect.tryPromise({
          try: (): Promise<unknown> => response.json(),
          catch: (cause) => new CursorUsageFailed({ cause }),
        });
      }),
    (controller) => Effect.sync(() => controller.abort()),
  );
});

const EXCHANGE_API_KEY_PATH = "/auth/exchange_user_api_key";

export const checkCursorApiKey = Effect.fn("Cursor.checkApiKey")(function* (key: string) {
  const endpoint = process.env.CURSOR_API_ENDPOINT?.trim() || CURSOR_API_ENDPOINT;
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => new AbortController()),
    (controller) =>
      Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(`${endpoint.replace(/\/+$/u, "")}${EXCHANGE_API_KEY_PATH}`, {
              method: "POST",
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
              body: "{}",
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(CURSOR_USAGE_TIMEOUT_MS)]),
            }),
          catch: (cause) => new CursorUsageFailed({ cause }),
        });
        yield* Effect.promise(() => response.body?.cancel() ?? Promise.resolve()).pipe(Effect.ignore);
        if (response.ok) return true;
        if (response.status === 401 || response.status === 403) return false;
        return yield* new CursorUsageFailed({
          cause: new Error(`Cursor key check returned HTTP ${response.status}.`),
        });
      }),
    (controller) => Effect.sync(() => controller.abort()),
  );
});

const MergedPlan = Schema.Struct({ isMerged: Schema.Literal(true) });

export const readCursorUsage = Effect.fn("Cursor.readUsage")(function* () {
  const accessToken = yield* readAccessToken();
  if (!accessToken) return NO_USAGE;
  const endpoint = process.env.CURSOR_API_ENDPOINT?.trim() || CURSOR_API_ENDPOINT;
  const [usage, planInfo] = yield* Effect.all(
    [
      postDashboard(endpoint, CURRENT_PERIOD_USAGE_PATH, accessToken),
      postDashboard(endpoint, PLAN_INFO_PATH, accessToken).pipe(Effect.option),
    ],
    { concurrency: "unbounded" },
  );
  if (usage === null) return NO_USAGE;
  const merged = Option.isSome(planInfo) && Option.isSome(Schema.decodeUnknownOption(MergedPlan)(planInfo.value));
  return cursorRateLimits(usage, merged);
});

const Int64 = Schema.Union([Schema.Finite, Schema.FiniteFromString]);
const CurrentPeriodUsage = Schema.Struct({
  billingCycleStart: Schema.optional(Int64),
  billingCycleEnd: Schema.optional(Int64),
});
const PlanUsage = Schema.Struct({
  autoPercentUsed: Schema.optional(Schema.Finite),
  apiPercentUsed: Schema.optional(Schema.Finite),
  totalPercentUsed: Schema.optional(Schema.Finite),
});

function cursorRateLimits(value: unknown, merged: boolean): AccountRateLimitsReadResult {
  const period = Schema.decodeUnknownOption(CurrentPeriodUsage)(value);
  const plan = Schema.decodeUnknownOption(PlanUsage)(getRecord(value, "planUsage") ?? {});
  if (Option.isNone(period) || Option.isNone(plan)) return NO_USAGE;
  const { billingCycleStart, billingCycleEnd } = period.value;
  const cycle = {
    windowDurationMins:
      billingCycleStart !== undefined && billingCycleEnd !== undefined && billingCycleEnd > billingCycleStart
        ? Math.round((billingCycleEnd - billingCycleStart) / 60_000)
        : null,
    resetsAt: billingCycleEnd ? billingCycleEnd / 1_000 : null,
  };
  const window = (usedPercent: number | undefined): AccountRateLimitWindowResult | null =>
    usedPercent === undefined ? null : { usedPercent: Math.max(0, Math.min(100, usedPercent)), ...cycle };
  const { autoPercentUsed, apiPercentUsed, totalPercentUsed } = plan.value;
  const split = !merged && (autoPercentUsed !== undefined || apiPercentUsed !== undefined);
  const primary = window(split ? autoPercentUsed : totalPercentUsed);
  const secondary = split ? window(apiPercentUsed) : null;
  const total = split ? window(totalPercentUsed) : null;
  if (!primary && !secondary) return NO_USAGE;
  return {
    rateLimits: { limitId: "cursor", primary, secondary },
    rateLimitsByLimitId: null,
    ...(total ? { tertiary: total } : {}),
    ...(merged ? { sharedQuotaWith: "grok" as const } : {}),
  };
}
