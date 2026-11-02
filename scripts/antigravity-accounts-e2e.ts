// Adds a second Gemini account end to end on the real driver, `ProviderRuntime` and account store,
// with a fake Antigravity ACP server that keeps its token in `$GEMINI_HOME/antigravity-acp`, as
// runtime 1.4.0 and later do. Checks that a runtime before 1.4.0 offers no account after the first,
// that a sign-in on the host opens Google's page and writes the token in the account's folder only,
// that each process of that account gets the folder and never the saved API key while the first
// account keeps the key, that a Reconnect signs the account out first, that Remove deletes the
// folder, and that a new account stays when its usage reading fails after the sign-in.
// `bun scripts/antigravity-accounts-e2e.ts`.
// Writes .openbot-build/antigravity-accounts-e2e/report.json.
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ProviderAccountStatus } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Cause, Effect, Exit } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderAccountStore } from "../src/backend/agent/provider-account-store";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { ANTIGRAVITY_MANIFEST } from "../src/backend/cli";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

const OUT = resolve(import.meta.dirname, "../.openbot-build/antigravity-accounts-e2e");
const SAVED_KEY = "fake-gemini-key-for-the-first-account";
const GOOGLE_PAGE = "https://accounts.google.com/o/oauth2/v2/auth?client_id=fake&state=fake";

// Each process appends what it started with and each method it was called with to `FAKE_AGY_LOG`.
// `authenticate` with `oauth-personal` prints Google's page, as the real server does, and writes the
// token when the file `FAKE_AGY_APPROVE` exists: the test writes it when the page opens.
const FAKE_AGY = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const NL = String.fromCharCode(10);
const home = process.env.GEMINI_HOME || path.join(require("node:os").homedir(), ".gemini");
const token = path.join(home, "antigravity-acp", "acp_token.json");
const log = (entry) => fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({
  pid: process.pid, home, key: process.env.GEMINI_API_KEY ?? null, ...entry,
}) + NL);
log({ event: "start" });
let keyAuthenticated = false;
const write = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + NL);
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
      fs.rmSync(token, { force: true });
      return write({ id: message.id, result: {} });
    case "authenticate":
      if (message.params.methodId === "gemini-api-key") {
        keyAuthenticated = Boolean(process.env.GEMINI_API_KEY);
        return write({ id: message.id, result: {} });
      }
      process.stderr.write("Open the following link to authenticate the ACP server: ${GOOGLE_PAGE}" + NL);
      const wait = setInterval(() => {
        if (!fs.existsSync(process.env.FAKE_AGY_APPROVE)) return;
        clearInterval(wait);
        fs.rmSync(process.env.FAKE_AGY_APPROVE);
        fs.mkdirSync(path.dirname(token), { recursive: true });
        fs.writeFileSync(token, JSON.stringify({ refresh_token: "fake" }));
        write({ id: message.id, result: {} });
      }, 20);
      return;
    case "session/new":
      if (!keyAuthenticated && !fs.existsSync(token))
        return write({ id: message.id, error: { code: -32000, message: "Authentication required" } });
      return write({ id: message.id, result: {
        sessionId: "s-" + message.id,
        models: { availableModels: [{ modelId: "gemini-fake", name: "Gemini Fake" }], currentModelId: "gemini-fake" },
      } });
    case "session/prompt":
      if (message.params.prompt?.[0]?.text === "/usage" && fs.existsSync(process.env.FAKE_AGY_USAGE_FAIL))
        return write({ id: message.id, error: { code: -32603, message: "Quota service unavailable" } });
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
  home: string;
  key: string | null;
  event: string;
  methodId?: string | null;
}

interface Report {
  passed: boolean;
  oldRuntime?: { accounts: boolean; connectError: string };
  signIn?: { pageOpened: string[]; accountState: string | undefined; tokenInAccount: boolean };
  processes?: { firstAccountHasKey: boolean; accountProcesses: number; accountProcessesWithKey: number };
  idleUsage?: { processesStarted: number };
  busyReconnect?: { error: string; loggedOut: boolean; agentProcessKept: boolean };
  reconnect?: { logoutFirst: boolean; agentProcessStopped: boolean; accountState: string | undefined };
  remove?: { folderLeft: boolean; rows: number };
  failedUsage?: { usagePrompts: number; stored: number; accountState: string | undefined };
}

const root = await mkdtemp(join(tmpdir(), "openbot-antigravity-accounts-e2e-"));
const log = join(root, "agy.jsonl");
const approve = join(root, "approve");
const usageFails = join(root, "usage-fails");
const defaultHome = join(root, "default-gemini");
const report: Report = { passed: false };
const savedEnvironment = { GEMINI_HOME: process.env.GEMINI_HOME };
process.env.FAKE_AGY_LOG = log;
process.env.FAKE_AGY_APPROVE = approve;
process.env.FAKE_AGY_USAGE_FAIL = usageFails;
// The first account's folder: the runtime's own processes inherit it.
process.env.GEMINI_HOME = defaultHome;

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

async function server(version: string): Promise<string> {
  const executable = join(root, "agy", version, "bin", "agy_acp_server");
  await mkdir(join(root, "agy", version, "bin"), { recursive: true });
  await writeFile(join(root, "agy", version, ANTIGRAVITY_MANIFEST), JSON.stringify({ version }));
  await writeFile(executable, FAKE_AGY);
  await chmod(executable, 0o755);
  return executable;
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

let runtime: ProviderRuntime | undefined;
try {
  // The first account is signed in already.
  await mkdir(join(defaultHome, "antigravity-acp"), { recursive: true });
  const defaultToken = JSON.stringify({ refresh_token: "first-account" });
  await writeFile(join(defaultHome, "antigravity-acp", "acp_token.json"), defaultToken);

  // 1. A runtime before 1.4.0 may ignore `GEMINI_HOME`, so it offers no account after the first.
  const oldStore = new ProviderAccountStore(join(root, "old-accounts.json"), join(root, "old-accounts"));
  await runCauseEffect(oldStore.load());
  runtime = createRuntime(await server("1.3.0"), oldStore);
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
  await stop(runtime);
  runtime = undefined;

  // 2. A sign-in on the host: Google's page opens, and the token goes in the account's folder.
  await rm(log, { force: true });
  const store = new ProviderAccountStore(join(root, "accounts.json"), join(root, "accounts"));
  await runCauseEffect(store.load());
  runtime = createRuntime(await server("1.4.3"), store);
  await runCauseEffect(runtime.ensureProvider("antigravity"));
  assert.equal(accountRows(runtime)?.length, 1, "the first account only");
  await runCauseEffect(runtime.signInProviderAccountOnHost("antigravity", null, openPage));
  const [account] = store.list("antigravity");
  assert.ok(account);
  const accountHome = store.home(account);
  const tokenInAccount = await exists(join(accountHome, "antigravity-acp", "acp_token.json"));
  report.signIn = { pageOpened: [...pageOpened], accountState: accountRows(runtime)?.[1]?.state, tokenInAccount };
  assert.deepEqual(pageOpened, [GOOGLE_PAGE]);
  assert.equal(report.signIn.accountState, "connected");
  assert.ok(tokenInAccount);
  assert.equal(await readFile(join(defaultHome, "antigravity-acp", "acp_token.json"), "utf8"), defaultToken);

  // 3. The first account keeps the saved key. Every process of the new account runs in its folder,
  // the sign-in and the account check included, and none of them gets the key.
  const starts = (await entries()).filter((entry) => entry.event === "start");
  const firstAccount = starts.filter((entry) => entry.home === defaultHome);
  const accountProcesses = starts.filter((entry) => entry.home === accountHome);
  report.processes = {
    firstAccountHasKey: firstAccount.length > 0 && firstAccount.every((entry) => entry.key === SAVED_KEY),
    accountProcesses: accountProcesses.length,
    accountProcessesWithKey: accountProcesses.filter((entry) => entry.key !== null).length,
  };
  assert.ok(report.processes.firstAccountHasKey);
  assert.ok(accountProcesses.length >= 2, "a sign-in process and a check process");
  assert.equal(report.processes.accountProcessesWithKey, 0);
  assert.equal(starts.length, firstAccount.length + accountProcesses.length, "no process in another folder");
  assert.ok(
    !(await entries()).some((entry) => entry.home === accountHome && entry.methodId === "gemini-api-key"),
    "an account process never authenticates with the key",
  );

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

  // A usage read of an idle account starts no process: each new session leaves a file on disk.
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
  assert.equal(await readFile(join(defaultHome, "antigravity-acp", "acp_token.json"), "utf8"), defaultToken);

  // 6. A new account whose usage reading fails after the sign-in stays: the sign-in worked.
  await rm(log, { force: true });
  await writeFile(usageFails, "");
  await runCauseEffect(runtime.signInProviderAccountOnHost("antigravity", null, openPage));
  report.failedUsage = {
    usagePrompts: (await entries()).filter((entry) => entry.event === "session/prompt").length,
    stored: store.list("antigravity").length,
    accountState: accountRows(runtime)?.[1]?.state,
  };
  assert.ok(report.failedUsage.usagePrompts > 0, "the check asked for the usage");
  assert.equal(report.failedUsage.stored, 1);
  assert.equal(report.failedUsage.accountState, "connected");

  report.passed = true;
} finally {
  if (runtime) await stop(runtime);
  if (savedEnvironment.GEMINI_HOME === undefined) delete process.env.GEMINI_HOME;
  else process.env.GEMINI_HOME = savedEnvironment.GEMINI_HOME;
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  database.close();
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
