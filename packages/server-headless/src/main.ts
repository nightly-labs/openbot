// @openbot/server-headless — option B entrypoint (WIP; see README and
// docs/headless-bun-module-roadmap.md).
//
// This is a NEW composition root: it builds the server services directly instead of
// importing createApplicationServices (which requires a BrowserWindow and imports
// Electron). Cut points, confirmed by audit:
//   - application-services.ts (composition)     -> replaced by this file
//   - secret-storage-cipher.ts (safeStorage)    -> headless-secret-storage.ts
//   - account-service-access.ts (electron net)  -> native fetch here
//   - agent-database-host-process.ts (utilityProcess.fork) -> headless-database-host.ts
//   - AgentService options bag (GUI fields)     -> stubs/null below
//
// Boot order mirrors src/main/index.ts:1412-1858 and application-services.ts:995-4147.
// Numbers in comments point at the lines this step replaces.

import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { runCauseEffect } from "../../../src/backend/effect-boundary";

// --- 0. paths (replaces app.getPath/app.setName, index.ts:300-314) ----------------
const appData = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
const userData = join(appData, "OpenBot");
const appVersion = "0.75.0"; // TODO read from package.json (replaces app.getVersion)
const controlSocketPath = join(process.env.XDG_RUNTIME_DIR ?? "/run/openbot", "control.sock");

// --- 1. timezone + logs (reuse, no Electron; index.ts:315-318, application-services.ts:995-1001)
import { applyServerTimezone, SERVER_TIMEZONE_PREFERENCE_FILE } from "../../../src/main/server-timezone-preference-store";
import { startProviderLog } from "../../../src/main/provider-log";
// TODO: startAgentLog / startAccountLog / startMainLog from the same module family.
applyServerTimezone(join(userData, SERVER_TIMEZONE_PREFERENCE_FILE), process.env);
startProviderLog(join(userData, "logs"));

// --- 2. secret storage without safeStorage (copy of secret-storage-cipher.ts:42-173
//        with isEncryptionAvailable()=false, app.isReady()=true; same file formats) --
import { createHeadlessSecretStorage } from "./headless-secret-storage";
const secretStorage = createHeadlessSecretStorage({ keyPath: join(userData, "secret-storage.key") });
const secretCipher = secretStorage.cipher(() => "secure storage unavailable");

// --- 3. CentralAuthManager (rewrites account-service-access.ts:30-67 with native fetch)
import { CentralAuthManager } from "../../../src/main/central-auth-manager";
const apiUrl = process.env.OPENBOT_AUTH_API_URL ?? "https://api.openbot.run";
const centralAuth = new CentralAuthManager({
  apiUrl,
  storagePath: join(userData, "openbot-central-auth-v1.bin"),
  fetch: (input: string, init?: RequestInit) => fetch(input, init),
  ...secretCipher,
  keyringChanged: () => secretStorage.madeKeyFile(),
  confirmSessionAtStart: false, // server mode (application-services.ts:1128)
} as never); // TODO: match the real constructor options of central-auth-manager.ts:190
await runCauseEffect(centralAuth.initialize() as never); // restores the obk1 session

// --- 4. database + roster (application-services.ts:1180-1190, 1254-1255, 1783-1798)
// TODO: OpenBotDatabase is node:sqlite — verify DatabaseSync/WAL under Bun on arm64.
// import { OpenBotDatabase } from "../../../src/backend/openbot-database";
// import { AgentStore } from "../../../src/backend/agent-store";
// import { MailboxStore } from "../../../src/backend/mailbox-store";
// import { AgentTables } from "../../../src/backend/agent-data/agent-tables";
// import { AgentDatabaseSupervisor } from "../../../src/backend/agent-data/agent-database-supervisor";
// import { spawnAgentDatabaseHostBun } from "./headless-database-host";
const database = null as never; // TODO
const store = null as never; // TODO AgentStore(userData, homedir(), database, defaults)
const mailbox = null as never; // TODO MailboxStore(userData, store.sharedRoot, store.database)
const agentTables = null as never; // TODO AgentTables + supervisor with Bun spawn

// --- 5. provider runtime (application-services.ts:1550-1571, 1615-1623) -----------
// import { ProviderRuntimeManager } from "../../../src/main/provider-runtime-manager";
// import { ProviderCredentialStore } from "../../../src/main/provider-credential-store";
const providerRuntimes = null as never; // TODO root = ~/.config/OpenBot/provider-runtimes
const providerCredentials = null as never; // TODO same file names as the desktop host

// --- 6. AgentService (application-services.ts:1961-2175; GUI options -> stub/null)
import { AgentService } from "../../../src/backend/agent-service";
import { HeadlessBrowserHost } from "./headless-browser-host";
const service = new AgentService({
  store,
  mailbox,
  browser: new HeadlessBrowserHost(), // refuses browser ops on a headless host
  screenCapture: null, // constructor accepts null (application-services.ts:2020-2022)
  // TODO: fill the full options bag (avatarDecoder, credentials, preferredProvider,
  // videoReader, feedback, hostedSites, skills, providerAccounts, ...)
} as never);

// --- 7. automation + team store + memory (2177-2195, 2581-2585, 1268-1275) -------
// import { AutomationServer } from "../../../src/main/automation-server";
// import { TeamStore } from "../../../src/main/team-store";
// import { ServerMemory } from "../../../src/main/server-memory";
const teamStore = null as never; // TODO openbot-team-server-v2.json (same file as desktop)
const hostMemory = null as never; // TODO ServerMemory({ hostedPlan: false, ... })
const automation = null as never; // TODO second phase if needed

// --- 8. HostService: owns TeamApiServer, listens on 127.0.0.1 ---------------------
// import { HostService } from "../../../src/main/host-service";
const host = null as never;
// TODO: HostService({ appVersion, store: teamStore, agents: service, mailbox,
//   registerRemoteHost: (i) => centralAuth.registerRemoteHost(i),
//   issueRemoteHostTicket: (h) => centralAuth.issueRemoteHostTicket(h), ... })
// Short-term alternative until WebRTC exists: host.startLoopbackOnly (host-service.ts:1136).

// --- 9. ServerMode: control socket, the /v1 routes (server-mode.ts:92-141) -------
// import { ServerMode } from "../../../src/main/server-mode";
const serverMode = null as never;
// TODO: new ServerMode({ environment: { controlSocketPath, setupPagePort: null },
//   version: appVersion, centralAuth, host, memory: { ... } })
// await runCauseEffect(serverMode.listen()); // application-services.ts:4101-4104

// --- 10. publish policy (index.ts:1652-1670) --------------------------------------
// centralAuth.on("changed", (state) => {
//   if (state.status === "signed_in") void serverMode.publish(true);
//   if (state.status === "signed_out") void host.stop(false);
// });

// --- 11. agent initialization gate (application-services.ts:3925-3938) ------------
// import { AgentInitializationGate } from "../../../src/main/agent-initialization";
const agentInitialization = null as never; // TODO: service.initialize + automation.sync

// --- 12. shutdown (index.ts:490-505) -----------------------------------------------
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void (async () => {
      // TODO: serverMode.close(), host.stop(false), service teardown, database.close()
      process.exit(0);
    })();
  });
}

console.log(
  JSON.stringify({
    status: "scaffold-wiring",
    package: "@openbot/server-headless",
    done: ["paths", "timezone+logs", "secret-storage-stub", "central-auth-manager", "browser-host-stub"],
    todo: ["database", "provider-runtime", "agent-options-bag", "host-service", "server-mode", "publish", "init-gate", "shutdown"],
    ram_estimate: "150-200 MB PSS vs 276 MB Electron main + 85 MB chromium subprocesses",
    see: "docs/headless-bun-module-roadmap.md",
  }),
);
