import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ProviderAccountStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Cause, Effect, Exit } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderAccountStore } from "../src/backend/agent/provider-account-store";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-accounts-e2e");
const SAVED_KEY = "fake-gemini-key-for-the-first-account";
const GOOGLE_PAGE = "https://accounts.google.com/o/oauth2/auth?client_id=fake&state=fake&prompt=consent";
const GOOGLE_PAGE_WITH_CHOOSER =
  "https://accounts.google.com/o/oauth2/auth?client_id=fake&state=fake&prompt=consent+select_account";
const PROJECT = "fake-account-project";
const TOKEN_FILE = "antigravity-oauth-token";
const LEGACY_TOKEN_FILE = "acp_token.json";
const MARKER = "openbot-token-imported";
const SAME_EMAIL = "same.person@example.com";

const fakeAntigravity = (version: string) => `#!/usr/bin/env node
if (process.argv[2] === "--version") {
  process.stdout.write("${version}\\n");
  process.exit(0);
}
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const NL = String.fromCharCode(10);
const flag = (name) => {
  const value = process.argv.find((arg) => arg.startsWith("--" + name + "="));
  return value === undefined ? null : value.slice(name.length + 3);
};
const geminiDir = flag("gemini-dir");
const appDataDir = flag("app-data-dir");
const home = geminiDir === null ? null : path.resolve(os.homedir(), geminiDir);
const token = home && appDataDir ? path.join(home, appDataDir, "${TOKEN_FILE}") : null;
const log = (entry) => fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({
  pid: process.pid, home, key: process.env.GEMINI_API_KEY ?? null, ...entry,
}) + NL);
log({
  event: "start",
  argv: process.argv.slice(2),
  wsl: process.env.WSL_DISTRO_NAME ?? null,
  tokenAtStart: token !== null && fs.existsSync(token),
});
let keyAuthenticated = false;
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
function openPage(id) {
  const first = (process.env.PATH || "").split(path.delimiter)[0] || "";
  const program = path.join(first, process.platform === "darwin" ? "open" : "xdg-open");
  if (!path.basename(first).startsWith("openbot-sign-in-") || !fs.existsSync(program)) {
    write({ id, error: { code: -32603, message: "OpenBot's open command is not first on PATH." } });
    return false;
  }
  require("node:child_process").execFileSync(program, ["${GOOGLE_PAGE}"]);
  return true;
}
function handle(message) {
  if (message.id === undefined) return;
  if (message.method) log({ event: message.method, methodId: message.params?.methodId ?? null });
  switch (message.method) {
    case "initialize":
      return write({ id: message.id, result: {
        protocolVersion: 1,
        agentCapabilities: { auth: { logout: {} } },
        authMethods: [{ id: "oauth-personal", name: "Google" }, { id: "gemini-api-key", name: "Key" }],
      } });
    case "logout":
      if (token) fs.rmSync(token, { force: true });
      return write({ id: message.id, result: {} });
    case "authenticate":
      if (message.params.methodId === "gemini-api-key") {
        keyAuthenticated = Boolean(process.env.GEMINI_API_KEY);
        return write({ id: message.id, result: {} });
      }
      if (!token || !openPage(message.id)) return;
      const wait = setInterval(() => {
        if (!fs.existsSync(process.env.FAKE_AGY_APPROVE)) return;
        clearInterval(wait);
        fs.rmSync(process.env.FAKE_AGY_APPROVE);
        fs.mkdirSync(path.dirname(token), { recursive: true });
        fs.writeFileSync(token, JSON.stringify({
          token: {
            access_token: "access:" + home, token_type: "Bearer", refresh_token: "fake",
            expiry: new Date(Date.now() + 3600000).toISOString(),
          },
          auth_method: "consumer",
          id_token_email: process.env.FAKE_AGY_EMAIL ?? "",
        }), { mode: 0o600 });
        write({ id: message.id, result: {} });
      }, 20);
      return;
    case "session/new":
      if (!keyAuthenticated && !(token && fs.existsSync(token)))
        return write({ id: message.id, error: { code: -32000, message: "Authentication required" } });
      return write({ id: message.id, result: {
        sessionId: "s-" + message.id,
        models: {
          availableModels: [
            { modelId: "gemini-fake", name: "Gemini Fake" },
            ...(home === process.env.FAKE_AGY_FREE_HOME ? [] : [{ modelId: "gemini-fake-pro", name: "Gemini Fake Pro" }]),
          ],
          currentModelId: "gemini-fake",
        },
      } });
    case "session/prompt":
      return write({ id: message.id, result: { stopReason: "end_turn" } });
    default:
      return write({ id: message.id, result: {} });
  }
}
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf(NL)) >= 0) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line.trim()) handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
`;

interface LogEntry {
  pid: number;
  home: string | null;
  key: string | null;
  event: string;
  methodId?: string | null;
  argv?: string[];
  wsl?: string | null;
  tokenAtStart?: boolean;
}

interface QuotaCall {
  path: string | undefined;
  authorization: string | undefined;
}

interface Report {
  passed: boolean;
  oldRuntime?: { accounts: boolean; connectError: string };
  tokenImport?: {
    tokenAtFirstStart: boolean | undefined;
    mode: string;
    refreshTokenKept: boolean;
    accessToken: string;
    authState: unknown;
    marker: boolean;
    legacyKept: boolean;
  };
  signIn?: { pageOpened: string[]; accountState: string | undefined; tokenInAccount: boolean };
  models?: { firstAccount: string[]; account: string[] };
  processes?: {
    firstAccountHasKey: boolean;
    accountProcesses: number;
    accountProcessesWithKey: number;
    argv: string[][];
    wsl: (string | null | undefined)[];
  };
  accountUsage?: { quotaCalls: QuotaCall[]; usedPercent: number | undefined };
  idleUsage?: { processesStarted: number };
  busyReconnect?: { error: string; loggedOut: boolean; agentProcessKept: boolean };
  reconnect?: { logoutFirst: boolean; agentProcessStopped: boolean; accountState: string | undefined };
  remove?: { folderLeft: boolean; rows: number };
  failedUsage?: { quotaCalls: number; stored: number; accountState: string | undefined };
  firstAccountTokens?: { legacyUnchanged: boolean; importedUnchanged: boolean };
  noSecondImport?: { tokenAtStart: boolean | undefined; tokenFile: boolean; legacyUnchanged: boolean };
  otherSignIn?: { tokenFile: boolean; marker: boolean; legacyUnchanged: boolean; started: boolean };
  sameLogin?: { ownEmailAtStart: string | null; error: string; stored: number; rows: number };
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-accounts-e2e-"));
const log = join(root, "agy.jsonl");
const approve = join(root, "approve");
const defaultHome = join(root, "default-gemini");
const defaultData = join(defaultHome, "antigravity-acp");
const report: Report = { passed: false };
const savedEnvironment = {
  GEMINI_HOME: process.env.GEMINI_HOME,
  OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL: process.env.OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL,
};
process.env.FAKE_AGY_LOG = log;
process.env.FAKE_AGY_APPROVE = approve;
process.env.FAKE_AGY_FREE_HOME = defaultHome;
process.env.GEMINI_HOME = defaultHome;
delete process.env.OPENBOT_ANTIGRAVITY_PATH;

const quotaCalls: QuotaCall[] = [];
let usageFails = false;
const quotaServer = createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    quotaCalls.push({ path: request.url, authorization: request.headers.authorization });
    response.setHeader("Content-Type", "application/json");
    if (usageFails) {
      response.statusCode = 500;
      return response.end(JSON.stringify({ error: { code: 500, message: "Quota service unavailable" } }));
    }
    if (request.url === "/v1internal:loadCodeAssist")
      return response.end(JSON.stringify({ cloudaicompanionProject: PROJECT }));
    response.end(
      JSON.stringify({
        groups: [
          {
            displayName: "Gemini Models",
            description: "Models within this group: Gemini Flash, Gemini Pro",
            buckets: [
              {
                displayName: "Weekly Limit Remaining",
                window: "weekly",
                resetTime: "2026-11-17T11:59:31Z",
                remainingFraction: 0.5,
              },
            ],
          },
        ],
      }),
    );
  });
});
await new Promise<void>((done) => quotaServer.listen(0, "127.0.0.1", done));
const quotaAddress = quotaServer.address();
assert.ok(quotaAddress !== null && typeof quotaAddress === "object");
process.env.OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL = `http://127.0.0.1:${quotaAddress.port}/v1internal`;

async function entries(): Promise<LogEntry[]> {
  const text = await readFile(log, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function cli(version: string): Promise<string> {
  const executable = join(root, "antigravity", version, "bin", "antigravity");
  await mkdir(join(root, "antigravity", version, "bin"), { recursive: true });
  await writeFile(executable, fakeAntigravity(version));
  await chmod(executable, 0o755);
  return executable;
}

async function legacyFolder(folder: string, refreshToken: string, signIn?: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  const legacy = JSON.stringify({
    access_token: "old-access",
    refresh_token: refreshToken,
    token_type: "Bearer",
    expiry: "2026-10-01T00:00:00Z",
  });
  await writeFile(join(folder, LEGACY_TOKEN_FILE), legacy, { mode: 0o600 });
  if (signIn) await writeFile(join(folder, "settings.json"), JSON.stringify({ auth: { type: signIn } }));
  return legacy;
}

const database = new OpenBotDatabase(join(root, "profile"));
const agents = new AgentStore(join(root, "profile"), join(root, "home"), database);

const busyAgents = new Set<string>();

function createRuntime(
  executable: string,
  accounts: ProviderAccountStore,
  savedKey: string | null = SAVED_KEY,
): ProviderRuntime {
  return new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "antigravity"),
    conversation: new ConversationRuntime(
      agents,
      () => undefined,
      () => agents.list(),
    ),
    hooks: {
      bindClient: () => undefined,
      onProvidersReady: () => Effect.void,
      onProviderLost: () => undefined,
      onClientStopped: () => Effect.void,
      isStopping: () => false,
      isProviderBusy: () => false,
      isAgentBusy: (agentId) => busyAgents.has(agentId),
      isProviderAssigned: () => true,
      onAgentClientLost: () => Effect.void,
      sharedRoot: () => join(root, "shared"),
      onProviderResumed: () => undefined,
      onProviderActivated: () => Effect.void,
      captureConfigRevision: () => 0,
    },
    emit: () => undefined,
    emitError: () => undefined,
    requestTimeoutMs: 5_000,
    preferredProvider: "antigravity",
    clientFactory: null,
    bundledExecutables: { antigravity: executable },
    credentials: { ...NO_PROVIDER_CREDENTIALS, apiKey: (provider) => (provider === "antigravity" ? savedKey : null) },
    accounts,
    redactMcp: (text) => text,
  });
}

function accountRows(runtime: ProviderRuntime): ProviderAccountStatus[] | undefined {
  return runtime.status().providers?.find((row) => row.id === "antigravity")?.accounts;
}

async function stop(runtime: ProviderRuntime): Promise<void> {
  for (const client of await runCauseEffect(runtime.dispose())) await runCauseEffect(client.stop());
}

const pageOpened: string[] = [];
async function openPage(url: string): Promise<void> {
  pageOpened.push(url);
  await writeFile(approve, "");
}

function startedIn(entry: LogEntry, home: string): boolean {
  const geminiDir = entry.argv?.find((arg) => arg.startsWith("--gemini-dir="))?.slice("--gemini-dir=".length);
  return (
    entry.argv?.[0] === "acp" &&
    geminiDir !== undefined &&
    geminiDir === home &&
    entry.argv.includes("--app-data-dir=antigravity-acp") &&
    entry.wsl === "OpenBot"
  );
}

let runtime: ProviderRuntime | undefined;
try {
  const defaultLegacy = await legacyFolder(defaultData, "first-account", "oauth-personal");

  const oldStore = new ProviderAccountStore(join(root, "old-accounts.json"), join(root, "old-accounts"));
  await runCauseEffect(oldStore.load());
  runtime = createRuntime(await cli("1.5.2"), oldStore);
  await runCauseEffect(runtime.ensureProvider("antigravity"));
  assert.equal(runtime.status().providers?.find((row) => row.id === "antigravity")?.state, "available");
  const oldExit = await Effect.runPromiseExit(runtime.connectProviderAccount("antigravity", null, openPage));
  assert.ok(Exit.isFailure(oldExit));
  const oldError = Cause.squash(oldExit.cause);
  const connectError = oldError instanceof Error && oldError.cause instanceof Error ? oldError.cause.message : "";
  report.oldRuntime = { accounts: accountRows(runtime) !== undefined, connectError };
  assert.equal(report.oldRuntime.accounts, false);
  assert.equal(connectError, sourceText("error.provider.accountsUnsupported", { provider: "Gemini" }));
  assert.equal(oldStore.list().length, 0);

  const imported = await readFile(join(defaultData, TOKEN_FILE), "utf8");
  const importedToken = JSON.parse(imported);
  report.tokenImport = {
    tokenAtFirstStart: (await entries()).find((entry) => entry.event === "start")?.tokenAtStart,
    mode: ((await stat(join(defaultData, TOKEN_FILE))).mode & 0o777).toString(8),
    refreshTokenKept: importedToken.token?.refresh_token === "first-account",
    accessToken: importedToken.token?.access_token,
    authState: JSON.parse(await readFile(join(defaultData, "cache", "acp-auth-state.json"), "utf8")),
    marker: await exists(join(defaultData, MARKER)),
    legacyKept: (await readFile(join(defaultData, LEGACY_TOKEN_FILE), "utf8")) === defaultLegacy,
  };
  assert.equal(report.tokenImport.tokenAtFirstStart, true, "the copy is made before the CLI starts");
  assert.equal(report.tokenImport.mode, "600");
  assert.ok(report.tokenImport.refreshTokenKept, "the same refresh token");
  assert.deepEqual(importedToken, {
    token: { access_token: "", token_type: "Bearer", refresh_token: "first-account", expiry: "2000-01-01T00:00:00Z" },
    auth_method: "consumer",
    id_token_email: "",
  });
  assert.deepEqual(report.tokenImport.authState, { methodId: "oauth-personal" });
  assert.ok(report.tokenImport.marker, "the marker is written");
  assert.ok(report.tokenImport.legacyKept, "the old token file stays");
  await stop(runtime);
  runtime = undefined;

  await rm(log, { force: true });
  const store = new ProviderAccountStore(join(root, "accounts.json"), join(root, "accounts"));
  await runCauseEffect(store.load());
  runtime = createRuntime(await cli("1.5.4"), store);
  await runCauseEffect(runtime.ensureProvider("antigravity"));
  assert.equal(accountRows(runtime)?.length, 1, "the first account only");
  await runCauseEffect(runtime.signInProviderAccountOnHost("antigravity", null, openPage));
  const [account] = store.list("antigravity");
  assert.ok(account);
  const accountHome = store.home(account);
  const tokenInAccount = await exists(join(accountHome, "antigravity-acp", TOKEN_FILE));
  report.signIn = { pageOpened: [...pageOpened], accountState: accountRows(runtime)?.[1]?.state, tokenInAccount };
  assert.deepEqual(pageOpened, [GOOGLE_PAGE_WITH_CHOOSER], "Google shows the account chooser for a new account");
  assert.equal(report.signIn.accountState, "connected");
  assert.ok(tokenInAccount);
  assert.equal(await readFile(join(defaultData, TOKEN_FILE), "utf8"), imported);
  assert.equal(await readFile(join(defaultData, LEGACY_TOKEN_FILE), "utf8"), defaultLegacy);

  report.models = {
    firstAccount: runtime
      .listModels()
      .filter((model) => model.provider === "antigravity")
      .map((model) => model.id),
    account: accountRows(runtime)?.[1]?.models?.map((model) => model.id) ?? [],
  };
  assert.deepEqual(report.models.account, ["gemini-fake-pro"], "the row carries only the account's own model");
  assert.ok(!report.models.firstAccount.includes("gemini-fake-pro"), "the first account does not list it");
  assert.deepEqual(
    runtime.accountModels("antigravity", account.id).map((model) => model.id),
    ["gemini-fake", "gemini-fake-pro"],
  );

  const starts = (await entries()).filter((entry) => entry.event === "start");
  const firstAccount = starts.filter((entry) => entry.home === defaultHome);
  const accountProcesses = starts.filter((entry) => entry.home === accountHome);
  report.processes = {
    firstAccountHasKey: firstAccount.length > 0 && firstAccount.every((entry) => entry.key === SAVED_KEY),
    accountProcesses: accountProcesses.length,
    accountProcessesWithKey: accountProcesses.filter((entry) => entry.key !== null).length,
    argv: starts.map((entry) => entry.argv ?? []),
    wsl: starts.map((entry) => entry.wsl),
  };
  assert.ok(report.processes.firstAccountHasKey);
  assert.ok(accountProcesses.length >= 2, "a sign-in process and a check process");
  assert.equal(report.processes.accountProcessesWithKey, 0);
  assert.equal(starts.length, firstAccount.length + accountProcesses.length, "no process in another folder");
  assert.ok(
    firstAccount.every((entry) => startedIn(entry, defaultHome)),
    "the first account's flags",
  );
  assert.ok(
    accountProcesses.every((entry) => startedIn(entry, accountHome)),
    "the account's flags",
  );
  assert.ok(
    !(await entries()).some((entry) => entry.home === accountHome && entry.methodId === "gemini-api-key"),
    "an account process never authenticates with the key",
  );

  const usage = await runCauseEffect(runtime.accountUsage());
  report.accountUsage = {
    quotaCalls: [...quotaCalls],
    usedPercent: usage.limits.find((limit) => limit.accountId === account.id)?.secondary?.usedPercent,
  };
  assert.ok(
    quotaCalls.some((call) => call.path === "/v1internal:retrieveUserQuotaSummary"),
    "the check read the account's quota",
  );
  assert.ok(
    quotaCalls.every((call) => call.authorization === `Bearer access:${accountHome}`),
    "only the account's own token is sent",
  );
  assert.equal(report.accountUsage.usedPercent, 50, "the account's reading is its own quota");

  await runCauseEffect(agents.initialize());
  const created = await runCauseEffect(
    agents.createAgent({ name: "Second", description: "", avatarSeed: "second", avatarHue: null }),
  );
  const agent = { ...created, provider: "antigravity" as const, providerAccountId: account.id };
  await runCauseEffect(runtime.ensureAgentClient(agent));
  assert.ok(runtime.runsOnOwnProcess(agent.id), "the agent runs on the account's own process");
  await rm(log, { force: true });
  busyAgents.add(agent.id);
  const busyExit = await Effect.runPromiseExit(
    runtime.signInProviderAccountOnHost("antigravity", account.id, openPage),
  );
  busyAgents.delete(agent.id);
  const busyError = Exit.isFailure(busyExit) ? Cause.squash(busyExit.cause) : null;
  report.busyReconnect = {
    error: busyError instanceof Error && busyError.cause instanceof Error ? busyError.cause.message : "",
    loggedOut: (await entries()).some((entry) => entry.event === "logout"),
    agentProcessKept: runtime.runsOnOwnProcess(agent.id),
  };
  assert.equal(report.busyReconnect.error, sourceText("error.provider.cliBusyReconnect", { provider: "Gemini" }));
  assert.equal(report.busyReconnect.loggedOut, false);
  assert.ok(report.busyReconnect.agentProcessKept);

  await runCauseEffect(runtime.signInProviderAccountOnHost("antigravity", account.id, openPage));
  const reconnect = (await entries()).filter(
    (entry) => entry.home === accountHome && (entry.event === "logout" || entry.event === "authenticate"),
  );
  report.reconnect = {
    logoutFirst: reconnect[0]?.event === "logout" && reconnect[1]?.methodId === "oauth-personal",
    agentProcessStopped: !runtime.runsOnOwnProcess(agent.id),
    accountState: accountRows(runtime)?.[1]?.state,
  };
  assert.ok(report.reconnect.logoutFirst);
  assert.ok(report.reconnect.agentProcessStopped);
  assert.equal(report.reconnect.accountState, "connected");
  assert.deepEqual(pageOpened, [GOOGLE_PAGE_WITH_CHOOSER, GOOGLE_PAGE_WITH_CHOOSER]);

  const startsBeforeUsage = (await entries()).filter((entry) => entry.event === "start").length;
  await runCauseEffect(runtime.accountUsage());
  report.idleUsage = {
    processesStarted: (await entries()).filter((entry) => entry.event === "start").length - startsBeforeUsage,
  };
  assert.equal(report.idleUsage.processesStarted, 0);

  await runCauseEffect(runtime.removeProviderAccount("antigravity", account.id));
  report.remove = { folderLeft: await exists(accountHome), rows: accountRows(runtime)?.length ?? 0 };
  assert.equal(report.remove.folderLeft, false);
  assert.equal(report.remove.rows, 1);

  await rm(log, { force: true });
  quotaCalls.length = 0;
  usageFails = true;
  await runCauseEffect(runtime.signInProviderAccountOnHost("antigravity", null, openPage));
  const [failed] = store.list("antigravity");
  report.failedUsage = {
    quotaCalls: quotaCalls.length,
    stored: store.list("antigravity").length,
    accountState: accountRows(runtime)?.[1]?.state,
  };
  assert.ok(failed);
  assert.ok(
    quotaCalls.some((call) => call.authorization === `Bearer access:${store.home(failed)}`),
    "the check asked for the usage",
  );
  assert.equal(report.failedUsage.stored, 1);
  assert.equal(report.failedUsage.accountState, "connected");
  usageFails = false;

  report.firstAccountTokens = {
    legacyUnchanged: (await readFile(join(defaultData, LEGACY_TOKEN_FILE), "utf8")) === defaultLegacy,
    importedUnchanged: (await readFile(join(defaultData, TOKEN_FILE), "utf8")) === imported,
  };
  assert.ok(report.firstAccountTokens.legacyUnchanged);
  assert.ok(report.firstAccountTokens.importedUnchanged);
  await stop(runtime);
  runtime = undefined;

  await rm(join(defaultData, TOKEN_FILE));
  await rm(log, { force: true });
  runtime = createRuntime(await cli("1.5.4"), store);
  await runCauseEffect(runtime.ensureProvider("antigravity"));
  const restart = (await entries()).find((entry) => entry.event === "start" && entry.home === defaultHome);
  report.noSecondImport = {
    tokenAtStart: restart?.tokenAtStart,
    tokenFile: await exists(join(defaultData, TOKEN_FILE)),
    legacyUnchanged: (await readFile(join(defaultData, LEGACY_TOKEN_FILE), "utf8")) === defaultLegacy,
  };
  assert.equal(report.noSecondImport.tokenAtStart, false, "the process started");
  assert.equal(report.noSecondImport.tokenFile, false, "no second copy");
  assert.ok(report.noSecondImport.legacyUnchanged);
  await stop(runtime);
  runtime = undefined;

  const keyHome = join(root, "key-gemini");
  const keyData = join(keyHome, "antigravity-acp");
  const keyLegacy = await legacyFolder(keyData, "not-a-google-sign-in", "gemini-api-key");
  process.env.GEMINI_HOME = keyHome;
  await rm(log, { force: true });
  runtime = createRuntime(await cli("1.5.4"), store);
  await runCauseEffect(runtime.ensureProvider("antigravity"));
  report.otherSignIn = {
    tokenFile: await exists(join(keyData, TOKEN_FILE)),
    marker: await exists(join(keyData, MARKER)),
    legacyUnchanged: (await readFile(join(keyData, LEGACY_TOKEN_FILE), "utf8")) === keyLegacy,
    started: (await entries()).some((entry) => entry.event === "start" && startedIn(entry, keyHome)),
  };
  assert.ok(report.otherSignIn.started, "a process started in the folder");
  assert.equal(report.otherSignIn.tokenFile, false, "another sign-in is not copied");
  assert.equal(report.otherSignIn.marker, false);
  assert.ok(report.otherSignIn.legacyUnchanged);
  await stop(runtime);
  runtime = undefined;

  const sameHome = join(root, "same-gemini");
  const sameData = join(sameHome, "antigravity-acp");
  const ownToken = (email: string) =>
    JSON.stringify({
      token: { access_token: "own", token_type: "Bearer", refresh_token: "own", expiry: "2099-01-01T00:00:00Z" },
      auth_method: "consumer",
      id_token_email: email,
    });
  await mkdir(sameData, { recursive: true });
  await writeFile(join(sameData, MARKER), "");
  await writeFile(join(sameData, TOKEN_FILE), ownToken(""), { mode: 0o600 });
  process.env.GEMINI_HOME = sameHome;
  process.env.FAKE_AGY_EMAIL = SAME_EMAIL;
  const sameStore = new ProviderAccountStore(join(root, "same-accounts.json"), join(root, "same-accounts"));
  await runCauseEffect(sameStore.load());
  runtime = createRuntime(await cli("1.5.4"), sameStore, null);
  await runCauseEffect(runtime.ensureProvider("antigravity"));
  const ownEmailAtStart = accountRows(runtime)?.[0]?.email ?? null;
  await writeFile(join(sameData, TOKEN_FILE), ownToken(SAME_EMAIL), { mode: 0o600 });
  const sameExit = await Effect.runPromiseExit(runtime.signInProviderAccountOnHost("antigravity", null, openPage));
  delete process.env.FAKE_AGY_EMAIL;
  const sameError = Exit.isFailure(sameExit) ? Cause.squash(sameExit.cause) : null;
  report.sameLogin = {
    ownEmailAtStart,
    error: sameError instanceof Error && sameError.cause instanceof Error ? sameError.cause.message : "",
    stored: sameStore.list("antigravity").length,
    rows: accountRows(runtime)?.length ?? 0,
  };
  assert.equal(report.sameLogin.ownEmailAtStart, null, "the first account had no email when Gemini started");
  assert.equal(report.sameLogin.error, sourceText("error.provider.accountAlreadyAdded", { provider: "Gemini" }));
  assert.equal(report.sameLogin.stored, 0, "the second sign-in with the same Google account is not kept");
  assert.equal(report.sameLogin.rows, 1);

  report.passed = true;
} finally {
  if (runtime) await stop(runtime);
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await new Promise<void>((done) => quotaServer.close(() => done()));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  database.close();
}
process.stdout.write(`${report.passed ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
