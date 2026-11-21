// @openbot-server-headless — milestone 4: the repository's own server + agent stack under Bun.
//
// Runs the REAL CentralAuthManager (obk1 session), the REAL ServerMode (control socket),
// the REAL OpenBotDatabase/AgentStore/MailboxStore (SQLite), the REAL AgentService
// (opencode preferred via ACP), the REAL ProviderCredentialStore (encrypted provider-key
// envelope, file-key cipher — no keyring), the REAL TeamStore and the REAL TeamApiServer
// serving the team routes on 127.0.0.1. No Electron, no Xvfb, no dbus, no keyring, no
// window, no browser (HeadlessBrowserHost refuses every call).
//
// OPENBOT_HEADLESS_MODEL (with OPENBOT_HEADLESS_PROVIDER, default "opencode") pins the
// first agent's model after boot — the free-tier default is
// opencode/deepseek-v4.1-flash-free, which needs no key at all.
//
// Boot order mirrors the native host (index.ts:1412-1858): the host surface (control
// socket, then team API) listens first; the account and the agent service initialize
// in the background, like the desktop's AgentInitializationGate, so a slow provider
// probe never blocks the CLI.
//
// Safety: never point this at the real userData while the Electron server runs.
// Defaults: ~/.config/openbot-headless-test and /run/openbot-headless-test.

import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";

const MIB = 1024 * 1024;
const GIB = MIB * 1024;

const userData = process.env.OPENBOT_HEADLESS_USER_DATA ?? join(homedir(), ".config", "openbot-headless-test");
const socketDir = process.env.OPENBOT_HEADLESS_CONTROL_DIR ?? "/run/openbot-headless-test";
const socketPath = join(socketDir, "control.sock");
process.env.OPENBOT_HEADLESS_USER_DATA = userData;

// The opencode the phone already runs in ACP today (same binary the packaged server
// uses); bundledExecutables below points the provider resolver at it.
const OPENCODE_BIN =
  process.env.OPENBOT_OPENCODE_PATH ??
  "/var/lib/openbot/.config/OpenBot/provider-runtimes/opencode/linux-arm64/2.2.5/bin/opencode";

try {
  mkdirSync(userData, { recursive: true });
  mkdirSync(socketDir, { mode: 0o700, recursive: true });
} catch {
  console.error("The server runtime directory is not writable. Run this as the service user.");
  process.exit(1);
}

// Native behavior (server-mode.ts:113-122): never steal a socket another instance
// owns — probe it first and refuse if it answers.
if (existsSync(socketPath)) {
  const answered = await new Promise<boolean>((resolve) => {
    const request = httpRequest(
      { socketPath, method: "GET", path: "/v1/status", host: "openbot" },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode === 200));
      },
    );
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
    request.end();
  });
  if (answered) {
    console.error("Another openbot-headless server already answers on this control socket.");
    process.exit(1);
  }
  rmSync(socketPath, { force: true });
}

// --- real repository modules (loaded through the electron cache shim) -------------
import { createCentralAuthManager, centralAuthApiUrl } from "../../../src/main/account-service-access";
import { ServerMode } from "../../../src/main/server-mode";
import { TeamApiServer } from "../../../src/main/team-api-server";
import { TeamStore } from "../../../src/main/team-store";
import { OpenBotDatabase } from "../../../src/backend/openbot-database";
import { AgentStore } from "../../../src/backend/agent-store";
import { MailboxStore } from "../../../src/backend/mailbox-store";
import { AgentService } from "../../../src/backend/agent-service";
import { AgentTables } from "../../../src/backend/agent-data/agent-tables";
import { AgentDatabaseSupervisor } from "../../../src/backend/agent-data/agent-database-supervisor";
import { spawnAgentDatabaseHostBun } from "./headless-database-host";
import { ProviderCredentialStore } from "../../../src/main/provider-credential-store";
import { createSecretStorage, SECRET_STORAGE_KEY_FILE } from "../../../src/main/secret-storage-cipher";
import { AGENT_PROVIDERS } from "@openbot/contracts/agent-providers";
import { HeadlessBrowserHost } from "./headless-browser-host";

// --- memory: native ServerMemory semantics (server-memory.ts:96-101, :199-204) ------
let meminfoCache: { at: number; total: number; available: number } | null = null;
function readMemory(): { total: number; available: number } {
  const now = Date.now();
  if (meminfoCache && now - meminfoCache.at < 1000) {
    return { total: meminfoCache.total, available: meminfoCache.available };
  }
  const text = readFileSync("/proc/meminfo", "utf8");
  const total = Number(/^MemTotal:\s+(\d+)/m.exec(text)?.[1] ?? 0) * 1024;
  const available = Number(/^MemAvailable:\s+(\d+)/m.exec(text)?.[1] ?? 0) * 1024;
  meminfoCache = { at: now, total, available };
  return { total, available };
}

function memoryLevel(): "ok" | "low" | "critical" {
  const { total, available } = readMemory();
  const critical = Math.max(256 * MIB, total * 0.06);
  const low = Math.max(critical + 64 * MIB, total * 0.12, Math.min(512 * MIB, total * 0.2));
  if (available <= critical) return "critical";
  if (available <= low) return "low";
  return "ok";
}

function turnLimit(): 2 | 8 | 16 {
  const { total } = readMemory();
  if (total <= 5 * GIB) return 2;
  if (total <= 10 * GIB) return 8;
  return 16;
}

// HostMemory contract (src/backend/host-memory.ts): subscribe/reserveTurn included so
// the real AgentService accepts it.
const hostMemory = {
  hostedPlan: false,
  level: () => memoryLevel(),
  turnLimit: () => turnLimit(),
  reserveTurn: () => () => undefined,
  subscribe: () => () => undefined,
};

// --- account (real manager) ------------------------------------------------------------
const centralAuth = createCentralAuthManager({ confirmSessionAtStart: false });

// --- database, roster and mailbox (real SQLite stores) -------------------------------
// openbotRoot is pinned INSIDE the test userData: the default (homedir()/OpenBot) would
// create agent workspaces and the shared tables under the live server's real
// /var/lib/openbot/OpenBot directory.
const database = new OpenBotDatabase(userData);
const store = new AgentStore(userData, homedir(), database, undefined as never, join(userData, "OpenBot"));
await Effect.runPromise(store.initialize() as never).catch((error) => {
  console.error("The agent store did not initialize.", String(error));
  process.exit(1);
});
const mailbox = new MailboxStore(userData, store.sharedRoot, database);

// --- provider credentials (real store: the encrypted envelope, no keyring) --------------
// Native (application-services.ts:1615): ProviderCredentialStore over the userData file
// with the secret-storage cipher. The cipher's Linux path is the obk1 file-key (pure
// node:crypto), so provider keys persist with neither dbus nor a keyring; the free
// OpenCode Zen models (deepseek-v4.1-flash-free) need no key at all.
const secretStorage = createSecretStorage({ keyPath: join(userData, SECRET_STORAGE_KEY_FILE) });
const providerCredentials = new ProviderCredentialStore(
  join(userData, "openbot-provider-credentials-v1.json"),
  secretStorage.cipher(() => "The headless secret storage is unavailable."),
);
const credentialLoadError = await Effect.runPromise(providerCredentials.load() as never);
if (credentialLoadError) {
  console.warn(
    "OpenBot could not read the provider key file. It was left unchanged.",
    String(credentialLoadError),
  );
}

// --- shared tables (real supervisor + REAL host child, spawned under Bun) --------------
// Native (application-services.ts:1784): AgentTables over the shared agent-data.db with
// an AgentDatabaseSupervisor whose host is a separate process. Here the host child is the
// same repository entry the packaged app bundles, run under Bun through its stdio
// fallback (JSON lines, no Electron parentPort) — see headless-database-host.ts.
const tables = new AgentTables({
  sharedRoot: store.sharedRoot,
  supervisor: new AgentDatabaseSupervisor({
    spawnHost: spawnAgentDatabaseHostBun,
    onStatementSettled: (durationMs, request) => {
      console.log(`agentdb.${request} ${durationMs} ms`);
    },
    onHostStartFailed: (failure) => {
      console.warn(
        `The shared data process ${failure.reason} (failed starts in a row: ${failure.consecutiveFailures}, next start after ${failure.retryAfterMs} ms).`,
        failure.output.length > 0 ? `Its last output: ${failure.output}` : "It wrote no output.",
      );
    },
  }),
} as never);

// --- agents (real service: opencode over ACP with the real credential store) -----------
const browser = new HeadlessBrowserHost();
const agentService = new AgentService({
  store,
  mailbox,
  browser,
  preferredProvider: "opencode",
  credentials: {
    // Native shape (application-services.ts:2073): the real store answers apiKey and the
    // account keys read/write the same encrypted envelope.
    apiKey: (provider: never) => providerCredentials.get(provider),
    accountKeys: {
      get: (provider: never, accountId: string) => providerCredentials.accountKey(provider, accountId),
      set: (provider: never, accountId: string, key: string | null) =>
        providerCredentials.setAccountKey(provider, accountId, key) as never,
    },
    customProviders: () => [],
    mcpServers: () => [],
  } as never,
  bundledExecutables: { opencode: existsSync(OPENCODE_BIN) ? OPENCODE_BIN : null },
  offProviders: AGENT_PROVIDERS.filter((provider) => provider !== "opencode"),
  tables: tables as never,
  hostMemory,
  hostTurnLimits: { turnLimit: () => turnLimit(), agentTaskLimit: () => 16 },
} as never);

// --- team identity (real store) --------------------------------------------------------
const teamStore = new TeamStore(join(userData, "openbot-team-server-v2.json"), null);
await Effect.runPromise(teamStore.initialize() as never).catch((error) =>
  console.warn("The team store did not initialize.", String(error)),
);
if (!teamStore.configured) {
  const credentialsPath = join(userData, "openbot-headless-owner.json");
  let owner: { username: string; password: string };
  if (existsSync(credentialsPath)) {
    owner = JSON.parse(readFileSync(credentialsPath, "utf8")) as { username: string; password: string };
  } else {
    owner = { username: "owner", password: randomUUID().replaceAll("-", "") };
    writeFileSync(credentialsPath, JSON.stringify(owner), { mode: 0o600 });
  }
  await Effect.runPromise(teamStore.configure("openbot-headless-test", owner.username, owner.password) as never).catch(
    (error) => {
      console.error("The team identity did not configure.", String(error));
      process.exit(1);
    },
  );
}

// --- team API (real server, loopback; port known after start) --------------------------
let teamApiPort: number | null = null;
const teamApi = new TeamApiServer({
  appVersion: "0.0.3-headless",
  store: teamStore,
  agents: agentService as never,
  mailbox: mailbox as never,
  browser: browser as never,
} as never);

// --- control socket (real ServerMode) --------------------------------------------------
// Host status mirrors the native shape: online with the loopback apiUrl once the team
// API serves; signed_out before that.
const hostStatus = () => ({
  phase: teamApiPort ? ("online" as const) : ("signed_out" as const),
  configured: teamStore.configured,
  enabledOnLaunch: false,
  serverId: teamStore.getIdentity()?.serverId ?? null,
  serverName: teamStore.getIdentity()?.serverName ?? null,
  apiUrl: teamApiPort ? `http://localhost:${teamApiPort}` : null,
  logoUrl: null,
  appearance: null,
  apiOnline: Boolean(teamApiPort),
  remoteDesktopReady: false,
  remoteDesktopScreenRecordingDenied: false,
  remoteDesktopUnattended: false,
  remoteDesktopActiveSessions: 0,
  remoteDesktopMaxSessions: 0,
  message: teamApiPort
    ? "headless host: team API on loopback; no WebRTC bridge yet"
    : "headless host: agent service not wired yet",
});

const serverMode = new ServerMode({
  environment: { controlSocketPath: socketPath, setupPagePort: null },
  version: "0.0.3-headless",
  centralAuth: centralAuth as never,
  host: {
    getStatus: hostStatus,
    configure: async () => {
      // TODO: delegate to TeamStore identity update + account registration.
    },
    start: async () => {
      // The team API already serves loopback; remote publish needs the WebRTC bridge.
    },
    updateIdentity: async () => {},
    getMobileConnectHost: async () => null,
    refreshRegistration: async () => {},
  } as never,
  memory: {
    level: () => memoryLevel(),
    sample: () => {
      const { total, available } = readMemory();
      return { total, available };
    },
    turnLimit: () => turnLimit(),
  },
  onError: (message, error) => console.warn(message, error),
});

// Native order: control socket first, then team API, then background initialization.
await Effect.runPromise(serverMode.listen() as never).catch((error) => {
  console.error("The control socket failed:", String(error));
  process.exit(1);
});
console.log(`openbot-headless 0.0.3-headless`);
console.log(`api=${centralAuthApiUrl()}`);
console.log(`control socket: ${socketPath}`);
teamApiPort = await Effect.runPromise(teamApi.start() as never).catch((error) => {
  console.warn("The team API did not start.", String(error));
  return null;
});
if (teamApiPort) console.log(`team api: http://localhost:${teamApiPort}`);
void Effect.runPromise(centralAuth.initialize() as never)
  .then((state) => console.log(`account=${(state as { status: string } | null)?.status ?? "loading"}`))
  .catch((error) => console.warn("The account did not initialize.", String(error)));
// Native (application-services.ts:4263): the shared database host prewarms in the
// background once the socket is already serving.
void Effect.runPromise(tables.prewarm() as never).catch(() => undefined);
void Effect.runPromise(agentService.initialize() as never)
  .then(async () => {
    console.log("agents=ready");
    // Milestone 4: pin the first agent to a chosen model (the free tier by default in
    // the test harness); updateAgent is the same path the desktop picker uses.
    const model = process.env.OPENBOT_HEADLESS_MODEL;
    if (!model) return;
    const provider = process.env.OPENBOT_HEADLESS_PROVIDER ?? "opencode";
    const service = agentService as unknown as {
      listAgents: () => Array<{ id: string; name: string }>;
      updateAgent: (input: Record<string, unknown>) => never;
      createAgent: (input: Record<string, unknown>) => never;
    };
    let agent = service.listAgents()[0];
    if (agent) {
      await Effect.runPromise(service.updateAgent({ agentId: agent.id, provider, model }));
    } else {
      // The packaged app creates its first agent during first-run setup; a headless host
      // has no setup UI, so the model pin creates the roster entry itself.
      const created = (await Effect.runPromise(
        service.createAgent({
          name: "Headless",
          description: "The headless Bun host agent.",
          avatarSeed: "openbot-headless",
          avatarHue: null,
          initialMessage: "Say ready and nothing else.",
          provider,
          model,
        }),
      )) as { id: string; name: string };
      agent = created;
    }
    console.log(`model=${model} provider=${provider} agent=${agent.id}`);
  })
  .catch((error) =>
    console.warn(
      "The agent service did not initialize fully.",
      error instanceof Error ? `${error}\ncause: ${String((error as { cause?: unknown }).cause)}` : String(error),
    ),
  );

async function shutdown(signal: string): Promise<void> {
  const fail = setTimeout(() => process.exit(0), 5_000);
  fail.unref();
  (tables as unknown as { dispose(): void }).dispose();
  await Effect.runPromise(teamApi.stop() as never).catch(() => undefined);
  await Effect.runPromise(serverMode.close() as never).catch(() => undefined);
  await Effect.runPromise(centralAuth.dispose() as never).catch(() => undefined);
  clearTimeout(fail);
  rmSync(socketPath, { force: true });
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.once(signal, () => void shutdown(signal));
}
