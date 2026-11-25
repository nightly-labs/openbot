import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_PROVIDER_ACCOUNT_ID, MAX_PROVIDER_ACCOUNTS } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_APP_VERSION_HEADER, TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { teamCapabilitiesForProtocol, teamCapabilityHeaders } from "@openbot/contracts/team-protocol/current";
import { PROVIDER_ACCOUNT_CODE_ROUTES } from "@openbot/contracts/team-protocol/provider-account-code-v1";
import { PROVIDER_ACCOUNT_KEYS_ROUTES } from "@openbot/contracts/team-protocol/provider-account-keys-v1";
import { PROVIDER_ACCOUNT_MODELS_ROUTES } from "@openbot/contracts/team-protocol/provider-account-models-v1";
import { PROVIDER_ACCOUNT_POOL_ROUTES } from "@openbot/contracts/team-protocol/provider-account-pool-v1";
import { PROVIDER_ACCOUNTS_ROUTES } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  PROVIDER_FROZEN_ACCOUNTS_LIMIT,
  PROVIDER_MANY_ACCOUNTS_CAPABILITY,
  PROVIDER_MANY_ACCOUNTS_LIMIT,
} from "@openbot/contracts/team-protocol/provider-many-accounts-v1";
import { PROVIDER_USAGE_RESET_ROUTES } from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { sourceText } from "@openbot/i18n/source";
import { plugin } from "bun";
import { Effect } from "effect";
import { ProviderAccountStore } from "../src/backend/agent/provider-account-store";
import { providerLabel } from "../src/backend/agent/thread-items";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentLifecycleFailed, AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type {
  TeamApiAdmin,
  TeamApiBrowser,
  TeamApiProviderAccounts,
  TeamApiProviderUsageResets,
} from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/provider-many-accounts-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const STEP_DEADLINE_MS = 60_000;
const PROVIDER = "codex";
const KEY_PROVIDER = "claude";

plugin({
  name: "provider-many-accounts-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => HOST_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: Object.assign(class extends Inert {}, { getAllWindows: () => [] }),
        MessageChannelMain: class extends Inert {},
        Notification: Object.assign(class extends Inert {}, { isSupported: () => false }),
        clipboard: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: {},
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});

const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The WebRTC transports. They pass the same codec option as the HTTP transport, which this check drives.",
    "A real released client build. This check sends the current capability list without `provider-many-accounts-v1`.",
    "Provider sign-in. The host behind the Team API saves accounts in the real account store, without a provider CLI.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

const unused = () => Effect.die(new Error("Not used by this check."));
const notUsed = (): never => {
  throw new Error("Not used by this check.");
};
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  answerPermission: unused,
  takeUserControl: unused,
  startTeach: unused,
  stopTeach: () => [],
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  releaseUserControlRefused: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  answerViewDialog: unused,
  importSignIn: unused,
  answerHttpSignIn: unused,
};

const root = await mkdtemp(join(tmpdir(), "openbot-provider-many-accounts-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  accountStore: ProviderAccountStore;
  server: InstanceType<typeof TeamApiServer>;
  port: number;
}

let host: Host | null = null;

function accountIds(store: ProviderAccountStore, provider: typeof PROVIDER | typeof KEY_PROVIDER = PROVIDER): string[] {
  return [DEFAULT_PROVIDER_ACCOUNT_ID, ...store.list(provider).map((account) => account.id)];
}

function accountRows(store: ProviderAccountStore, provider: typeof PROVIDER | typeof KEY_PROVIDER) {
  return accountIds(store, provider).map((id) => ({
    id,
    label: null,
    email: null,
    state: "connected" as const,
    message: null,
  }));
}

function accountLimitFailure() {
  return new AgentLifecycleFailed({
    operation: "connectProviderAccount",
    cause: new Error(
      sourceText("error.provider.accountLimit", { provider: providerLabel(PROVIDER), limit: MAX_PROVIDER_ACCOUNTS }),
    ),
  });
}

function providerAccounts(store: ProviderAccountStore): TeamApiProviderAccounts {
  return {
    list: () => ({
      providers: [
        { provider: PROVIDER, accounts: accountRows(store, PROVIDER) },
        { provider: KEY_PROVIDER, accounts: accountRows(store, KEY_PROVIDER) },
      ],
      agents: [],
    }),
    models: () => ({
      providers: [
        {
          provider: PROVIDER,
          accounts: accountIds(store).map((accountId) => ({
            accountId,
            models: [
              {
                id: "e2e-model",
                name: "E2E model",
                description: "",
                defaultReasoningEffort: "medium" as const,
                supportedReasoningEfforts: ["medium" as const],
              },
            ],
          })),
        },
      ],
    }),
    pools: () => {
      const pool = store.pool(PROVIDER);
      return { pools: pool ? [{ provider: PROVIDER, leftOut: [...pool.leftOut], inUse: null }] : [] };
    },
    setPool: (provider, enabled, leftOut) =>
      store.setPool(provider === "acp" ? PROVIDER : provider, enabled ? { leftOut } : null).pipe(Effect.orDie),
    liveVoiceAccount: () => ({ accountId: null }),
    setLiveVoiceAccount: unused,
    usage: unused,
    startSignIn: unused,
    signInStatus: notUsed,
    cancelSignIn: unused,
    connectKey: (provider, accountId) =>
      accountId !== null
        ? unused()
        : store.create(provider).pipe(
            Effect.orDie,
            Effect.flatMap((account) => (account ? Effect.void : Effect.fail(accountLimitFailure()))),
          ),
    startCodeSignIn: unused,
    submitCodeSignIn: notUsed,
    codeSignInStatus: notUsed,
    cancelCodeSignIn: unused,
    rename: unused,
    remove: unused,
    setAgentAccount: unused,
  };
}

function providerUsageResets(store: ProviderAccountStore): TeamApiProviderUsageResets {
  return {
    providerUsageResets: (provider) =>
      Effect.succeed(accountIds(store).map((accountId) => ({ provider, accountId, available: 1 }))),
    resetProviderUsage: unused,
  };
}

function providersAdmin(store: ProviderAccountStore, agents: AgentService): TeamApiAdmin {
  return {
    providers: {
      service: {
        startProviderCodeLogin: unused,
        submitProviderCodeLogin: notUsed,
        cancelProviderCodeLogin: unused,
        changeProviderCredential: (provider, change) =>
          change().pipe(
            Effect.andThen(
              provider === KEY_PROVIDER
                ? store.ensure(provider, CLAUDE_API_KEY_ACCOUNT_ID).pipe(Effect.orDie)
                : Effect.void,
            ),
            Effect.map(() => agents.getStatus()),
          ),
        clearProviderCredential: unused,
        signInCodexWithApiKey: unused,
        getStatus: () => agents.getStatus(),
        setProviderOn: unused,
      },
      credentials: { status: () => "missing", set: () => Effect.void, clear: unused },
      runtimes: {
        getStatus: notUsed,
        download: unused,
        cancel: unused,
        checkForUpdates: unused,
        startKeyProviderCli: () => Effect.succeed(false),
      },
      customProviders: { list: notUsed, save: unused, peerUpdate: unused, peerHarnessUpdate: unused, remove: unused },
      pasteSignIn: false,
    },
  };
}

async function startHost(): Promise<Host> {
  const database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  const accountStore = new ProviderAccountStore(
    join(userData, "provider-accounts.json"),
    join(userData, "provider-accounts"),
  );
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  await runCauseEffect(accountStore.load());
  if (!team.getIdentity()) await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    providerAccounts: providerAccounts(accountStore),
    providerUsageResets: providerUsageResets(accountStore),
    admin: providersAdmin(accountStore, agents),
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, accountStore, server, port };
}

async function stopHost(): Promise<void> {
  if (!host) return;
  const stopping = host;
  host = null;
  await Effect.runPromise(stopping.server.stop()).catch(() => undefined);
  await runCauseEffect(stopping.agents.stop()).catch(() => undefined);
  stopping.database.close();
}

function current(): Host {
  assert.ok(host, "The host is not running.");
  return host;
}

function heldAccounts(): number {
  return accountIds(current().accountStore).length;
}

const CURRENT = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10);
const RELEASED = CURRENT.filter((capability) => capability !== PROVIDER_MANY_ACCOUNTS_CAPABILITY);

interface Reply {
  status: number;
  body: unknown;
}

async function call(path: string, input: { token?: string; body?: unknown; released?: boolean } = {}): Promise<Reply> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, input.released ? RELEASED : CURRENT),
  };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${current().port}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input.body ?? {}),
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function login(): Promise<string> {
  const response = await call(TEAM_API_ROUTES.auth.login, { body: OWNER });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  const body = response.body;
  assert.ok(typeof body === "object" && body !== null && "sessionToken" in body);
  return String(body.sessionToken);
}

function decoded(path: string, reply: Reply, manyAccounts: boolean): DynamicRecord {
  assert.equal(reply.status, 200, `${path} returned ${reply.status}: ${JSON.stringify(reply.body)}`);
  const codec = teamSideRouteCodec(path);
  assert.ok(codec, `${path} has no side-route codec.`);
  const body = codec.response(
    path,
    reply.status,
    reply.body,
    manyAccounts ? { providerManyAccounts: true } : undefined,
  );
  assert.ok(isDynamicRecord(body), `${path} is not an object.`);
  return body;
}

function firstRow(list: unknown, label: string): DynamicRecord {
  assert.ok(Array.isArray(list) && isDynamicRecord(list[0]), `${label} has no row.`);
  return list[0];
}

function rowCount(list: unknown, label: string): number {
  assert.ok(Array.isArray(list), `${label} is not a list.`);
  return list.length;
}

function listedAccounts(path: string, reply: Reply, manyAccounts: boolean): number {
  const body = decoded(path, reply, manyAccounts);
  if (path === PROVIDER_USAGE_RESET_ROUTES.list) return rowCount(body.accounts, "accounts");
  if (path === PROVIDER_ACCOUNT_POOL_ROUTES.list) return rowCount(firstRow(body.pools, "pools").leftOut, "leftOut");
  return rowCount(firstRow(body.providers, "providers").accounts, "accounts");
}

const LIST_ROUTES = [
  PROVIDER_ACCOUNTS_ROUTES.list,
  PROVIDER_ACCOUNT_MODELS_ROUTES.list,
  PROVIDER_USAGE_RESET_ROUTES.list,
] as const;

const NEEDS_UPDATE = sourceText("error.team.providerAccountListNeedsUpdate", { limit: PROVIDER_FROZEN_ACCOUNTS_LIMIT });

function needsUpdate(reply: Reply, label: string): void {
  assert.equal(reply.status, 409, `${label}: expected 409, got ${reply.status}.`);
  assert.equal(JSON.stringify(reply.body).includes(NEEDS_UPDATE), true, `${label}: ${JSON.stringify(reply.body)}`);
}

function addAccount(token: string, index: number, released = false): Promise<Reply> {
  return call(PROVIDER_ACCOUNT_KEYS_ROUTES.connect, {
    token,
    released,
    body: { provider: PROVIDER, accountId: null, key: `e2e-key-${index}` },
  });
}

try {
  assert.equal(MAX_PROVIDER_ACCOUNTS, PROVIDER_MANY_ACCOUNTS_LIMIT, "The store and the wire limits differ.");
  host = await startHost();
  const token = await login();

  await step("a released client adds accounts up to 10 and reads them with the frozen codecs", async () => {
    for (let index = heldAccounts() + 1; index <= PROVIDER_FROZEN_ACCOUNTS_LIMIT; index += 1) {
      const added = await addAccount(token, index, true);
      assert.equal(added.status, 200, `Add ${index} returned ${added.status}: ${JSON.stringify(added.body)}`);
    }
    const counts: Record<string, number> = {};
    for (const path of LIST_ROUTES) {
      counts[path] = listedAccounts(
        path,
        await call(path, { token, released: true, body: { provider: PROVIDER } }),
        false,
      );
      assert.equal(counts[path], PROVIDER_FROZEN_ACCOUNTS_LIMIT, path);
    }
    return counts;
  });

  await step("the host refuses a released client the 11th account, before it saves", async () => {
    const tries = {
      key: await addAccount(token, PROVIDER_FROZEN_ACCOUNTS_LIMIT + 1, true),
      signIn: await call(PROVIDER_ACCOUNTS_ROUTES.signInStart, {
        token,
        released: true,
        body: { provider: PROVIDER, accountId: null },
      }),
      code: await call(PROVIDER_ACCOUNT_CODE_ROUTES.start, {
        token,
        released: true,
        body: { provider: PROVIDER, accountId: null },
      }),
    };
    for (const [label, reply] of Object.entries(tries)) needsUpdate(reply, label);
    assert.equal(heldAccounts(), PROVIDER_FROZEN_ACCOUNTS_LIMIT, "A refused add was stored.");
    return Object.fromEntries(Object.entries(tries).map(([label, reply]) => [label, reply.status]));
  });

  await step("the host refuses a released client a saved Claude key that would add the 11th account", async () => {
    const store = current().accountStore;
    while (accountIds(store, KEY_PROVIDER).length < PROVIDER_FROZEN_ACCOUNTS_LIMIT)
      await runCauseEffect(store.create(KEY_PROVIDER));
    const body = { provider: KEY_PROVIDER, key: "e2e-claude-key" };
    const refused = await call(PROVIDERS_ADMIN_ROUTES.apiKeySet, { token, released: true, body });
    needsUpdate(refused, "apiKeySet");
    assert.equal(store.get(KEY_PROVIDER, CLAUDE_API_KEY_ACCOUNT_ID), null, "A refused key added an account.");
    const saved = await call(PROVIDERS_ADMIN_ROUTES.apiKeySet, { token, body });
    assert.equal(saved.status, 200, `apiKeySet returned ${saved.status}: ${JSON.stringify(saved.body)}`);
    const held = accountIds(store, KEY_PROVIDER);
    assert.equal(held.includes(CLAUDE_API_KEY_ACCOUNT_ID), true, "The saved key has no account.");
    const again = await call(PROVIDERS_ADMIN_ROUTES.apiKeySet, { token, body });
    assert.equal(again.status, 200, "A current client could not replace the saved key.");
    return { refused: refused.status, saved: saved.status, claudeAccounts: held.length };
  });

  await step("a current client adds accounts up to 20 and reads all of them", async () => {
    for (let index = heldAccounts() + 1; index <= PROVIDER_MANY_ACCOUNTS_LIMIT; index += 1) {
      const added = await addAccount(token, index);
      assert.equal(added.status, 200, `Add ${index} returned ${added.status}: ${JSON.stringify(added.body)}`);
    }
    const counts: Record<string, number> = {};
    for (const path of LIST_ROUTES) {
      const reply = await call(path, { token, body: { provider: PROVIDER } });
      counts[path] = listedAccounts(path, reply, true);
      assert.equal(counts[path], PROVIDER_MANY_ACCOUNTS_LIMIT, path);
      assert.throws(() => decoded(path, reply, false), `${path}: the frozen codec read 20 accounts.`);
    }
    return counts;
  });

  await step("the host refuses the 21st account", async () => {
    const extra = await addAccount(token, PROVIDER_MANY_ACCOUNTS_LIMIT + 1);
    const limit = sourceText("error.provider.accountLimit", {
      provider: providerLabel(PROVIDER),
      limit: MAX_PROVIDER_ACCOUNTS,
    });
    assert.equal(extra.status, 409, `Expected 409, got ${extra.status}.`);
    assert.equal(JSON.stringify(extra.body).includes(limit), true, JSON.stringify(extra.body));
    assert.equal(heldAccounts(), PROVIDER_MANY_ACCOUNTS_LIMIT);
    return { status: extra.status };
  });

  await step("a current client leaves 20 accounts out of the pool and reads them back", async () => {
    const leftOut = accountIds(current().accountStore);
    const body = { provider: PROVIDER, enabled: true, leftOut };
    const codec = teamSideRouteCodec(PROVIDER_ACCOUNT_POOL_ROUTES.update);
    assert.ok(codec, "The pool update has no side-route codec.");
    assert.throws(() => codec.request(PROVIDER_ACCOUNT_POOL_ROUTES.update, body), "The frozen codec sent 20 rows.");
    codec.request(PROVIDER_ACCOUNT_POOL_ROUTES.update, body, { providerManyAccounts: true });
    const saved = await call(PROVIDER_ACCOUNT_POOL_ROUTES.update, { token, body });
    assert.equal(saved.status, 200, `Pool update returned ${saved.status}: ${JSON.stringify(saved.body)}`);
    const reply = await call(PROVIDER_ACCOUNT_POOL_ROUTES.list, { token });
    assert.equal(listedAccounts(PROVIDER_ACCOUNT_POOL_ROUTES.list, reply, true), PROVIDER_MANY_ACCOUNTS_LIMIT);
    assert.throws(() => decoded(PROVIDER_ACCOUNT_POOL_ROUTES.list, reply, false));
    return { leftOut: leftOut.length };
  });

  await step("a released client gets the update message on every account route, and changes nothing", async () => {
    const released = { token, released: true };
    const tries = {
      list: await call(PROVIDER_ACCOUNTS_ROUTES.list, released),
      models: await call(PROVIDER_ACCOUNT_MODELS_ROUTES.list, released),
      pool: await call(PROVIDER_ACCOUNT_POOL_ROUTES.list, released),
      poolUpdate: await call(PROVIDER_ACCOUNT_POOL_ROUTES.update, {
        ...released,
        body: { provider: PROVIDER, enabled: false, leftOut: [] },
      }),
      usageReset: await call(PROVIDER_USAGE_RESET_ROUTES.list, { ...released, body: { provider: PROVIDER } }),
    };
    for (const [label, reply] of Object.entries(tries)) needsUpdate(reply, label);
    assert.equal(heldAccounts(), PROVIDER_MANY_ACCOUNTS_LIMIT);
    assert.equal(current().accountStore.pool(PROVIDER)?.leftOut.length, PROVIDER_MANY_ACCOUNTS_LIMIT);
    return Object.fromEntries(Object.entries(tries).map(([label, reply]) => [label, reply.status]));
  });

  await step("the 20 accounts and the pool stay after a restart", async () => {
    const before = accountIds(current().accountStore);
    await stopHost();
    host = await startHost();
    const again = await login();
    assert.deepEqual(accountIds(current().accountStore), before, "The account file did not load again.");
    assert.equal(current().accountStore.pool(PROVIDER)?.leftOut.length, PROVIDER_MANY_ACCOUNTS_LIMIT);
    const reply = await call(PROVIDER_ACCOUNTS_ROUTES.list, { token: again });
    assert.equal(listedAccounts(PROVIDER_ACCOUNTS_ROUTES.list, reply, true), PROVIDER_MANY_ACCOUNTS_LIMIT);
    return { accounts: before.length };
  });

  report.passed = true;
} finally {
  await stopHost();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: report.passed, steps: report.steps.length }, null, 2)}\n`);
}
process.exit(report.passed ? 0 : 1);
