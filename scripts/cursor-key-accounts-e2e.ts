import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { ProviderCredentialStore } from "../src/main/provider-credential-store";
import { installFakeAgent, readJsonl } from "./provider-fakes/host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/cursor-key-accounts-e2e");
const GOOD_KEY = "key_e2e_good_5d1c0a97";
const SECOND_GOOD_KEY = "key_e2e_good_second_77aa";
const BAD_KEY = "key_e2e_refused_0b44";

interface Start {
  argv: string[];
  store: string | null;
  key: "absent" | "empty" | "good" | "other";
  authToken: "absent" | "empty" | "set";
}

const root = await mkdtemp(join(tmpdir(), "openbot-cursor-key-accounts-"));
const log = join(root, "starts.jsonl");
const executable = join(root, "cursor", "cursor-agent");
const credentialPath = join(root, "profile", "provider-credentials.json");
delete process.env.CURSOR_API_KEY;
delete process.env.CURSOR_AUTH_TOKEN;
process.env.OPENBOT_CURSOR_PATH = executable;

const accepted = new Set([GOOD_KEY, SECOND_GOOD_KEY]);
let serverError = false;
const exchanges: string[] = [];
const cursor = createServer((request, response) => {
  const key = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
  exchanges.push(key === GOOD_KEY || key === SECOND_GOOD_KEY ? "good" : "other");
  request.resume();
  if (request.url !== "/auth/exchange_user_api_key" || request.method !== "POST") response.writeHead(404).end();
  else if (serverError) response.writeHead(503).end();
  else if (accepted.has(key))
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ accessToken: "fake-access", refreshToken: "fake-refresh" }));
  else response.writeHead(401).end();
});
await new Promise<void>((listening) => cursor.listen(0, "127.0.0.1", listening));
const address = cursor.address();
assert.ok(address && typeof address === "object", "the fake of Cursor did not get a port");
process.env.CURSOR_API_ENDPOINT = `http://127.0.0.1:${address.port}`;

const cipher = {
  encrypt: (value: string) => Buffer.from([...Buffer.from(value, "utf8")].map((byte) => byte ^ 0x5a)),
  decrypt: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString("utf8"),
};

const database = new OpenBotDatabase(join(root, "profile"));
const agents = new AgentStore(join(root, "profile"), join(root, "home"), database);
const errors: string[] = [];

function createRuntime(accounts: ProviderAccountStore, credentials: ProviderCredentialStore): ProviderRuntime {
  return new ProviderRuntime({
    offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter((id) => id !== "cursor"),
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
      isAgentBusy: () => false,
      isProviderAssigned: () => true,
      onAgentClientLost: () => Effect.void,
      sharedRoot: () => join(root, "shared"),
      onProviderResumed: () => undefined,
      onProviderActivated: () => Effect.void,
      captureConfigRevision: () => 0,
    },
    emit: () => undefined,
    emitError: (_code, error) => errors.push(error instanceof Error ? error.message : String(error)),
    requestTimeoutMs: 5_000,
    preferredProvider: "cursor",
    clientFactory: null,
    bundledExecutables: { cursor: executable },
    credentials: {
      ...NO_PROVIDER_CREDENTIALS,
      accountKeys: {
        get: (provider, accountId) => credentials.accountKey(provider, accountId),
        set: (provider, accountId, key) => credentials.setAccountKey(provider, accountId, key),
      },
    },
    accounts,
    redactMcp: (text) => text,
  });
}

const rows = (runtime: ProviderRuntime): ProviderAccountStatus[] | undefined =>
  runtime.status().providers?.find((row) => row.id === "cursor")?.accounts;

async function stop(runtime: ProviderRuntime): Promise<void> {
  for (const client of await runCauseEffect(runtime.dispose())) await runCauseEffect(client.stop());
}

async function failureOf(effect: Effect.Effect<unknown, { readonly cause: unknown }>): Promise<string | null> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return null;
  const error = Cause.squash(exit.cause);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return cause instanceof Error ? cause.message : String(cause);
}

async function rowState(runtime: ProviderRuntime, accountId: string, state: string): Promise<ProviderAccountStatus> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const row = rows(runtime)?.find((candidate) => candidate.id === accountId);
    if (row?.state === state) return row;
    assert.ok(Date.now() < deadline, `the account did not get the state ${state}: ${JSON.stringify(row)}`);
    await new Promise((later) => setImmediate(later));
  }
}

const starts = () => readJsonl<Start>(log);
const acpStarts = async (from = 0) => (await starts()).slice(from).filter((entry) => entry.argv[0] === "acp");

interface Report {
  result?: "pass" | "fail";
  error?: string;
  refusedKey?: { error: string | null; accounts: number; processes: number };
  unreachable?: { error: string | null; accounts: number };
  accepted?: { row: ProviderAccountStatus; starts: Start[] };
  storage?: { keyInCredentialFile: boolean; keyInAccountList: boolean; entry: string[] };
  ownSignIn?: Start[];
  browserSignIn?: { add: string | null; reconnect: string | null; onHost: string | null; opened: string[] };
  replaceRefused?: { error: string | null; state: string; keyKept: boolean };
  restart?: { state: string };
  revoked?: { state: string; message: string | null };
  newKey?: { state: string };
  removed?: { accounts: number; key: string | null; rows: string[] | undefined };
  unreadableFile?: { error: string | null; fileKept: boolean };
  oldCli?: { accounts: boolean; error: string | null; keyProcesses: number };
  exchanges?: string[];
  errors?: string[];
}

const report: Report = {};
let runtime: ProviderRuntime | undefined;
try {
  await mkdir(join(root, "profile"), { recursive: true });
  await installFakeAgent(executable, "cursor-key-accounts", { FAKE_LOG: log, FAKE_GOOD_KEY: GOOD_KEY });
  const store = new ProviderAccountStore(join(root, "profile", "accounts.json"), join(root, "profile", "accounts"));
  await runCauseEffect(store.load());
  const credentials = new ProviderCredentialStore(credentialPath, cipher);
  assert.equal(await Effect.runPromise(credentials.load()), null);
  runtime = createRuntime(store, credentials);
  await runCauseEffect(runtime.ensureProvider("cursor"));
  assert.ok((await starts()).length > 0, "the fake Cursor CLI did not run: stop before a real CLI gets a key");
  assert.equal(runtime.status().providers?.find((row) => row.id === "cursor")?.state, "available");
  assert.deepEqual(
    rows(runtime)?.map((row) => row.id),
    ["default"],
    "the own sign-in is the first account",
  );

  let seen = (await starts()).length;
  const refused = await failureOf(runtime.connectProviderAccountKey("cursor", null, BAD_KEY));
  report.refusedKey = {
    error: refused,
    accounts: store.list("cursor").length,
    processes: (await acpStarts(seen)).length,
  };
  assert.equal(refused, sourceText("error.provider.accountKeyRefused", { provider: "Cursor" }));
  assert.equal(store.list("cursor").length, 0, "a refused key leaves no account");
  assert.equal((await acpStarts(seen)).length, 0, "a refused key starts no Cursor process");
  assert.equal(rows(runtime)?.length, 1);

  serverError = true;
  const unreachable = await failureOf(runtime.connectProviderAccountKey("cursor", null, GOOD_KEY));
  serverError = false;
  report.unreachable = { error: unreachable, accounts: store.list("cursor").length };
  assert.equal(unreachable, sourceText("error.provider.accountKeyUnreachable", { provider: "Cursor" }));
  assert.equal(store.list("cursor").length, 0);
  assert.equal(credentials.accountKey("cursor", "a0000000000000000"), null);

  seen = (await starts()).length;
  await runCauseEffect(runtime.connectProviderAccountKey("cursor", null, GOOD_KEY));
  const [account] = store.list("cursor");
  assert.ok(account, "the account is saved");
  const added = await rowState(runtime, account.id, "connected");
  const accountStarts = await acpStarts(seen);
  report.accepted = { row: added, starts: accountStarts };
  assert.ok(accountStarts.length > 0, "the account check started a Cursor process");
  for (const entry of accountStarts) {
    assert.equal(entry.key, "good", "the account process gets its key");
    assert.equal(entry.store, "memory", "the account process does not read or write the own sign-in");
    assert.equal(entry.authToken, "empty", "a token of the environment cannot win over the key");
  }
  assert.equal(added.email, null);
  assert.deepEqual(
    added.models?.map((model) => model.id),
    ["key-plan-model"],
    "the account lists the models of its own plan",
  );
  assert.equal(credentials.accountKey("cursor", account.id), GOOD_KEY);

  const credentialFile = await readFile(credentialPath, "utf8");
  const accountFile = await readFile(join(root, "profile", "accounts.json"), "utf8");
  report.storage = {
    keyInCredentialFile: credentialFile.includes(GOOD_KEY),
    keyInAccountList: accountFile.includes(GOOD_KEY),
    entry: Object.keys(JSON.parse(credentialFile).credentials),
  };
  assert.ok(!credentialFile.includes(GOOD_KEY), "the credential file holds the key encrypted");
  assert.ok(!accountFile.includes(GOOD_KEY), "the account list holds no key");
  assert.deepEqual(report.storage, {
    keyInCredentialFile: false,
    keyInAccountList: false,
    entry: [`cursor:${account.id}`],
  });

  const ownStarts = (await acpStarts()).filter((entry) => !accountStarts.includes(entry) && entry.key !== "good");
  report.ownSignIn = ownStarts;
  assert.ok(ownStarts.length > 0);
  for (const entry of ownStarts) {
    assert.equal(entry.key, "absent");
    assert.equal(entry.store, null);
    assert.equal(entry.authToken, "absent", "the own sign-in keeps the environment of the user");
  }

  const needsKey = sourceText("error.provider.accountNeedsKey", { provider: "Cursor" });
  const opened: string[] = [];
  const open = async (url: string) => void opened.push(url);
  report.browserSignIn = {
    add: await failureOf(runtime.connectProviderAccount("cursor", null, open)),
    reconnect: await failureOf(runtime.connectProviderAccount("cursor", account.id, open)),
    onHost: await failureOf(runtime.signInProviderAccountOnHost("cursor", null, open)),
    opened,
  };
  assert.deepEqual(report.browserSignIn, { add: needsKey, reconnect: needsKey, onHost: needsKey, opened: [] });
  assert.equal(store.list("cursor").length, 1);

  const replaceRefused = await failureOf(runtime.connectProviderAccountKey("cursor", account.id, BAD_KEY));
  const kept = await rowState(runtime, account.id, "connected");
  report.replaceRefused = {
    error: replaceRefused,
    state: kept.state,
    keyKept: credentials.accountKey("cursor", account.id) === GOOD_KEY,
  };
  assert.equal(replaceRefused, sourceText("error.provider.accountKeyRefused", { provider: "Cursor" }));
  assert.equal(credentials.accountKey("cursor", account.id), GOOD_KEY);

  const duplicate = await failureOf(runtime.connectProviderAccountKey("cursor", "a00000000000000ff", GOOD_KEY));
  assert.equal(duplicate, sourceText("error.provider.accountNotFound", { provider: "Cursor" }));
  await stop(runtime);
  runtime = undefined;

  const restartedStore = new ProviderAccountStore(
    join(root, "profile", "accounts.json"),
    join(root, "profile", "accounts"),
  );
  await runCauseEffect(restartedStore.load());
  const restartedCredentials = new ProviderCredentialStore(credentialPath, cipher);
  assert.equal(await Effect.runPromise(restartedCredentials.load()), null);
  runtime = createRuntime(restartedStore, restartedCredentials);
  await runCauseEffect(runtime.ensureProvider("cursor"));
  report.restart = { state: (await rowState(runtime, account.id, "connected")).state };
  await stop(runtime);
  runtime = undefined;

  accepted.delete(GOOD_KEY);
  runtime = createRuntime(restartedStore, restartedCredentials);
  await runCauseEffect(runtime.ensureProvider("cursor"));
  const signedOut = await rowState(runtime, account.id, "signed-out");
  report.revoked = { state: signedOut.state, message: signedOut.message };
  assert.equal(signedOut.message, sourceText("error.provider.accountKeySignedOut", { provider: "Cursor" }));

  seen = (await starts()).length;
  await installFakeAgent(executable, "cursor-key-accounts", { FAKE_LOG: log, FAKE_GOOD_KEY: SECOND_GOOD_KEY });
  await runCauseEffect(runtime.connectProviderAccountKey("cursor", account.id, SECOND_GOOD_KEY));
  report.newKey = { state: (await rowState(runtime, account.id, "connected")).state };
  assert.equal(restartedCredentials.accountKey("cursor", account.id), SECOND_GOOD_KEY);
  assert.ok((await acpStarts(seen)).every((entry) => entry.key === "good" && entry.store === "memory"));

  await runCauseEffect(runtime.removeProviderAccount("cursor", account.id));
  report.removed = {
    accounts: restartedStore.list("cursor").length,
    key: restartedCredentials.accountKey("cursor", account.id),
    rows: rows(runtime)?.map((row) => row.id),
  };
  assert.deepEqual(report.removed, { accounts: 0, key: null, rows: ["default"] });

  const lockedPath = join(root, "profile", "locked-credentials.json");
  const lockedFile = `${JSON.stringify({ version: 1, credentials: { opencode: "bm90LWZvci10aGlzLWNpcGhlcg==" } })}\n`;
  await writeFile(lockedPath, lockedFile);
  const locked = new ProviderCredentialStore(lockedPath, {
    encrypt: cipher.encrypt,
    decrypt: () => {
      throw new Error("the keychain refused");
    },
  });
  assert.ok(await Effect.runPromise(locked.load()), "the file must be unreadable for this case");
  const lockedSave = await failureOf(locked.setAccountKey("cursor", account.id, GOOD_KEY));
  await Effect.runPromise(locked.setAccountKey("cursor", account.id, null));
  report.unreadableFile = { error: lockedSave, fileKept: (await readFile(lockedPath, "utf8")) === lockedFile };
  assert.deepEqual(report.unreadableFile, {
    error: sourceText("error.provider.credentialFileUnreadable"),
    fileKept: true,
  });

  await stop(runtime);
  await installFakeAgent(executable, "cursor-key-accounts", {
    FAKE_LOG: log,
    FAKE_GOOD_KEY: GOOD_KEY,
    FAKE_VERSION: "2026.09.30-e373342",
  });
  runtime = createRuntime(restartedStore, restartedCredentials);
  await runCauseEffect(runtime.ensureProvider("cursor"));
  seen = (await starts()).length;
  report.oldCli = {
    accounts: rows(runtime) !== undefined,
    error: await failureOf(runtime.connectProviderAccountKey("cursor", null, GOOD_KEY)),
    keyProcesses: (await acpStarts(seen)).filter((entry) => entry.key !== "absent").length,
  };
  assert.deepEqual(report.oldCli, {
    accounts: false,
    error: sourceText("error.provider.accountsUnsupported", { provider: "Cursor" }),
    keyProcesses: 0,
  });

  report.exchanges = exchanges;
  report.errors = errors;
  assert.deepEqual(errors, []);
  report.result = "pass";
} catch (error) {
  report.result = "fail";
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  if (runtime) await stop(runtime).catch(() => undefined);
  await new Promise((closed) => cursor.close(closed));
  database.close();
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
}
process.stdout.write(`${report.result === "pass" ? "PASS" : "FAIL"} ${join(OUT, "report.json")}\n`);
