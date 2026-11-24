import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, win32 } from "node:path";
import { promisify } from "node:util";
import { Effect, Option, Schema } from "effect";
import { type AccountRateLimitsReadResult, type AccountRateLimitWindowResult, getRecord } from "./protocol";

const CURSOR_API_ENDPOINT = "https://api2.cursor.sh";
const CURRENT_PERIOD_USAGE_PATH = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const PLAN_INFO_PATH = "/aiserver.v1.DashboardService/GetPlanInfo";
const CURSOR_USAGE_TIMEOUT_MS = 10_000;
const KEYCHAIN_TIMEOUT_MS = 3_000;
const SECRET_TOOL_PATHS = ["/usr/bin/secret-tool", "/usr/local/bin/secret-tool"];
const SECRET_SERVICE_ATTRIBUTES = ["service", "cursor-credentials", "account", "cursor-user"];
const SECRET_SERVICE_MISS_REUSE_MS = 30 * 60_000;
const DPAPI_UNPROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "Add-Type -AssemblyName System.Security",
  "$blob=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())",
  "$plain=[Security.Cryptography.ProtectedData]::Unprotect($blob,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
  "[Console]::Out.Write([Convert]::ToBase64String($plain))",
].join(";");

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

const CursorAuth = Schema.Struct({
  accessToken: Schema.optional(Schema.String),
  storedIn: Schema.optional(Schema.String),
});
const decodeCursorAuth = Schema.decodeUnknownOption(Schema.fromJsonString(CursorAuth));

function secretServiceEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env.DBUS_SESSION_BUS_ADDRESS || !env.XDG_RUNTIME_DIR) return env;
  return { ...env, DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(env.XDG_RUNTIME_DIR, "bus")}` };
}

let storedSecretRead: { versionFile: string; modifiedMs: number; readAt: number; accessToken: string | null } | null =
  null;

const readStoredAccessToken = Effect.fn("Cursor.readStoredAccessToken")(function* (
  versionFile: string,
  readSecret: Effect.Effect<string | undefined>,
) {
  const modified = yield* Effect.tryPromise({
    try: () => stat(versionFile),
    catch: (cause) => new CursorUsageFailed({ cause }),
  }).pipe(Effect.option);
  if (Option.isNone(modified)) return null;
  const modifiedMs = modified.value.mtimeMs;
  if (
    storedSecretRead?.versionFile === versionFile &&
    storedSecretRead.modifiedMs === modifiedMs &&
    (storedSecretRead.accessToken !== null || Date.now() - storedSecretRead.readAt < SECRET_SERVICE_MISS_REUSE_MS)
  ) {
    return storedSecretRead.accessToken;
  }
  const secret = yield* readSecret;
  const auth = secret === undefined ? Option.none() : decodeCursorAuth(secret);
  const accessToken = Option.isSome(auth) && auth.value.accessToken ? auth.value.accessToken : null;
  storedSecretRead = { versionFile, modifiedMs, readAt: Date.now(), accessToken };
  return accessToken;
});

const readSecretServiceSecret = Effect.tryPromise({
  try: () =>
    execFileAsync(
      SECRET_TOOL_PATHS.find((path) => existsSync(path)) ?? "secret-tool",
      ["search", ...SECRET_SERVICE_ATTRIBUTES],
      { timeout: CURSOR_USAGE_TIMEOUT_MS, env: secretServiceEnvironment() },
    ),
  catch: (cause) => new CursorUsageFailed({ cause }),
}).pipe(
  Effect.option,
  Effect.map((output) => (Option.isSome(output) ? /^secret = (.*)$/mu.exec(output.value.stdout)?.[1] : undefined)),
);

const DpapiFile = Schema.Struct({ version: Schema.Literal(1), dpapi: Schema.String });
const decodeDpapiFile = Schema.decodeUnknownOption(Schema.fromJsonString(DpapiFile));

function windowsPowerShell(env: NodeJS.ProcessEnv = process.env): string {
  return win32.join(env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function unprotectDpapiBlob(blob: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      windowsPowerShell(),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", DPAPI_UNPROTECT_SCRIPT],
      { timeout: CURSOR_USAGE_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(Buffer.from(stdout.trim(), "base64").toString("utf8"))),
    );
    child.stdin?.on("error", reject);
    child.stdin?.end(blob);
  });
}

const readDpapiSecret = Effect.fn("Cursor.readDpapiSecret")(function* (dpapiFile: string) {
  const text = yield* Effect.tryPromise({
    try: () => readFile(dpapiFile, "utf8"),
    catch: (cause) => new CursorUsageFailed({ cause }),
  }).pipe(Effect.option);
  const file = Option.isSome(text) ? decodeDpapiFile(text.value) : Option.none();
  if (Option.isNone(file)) return undefined;
  const secret = yield* Effect.tryPromise({
    try: () => unprotectDpapiBlob(file.value.dpapi),
    catch: (cause) => new CursorUsageFailed({ cause }),
  }).pipe(Effect.option);
  return Option.getOrUndefined(secret);
});

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
  const authFile = cursorAuthFile();
  const text = yield* Effect.tryPromise({
    try: () => readFile(authFile, "utf8"),
    catch: (cause) => new CursorUsageFailed({ cause }),
  }).pipe(Effect.option);
  if (Option.isNone(text)) return null;
  const auth = decodeCursorAuth(text.value);
  if (Option.isNone(auth)) return null;
  if (auth.value.accessToken) return auth.value.accessToken;
  if (auth.value.storedIn !== "os-secret-store") return null;
  switch (platform()) {
    case "linux":
      return yield* readStoredAccessToken(authFile, readSecretServiceSecret);
    case "win32": {
      const dpapiFile = join(dirname(authFile), "auth.dpapi");
      return yield* readStoredAccessToken(dpapiFile, readDpapiSecret(dpapiFile));
    }
    default:
      return null;
  }
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
