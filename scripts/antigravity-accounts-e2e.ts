// Adds a second Gemini account end to end on the real driver, `ProviderRuntime` and account store,
// with a fake Antigravity CLI that prints its version, takes its folders as `--gemini-dir` (an absolute
// path) and `--app-data-dir`, and keeps its token in `antigravity-oauth-token` there, as
// the CLI 1.5.3 and later do when `WSL_DISTRO_NAME` is set. A local `node:http` fake of Google's Code
// Assist service (`OPENBOT_DEV_ANTIGRAVITY_CODE_ASSIST_URL`) answers the usage reads. Checks that a
// CLI before 1.5.3 offers no account after the first; that the first spawn copies the refresh token of
// a 1.4 `acp_token.json` into a new token file at mode 0600 before the CLI starts, writes the sign-in
// method and a marker, and keeps the old file; that a sign-in on the host opens Google's page through
// OpenBot's `open` command and writes the token in the account's folder only; that every process gets
// the flags of its own folder and `WSL_DISTRO_NAME`, that the first account keeps the saved API key and
// no account process gets it; that the account lists its own models (#5217) and its usage reading sends
// only its own token; that a Reconnect signs the account out first; that Remove deletes the folder;
// that a new account stays when its usage reading fails after the sign-in; that the first account's
// token files are never changed or moved; that the marker stops a second copy after the new token is
// deleted; and that a 1.4 folder whose settings name another sign-in is not copied.
// `bun scripts/antigravity-accounts-e2e.ts`.
// Writes .openbot-build/antigravity-accounts-e2e/report.json.
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
const GOOGLE_PAGE = "https://accounts.google.com/o/oauth2/auth?client_id=fake&state=fake";
const PROJECT = "fake-account-project";
const TOKEN_FILE = "antigravity-oauth-token";
const LEGACY_TOKEN_FILE = "acp_token.json";
const MARKER = "openbot-token-imported";

// Each process appends its argv, its folder and its environment, and each method it was called with,
// to `FAKE_AGY_LOG`. The folder comes from the flags only, as the real CLI ignores `GEMINI_HOME`.
// `authenticate` with `oauth-personal` gives Google's page to the `open` (macOS) or `xdg-open` (Linux)
// command that it finds first on `PATH`, as the real CLI does. It runs only OpenBot's own command, in
// an `openbot-sign-in-*` folder, so no real browser opens. It writes the token when the file
// `FAKE_AGY_APPROVE` exists: the test writes it when the page opens. A folder other than
// `FAKE_AGY_FREE_HOME` is a paid plan, which also serves `gemini-fake-pro`.
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
          id_token_email: "",
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
// The first account's folder: the runtime's own processes inherit it. Never the user's `~/.gemini`.
process.env.GEMINI_HOME = defaultHome;
delete process.env.OPENBOT_ANTIGRAVITY_PATH;

/** Code Assist answers each usage read; `usageFails` makes it answer 500. */
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

/** A managed install, `<root>/<version>/bin/antigravity`. */
async function cli(version: string): Promise<string> {
  const executable = join(root, "antigravity", version, "bin", "antigravity");
  await mkdir(join(root, "antigravity", version, "bin"), { recursive: true });
  await writeFile(executable, fakeAntigravity(version));
  await chmod(executable, 0o755);
  return executable;
}

/** Writes a 1.4 server's folder: its token file and, when given, the chosen sign-in. */
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

/** The agents that run a turn now. */
const busyAgents = new Set<string>();

function createRuntime(executable: string, accounts: ProviderAccountStore): ProviderRuntime {
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
    credentials: { ...NO_PROVIDER_CREDENTIALS, apiKey: (provider) => (provider === "antigravity" ? SAVED_KEY : null) },
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

/** Opens Google's page as a host's live view does: the user finishes the sign-in there. */
const pageOpened: string[] = [];
async function openPage(url: string): Promise<void> {
  pageOpened.push(url);
  await writeFile(approve, "");
}

/** Whether a process got the flags of `home` and `WSL_DISTRO_NAME`, as the driver must pass them. */
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
  // The first account was signed in on 1.4: its token is in the old file.
  const defaultLegacy = await legacyFolder(defaultData, "first-account", "oauth-personal");

  // 1. A CLI before 1.5.3 may ignore the folder flags, so it offers no account after the first.
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

  // The first spawn copied the 1.4 refresh token before the CLI started, and kept the old file.
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

  // 2. A sign-in on the host: Google's page opens, and the token goes in the account's folder.
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
  assert.deepEqual(pageOpened, [GOOGLE_PAGE]);
  assert.equal(report.signIn.accountState, "connected");
  assert.ok(tokenInAccount);
  assert.equal(await readFile(join(defaultData, TOKEN_FILE), "utf8"), imported);
  assert.equal(await readFile(join(defaultData, LEGACY_TOKEN_FILE), "utf8"), defaultLegacy);

  // The account check reads the account's own models: its plan serves one that the first account's
  // does not, and the catalogue of the first account stays as it was. The row carries only that one;
  // the picker adds it to the catalogue, which keeps the models an admin turned off out (#5217).
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

  // 3. The first account keeps the saved key. Every process of the new account runs in its folder,
  // the sign-in and the account check included, and none of them gets the key. Each process gets the
  // folder flags and `WSL_DISTRO_NAME`.
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

  // The check read the account's usage from Code Assist with its own token. The first account has a
  // saved key, so its token is never sent.
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

  // 4. A Reconnect signs the account out, so it waits while an agent on the account runs a turn.
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

  // When no turn runs, it stops the agent's process, which kept the old token, and signs out first.
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
  assert.equal(pageOpened.length, 2);

  // A usage read of an idle account starts no process.
  const startsBeforeUsage = (await entries()).filter((entry) => entry.event === "start").length;
  await runCauseEffect(runtime.accountUsage());
  report.idleUsage = {
    processesStarted: (await entries()).filter((entry) => entry.event === "start").length - startsBeforeUsage,
  };
  assert.equal(report.idleUsage.processesStarted, 0);

  // 5. Remove deletes the account's folder with its token.
  await runCauseEffect(runtime.removeProviderAccount("antigravity", account.id));
  report.remove = { folderLeft: await exists(accountHome), rows: accountRows(runtime)?.length ?? 0 };
  assert.equal(report.remove.folderLeft, false);
  assert.equal(report.remove.rows, 1);

  // 6. A new account whose usage reading fails after the sign-in stays: the sign-in worked.
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

  // The first account's token files were never changed or moved.
  report.firstAccountTokens = {
    legacyUnchanged: (await readFile(join(defaultData, LEGACY_TOKEN_FILE), "utf8")) === defaultLegacy,
    importedUnchanged: (await readFile(join(defaultData, TOKEN_FILE), "utf8")) === imported,
  };
  assert.ok(report.firstAccountTokens.legacyUnchanged);
  assert.ok(report.firstAccountTokens.importedUnchanged);
  await stop(runtime);
  runtime = undefined;

  // 7. The marker stops a second copy: after a sign-out deletes the new token, the old one must not
  // sign the account in again.
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

  // 8. A 1.4 folder whose settings name the API key sign-in: its token is not a Google sign-in to copy.
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
