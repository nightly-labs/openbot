// The Cursor plan usage, read from the Cursor backend with the Cursor CLI's own sign-in.
//
// Cursor's ACP process does not report usage, so this is the request the Cursor CLI sends itself:
// `aiserver.v1.DashboardService/GetCurrentPeriodUsage` on its API endpoint, as Connect JSON, with
// the access token of the CLI's sign-in. The answer splits the plan into Cursor's own models
// (`autoPercentUsed`) and every other model (`apiPercentUsed`) for one billing cycle. The included
// usage of a merged plan (`GetPlanInfo` `isMerged`) covers Grok and Composer only, so its reading is
// the total alone, as in the Cursor app. That total is the quota of the Grok plan, so the reading
// names Grok as sharing it, and the rail shows one ring for both.

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect, Option, Schema } from "effect";
import { type AccountRateLimitsReadResult, type AccountRateLimitWindowResult, getRecord } from "./protocol";

/** The CLI's default endpoint. `CURSOR_API_ENDPOINT` moves the CLI, so it moves this read too. */
const CURSOR_API_ENDPOINT = "https://api2.cursor.sh";
const CURRENT_PERIOD_USAGE_PATH = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const PLAN_INFO_PATH = "/aiserver.v1.DashboardService/GetPlanInfo";
const CURSOR_USAGE_TIMEOUT_MS = 10_000;
const KEYCHAIN_TIMEOUT_MS = 3_000;

const execFileAsync = promisify(execFile);

const NO_USAGE: AccountRateLimitsReadResult = { rateLimits: null, rateLimitsByLimitId: null };

/**
 * No sign-in file, a token the backend rejects, and a plan with no percentages all read as no
 * usage, so the dock shows the provider as not reporting instead of an error.
 */
class CursorUsageFailed extends Schema.TaggedError<CursorUsageFailed>()("CursorUsageFailed", {
  cause: Schema.Defect(),
}) {}

/**
 * The file where the Cursor CLI keeps its sign-in. On macOS the CLI uses the login Keychain and
 * writes this file only when the Keychain cannot be used.
 */
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
    // The CLI writes the item with `/usr/bin/security`, so reading it with the same tool asks nothing.
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

/** The answer of one dashboard call, or null when the backend rejects the token. */
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
            // Appended, not resolved: a resolved absolute path drops a path in the endpoint.
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

const MergedPlan = Schema.Struct({ isMerged: Schema.Literal(true) });

export const readCursorUsage = Effect.fn("Cursor.readUsage")(function* () {
  const accessToken = yield* readAccessToken();
  if (!accessToken) return NO_USAGE;
  const endpoint = process.env.CURSOR_API_ENDPOINT?.trim() || CURSOR_API_ENDPOINT;
  const [usage, planInfo] = yield* Effect.all(
    [
      postDashboard(endpoint, CURRENT_PERIOD_USAGE_PATH, accessToken),
      // A plan info that fails to read keeps the split reading, as before the plan info was read.
      postDashboard(endpoint, PLAN_INFO_PATH, accessToken).pipe(Effect.option),
    ],
    { concurrency: "unbounded" },
  );
  if (usage === null) return NO_USAGE;
  const merged = Option.isSome(planInfo) && Option.isSome(Schema.decodeUnknownOption(MergedPlan)(planInfo.value));
  return cursorRateLimits(usage, merged);
});

/** Connect JSON writes an int64 as a string. */
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

/**
 * The primary window holds Cursor's own models and the secondary one every other model; the dock
 * names them by slot. A merged plan, or a plan that reports only the total, fills the primary
 * window with the total.
 */
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
  if (!primary && !secondary) return NO_USAGE;
  return {
    rateLimits: { limitId: "cursor", primary, secondary },
    rateLimitsByLimitId: null,
    ...(merged ? { sharedQuotaWith: "grok" as const } : {}),
  };
}
