import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { redactPostText, redactText } from "@openbot/logging";
import { AccountAccessTokens, requiresAccountSessionToken } from "@openbot/team-client/account-access-token";
import { RemoteTeamDirectoryClient } from "@openbot/team-client/remote-directory";
import { Effect } from "effect";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CentralAuthManager } from "../src/main/central-auth-manager";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "account-access-token");
const SERVER = join(ROOT, "apps", "auth-api", "scripts", "account-access-token-server.ts");
const MOBILE_ACCOUNT_FETCH = join(ROOT, "apps", "mobile", "src", "features", "auth", "api", "account-fetch.ts");
const ACCESS_LIFETIME_MS = 10 * 60_000;
const START_LIMIT_MS = 30_000;
const USER = { id: "user-1", email: "user@example.test", name: "User", avatarUrl: null };

type BearerKind = "session" | "access" | "none" | "unknown";

interface SentRequest {
  method: string;
  path: string;
  bearer: BearerKind;
  status: number;
  d1Reads: number;
  d1Writes: number;
}

interface ServiceLog {
  sent: SentRequest[];
  issued: string[];
}

interface ServiceControl {
  mode?: "present" | "missing" | "failing";
  expireNextAccess?: boolean;
  refuseNextAccess?: boolean;
  clock?: number | null;
  addSessions?: string[];
}

interface FakeAccountService {
  url: string;
  control(patch: ServiceControl): Promise<void>;
  log(): Promise<ServiceLog>;
  stop(): void;
}

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}

const services: FakeAccountService[] = [];

interface MobileAccountFetchModule {
  fetchMobileAccount(
    credential: { apiUrl: string; sessionToken: string },
    path: string,
    init?: { method?: string; body?: string },
  ): Promise<Response>;
  forgetMobileAccountAccess(sessionToken: string): void;
}

function isMobileAccountFetchModule(value: unknown): value is MobileAccountFetchModule {
  return (
    isDynamicRecord(value) &&
    typeof value.fetchMobileAccount === "function" &&
    typeof value.forgetMobileAccountAccess === "function"
  );
}

function mobileAccountFetchModule(value: unknown): MobileAccountFetchModule {
  assert.ok(isMobileAccountFetchModule(value), "The mobile account fetch module has no expected exports.");
  return value;
}

async function loadMobileAccountFetch(): Promise<MobileAccountFetchModule> {
  return mobileAccountFetchModule(await import(pathToFileURL(MOBILE_ACCOUNT_FETCH).href));
}

function spawnServer(): Promise<{ child: ChildProcess; port: number }> {
  const child = spawn(process.execPath, [SERVER], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error("The account server did not start.")), START_LIMIT_MS);
    child.once("exit", (code) => reject(new Error(`The account server stopped with code ${code}.`)));
    if (!child.stdout) return reject(new Error("The account server has no output."));
    createInterface({ input: child.stdout }).once("line", (line) => {
      clearTimeout(timer);
      const port = Number(JSON.parse(line).port);
      if (!Number.isInteger(port)) return reject(new Error("The account server has no port."));
      resolvePort({ child, port });
    });
  });
}

async function startService(initial: ServiceControl): Promise<FakeAccountService> {
  const { child, port } = await spawnServer();
  const url = `http://127.0.0.1:${port}`;
  const service: FakeAccountService = {
    url,
    async control(patch) {
      const response = await fetch(`${url}/__control`, { method: "POST", body: JSON.stringify(patch) });
      assert.equal(response.status, 200);
    },
    async log() {
      const value = await (await fetch(`${url}/__log`)).json();
      assert.ok(isDynamicRecord(value) && Array.isArray(value.sent) && Array.isArray(value.issued));
      return { sent: value.sent, issued: value.issued };
    },
    stop: () => child.kill("SIGTERM"),
  };
  services.push(service);
  await service.control(initial);
  return service;
}

function sessionToken(label: string): string {
  return `${label}-${randomBytes(24).toString("base64url")}`;
}

const temporary = await mkdtemp(join(tmpdir(), "openbot-account-access-"));
let managerIndex = 0;

async function signedInManager(service: FakeAccountService, token: string) {
  managerIndex += 1;
  const storagePath = join(temporary, `session-${managerIndex}.bin`);
  await writeFile(storagePath, Buffer.from(JSON.stringify({ version: 2, sessionToken: token })).toString("base64"));
  const manager = new CentralAuthManager({
    apiUrl: service.url,
    storagePath,
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
  });
  const state = await runCauseEffect(manager.initialize());
  assert.equal(state.status, "signed_in");
  return manager;
}

const identity = (value: unknown) => value;

async function sentSince(service: FakeAccountService, from: number): Promise<SentRequest[]> {
  return (await service.log()).sent.slice(from);
}

async function sentCount(service: FakeAccountService): Promise<number> {
  return (await service.log()).sent.length;
}

function shapeOf(sent: readonly SentRequest[]) {
  return sent.map((entry) => `${entry.method} ${entry.path} ${entry.bearer} ${entry.status}`);
}

function sameShape(sent: readonly SentRequest[], expected: readonly string[]): boolean {
  return JSON.stringify(shapeOf(sent)) === JSON.stringify(expected);
}

function d1Summary(sent: readonly SentRequest[]) {
  const byType: Record<string, { requests: number; d1Reads: number; d1Writes: number; bearer: BearerKind[] }> = {};
  for (const entry of sent) {
    const type = `${entry.method} ${entry.path.split("?")[0]}`;
    const row = byType[type] ?? { requests: 0, d1Reads: 0, d1Writes: 0, bearer: [] };
    row.requests += 1;
    row.d1Reads += entry.d1Reads;
    row.d1Writes += entry.d1Writes;
    if (!row.bearer.includes(entry.bearer)) row.bearer.push(entry.bearer);
    byType[type] = row;
  }
  const total = sent.reduce((sum, entry) => sum + entry.d1Reads + entry.d1Writes, 0);
  return { byType, requests: sent.length, d1Queries: total };
}

type D1Summary = ReturnType<typeof d1Summary>;

async function desktopMix(manager: CentralAuthManager) {
  for (let index = 0; index < 10; index += 1) await runCauseEffect(manager.listRemoteHosts());
  for (let index = 0; index < 5; index += 1)
    await runCauseEffect(manager.requestAuthorized("/v1/me", { method: "GET" }, identity));
  for (let index = 0; index < 2; index += 1) await runCauseEffect(manager.downloadAuthorized("/v1/me/avatar"));
  await runCauseEffect(manager.requestAuthorized("/v1/me/billing", { method: "GET" }, identity));
}

const d1: {
  beforeOriginMainHeaders?: D1Summary;
  afterAccessTokens?: D1Summary;
  oneHourAtOneRequestPer30s?: {
    requests: number;
    sessionLookupsBefore: number;
    sessionLookupsAfter: number;
    d1QueriesOfIssueCalls: number;
  };
} = {};
let passed = false;
let failure: string | undefined;

try {
  const beforeToken = sessionToken("before");
  const before = await startService({ addSessions: [beforeToken], mode: "missing" });
  const beforeManager = await signedInManager(before, beforeToken);
  const beforeStart = await sentCount(before);
  await desktopMix(beforeManager);
  await desktopMix(beforeManager);
  const beforeSent = await sentSince(before, beforeStart);
  check(
    "route 404: the desktop asks for an access token once, then sends the session token on each request",
    beforeSent.filter((entry) => entry.path === "/v1/auth/access-token").length === 1 &&
      beforeSent.filter((entry) => entry.path !== "/v1/auth/access-token").every((entry) => entry.bearer === "session"),
    shapeOf(beforeSent),
  );
  await runCauseEffect(beforeManager.dispose());

  const afterToken = sessionToken("after");
  const after = await startService({ addSessions: [afterToken] });
  const afterManager = await signedInManager(after, afterToken);
  const startup = (await after.log()).sent.at(-1);
  check(
    "the desktop start check of /v1/me still sends the session token",
    startup?.path === "/v1/me" && startup.bearer === "session",
    startup,
  );
  const afterStart = await sentCount(after);
  await desktopMix(afterManager);
  await desktopMix(afterManager);
  const afterSent = await sentSince(after, afterStart);
  const afterIssues = afterSent.filter((entry) => entry.path === "/v1/auth/access-token");
  const accountRequests = afterSent.filter(
    (entry) => entry.path !== "/v1/auth/access-token" && !entry.path.startsWith("/v1/me/billing"),
  );
  check(
    "route present: one session-token POST /v1/auth/access-token, then each account request sends the access token",
    afterIssues.length === 1 &&
      afterIssues[0]?.bearer === "session" &&
      accountRequests.length === 34 &&
      accountRequests.every((entry) => entry.bearer === "access" && entry.status === 200),
    shapeOf(afterSent),
  );
  check(
    "billing always sends the session token",
    afterSent.filter((entry) => entry.path === "/v1/me/billing").every((entry) => entry.bearer === "session"),
  );
  check(
    "an access-token request makes no session lookup in D1",
    accountRequests.every((entry) => entry.d1Reads === 0 && entry.d1Writes === 0),
  );
  d1.beforeOriginMainHeaders = d1Summary(beforeSent.filter((entry) => entry.path !== "/v1/auth/access-token"));
  d1.afterAccessTokens = d1Summary(afterSent);

  let from = await sentCount(after);
  await runCauseEffect(
    afterManager.requestAuthorized("/v1/mobile-auth/devices?includeDesktop=true", { method: "GET" }, identity),
  );
  await runCauseEffect(afterManager.requestAuthorized("/v1/me/license", { method: "GET" }, identity));
  const sessionOnly = await sentSince(after, from);
  check(
    "the session list and the license send the session token",
    sessionOnly.length === 2 && sessionOnly.every((entry) => entry.bearer === "session"),
    shapeOf(sessionOnly),
  );

  from = await sentCount(after);
  await after.control({ expireNextAccess: true });
  const expiredResult = await runCauseEffect(afterManager.requestAuthorized("/v1/me", { method: "GET" }, identity));
  const expiredSent = await sentSince(after, from);
  check(
    "access_token_expired once: the desktop gets a new access token and sends the request again once",
    sameShape(expiredSent, [
      "GET /v1/me access 401",
      "POST /v1/auth/access-token session 200",
      "GET /v1/me access 200",
    ]) &&
      JSON.stringify(expiredResult) === JSON.stringify(USER) &&
      afterManager.getState().status === "signed_in",
    shapeOf(expiredSent),
  );

  from = await sentCount(after);
  await after.control({ expireNextAccess: true });
  await runCauseEffect(afterManager.downloadAuthorized("/v1/me/avatar"));
  const downloadSent = await sentSince(after, from);
  check(
    "access_token_expired on a download: a new access token, then one more send",
    sameShape(downloadSent, [
      "GET /v1/me/avatar access 401",
      "POST /v1/auth/access-token session 200",
      "GET /v1/me/avatar access 200",
    ]),
    shapeOf(downloadSent),
  );

  from = await sentCount(after);
  await after.control({ refuseNextAccess: true });
  await runCauseEffect(afterManager.requestAuthorized("/v1/me", { method: "GET" }, identity));
  const refusedSent = await sentSince(after, from);
  check(
    "another 401 for an access token: the request goes again with the session token and the user stays signed in",
    sameShape(refusedSent, ["GET /v1/me access 401", "GET /v1/me session 200"]) &&
      afterManager.getState().status === "signed_in",
    shapeOf(refusedSent),
  );

  from = await sentCount(after);
  await runCauseEffect(afterManager.requestAuthorized("/v1/me", { method: "GET" }, identity));
  await runCauseEffect(afterManager.logout());
  const signOut = await sentSince(after, from);
  check(
    "sign-out sends the session token to POST /v1/auth/logout, and the desktop is signed out",
    signOut.at(-1)?.path === "/v1/auth/logout" &&
      signOut.at(-1)?.bearer === "session" &&
      signOut.at(-1)?.status === 200 &&
      afterManager.getState().status === "signed_out",
    shapeOf(signOut),
  );
  await runCauseEffect(afterManager.dispose());

  const failingToken = sessionToken("failing");
  const failing = await startService({ addSessions: [failingToken], mode: "failing" });
  const failingManager = await signedInManager(failing, failingToken);
  from = await sentCount(failing);
  await runCauseEffect(failingManager.listRemoteHosts());
  await runCauseEffect(failingManager.listRemoteHosts());
  await failing.control({ mode: "present" });
  await runCauseEffect(failingManager.listRemoteHosts());
  const failingSent = await sentSince(failing, from);
  check(
    "another issue error: that request sends the session token, and the next request tries the route again",
    sameShape(failingSent, [
      "POST /v1/auth/access-token session 503",
      "GET /v2/remote/hosts/ session 200",
      "POST /v1/auth/access-token session 503",
      "GET /v2/remote/hosts/ session 200",
      "POST /v1/auth/access-token session 200",
      "GET /v2/remote/hosts/ access 200",
    ]),
    shapeOf(failingSent),
  );
  await runCauseEffect(failingManager.dispose());

  const burstToken = sessionToken("burst");
  const burst = await startService({ addSessions: [burstToken] });
  const burstManager = await signedInManager(burst, burstToken);
  from = await sentCount(burst);
  await Promise.all(Array.from({ length: 8 }, () => runCauseEffect(burstManager.listRemoteHosts())));
  const burstSent = await sentSince(burst, from);
  check(
    "eight requests at the same time share one access-token request",
    burstSent.filter((entry) => entry.path === "/v1/auth/access-token").length === 1 &&
      burstSent.filter((entry) => entry.path === "/v2/remote/hosts/").length === 8 &&
      burstSent.filter((entry) => entry.path === "/v2/remote/hosts/").every((entry) => entry.bearer === "access"),
    shapeOf(burstSent),
  );
  await runCauseEffect(burstManager.dispose());

  const directoryToken = sessionToken("directory");
  const directoryService = await startService({ addSessions: [directoryToken] });
  const directory = new RemoteTeamDirectoryClient({
    apiUrl: directoryService.url,
    token: directoryToken,
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => fetch(input, init), {
      preconnect: fetch.preconnect,
    }),
    verifyHostKeySignature: () => Effect.succeed(false),
  });
  await Effect.runPromise(directory.listHosts());
  await Effect.runPromise(directory.listHosts());
  await directoryService.control({ expireNextAccess: true });
  await Effect.runPromise(directory.listHosts());
  const directorySent = (await directoryService.log()).sent;
  check(
    "the shared team client (mobile, share extension, browser extension) uses one access token and handles access_token_expired",
    sameShape(directorySent, [
      "POST /v1/auth/access-token session 200",
      "GET /v2/remote/hosts/ access 200",
      "GET /v2/remote/hosts/ access 200",
      "GET /v2/remote/hosts/ access 401",
      "POST /v1/auth/access-token session 200",
      "GET /v2/remote/hosts/ access 200",
    ]),
    shapeOf(directorySent),
  );

  Bun.plugin({
    name: "expo-fetch-for-bun",
    setup(build) {
      build.module("expo/fetch", () => ({ exports: { fetch: globalThis.fetch }, loader: "object" }));
    },
  });
  const mobile = await loadMobileAccountFetch();
  const mobileToken = sessionToken("mobile");
  const mobileService = await startService({ addSessions: [mobileToken] });
  const credential = { apiUrl: mobileService.url, sessionToken: mobileToken };
  const mobileStatuses: number[] = [];
  mobileStatuses.push((await mobile.fetchMobileAccount(credential, "/v1/me")).status);
  await mobileService.control({ expireNextAccess: true });
  mobileStatuses.push(
    (await mobile.fetchMobileAccount(credential, "/v1/me/analytics", { method: "PUT", body: "{}" })).status,
  );
  mobileStatuses.push((await mobile.fetchMobileAccount(credential, "/v1/me/billing")).status);
  mobile.forgetMobileAccountAccess(mobileToken);
  mobileStatuses.push((await mobile.fetchMobileAccount(credential, "/v1/me")).status);
  const mobileSent = (await mobileService.log()).sent;
  check(
    "the mobile account fetch module (under Bun, expo/fetch mapped to fetch) sends access tokens and handles access_token_expired and sign-out",
    mobileStatuses.every((status) => status === 200) &&
      sameShape(mobileSent, [
        "POST /v1/auth/access-token session 200",
        "GET /v1/me access 200",
        "PUT /v1/me/analytics access 401",
        "POST /v1/auth/access-token session 200",
        "PUT /v1/me/analytics access 200",
        "GET /v1/me/billing session 200",
        "POST /v1/auth/access-token session 200",
        "GET /v1/me access 200",
      ]),
    shapeOf(mobileSent),
  );

  let clock = Date.now();
  const timedToken = sessionToken("clock");
  const timedService = await startService({ addSessions: [timedToken], clock });
  const hourService = await startService({ addSessions: [timedToken], clock });
  const missingService = await startService({ addSessions: [timedToken], clock, mode: "missing" });
  const clockServices = [timedService, hourService, missingService];
  const advance = async (milliseconds: number) => {
    clock += milliseconds;
    await Promise.all(clockServices.map((service) => service.control({ clock })));
  };
  const request = (service: FakeAccountService) => ({
    apiUrl: service.url,
    sessionToken: timedToken,
    path: "/v2/remote/hosts/",
    method: "GET",
    fetch: (input: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) =>
      fetch(input, init),
  });

  const tokens = new AccountAccessTokens({ now: () => clock });
  const bearer = () => Effect.runPromise(tokens.bearer(request(timedService)));
  const first = await bearer();
  await advance(Math.floor(ACCESS_LIFETIME_MS * 0.8) - 2_000);
  const beforeRefresh = await bearer();
  await advance(3_000);
  const afterRefresh = await bearer();
  const timedIssued = (await timedService.log()).issued;
  check(
    "the access token stays in use until 80% of its lifetime, then the client gets a new one",
    first.startsWith("oba1.") &&
      beforeRefresh === first &&
      afterRefresh !== first &&
      afterRefresh.startsWith("oba1.") &&
      timedIssued.length === 2,
    { issued: timedIssued.length },
  );

  const hourTokens = new AccountAccessTokens({ now: () => clock });
  for (let second = 0; second < 3_600; second += 30) {
    await Effect.runPromise(hourTokens.bearer(request(hourService)));
    await advance(30_000);
  }
  const hourLog = await hourService.log();
  d1.oneHourAtOneRequestPer30s = {
    requests: 120,
    sessionLookupsBefore: 120,
    sessionLookupsAfter: hourLog.issued.length,
    d1QueriesOfIssueCalls: hourLog.sent.reduce((sum, entry) => sum + entry.d1Reads + entry.d1Writes, 0),
  };
  check(
    "one hour at one request each 30 s needs 8 access tokens",
    hourLog.issued.length === 8,
    d1.oneHourAtOneRequestPer30s,
  );

  const missingTokens = new AccountAccessTokens({ now: () => clock });
  const firstMissing = await Effect.runPromise(missingTokens.bearer(request(missingService)));
  await advance(59 * 60_000);
  const stillMissing = await Effect.runPromise(missingTokens.bearer(request(missingService)));
  await missingService.control({ mode: "present" });
  await advance(2 * 60_000);
  const retried = await Effect.runPromise(missingTokens.bearer(request(missingService)));
  const missingSent = (await missingService.log()).sent;
  check(
    "route 404: the client tries the route again only after 1 h",
    firstMissing === timedToken &&
      stillMissing === timedToken &&
      retried.startsWith("oba1.") &&
      sameShape(missingSent, ["POST /v1/auth/access-token session 404", "POST /v1/auth/access-token session 200"]),
    shapeOf(missingSent),
  );

  const sessionOnlyPaths = [
    ["POST", "/v1/auth/logout"],
    ["POST", "/v1/auth/logout-all"],
    ["DELETE", "/v1/me"],
    ["POST", "/v1/me/email"],
    ["GET", "/v1/me/billing/portal"],
    ["GET", "/v1/me/license"],
    ["GET", "/v1/mobile-auth/devices?includeDesktop=true"],
    ["POST", "/v1/mobile-auth/session/revoke"],
  ];
  const accessPaths = [
    ["GET", "/v1/me"],
    ["PUT", "/v1/me/analytics"],
    ["GET", "/v2/remote/hosts/"],
    ["POST", "/v2/hosting/servers/x/wake"],
  ];
  check(
    "sign-out, account delete, email change, billing, license and the session list are session-token paths",
    sessionOnlyPaths.every(([method, path]) => requiresAccountSessionToken(path ?? "", method)) &&
      accessPaths.every(([method, path]) => !requiresAccountSessionToken(path ?? "", method)),
  );

  const issuedToken = timedIssued[0] ?? "";
  check(
    "the log redaction hides an issued access token",
    issuedToken.startsWith("oba1.") &&
      !redactText(`Bearer ${issuedToken}`).includes(issuedToken) &&
      !redactText(JSON.stringify({ accessToken: issuedToken })).includes(issuedToken) &&
      !redactPostText(`token ${issuedToken}`).includes(issuedToken),
  );

  passed = checks.every((entry) => entry.passed);
} catch (error) {
  failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  for (const service of services) service.stop();
  await rm(temporary, { recursive: true, force: true });
}

const report = {
  passed,
  failure,
  d1,
  d1Method:
    "Account service process: the real D1AuthRepository.authenticate on SQLite with all migrations, D1 statements counted per request; an access token is checked by signature only. Before = the headers that origin/main sends (the session token on each request), measured on the 404 fallback path.",
  checks,
};
await mkdir(OUT, { recursive: true });
await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
const output = [
  ...checks.map((entry) => `${entry.passed ? "ok" : "FAIL"} ${entry.name}`),
  JSON.stringify(d1, null, 2),
  ...(failure ? [failure] : []),
  ...(passed ? [] : checks.filter((item) => !item.passed).map((entry) => JSON.stringify(entry.detail, null, 2))),
];
process.stdout.write(`${output.join("\n")}\nreport in ${join(OUT, "report.json")}\n`);
process.exit(passed ? 0 : 1);
