// Checks saved accounts through the real runtime, account store, and provider adapters with local CLI fixtures.
// Run: bun scripts/provider-account-reload-e2e.ts
// Report: .openbot-build/provider-update-busy-e2e/account-reload-report.json
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ProviderAccountState, ProviderAccountStatus } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { ConversationRuntime } from "../src/backend/agent/conversation-runtime";
import { ProviderAccountStore } from "../src/backend/agent/provider-account-store";
import { ProviderRuntime } from "../src/backend/agent/provider-runtime";
import { AgentStore } from "../src/backend/agent-store";
import { CodexAppServerClient } from "../src/backend/app-server-client";
import { ClaudeAgentClient } from "../src/backend/claude-client";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { BUILT_IN_PROVIDER_DRIVERS, NO_PROVIDER_CREDENTIALS } from "../src/backend/provider-drivers";

export async function checkProviderAccountReload(): Promise<void> {
  const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-update-busy-e2e");
  const root = await mkdtemp(join(tmpdir(), "openbot-account-reload-"));
  const providersToCheck = ["codex", "claude"] as const;
  type Provider = (typeof providersToCheck)[number];
  const changes = new EventEmitter();
  const results: { name: string; passed: boolean }[] = [];
  const savedEnvironment = {
    OPENBOT_CODEX_PATH: process.env.OPENBOT_CODEX_PATH,
    OPENBOT_CLAUDE_PATH: process.env.OPENBOT_CLAUDE_PATH,
  };

  // Account status comes from a file in the selected account folder, never from a real sign-in.
  const FAKE_CLI = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const claude = path.basename(process.argv[1]).startsWith("claude");
if (process.argv.includes("--version")) {
  const updated = process.argv[1].includes("updated");
  process.stdout.write(claude
    ? (updated ? "2.1.305 (Claude Code)\\n" : "2.1.304 (Claude Code)\\n")
    : (updated ? "codex-cli 0.164.0\\n" : "codex-cli 0.163.0\\n"));
  process.exit(0);
}
const folder = claude ? process.env.CLAUDE_CONFIG_DIR : process.env.CODEX_HOME;
const account = () => JSON.parse(fs.readFileSync(path.join(folder, "fixture-account.json"), "utf8"));
if (claude) {
  if (process.argv.slice(2).join(" ") !== "auth status --json") process.exit(2);
  const value = account();
  process.stdout.write(JSON.stringify({ loggedIn: value.email !== null, email: value.email, subscriptionType: "pro" }));
  process.exit(value.email === null ? 1 : 0);
}
const write = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  switch (message.method) {
    case "initialize": result = {}; break;
    case "account/read": {
      const value = account();
      result = { account: value.email === null ? null : { type: "chatgpt", email: value.email } };
      break;
    }
    case "account/rateLimits/read": result = { rateLimits: null, rateLimitsByLimitId: null }; break;
    case "model/list": result = { data: [{ model: "gpt-5.5", displayName: "GPT-5.5" }] }; break;
    case "plugin/list": result = { marketplaces: [] }; break;
    case "config/read": result = { config: { mcp_servers: {} }, layers: [] }; break;
    case "config/batchWrite": result = {}; break;
    default: return write({ id: message.id, error: { code: -32601, message: "Unsupported fixture method" } });
  }
  write({ id: message.id, result });
});
`;

  async function saveAccount(folder: string, email: string | null): Promise<void> {
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "fixture-account.json"), JSON.stringify({ email }));
  }

  function defaultHome(provider: Provider): string {
    return join(root, `default-${provider}`);
  }

  const database = new OpenBotDatabase(join(root, "profile"));
  const agents = new AgentStore(join(root, "profile"), join(root, "home"), database);
  const accountsPath = join(root, "accounts.json");
  const accountsRoot = join(root, "accounts");

  function createRuntime(accounts: ProviderAccountStore): ProviderRuntime {
    return new ProviderRuntime({
      offProviders: BUILT_IN_PROVIDER_DRIVERS.map((driver) => driver.id).filter(
        (id) => id !== "codex" && id !== "claude",
      ),
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
      emit: () => {
        changes.emit("status");
      },
      emitError: () => undefined,
      requestTimeoutMs: 5_000,
      preferredProvider: "codex",
      bundledExecutables: {},
      credentials: NO_PROVIDER_CREDENTIALS,
      accounts,
      redactMcp: (text) => text,
      clientFactory: (provider, cli, _confinement, accountEnvironment) => {
        if (provider === "codex")
          return new CodexAppServerClient(cli.executable, 5_000, {
            CODEX_HOME: defaultHome("codex"),
            ...accountEnvironment,
          });
        assert.equal(provider, "claude");
        return new ClaudeAgentClient(
          cli,
          () => ({
            async *[Symbol.asyncIterator]() {
              yield { type: "system", subtype: "init" };
            },
            interrupt: async () => undefined,
            supportedModels: async () => [],
            setModel: async () => undefined,
            applyFlagSettings: async () => undefined,
            close: () => undefined,
          }),
          undefined,
          5_000,
          () => [],
          undefined,
          undefined,
          undefined,
          join(root, "claude-state"),
          () => ({ CLAUDE_CONFIG_DIR: defaultHome("claude"), ...accountEnvironment }),
        );
      },
    });
  }

  function waitForAccounts(runtime: ProviderRuntime, expected: ProviderAccountState): Promise<void> {
    const ready = () =>
      providersToCheck.every((provider) => {
        const rows: ProviderAccountStatus[] | undefined = runtime
          .status()
          .providers?.find((row) => row.id === provider)?.accounts;
        return rows?.length === 2 && rows[0]?.state === "connected" && rows[1]?.state === expected;
      });
    return new Promise((resolve, reject) => {
      const check = () => {
        if (!ready()) return;
        clearTimeout(timer);
        changes.off("status", check);
        resolve();
      };
      const timer = setTimeout(() => {
        changes.off("status", check);
        reject(
          new Error(
            `Secondary accounts did not reach ${expected}: ${JSON.stringify(runtime.status().providers?.filter((row) => row.id === "codex" || row.id === "claude"))}`,
          ),
        );
      }, 5_000);
      changes.on("status", check);
      check();
    });
  }

  async function stop(runtime: ProviderRuntime): Promise<void> {
    const clients = await runCauseEffect(runtime.dispose());
    for (const client of clients) await runCauseEffect(client.stop());
  }

  let runtime: ProviderRuntime | undefined;
  let passed = false;
  try {
    for (const provider of providersToCheck) {
      const executable = join(root, `${provider}.cjs`);
      await writeFile(executable, FAKE_CLI);
      await chmod(executable, 0o755);
      process.env[provider === "codex" ? "OPENBOT_CODEX_PATH" : "OPENBOT_CLAUDE_PATH"] = executable;
      await saveAccount(defaultHome(provider), `${provider}-default@example.invalid`);
    }
    const initial = new ProviderAccountStore(accountsPath, accountsRoot);
    await runCauseEffect(initial.load());
    for (const provider of providersToCheck) {
      const account = await runCauseEffect(initial.create(provider));
      assert.ok(account);
      await runCauseEffect(initial.rename(provider, account.id, `${provider} secondary`));
      await saveAccount(initial.home(account), `${provider}-secondary@example.invalid`);
    }
    const savedList = await readFile(accountsPath, "utf8");
    const savedAccounts = await Promise.all(
      initial.list().map((account) => readFile(join(initial.home(account), "fixture-account.json"), "utf8")),
    );

    for (const name of ["cold start", "reload", "CLI version change", "on-demand start"] as const) {
      if (name === "CLI version change") {
        for (const provider of providersToCheck) {
          const executable = join(root, `${provider}-updated.cjs`);
          await writeFile(executable, FAKE_CLI);
          await chmod(executable, 0o755);
          process.env[provider === "codex" ? "OPENBOT_CODEX_PATH" : "OPENBOT_CLAUDE_PATH"] = executable;
        }
      }
      const loaded = new ProviderAccountStore(accountsPath, accountsRoot);
      await runCauseEffect(loaded.load());
      runtime = createRuntime(loaded);
      if (name === "on-demand start") {
        for (const provider of providersToCheck) await runCauseEffect(runtime.ensureProvider(provider));
      } else {
        await runCauseEffect(runtime.start());
      }
      await waitForAccounts(runtime, "connected");
      for (const provider of providersToCheck) {
        const rows: ProviderAccountStatus[] | undefined = runtime
          .status()
          .providers?.find((row) => row.id === provider)?.accounts;
        assert.equal(rows?.[0]?.email, `${provider}-default@example.invalid`);
        assert.equal(rows?.[1]?.email, `${provider}-secondary@example.invalid`);
        assert.equal(rows?.[1]?.label, `${provider} secondary`);
        assert.equal(rows?.[1]?.id, initial.list(provider)[0]?.id);
        if (name === "CLI version change") {
          assert.equal(
            runtime.status().providers?.find((row) => row.id === provider)?.version,
            provider === "codex" ? "0.164.0" : "2.1.305",
          );
        }
      }
      assert.equal(await readFile(accountsPath, "utf8"), savedList);
      assert.deepEqual(
        await Promise.all(
          loaded.list().map((account) => readFile(join(loaded.home(account), "fixture-account.json"), "utf8")),
        ),
        savedAccounts,
      );
      results.push({ name, passed: true });
      await stop(runtime);
      runtime = undefined;
    }

    // A provider that reports no account must finish its check without removing the saved account.
    const signedOut = new ProviderAccountStore(accountsPath, accountsRoot);
    await runCauseEffect(signedOut.load());
    for (const account of signedOut.list()) await saveAccount(signedOut.home(account), null);
    runtime = createRuntime(signedOut);
    await runCauseEffect(runtime.start());
    await waitForAccounts(runtime, "signed-out");
    assert.equal(await readFile(accountsPath, "utf8"), savedList);
    results.push({ name: "signed-out secondary accounts finish checking and stay saved", passed: true });
    await stop(runtime);
    runtime = undefined;

    const failedCheck = new ProviderAccountStore(accountsPath, accountsRoot);
    await runCauseEffect(failedCheck.load());
    for (const account of failedCheck.list())
      await writeFile(join(failedCheck.home(account), "fixture-account.json"), "invalid fixture");
    runtime = createRuntime(failedCheck);
    await runCauseEffect(runtime.start());
    await waitForAccounts(runtime, "error");
    assert.equal(await readFile(accountsPath, "utf8"), savedList);
    results.push({ name: "failed secondary checks show errors and keep the primary accounts connected", passed: true });
    passed = true;
  } finally {
    if (runtime) await stop(runtime);
    for (const [name, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await mkdir(OUT, { recursive: true });
    await writeFile(
      join(OUT, "account-reload-report.json"),
      JSON.stringify({ passed, checkedAt: new Date().toISOString(), results }, null, 2),
    );
    await rm(root, { recursive: true, force: true });
    database.close();
  }
}

if (import.meta.main) await checkProviderAccountReload();
