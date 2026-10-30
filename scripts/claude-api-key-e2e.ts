// Checks where a saved Anthropic API key reaches the Claude CLI, through the real Claude driver,
// client, account store and accounts. A fake `claude` CLI records the environment of each process it
// starts and answers `auth status --json` as Claude Code 2.1.310 does: with `ANTHROPIC_API_KEY` set it
// reports `authMethod: "api_key"` and no email, also when a claude.ai login exists. Cases: with a
// claude.ai login, the own sign-in never gets the key; with no login, its account check and SDK
// process get the key; the key account gets the key in its own folder, and its row shows only while
// the own sign-in has a login, and a sign-in or a peer removal on it is refused; an added account never
// gets the key; no saved key keeps the login.
// `bun scripts/claude-api-key-e2e.ts`. Writes .openbot-build/claude-api-key-e2e/report.json.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { Effect } from "effect";
import { ProviderAccountStore } from "../src/backend/agent/provider-account-store";
import { ProviderAccounts, type ProviderAccountsHost } from "../src/backend/agent/provider-accounts";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { CLAUDE_API_KEY_ACCOUNT_TYPE } from "../src/backend/protocol";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";
import { ProviderAccountsHost as PeerAccountsHost } from "../src/main/provider-accounts-host";

const OUT = resolve(import.meta.dirname, "../.openbot-build/claude-api-key-e2e");
const KEY = "sk-ant-e2e-0f3c9a71";
const root = await mkdtemp(join(tmpdir(), "openbot-claude-api-key-"));
const executable = join(root, "claude.cjs");
const logPath = join(root, "claude.jsonl");
// A key in the shell would reach the CLI in every case.
delete process.env.ANTHROPIC_API_KEY;
process.env.FAKE_CLAUDE_LOG = logPath;

/** Records each start, never the key itself: only whether it is the expected one. */
const FAKE_CLAUDE = `#!${process.execPath}
const fs = require("node:fs");
const NL = String.fromCharCode(10);
const key = process.env.ANTHROPIC_API_KEY;
fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({
  args: process.argv.slice(2).slice(0, 3),
  configDir: process.env.CLAUDE_CONFIG_DIR ?? null,
  key: key === undefined ? "absent" : key === ${JSON.stringify(KEY)} ? "saved" : "other",
}) + NL);
if (process.argv.includes("--version")) { process.stdout.write("2.1.310 (Claude Code)" + NL); process.exit(0); }
if (process.argv.slice(2).join(" ") === "auth status --json") {
  process.stdout.write(JSON.stringify(key
    ? { loggedIn: true, authMethod: "api_key", apiProvider: "firstParty", apiKeySource: "ANTHROPIC_API_KEY" }
    : process.env.FAKE_CLAUDE_SIGNED_OUT === "1"
      ? { loggedIn: false, authMethod: "none", apiProvider: "firstParty" }
      : { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "owner@example.invalid", subscriptionType: "max" }));
  process.exit(0);
}
process.exit(2);
`;

interface LogEntry {
  readonly args: readonly string[];
  readonly configDir: string | null;
  readonly key: "absent" | "saved" | "other";
}

function readLog(): LogEntry[] {
  let text = "";
  try {
    text = readFileSync(logPath, "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const driver = BUILT_IN_PROVIDER_DRIVERS.find((item) => item.id === "claude");
assert.ok(driver, "no Claude driver");
const claudeDriver = driver;

interface CaseResult {
  readonly name: string;
  readonly account: unknown;
  readonly starts: readonly LogEntry[];
}

/** Runs the account check and a model probe through a client built from `apiKey` and `accountEnvironment`. */
async function runCase(
  name: string,
  apiKey: string | null,
  options: { accountEnvironment?: Readonly<Record<string, string>>; signedOut?: boolean } = {},
): Promise<CaseResult> {
  const { accountEnvironment, signedOut = false } = options;
  if (signedOut) process.env.FAKE_CLAUDE_SIGNED_OUT = "1";
  else delete process.env.FAKE_CLAUDE_SIGNED_OUT;
  const before = readLog().length;
  const client = claudeDriver.createClient({ executable, version: "2.1.310" }, 5_000, {
    ...NO_PROVIDER_CREDENTIALS,
    apiKey: (provider) => (provider === "claude" ? apiKey : null),
    ...(accountEnvironment ? { accountEnvironment } : {}),
  });
  client.start();
  try {
    const account = await runCauseEffect(client.request("account/read", {}, (value) => value));
    // The probe fails, because the fake CLI is no SDK process. Only its start matters.
    await runCauseEffect(Effect.ignore(client.request("model/list", {}, (value) => value, 5_000)));
    const starts = readLog().slice(before);
    assert.ok(
      starts.some((entry) => entry.args[0] !== "auth"),
      `${name}: the model probe started no Claude process`,
    );
    return { name, account, starts };
  } finally {
    await runCauseEffect(client.stop());
  }
}

/** A host for `environment` and `rows` only. The other calls fail the run. */
/** A call that the case must not make. */
function unused(name: string) {
  return () => {
    throw new Error(`unexpected call: ${name}`);
  };
}

function accountsHost(key: Pick<ProviderAccountsHost, "apiKey" | "defaultUsesApiKey">): ProviderAccountsHost {
  return {
    ...key,
    scope: unused("scope"),
    cli: () => ({ executable, version: "2.1.310" }),
    defaultEmail: () => null,
    signInTemp: () => undefined,
    authenticate: unused("authenticate"),
    stopClient: unused("stopClient"),
    agentClient: () => null,
    isAccountBusy: () => false,
    stopAgentClients: unused("stopAgentClients"),
    readUsage: unused("readUsage"),
    resetCredits: () => undefined,
    consumeUsageReset: unused("consumeUsageReset"),
    changed: () => {},
    usageChanged: () => {},
    redact: (text) => text,
  };
}

const report: {
  cases: CaseResult[];
  keyAccountSignIn?: "refused";
  keyAccountRemoval?: "refused";
  result?: "pass" | "fail";
  error?: string;
} = { cases: [] };
try {
  await writeFile(executable, FAKE_CLAUDE);
  await chmod(executable, 0o755);

  const plan = await runCase("plan-and-key", KEY);
  report.cases.push(plan);
  assert.deepEqual(plan.account, {
    account: { type: "claude", email: "owner@example.invalid", planType: "max" },
    requiresOpenaiAuth: false,
  });
  assert.ok(
    plan.starts.every((entry) => entry.key === "absent"),
    "the own sign-in with a claude.ai login got the key",
  );

  const keyOnly = await runCase("key-only", KEY, { signedOut: true });
  report.cases.push(keyOnly);
  assert.deepEqual(keyOnly.account, {
    account: { type: CLAUDE_API_KEY_ACCOUNT_TYPE, email: null, planType: null },
    requiresOpenaiAuth: false,
  });
  const keyOnlyStatus = keyOnly.starts.filter((entry) => entry.args[0] === "auth");
  assert.deepEqual(
    keyOnlyStatus.map((entry) => entry.key),
    ["absent", "saved"],
    "the account check did not try the login first, then the key",
  );
  assert.ok(
    keyOnly.starts.filter((entry) => entry.args[0] !== "auth").every((entry) => entry.key === "saved"),
    "SDK process with no login did not get the key",
  );

  const none = await runCase("no-key", null);
  report.cases.push(none);
  assert.deepEqual(none.account, {
    account: { type: "claude", email: "owner@example.invalid", planType: "max" },
    requiresOpenaiAuth: false,
  });
  assert.ok(
    none.starts.every((entry) => entry.key === "absent"),
    "key without a saved key",
  );

  // The key account and an added account, from the real store and accounts.
  let defaultUsesApiKey = false;
  const store = new ProviderAccountStore(join(root, "accounts.json"), join(root, "accounts"));
  const accounts = new ProviderAccounts(
    store,
    accountsHost({ apiKey: () => KEY, defaultUsesApiKey: () => defaultUsesApiKey }),
  );
  const keyAccount = await runCauseEffect(store.ensure("claude", CLAUDE_API_KEY_ACCOUNT_ID));
  const added = await runCauseEffect(store.create("claude"));
  assert.ok(keyAccount && added, "the store made no account");
  const keyHome = store.home(keyAccount);
  const keyCase = await runCase("key-account", KEY, { accountEnvironment: accounts.environment(keyAccount) });
  report.cases.push(keyCase);
  assert.ok(
    keyCase.starts.every((entry) => entry.key === "saved" && entry.configDir === keyHome),
    "the key account did not get the key in its own folder",
  );
  const addedHome = store.home(added);
  const addedCase = await runCase("added-account", KEY, { accountEnvironment: accounts.environment(added) });
  report.cases.push(addedCase);
  assert.ok(
    addedCase.starts.every((entry) => entry.key === "absent" && entry.configDir === addedHome),
    "the added account got the key or another folder",
  );

  const rowIds = () => accounts.rows("claude", null)?.map((row) => row.id) ?? [];
  assert.deepEqual(rowIds(), ["default", CLAUDE_API_KEY_ACCOUNT_ID, added.id], "the key account row is missing");
  defaultUsesApiKey = true;
  assert.deepEqual(rowIds(), ["default", added.id], "the key account row shows while the own sign-in uses the key");

  // A client without claude-api-key-v1 shows the key account as signed out and can offer a sign-in.
  const startsBeforeSignIn = readLog().length;
  const refusal = await runCauseEffect(
    accounts
      .connect("claude", CLAUDE_API_KEY_ACCOUNT_ID, async () => {}, true)
      .pipe(Effect.match({ onFailure: (failure) => failure.cause, onSuccess: () => null })),
  );
  assert.ok(
    refusal instanceof Error && refusal.message.includes("saved API key"),
    "a sign-in on the key account was not refused",
  );
  assert.equal(readLog().length, startsBeforeSignIn, "a refused sign-in on the key account started Claude");
  assert.ok(store.get("claude", CLAUDE_API_KEY_ACCOUNT_ID), "a refused sign-in removed the key account");
  report.keyAccountSignIn = "refused";

  // The same client can offer Remove on it. Only the key dialog removes the key account.
  const peerAccounts = new PeerAccountsHost({
    service: {
      getStatus: unused("getStatus"),
      getProviderAccountUsage: unused("getProviderAccountUsage"),
      listAgents: unused("listAgents"),
      updateAgent: unused("updateAgent"),
      signInProviderAccountOnHost: unused("signInProviderAccountOnHost"),
      renameProviderAccount: unused("renameProviderAccount"),
      removeProviderAccount: unused("removeProviderAccount"),
    },
    browser: { openPrivate: unused("openPrivate"), privateTab: unused("privateTab"), close: unused("close") },
  });
  const removal = await runCauseEffect(
    peerAccounts
      .remove("claude", CLAUDE_API_KEY_ACCOUNT_ID)
      .pipe(Effect.match({ onFailure: (failure) => failure.cause, onSuccess: () => null })),
  );
  assert.ok(
    removal instanceof Error && removal.message.includes("saved API key"),
    "a peer removal of the key account was not refused",
  );
  report.keyAccountRemoval = "refused";
  report.result = "pass";
} catch (error) {
  report.result = "fail";
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`PASS claude-api-key-e2e: ${join(OUT, "report.json")}\n`);
