// Drives the real `TeamApiServer` on a loopback port over HTTP, as a remote client does. The team
// store and the direct-message store are the real ones on temporary files. The agent service, the
// mailbox and the browser are small in-memory stand-ins that record each call, so a check can show
// that a refused request did not reach them. The checks cover the protocol and auth gates, sign-in
// and account tickets, the admin-only routes, the host's Bitwarden connection over a fake `bw`, the
// host's Vault (`vault-v1`, its API keys through `vault-v2`, and the CSV import of `vault-import-v1`)
// over the real service and store,
// a password that an admin saves from the secure card (`browser-secret-vault-v1`),
// direct-message isolation, agents hidden from an older
// protocol, the queue routes, the attachment and file routes with their size limits, and the error
// codes. Writes .openbot-build/team-api-routes-e2e/report.json.
// Run: `bun run test:team-api-routes` (the preload gives the server's import graph an `electron`).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_PROVIDERS,
  type AgentModelId,
  type AgentProviderId,
  type AgentStatus,
  type AgentSummary,
  type AttachmentDataInput,
  type BitwardenConnectorStatus,
  type CentralAuthUser,
  DEFAULT_AGENT_DEFAULTS,
  type HiddenAgentsSnapshot,
  type QueueSnapshot,
  type RoutineResultConnectionOption,
  type RoutineResultDestination,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_PROTOCOL_V1_WEBSOCKET } from "@openbot/contracts/team-protocol";
import {
  AGENT_BACKUP_MODELS_CAPABILITY,
  AGENT_BACKUP_MODELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_TASK_LIMIT_CAPABILITY,
  AGENT_TASK_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import {
  BITWARDEN_CONNECTOR_CAPABILITY,
  BITWARDEN_CONNECTOR_ROUTES,
} from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import {
  BROWSER_PROFILES_CAPABILITY,
  BROWSER_PROFILES_ROUTES,
} from "@openbot/contracts/team-protocol/browser-profiles-v1";
import {
  BROWSER_SECRET_VAULT_CAPABILITY,
  BROWSER_SECRET_VAULT_ROUTES,
} from "@openbot/contracts/team-protocol/browser-secret-vault-v1";
import {
  MACHINE_RESOURCES_CAPABILITY,
  MACHINE_RESOURCES_ROUTES,
  type MachineAlertEvent,
  machineAlertEvent,
} from "@openbot/contracts/team-protocol/machine-resources-v1";
import { MEMORY_REVIEW_CAPABILITY, MEMORY_REVIEW_ROUTES } from "@openbot/contracts/team-protocol/memory-review-v1";
import {
  PROVIDER_DEFAULT_CAPABILITY,
  PROVIDER_DEFAULT_ROUTES,
} from "@openbot/contracts/team-protocol/provider-default-v1";
import {
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDER_USAGE_RESET_ROUTES,
} from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { PROVIDERS_V5_CAPABILITY, PROVIDERS_V5_ROUTES } from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_CAPABILITY, PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { QueueEditRejectedError, TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import {
  ROUTINE_RESULTS_CAPABILITY,
  ROUTINE_RESULTS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-results-v1";
import { SIDE_QUESTION_CAPABILITY, SIDE_QUESTION_ROUTES } from "@openbot/contracts/team-protocol/side-question-v1";
import { STORAGE_DISK_CAPABILITY, STORAGE_DISK_ROUTES } from "@openbot/contracts/team-protocol/storage-disk-v1";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { VAULT_IMPORT_CAPABILITY, VAULT_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_CAPABILITY, VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY, VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { SteerUnsupportedError } from "../src/backend/agent/queue-controls";
import { AgentLifecycleFailed } from "../src/backend/agent-service";
import { BrowserProfileStore } from "../src/backend/browser-profiles/browser-profile-store";
import type { BrowserTabSession } from "../src/backend/browser-state";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineResultError } from "../src/backend/routine-results/routine-results";
import { TeamChatStore } from "../src/backend/team-chat-store";
import { createAgentHostSettings } from "../src/main/agent-host-settings";
import { type BitwardenCliRunner, BitwardenConnectorService } from "../src/main/bitwarden-connector-service";
import { BitwardenConnectorStore } from "../src/main/bitwarden-connector-store";
import { createBrowserProfileService } from "../src/main/browser-profile-service";
import { MachineAlertMonitor, MachineAlertPreferenceStore } from "../src/main/machine-alerts";
import { MemoryReviewPreferenceStore } from "../src/main/memory-review-preference-store";
import type { TeamApiAgents, TeamApiBrowser, TeamApiMailbox } from "../src/main/team-api/dependencies";
import { isPeerHiddenProvider } from "../src/main/team-api/provider-visibility";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";
import { VaultService } from "../src/main/vault-service";
import { VaultStore } from "../src/main/vault-store";

const OUT = resolve(import.meta.dirname, "../.openbot-build/team-api-routes-e2e");
const APP_VERSION = "0.43.0";
const MIB = 1024 * 1024;

interface Check {
  name: string;
  passed: boolean;
  detail: unknown;
}

/** A parsed JSON response body. `JSON.parse` gives only these values. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Reply {
  status: number;
  body: Json;
  text: string;
  headers: Headers;
}

interface ReplySummary {
  status: number;
  body: Json;
}

interface CallOptions {
  token?: string;
  json?: unknown;
  bytes?: Uint8Array<ArrayBuffer>;
  protocol?: number | null;
  capabilities?: string[];
  headers?: Record<string, string>;
}

interface RecordedCall {
  method: string;
  args: readonly unknown[];
}

mkdirSync(OUT, { recursive: true });
const root = mkdtempSync(join(tmpdir(), "openbot-team-api-routes-"));
const checks: Check[] = [];
const calls: RecordedCall[] = [];
const logged: string[] = [];
// The uploads that reached `prepareImportedAttachments`, with their bytes.
const uploads: AttachmentDataInput[] = [];
let clock = Date.now();
const routineResultOptions: RoutineResultConnectionOption[] = [
  {
    connectionId: "slack-acme",
    platform: "slack",
    connectionName: "Acme",
    places: [{ id: "C0123", name: "general" }],
    placesFailed: false,
  },
];
let routineDestination: RoutineResultDestination | null = null;
// The setup choice of the host: Codex with its own default model.
let providerDefault: { provider: AgentProviderId | null; model: AgentModelId | null } = {
  provider: "codex",
  model: null,
};

function check(name: string, passed: boolean, detail: unknown = null): void {
  checks.push({ name, passed, detail });
}

function record(method: string, ...args: unknown[]): void {
  calls.push({ method, args });
}

function callsOf(method: string): readonly (readonly unknown[])[] {
  return calls.filter((call) => call.method === method).map((call) => call.args);
}

function parseJson(text: string): Json {
  const value: Json = JSON.parse(text);
  return value;
}

function objectKeys(value: Json | undefined): string[] {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
}

function field(value: Json | undefined, ...path: (string | number)[]): Json | undefined {
  let current = value;
  for (const key of path) {
    if (current === undefined || current === null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) current = typeof key === "number" ? current[key] : undefined;
    else current = typeof key === "string" ? current[key] : undefined;
  }
  return current;
}

function list(value: Json | undefined): Json[] {
  return Array.isArray(value) ? value : [];
}

function unused(name: string): () => never {
  return () => {
    throw new Error(`${name} is not used by the Team API routes E2E run.`);
  };
}

// The fake secret is put together at run time so that a secret scanner does not read it as a real key.
const FAKE_SECRET = ["sk", "ant", "e2e", "fake0000000000000000"].join("-");

// Files that the fake mailbox and the fake file resolvers point at.
const files = join(root, "files");
mkdirSync(files, { recursive: true });
const attachmentPath = join(files, "report one.txt");
const attachmentBytes = "attachment bytes for the download check\n";
writeFileSync(attachmentPath, attachmentBytes);
const sharedPath = join(files, "shared.txt");
writeFileSync(sharedPath, "shared file bytes\n");
const workspacePath = join(files, "notes.md");
writeFileSync(workspacePath, "# workspace notes\n");

function agent(id: string, name: string, provider: AgentProviderId, model: string): AgentSummary {
  return {
    id,
    name,
    title: "",
    description: "",
    notifications: true,
    provider,
    model,
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: join(root, "workspaces", id),
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  };
}

// `agent-oc` uses OpenCode, which protocol 3 does not know; `agent-pi` uses Pi, which protocols
// below 7 do not know. The server hides each one from a client on such a protocol.
const agents = [
  agent("agent-ada", "Ada", "claude", "claude-sonnet-4-5"),
  agent("agent-oc", "Oscar", "opencode", "anthropic/claude-sonnet-4-5"),
  agent("agent-pi", "Pia", "pi", "anthropic/claude-sonnet-4-5"),
];

function queueSnapshot(agentId: string): QueueSnapshot {
  return {
    agentId,
    deliveries: [
      {
        id: "delivery-1",
        messageId: "message-1",
        recipientAgentId: agentId,
        sender: { kind: "user" },
        text: "queued text",
        attachments: [],
        replyToMessageId: null,
        status: "queued",
        position: 1,
        turnId: null,
        error: null,
        createdAt: new Date(0).toISOString(),
      },
    ],
  };
}

// The provider keys that the fake host keeps.
const providerKeys = new Set<string>();
const NO_STATUS: AgentStatus = {
  phase: "ready",
  cliVersion: null,
  auth: { kind: "unknown" },
  capabilities: { chat: "ready", browser: "unavailable", computerUse: "unavailable" },
  message: null,
  fullAccess: true,
};

let hidden: HiddenAgentsSnapshot = { agents: [{ agentId: "agent-pi", hiddenAt: new Date(0).toISOString() }] };

const fakeAgents: TeamApiAgents = {
  on: () => undefined,
  off: () => undefined,
  preferredProvider: () => "claude",
  newAgentProvider: () => "claude",
  getStatus: () => {
    throw new Error(`The status backend failed with ${FAKE_SECRET}.`);
  },
  listAgents: () => agents,
  listQueue: (agentId) => {
    record("listQueue", agentId);
    return queueSnapshot(agentId);
  },
  acknowledgeFailedTurn: (agentId, turnId) => record("acknowledgeFailedTurn", agentId, turnId),
  cancelQueuedMessage: (agentId, deliveryId) => Effect.sync(() => record("cancelQueuedMessage", agentId, deliveryId)),
  steerQueuedMessage: (input) => {
    record("steerQueuedMessage", input);
    // OpenCode defers steering: the queue keeps the message and refuses the steer.
    if (input.agentId === "agent-oc")
      return Effect.fail(
        new AgentLifecycleFailed({ operation: "steerQueuedMessage", cause: new SteerUnsupportedError() }),
      );
    return Effect.void;
  },
  updateQueuedMessage: (input, sender) => Effect.sync(() => record("updateQueuedMessage", input, sender)),
  editQueuedMessage: (agentId, input, sender) => {
    record("editQueuedMessage", agentId, input, sender);
    if (input.editId === "edit-rejected") {
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "editQueuedMessage",
          cause: new QueueEditRejectedError("another editor holds this message."),
        }),
      );
    }
    return Effect.succeed(queueSnapshot(agentId));
  },
  reorderQueue: (input) => Effect.sync(() => record("reorderQueue", input)),
  interrupt: (agentId, turnId) => Effect.sync(() => record("interrupt", agentId, turnId)),
  prepareImportedAttachments: (paths, data) =>
    Effect.sync(() => {
      record("prepareImportedAttachments", paths, data);
      uploads.push(...data);
      return data.map((item, index) => ({
        id: `draft-${index + 1}`,
        name: item.name,
        size: item.bytes.length,
        kind: "file",
        mimeType: item.mimeType,
        previewKind: "none",
        previewUrl: null,
      }));
    }),
  discardDraftAttachment: (id) => Effect.sync(() => record("discardDraftAttachment", id)),
  resolveSharedFile: (path) =>
    Effect.sync(() => {
      record("resolveSharedFile", path);
      return path === "big.bin"
        ? { path: sharedPath, name: "big.bin", size: ATTACHMENT_LIMITS.fileBytes + 1 }
        : { path: sharedPath, name: "shared.txt", size: readFileSync(sharedPath).length };
    }),
  resolveWorkspaceFile: (agentId, path) =>
    Effect.sync(() => {
      record("resolveWorkspaceFile", agentId, path);
      return path === "big.bin"
        ? { path: workspacePath, name: "big.bin", size: ATTACHMENT_LIMITS.fileBytes + 1, insideWorkspace: true }
        : { path: workspacePath, name: "notes.md", size: readFileSync(workspacePath).length, insideWorkspace: true };
    }),
  deleteAgent: (agentId) => Effect.sync(() => record("deleteAgent", agentId)),
  getRuntimeSnapshot: unused("getRuntimeSnapshot"),
  getUsage: unused("getUsage"),
  getAnalytics: unused("getAnalytics"),
  getHostAnalytics: unused("getHostAnalytics"),
  listModels: unused("listModels"),
  sidebarChatIds: unused("sidebarChatIds"),
  listConversationReads: unused("listConversationReads"),
  generateProfile: unused("generateProfile"),
  askSideQuestion: (input) => {
    record("askSideQuestion", input);
    if (input.question === "busy?")
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "ask side question",
          cause: new Error(sourceText("error.agent.sideQuestionBusy")),
        }),
      );
    return Effect.succeed(`Answer to ${input.question}`);
  },
  saveProfile: unused("saveProfile"),
  createAgent: unused("createAgent"),
  committedAgentDuplication: unused("committedAgentDuplication"),
  duplicateAgent: unused("duplicateAgent"),
  commitAgentDuplication: unused("commitAgentDuplication"),
  updateAgent: unused("updateAgent"),
  getMemorySelection: unused("getMemorySelection"),
  setMemoryInclusion: unused("setMemoryInclusion"),
  listMemories: unused("listMemories"),
  createMemory: unused("createMemory"),
  updateMemory: unused("updateMemory"),
  deleteMemory: unused("deleteMemory"),
  clearMemories: unused("clearMemories"),
  listRoutines: unused("listRoutines"),
  createRoutine: unused("createRoutine"),
  updateRoutine: unused("updateRoutine"),
  deleteRoutine: unused("deleteRoutine"),
  testRoutine: unused("testRoutine"),
  listRoutineRuns: unused("listRoutineRuns"),
  listChannelMemories: unused("listChannelMemories"),
  createChannelMemory: unused("createChannelMemory"),
  updateChannelMemory: unused("updateChannelMemory"),
  deleteChannelMemory: unused("deleteChannelMemory"),
  clearChannelMemories: unused("clearChannelMemories"),
  listChannelRoutines: unused("listChannelRoutines"),
  createChannelRoutine: unused("createChannelRoutine"),
  updateChannelRoutine: unused("updateChannelRoutine"),
  deleteChannelRoutine: unused("deleteChannelRoutine"),
  testChannelRoutine: unused("testChannelRoutine"),
  listChannelRoutineRuns: unused("listChannelRoutineRuns"),
  setAvatar: unused("setAvatar"),
  resolveAvatar: unused("resolveAvatar"),
  readConversation: unused("readConversation"),
  readConversationFor: unused("readConversationFor"),
  readConversationPageFor: unused("readConversationPageFor"),
  searchConversationMessages: unused("searchConversationMessages"),
  searchConversationFiles: unused("searchConversationFiles"),
  markConversationRead: unused("markConversationRead"),
  markConversationUnread: unused("markConversationUnread"),
  listWorkspaceDirectory: unused("listWorkspaceDirectory"),
  sendMessage: unused("sendMessage"),
  setMessageReaction: unused("setMessageReaction"),
  clearAgentContext: unused("clearAgentContext"),
  agentIdForRequest: () => undefined,
  respondToPrompt: unused("respondToPrompt"),
  respondToApproval: unused("respondToApproval"),
  respondToBrowserSecret: (input) => Effect.sync(() => record("respondToBrowserSecret", input)),
  respondToBrowserTakeover: unused("respondToBrowserTakeover"),
};

const mailbox: TeamApiMailbox = {
  resolveAttachment: (id) =>
    Effect.succeed(id === "att-1" ? { path: attachmentPath, mimeType: "text/plain", name: "report one.txt" } : null),
};

// The holders whose browser control a route gave back, so a session end can be checked.
const releasedHolders: Parameters<TeamApiBrowser["releaseUserControlHeldBy"]>[0][] = [];
const releasedSession = (sessionId: string | undefined) =>
  releasedHolders.some((holder) => holder.kind === "session" && holder.sessionId === sessionId);

const browser: TeamApiBrowser = {
  listTabs: unused("listTabs"),
  getControlState: unused("getControlState"),
  open: unused("open"),
  activate: unused("activate"),
  navigate: unused("navigate"),
  reload: unused("reload"),
  stop: unused("stop"),
  takeUserControl: unused("takeUserControl"),
  releaseUserControl: unused("releaseUserControl"),
  releaseUserControlHeldBy: (holder) => {
    releasedHolders.push(holder);
  },
  close: unused("close"),
  capturePreview: unused("capturePreview"),
  setVisible: unused("setVisible"),
  getDisplayState: unused("getDisplayState"),
  loadUrl: unused("loadUrl"),
  // Only the browser-profiles tab route asks. `tab-private` holds an administrator's MCP sign-in.
  isPrivate: (tabId) => tabId === "tab-private",
  startView: unused("startView"),
  dispatchViewInput: unused("dispatchViewInput"),
  copyViewSelection: unused("copyViewSelection"),
  importSignIn: unused("importSignIn"),
};

// Account tickets that the fake account service redeems. Anything else is a ticket it refuses.
const accountUsers: Record<string, CentralAuthUser> = {
  "ticket-bob": { id: "account-bob", email: "bob@example.com", name: "Bob", avatarUrl: null },
  "ticket-stranger": { id: "account-stranger", email: "stranger@example.com", name: null, avatarUrl: null },
};
const redeemedServerIds: string[] = [];

// The host's Bitwarden connection: the real service and store, over a fake `bw` that keeps the state
// that the real CLI keeps in its data folder (the server and the sign-in) and records each call.
const BW_ITEM_ID = "12345678-1234-1234-1234-123456789abc";
const BW_CLIENT_ID = "user.e2e-client";
const BW_CLIENT_SECRET = ["bw", "e2e", "client", "secret"].join("-");
const BW_MASTER_PASSWORD = ["bw", "e2e", "master", "password"].join("-");
const BW_SESSION_KEY = ["bw", "e2e", "session"].join("-");
const BW_LOGIN_PASSWORD = ["bw", "e2e", "login", "password"].join("-");
const BW_SECRETS = [BW_CLIENT_SECRET, BW_MASTER_PASSWORD, BW_SESSION_KEY, BW_LOGIN_PASSWORD];
const bitwardenData = join(root, "bitwarden-host");
const bitwardenFile = join(root, "openbot-bitwarden-connector-v1.json");
const bitwardenCalls: { args: string[]; env: Record<string, string> }[] = [];
/** While set, `unlock` reports that it started and waits for `released`. */
let bitwardenUnlockGate: { started: () => void; released: Promise<void> } | null = null;
/** The CLI's own state lives in its data folder, so removing the folder signs it out. */
function bitwardenCliState(): { server: string | null; signedIn: boolean } {
  const path = join(bitwardenData, "data.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { server: null, signedIn: false };
}
function saveBitwardenCliState(change: Partial<{ server: string | null; signedIn: boolean }>): void {
  mkdirSync(bitwardenData, { recursive: true });
  writeFileSync(join(bitwardenData, "data.json"), JSON.stringify({ ...bitwardenCliState(), ...change }));
}
const fakeBitwardenCli: BitwardenCliRunner = async (_executable, args, env) => {
  bitwardenCalls.push({ args, env: { ...env } });
  if (env.BITWARDENCLI_APPDATA_DIR !== bitwardenData) throw new Error("bw ran outside the host data folder.");
  const [command, target] = args;
  const state = bitwardenCliState();
  if (command === "status")
    return JSON.stringify({ status: state.signedIn ? "locked" : "unauthenticated", serverUrl: state.server });
  if (command === "logout") {
    saveBitwardenCliState({ signedIn: false });
    return "";
  }
  if (command === "config") {
    if (state.signedIn) throw new Error("Logout required before server config update.");
    saveBitwardenCliState({ server: args[2] ?? null });
    return "Saved setting `config`.";
  }
  if (command === "login") {
    if (env.BW_CLIENTID !== BW_CLIENT_ID || env.BW_CLIENTSECRET !== BW_CLIENT_SECRET) throw new Error("bad key");
    saveBitwardenCliState({ signedIn: true });
    return "You are logged in!";
  }
  if (command === "unlock") {
    if (bitwardenUnlockGate) {
      bitwardenUnlockGate.started();
      await bitwardenUnlockGate.released;
    }
    if (!state.signedIn || env.BW_PASSWORD !== BW_MASTER_PASSWORD) throw new Error("bad password");
    return `${BW_SESSION_KEY}\n`;
  }
  if (env.BW_SESSION !== BW_SESSION_KEY) throw new Error("locked");
  const item = {
    id: BW_ITEM_ID,
    name: "Example",
    type: 1,
    folderId: "shared",
    login: { username: "ada", password: BW_LOGIN_PASSWORD, uris: [{ uri: "https://example.com/login", match: null }] },
  };
  if (command === "sync") return "Syncing complete.";
  if (command === "list" && target === "folders")
    return JSON.stringify([{ id: "shared", name: "Shared with OpenBot" }]);
  if (command === "list" && target === "items") return JSON.stringify([item]);
  if (command === "get" && target === "item") return JSON.stringify(item);
  throw new Error(`Unexpected bw call: ${command}`);
};
/** Reversible, and the stored file holds no secret in plain text. */
const fakeCipher = {
  encrypt: (value: string) => Buffer.from(Buffer.from(value, "utf8").toString("hex"), "utf8"),
  decrypt: (value: Buffer) => Buffer.from(value.toString("utf8"), "hex").toString("utf8"),
};
const createBitwardenHost = () =>
  new BitwardenConnectorService({
    runCli: fakeBitwardenCli,
    findCli: async () => "/fixture/bw",
    host: {
      store: new BitwardenConnectorStore(bitwardenFile, fakeCipher),
      dataDirectory: bitwardenData,
      installCli: null,
    },
  });
const bitwardenConnector = createBitwardenHost();
// The host's Vault: the real service and store, over the same reversible cipher.
const vaultFile = join(root, "openbot-vault-v1.json");
const vault = new VaultService({ store: new VaultStore(vaultFile, fakeCipher), canPersist: () => true });
await Effect.runPromise(vault.load());
const VAULT_PASSWORD = "e2e-vault-password-7f3c";
const VAULT_API_KEY = "e2e-vault-api-key-91d2";
/** Resolves with the first status after a host sign-in started (`connecting`) and then ended. */
function bitwardenSettled(connector: BitwardenConnectorService): Promise<BitwardenConnectorStatus> {
  return new Promise((resolveStatus) => {
    let started = false;
    const stop = connector.onChanged((status) => {
      if (status.connecting) started = true;
      if (!started || status.connecting) return;
      stop();
      resolveStatus(status);
    });
  });
}

const store = new TeamStore(join(root, "team.json"));
// The real alert store and member check, over a fixed reading of a nearly full machine.
const machineMetrics = {
  diskUsedBytes: 61 * 1024 ** 3,
  diskFreeBytes: 3 * 1024 ** 3,
  diskTotalBytes: 64 * 1024 ** 3,
  memoryAvailableBytes: 2 * 1024 ** 3,
  memoryTotalBytes: 16 * 1024 ** 3,
  cpuPercent: 37,
  cpuMillicores: 1500,
  checkedAt: "2026-10-27T12:00:00.000Z",
};
const machineAlertStore = new MachineAlertPreferenceStore(join(root, "machine-alerts.json"));
// The real memory review store on a temporary file, as the host keeps it.
const memoryReviewFile = join(root, "memory-review.json");
const memoryReview = new MemoryReviewPreferenceStore(memoryReviewFile);
const readMachine = () =>
  Effect.sync(() => {
    record("machineMetrics");
    return machineMetrics;
  });
const machine = new MachineAlertMonitor({
  read: readMachine,
  display: readMachine,
  store: machineAlertStore,
  members: () => store.listMembers(),
  onError: (message) => logged.push(message),
});
const database = new OpenBotDatabase(join(root, "user-data"));
let server: TeamApiServer | null = null;

try {
  await runCauseEffect(store.initialize());
  const OWNER_PASSWORD = "owner-password-e2e";
  await runCauseEffect(store.configure("E2E Server", "owner", OWNER_PASSWORD));
  await runCauseEffect(database.initialize());
  const owner = await runCauseEffect(store.login("owner", OWNER_PASSWORD));
  const serverId = store.getIdentity()?.serverId;
  assert.ok(serverId, "The team store has no identity after configure.");

  // The real profile service over the test database. The host's open profile tabs are one list.
  const profileTabs: { tabId: string; tabSession: BrowserTabSession }[] = [];
  const inSession = (left: BrowserTabSession, right: BrowserTabSession) =>
    left.kind === "profile" && right.kind === "profile"
      ? left.profileId === right.profileId
      : left.kind === "agent" && right.kind === "agent" && left.key === right.key;
  const browserProfiles = createBrowserProfileService({
    store: new BrowserProfileStore(database),
    agents: {
      listAgents: () => agents,
      updateAgent: (input) =>
        Effect.sync(() => {
          record("updateAgentBrowserProfile", input);
          const target = agents.find((item) => item.id === input.agentId);
          if (!target) throw new Error("Agent not found.");
          if (typeof input.browserProfileId === "string") target.browserProfileId = input.browserProfileId;
          else if (input.ownBrowserSession !== undefined) {
            delete target.browserProfileId;
            target.ownBrowserSession = input.ownBrowserSession;
          }
          return target;
        }),
    },
    browser: {
      tabIdsInSession: (tabSession) =>
        profileTabs.filter((tab) => inSession(tab.tabSession, tabSession)).map((tab) => tab.tabId),
      listTabSessions: () => profileTabs.map((tab) => ({ ...tab })),
      close: (tabId) =>
        Effect.sync(() => {
          record("closeProfileTab", tabId);
          profileTabs.splice(
            profileTabs.findIndex((tab) => tab.tabId === tabId),
            1,
          );
        }),
      clearTabSession: (tabSession) => Effect.sync(() => record("clearTabSession", tabSession)),
    },
  });

  server = new TeamApiServer({
    appVersion: APP_VERSION,
    store,
    agents: fakeAgents,
    mailbox,
    browser,
    chat: new TeamChatStore(database),
    // The real host-settings service, over an agent writer that records each change.
    admin: {
      agentHost: createAgentHostSettings({
        agents: {
          listAgents: () => agents,
          updateAgent: (input) =>
            Effect.sync(() => {
              record("updateAgent", input);
              const target = agents.find((item) => item.id === input.agentId);
              if (!target) throw new Error("Agent not found.");
              if (input.backupModels === null) delete target.backupModels;
              else if (input.backupModels) target.backupModels = input.backupModels;
              if (input.taskLimit === null) delete target.taskLimit;
              else if (input.taskLimit !== undefined) target.taskLimit = input.taskLimit;
              return target;
            }),
        },
        busyMessageMode: { get: () => ({ mode: "queue" }) },
        agentDefaults: { get: () => DEFAULT_AGENT_DEFAULTS },
      }),
      memoryReview,
      // The setup file in memory. The host writes it and tells the agent service, as `saveSetup` does.
      defaultProvider: {
        get: () => Effect.sync(() => providerDefault),
        set: (input) =>
          Effect.sync(() => {
            record("setDefaultProvider", input);
            providerDefault = { provider: input.preferredProvider, model: input.preferredModel };
            return providerDefault;
          }),
      },
      // A routine results service over one agent routine. The host's own name of the connection wins.
      routineResults: {
        options: () => Effect.succeed(routineResultOptions),
        destination: (input) =>
          input.agentId === "agent-ada" && input.routineId === "routine-ada"
            ? Effect.succeed(routineDestination)
            : Effect.fail({ cause: new RoutineResultError(sourceText("error.backend.routineGone")) }),
        setDestination: (input) =>
          Effect.suspend(() => {
            record("setRoutineResultDestination", input);
            if (input.agentId !== "agent-ada" || input.routineId !== "routine-ada")
              return Effect.fail({ cause: new RoutineResultError(sourceText("error.backend.routineGone")) });
            routineDestination = input.destination
              ? { ...input.destination, platform: "slack", connectionName: "Acme" }
              : null;
            return Effect.succeed(routineDestination);
          }),
      },
      // A credential store in memory. The service runs the change as the host's does.
      providers: {
        service: {
          startProviderCodeLogin: unused("providers.startProviderCodeLogin"),
          submitProviderCodeLogin: unused("providers.submitProviderCodeLogin"),
          cancelProviderCodeLogin: unused("providers.cancelProviderCodeLogin"),
          changeProviderCredential: (provider, change) => {
            record("changeProviderCredential", provider);
            return change().pipe(Effect.as(NO_STATUS));
          },
          clearProviderCredential: (_provider, change) => change().pipe(Effect.as(NO_STATUS)),
        },
        credentials: {
          status: (provider) => (providerKeys.has(provider) ? "saved" : "missing"),
          set: (provider, key) =>
            Effect.sync(() => {
              record("setProviderKey", provider, key);
              providerKeys.add(provider);
            }),
          clear: (provider) =>
            Effect.sync(() => {
              record("clearProviderKey", provider);
              providerKeys.delete(provider);
            }),
        },
        runtimes: {
          getStatus: unused("providers.runtimes.getStatus"),
          download: unused("providers.runtimes.download"),
          cancel: unused("providers.runtimes.cancel"),
          checkForUpdates: unused("providers.runtimes.checkForUpdates"),
          // Pi is ready for DeepSeek. For Inception it is still to come.
          startKeyProviderCli: (provider) =>
            Effect.sync(() => {
              record("startKeyProviderCli", provider);
              return provider === "inception";
            }),
        },
        customProviders: {
          list: unused("providers.customProviders.list"),
          save: unused("providers.customProviders.save"),
          remove: unused("providers.customProviders.remove"),
        },
        pasteSignIn: false,
      },
    },
    bitwardenConnector,
    vault,
    browserProfiles,
    machine,
    // Only the disk of the host answers here; the storage-v1 routes are not part of this run.
    storage: {
      usage: unused("storage.usage"),
      deleteFile: unused("storage.deleteFile"),
      clear: unused("storage.clear"),
      disk: () =>
        Effect.sync(() => {
          record("disk");
          return { freeBytes: 2 * 1024 ** 3, totalBytes: 64 * 1024 ** 3 };
        }),
    },
    // The host's own sign-in has two usage reset credits; a reset spends one.
    providerUsageResets: {
      providerUsageResets: (provider) =>
        Effect.sync(() => {
          record("providerUsageResets", provider);
          return [{ provider, accountId: "default", available: 2 }];
        }),
      resetProviderUsage: (provider, accountId) =>
        Effect.sync(() => {
          record("resetProviderUsage", { provider, accountId });
          return "reset" as const;
        }),
    },
    hiddenAgents: {
      listHiddenAgents: () => hidden,
      setAgentHidden: (input) =>
        Effect.sync(() => {
          record("setAgentHidden", input);
          const others = hidden.agents.filter((entry) => entry.agentId !== input.agentId);
          hidden = {
            agents: input.hidden
              ? [...others, { agentId: input.agentId, hiddenAt: new Date(clock).toISOString() }]
              : others,
          };
          return hidden;
        }),
    },
    redeemCentralTicket: (ticket, id) =>
      Effect.sync(() => {
        redeemedServerIds.push(id);
        return accountUsers[ticket] ?? null;
      }),
    now: () => clock,
    logger: createOpenBotLogger("team-api-e2e", (line) => logged.push(line)),
  });
  const port = await Effect.runPromise(server.start());
  const base = `http://127.0.0.1:${port}`;

  function protocolHeaders(options: CallOptions): Record<string, string> {
    const protocol = options.protocol === undefined ? 7 : options.protocol;
    return {
      ...(protocol === null
        ? {}
        : {
            [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
            [TEAM_APP_VERSION_HEADER]: APP_VERSION,
            [TEAM_CAPABILITIES_HEADER]: (
              options.capabilities ?? [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY]
            ).join(","),
          }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    };
  }

  async function call(method: string, path: string, options: CallOptions = {}): Promise<Reply> {
    const headers = protocolHeaders(options);
    let body: string | Uint8Array<ArrayBuffer> | null = null;
    if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.bytes) body = options.bytes;
    const response = await fetch(`${base}${path}`, { method, headers, body });
    const text = await response.text();
    let parsed: Json = null;
    if (response.headers.get("content-type")?.startsWith("application/json")) parsed = parseJson(text);
    return { status: response.status, body: parsed, text, headers: response.headers };
  }

  /** One raw request with a declared length, for the body limits that `fetch` cannot reach. */
  function rawCall(path: string, token: string, contentLength: number, body: Uint8Array | null): Promise<ReplySummary> {
    return new Promise((resolveCall, rejectCall) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path,
          headers: {
            ...protocolHeaders({ token }),
            "Content-Type": "application/octet-stream",
            "Content-Length": String(contentLength),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            request.destroy();
            const text = Buffer.concat(chunks).toString("utf8");
            resolveCall({ status: response.statusCode ?? 0, body: text ? parseJson(text) : null });
          });
        },
      );
      request.on("error", rejectCall);
      if (body) request.end(body);
      else request.flushHeaders();
    });
  }

  function errorIs(reply: Reply, status: number, message: string): boolean {
    return reply.status === status && field(reply.body, "error") === message;
  }

  function summary(reply: Reply): ReplySummary {
    return { status: reply.status, body: reply.body ?? reply.text.slice(0, 200) };
  }

  // ---- Protocol gate ----
  {
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: null });
    check(
      "compatibility answers without protocol headers and names the supported range",
      compatibility.status === 200 &&
        field(compatibility.body, "protocol", "minimum") === 1 &&
        field(compatibility.body, "protocol", "maximum") === 8,
      summary(compatibility),
    );
    const noHeaders = await call("GET", TEAM_API_ROUTES.identity, { protocol: null });
    check(
      "a request without protocol headers gets 426 client_update_required",
      noHeaders.status === 426 && field(noHeaders.body, "code") === "client_update_required",
      summary(noHeaders),
    );
    const badHeader = await call("GET", TEAM_API_ROUTES.identity, {
      headers: { [TEAM_PROTOCOL_VERSION_HEADER]: "7.5" },
    });
    check(
      "a protocol header that is not an integer gets 400 protocol_error",
      badHeader.status === 400 && field(badHeader.body, "code") === "protocol_error",
      summary(badHeader),
    );
    const newer = await call("GET", TEAM_API_ROUTES.identity, { protocol: 9 });
    check(
      "a newer protocol gets 426 host_update_required with the client version",
      newer.status === 426 &&
        field(newer.body, "code") === "host_update_required" &&
        field(newer.body, "client", "protocol") === 9,
      summary(newer),
    );
    const zero = await call("GET", TEAM_API_ROUTES.identity, { protocol: 0 });
    check(
      "protocol 0 is not a valid protocol header and gets 400 protocol_error",
      zero.status === 400 && field(zero.body, "code") === "protocol_error",
      summary(zero),
    );
    const identity = await call("GET", TEAM_API_ROUTES.identity);
    check(
      "identity answers without a token and names this server",
      identity.status === 200 && field(identity.body, "serverId") === serverId,
      summary(identity),
    );
  }

  // ---- Join with an invitation and with an account ticket ----
  const adminInvite = await runCauseEffect(store.createInvite("admin"));
  const memberInvite = await runCauseEffect(store.createInvite("member"));
  const ADA_PASSWORD = "ada-password-e2e-1";
  const adaJoin = await call("POST", TEAM_API_ROUTES.join.server, {
    json: { inviteToken: adminInvite.token, username: "ada", password: ADA_PASSWORD },
  });
  const adaToken = field(adaJoin.body, "sessionToken");
  const adaId = field(adaJoin.body, "member", "id");
  check(
    "join with an admin invitation gives 201 and an admin session",
    adaJoin.status === 201 && typeof adaToken === "string" && field(adaJoin.body, "member", "role") === "admin",
    { status: adaJoin.status, role: field(adaJoin.body, "member", "role") },
  );
  assert.ok(typeof adaToken === "string" && typeof adaId === "string", "ada did not join.");

  const reuse = await call("POST", TEAM_API_ROUTES.join.server, {
    json: { inviteToken: adminInvite.token, username: "ada2", password: ADA_PASSWORD },
  });
  check(
    "a used invitation is refused with inviteInvalid",
    errorIs(reuse, 400, sourceText("error.team.inviteInvalid")),
    summary(reuse),
  );

  const unknownTicket = await call("POST", TEAM_API_ROUTES.join.account, {
    json: { inviteToken: memberInvite.token, accountTicket: "ticket-unknown" },
  });
  check(
    "join with a ticket that the account service refuses gives 401 signInRequired",
    errorIs(unknownTicket, 401, sourceText("error.team.signInRequired")),
    summary(unknownTicket),
  );
  const bobJoin = await call("POST", TEAM_API_ROUTES.join.account, {
    json: { inviteToken: memberInvite.token, accountTicket: "ticket-bob" },
  });
  const bobToken = field(bobJoin.body, "sessionToken");
  const bobId = field(bobJoin.body, "member", "id");
  check(
    "join with an account ticket gives 201 and a member with the account email",
    bobJoin.status === 201 &&
      field(bobJoin.body, "member", "role") === "member" &&
      field(bobJoin.body, "member", "email") === "bob@example.com",
    { status: bobJoin.status, role: field(bobJoin.body, "member", "role") },
  );
  check(
    "the ticket is redeemed for this server only",
    redeemedServerIds.length > 0 && redeemedServerIds.every((id) => id === serverId),
    { redeemedServerIds, serverId },
  );
  assert.ok(typeof bobToken === "string" && typeof bobId === "string", "bob did not join.");

  const seatInvite = await runCauseEffect(store.createInvite("member"));
  const fourth = await call("POST", TEAM_API_ROUTES.join.server, {
    json: { inviteToken: seatInvite.token, username: "carol", password: "carol-password-e2e" },
  });
  check(
    "a fourth member is refused with memberLimit",
    errorIs(fourth, 400, sourceText("error.team.memberLimit", { limit: 3 })) && store.listMembers().length === 3,
    summary(fourth),
  );

  // ---- Sign-in, rate limit, account sign-in, logout ----
  {
    const results: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await call("POST", TEAM_API_ROUTES.auth.login, {
        json: { username: "owner", password: "not-the-owner-password" },
      });
      results.push(wrong.status);
    }
    const blocked = await call("POST", TEAM_API_ROUTES.auth.login, {
      json: { username: "owner", password: OWNER_PASSWORD },
    });
    check(
      "five wrong passwords give loginIncorrect, then the correct password gets 429",
      results.every((status) => status === 400) &&
        errorIs(blocked, 429, sourceText("error.team.tooManySignInAttempts")) &&
        field(blocked.body, "sessionToken") === undefined,
      { results, blocked: summary(blocked) },
    );
    const otherUser = await call("POST", TEAM_API_ROUTES.auth.login, {
      json: { username: "ada", password: ADA_PASSWORD },
    });
    check(
      "the limit of one user name does not block another user name",
      otherUser.status === 200 && typeof field(otherUser.body, "sessionToken") === "string",
      { status: otherUser.status },
    );
    clock += 15 * 60 * 1_000 + 1;
    const afterWindow = await call("POST", TEAM_API_ROUTES.auth.login, {
      json: { username: "owner", password: OWNER_PASSWORD },
    });
    check(
      "after the 15 minute window the owner signs in again",
      afterWindow.status === 200 && field(afterWindow.body, "member", "role") === "owner",
      { status: afterWindow.status },
    );

    const adaSecond = field(otherUser.body, "sessionToken");
    assert.ok(typeof adaSecond === "string", "ada has no second session.");
    const adaSecondSession = store.authenticateSession(adaSecond)?.sessionId;
    const logout = await call("POST", TEAM_API_ROUTES.auth.logout, { token: adaSecond, json: {} });
    const afterLogout = await call("GET", TEAM_API_ROUTES.me, { token: adaSecond });
    const firstStill = await call("GET", TEAM_API_ROUTES.me, { token: adaToken });
    check(
      "logout ends only that session and gives back the browser control of that session",
      logout.status === 204 &&
        errorIs(afterLogout, 401, sourceText("error.team.authenticationRequired")) &&
        firstStill.status === 200 &&
        releasedSession(adaSecondSession),
      {
        logout: logout.status,
        afterLogout: afterLogout.status,
        firstStill: firstStill.status,
        released: releasedSession(adaSecondSession),
      },
    );
  }

  const bobSessionsBefore = new Set(store.listSessions().map((session) => session.id));
  const accountLogin = await call("POST", TEAM_API_ROUTES.auth.account, { json: { accountTicket: "ticket-bob" } });
  const bobSecond = field(accountLogin.body, "sessionToken");
  check(
    "account sign-in with a member ticket gives a session for that member",
    accountLogin.status === 200 && field(accountLogin.body, "member", "id") === bobId && typeof bobSecond === "string",
    { status: accountLogin.status },
  );
  assert.ok(typeof bobSecond === "string", "bob has no account session.");
  const bobSecondSession = store
    .listSessions()
    .find((session) => !bobSessionsBefore.has(session.id) && session.memberId === bobId);
  const stranger = await call("POST", TEAM_API_ROUTES.auth.account, { json: { accountTicket: "ticket-stranger" } });
  check(
    "account sign-in for an account that is not a member gives accountNotMember",
    errorIs(stranger, 400, sourceText("error.team.accountNotMember")) &&
      field(stranger.body, "sessionToken") === undefined,
    summary(stranger),
  );
  const refusedTicket = await call("POST", TEAM_API_ROUTES.auth.account, { json: { accountTicket: "ticket-unknown" } });
  check(
    "account sign-in with a refused ticket gives 401 signInRequired",
    errorIs(refusedTicket, 401, sourceText("error.team.signInRequired")),
    summary(refusedTicket),
  );

  // ---- Auth gate ----
  {
    const required = sourceText("error.team.authenticationRequired");
    const noToken = await call("GET", TEAM_API_ROUTES.me);
    const unknownPath = await call("GET", "/v1/no-such-route");
    const shortToken = await call("GET", TEAM_API_ROUTES.me, { headers: { Authorization: "Bearer short" } });
    const unknownToken = await call("GET", TEAM_API_ROUTES.me, { token: "A".repeat(43) });
    const basic = await call("GET", TEAM_API_ROUTES.me, { headers: { Authorization: `Basic ${bobToken}` } });
    check(
      "no token, a malformed token, an unknown token and a non-bearer scheme all get 401",
      [noToken, shortToken, unknownToken, basic].every((reply) => errorIs(reply, 401, required)),
      [noToken, shortToken, unknownToken, basic].map((reply) => reply.status),
    );
    check(
      "an unknown route without a token gets 401, not 404",
      errorIs(unknownPath, 401, required),
      summary(unknownPath),
    );
    const me = await call("GET", TEAM_API_ROUTES.me, { token: bobToken });
    check(
      "me returns the caller and no credential fields",
      me.status === 200 &&
        field(me.body, "id") === bobId &&
        field(me.body, "role") === "member" &&
        !/password|salt|hash|token/iu.test(objectKeys(me.body).join(",")),
      summary(me),
    );
    const notFound = await call("GET", "/v1/no-such-route", { token: bobToken });
    const wrongMethod = await call("PUT", TEAM_API_ROUTES.me, { token: bobToken, json: {} });
    check(
      "an unknown route and a wrong method with a token get 404 routeNotFound",
      errorIs(notFound, 404, sourceText("error.team.routeNotFound")) &&
        errorIs(wrongMethod, 404, sourceText("error.team.routeNotFound")),
      { notFound: notFound.status, wrongMethod: wrongMethod.status },
    );
    const events = await call("GET", TEAM_API_ROUTES.events, { token: bobToken });
    const remoteMac = await call("GET", TEAM_API_ROUTES.host.remoteMac, { token: bobToken });
    const remoteDesktop = await call("GET", TEAM_API_ROUTES.host.remoteDesktopAccess, { token: bobToken });
    check(
      "events over HTTP and the two removed host routes get 426",
      events.status === 426 &&
        [remoteMac, remoteDesktop].every(
          (reply) =>
            errorIs(reply, 426, sourceText("error.team.updateRequired")) &&
            field(reply.body, "code") === "protocol_mismatch",
        ),
      [summary(events), summary(remoteMac), summary(remoteDesktop)],
    );
  }

  // ---- Admin-only routes: a member is refused and nothing changes ----
  {
    const adminRequired = sourceText("error.team.adminRequired");
    const membersBefore = JSON.stringify(store.listMembers());
    const invitesBefore = store.listInvites().length;
    const sessionsBefore = store.listSessions().length;
    const ownerSession = store.authenticateSession(owner.sessionToken)?.sessionId ?? "";
    const memberAttempts = [
      await call("GET", TEAM_API_ROUTES.team.members, { token: bobToken }),
      await call("PATCH", TEAM_API_ROUTES.team.member(adaId), { token: bobToken, json: { disabled: true } }),
      await call("DELETE", TEAM_API_ROUTES.team.member(adaId), { token: bobToken }),
      await call("POST", TEAM_API_ROUTES.team.invites, { token: bobToken, json: { role: "admin" } }),
      await call("GET", TEAM_API_ROUTES.team.invites, { token: bobToken }),
      await call("DELETE", TEAM_API_ROUTES.team.invite(seatInvite.id), { token: bobToken }),
      await call("GET", TEAM_API_ROUTES.team.sessions, { token: bobToken }),
      await call("DELETE", TEAM_API_ROUTES.team.session(ownerSession), { token: bobToken }),
    ];
    check(
      "a member gets 403 adminRequired on every member, invitation and session admin route",
      memberAttempts.every((reply) => errorIs(reply, 403, adminRequired)),
      memberAttempts.map((reply) => reply.status),
    );
    check(
      "the refused admin requests changed no member, invitation or session",
      JSON.stringify(store.listMembers()) === membersBefore &&
        store.listInvites().length === invitesBefore &&
        store.listSessions().length === sessionsBefore,
      {
        members: store.listMembers().length,
        invites: store.listInvites().length,
        sessions: store.listSessions().length,
      },
    );
    const sessionsList = await call("GET", TEAM_API_ROUTES.team.sessions, { token: bobToken });
    check(
      "the refused session list does not include any session data",
      !sessionsList.text.includes(ownerSession) && !sessionsList.text.includes(String(bobId)),
      summary(sessionsList),
    );

    const members = await call("GET", TEAM_API_ROUTES.team.members, { token: adaToken });
    check("an admin lists the three members", members.status === 200 && list(members.body).length === 3, {
      status: members.status,
      count: list(members.body).length,
    });
    const invite = await call("POST", TEAM_API_ROUTES.team.invites, { token: adaToken, json: { role: "member" } });
    check(
      "an invitation without the invite service gets 503 inviteServiceUnavailable",
      errorIs(invite, 503, sourceText("error.team.inviteServiceUnavailable")),
      summary(invite),
    );
    const ownerId = store.getOwnerMemberId() ?? "";
    const changeOwner = await call("PATCH", TEAM_API_ROUTES.team.member(ownerId), {
      token: adaToken,
      json: { role: "member" },
    });
    const badRole = await call("PATCH", TEAM_API_ROUTES.team.member(bobId), {
      token: adaToken,
      json: { role: "owner" },
    });
    const badDisabled = await call("PATCH", TEAM_API_ROUTES.team.member(bobId), {
      token: adaToken,
      json: { disabled: "yes" },
    });
    check(
      "an admin cannot change the owner and gets 400 for an invalid role or disabled value",
      errorIs(changeOwner, 400, sourceText("error.team.ownerCannotChange")) &&
        badRole.status === 400 &&
        badDisabled.status === 400 &&
        store.getMember(ownerId)?.role === "owner" &&
        store.getMember(bobId)?.role === "member",
      [summary(changeOwner), summary(badRole), summary(badDisabled)],
    );
    const revokeOwner = await call("DELETE", TEAM_API_ROUTES.team.session(ownerSession), { token: adaToken });
    check(
      "an admin cannot end a session of the owner",
      errorIs(revokeOwner, 400, sourceText("error.team.ownerCannotChange")) &&
        store.authenticateSession(owner.sessionToken) !== null,
      summary(revokeOwner),
    );
    const revokeBob = await call("DELETE", TEAM_API_ROUTES.team.session(bobSecondSession?.id ?? "missing"), {
      token: adaToken,
    });
    const revokedUse = await call("GET", TEAM_API_ROUTES.me, { token: bobSecond });
    const bobFirst = await call("GET", TEAM_API_ROUTES.me, { token: bobToken });
    check(
      "an admin ends one session of a member; that token gets 401, the other session stays, and the browser control of that session is given back",
      revokeBob.status === 204 &&
        revokedUse.status === 401 &&
        bobFirst.status === 200 &&
        releasedSession(bobSecondSession?.id),
      {
        revoke: revokeBob.status,
        revokedUse: revokedUse.status,
        bobFirst: bobFirst.status,
        released: releasedSession(bobSecondSession?.id),
      },
    );
  }

  // ---- Direct messages stay between the two members ----
  {
    const ownerId = store.getOwnerMemberId() ?? "";
    const privateText = "owner to ada: private plan";
    const sent = await call("POST", TEAM_API_ROUTES.direct.messages, {
      token: owner.sessionToken,
      json: { memberId: adaId, text: privateText, clientMessageId: "client-message-1" },
    });
    const adaView = await call("GET", TEAM_API_ROUTES.direct.conversation(ownerId), { token: adaToken });
    check(
      "a direct message reaches its recipient",
      sent.status === 201 &&
        adaView.status === 200 &&
        list(field(adaView.body, "messages")).some((message) => field(message, "text") === privateText),
      { sent: sent.status, adaView: adaView.status },
    );
    const bobThreads = await call("GET", TEAM_API_ROUTES.direct.threads, { token: bobToken });
    const bobWithOwner = await call("GET", TEAM_API_ROUTES.direct.conversation(ownerId), { token: bobToken });
    const bobWithAda = await call("GET", TEAM_API_ROUTES.direct.conversation(adaId), { token: bobToken });
    const bobPage = await call("GET", TEAM_API_ROUTES.direct.conversationPage(ownerId), { token: bobToken });
    check(
      "a third member does not see the direct message in threads, conversations or pages",
      [bobThreads, bobWithOwner, bobWithAda, bobPage].every(
        (reply) => reply.status === 200 && !reply.text.includes(privateText),
      ) && list(bobThreads.body).length === 0,
      [bobThreads, bobWithOwner, bobWithAda, bobPage].map((reply) => reply.status),
    );
    const loggedBefore = logged.length;
    const toSelf = await call("POST", TEAM_API_ROUTES.direct.messages, {
      token: bobToken,
      json: { memberId: bobId, text: "hello me", clientMessageId: "client-message-2" },
    });
    const toStranger = await call("POST", TEAM_API_ROUTES.direct.messages, {
      token: bobToken,
      json: { memberId: "not-a-member", text: "hello stranger", clientMessageId: "client-message-3" },
    });
    const withStranger = await call("GET", TEAM_API_ROUTES.direct.conversation("not-a-member"), { token: bobToken });
    const threadsAfter = await call("GET", TEAM_API_ROUTES.direct.threads, { token: bobToken });
    const unavailable = sourceText("error.team.directRecipientUnavailable");
    check(
      "a direct message to oneself gets 400; to someone not on the team, 404; nothing is stored",
      errorIs(toSelf, 400, sourceText("error.team.directMessageSelf")) &&
        errorIs(toStranger, 404, unavailable) &&
        errorIs(withStranger, 404, unavailable) &&
        threadsAfter.status === 200 &&
        list(threadsAfter.body).length === 0,
      {
        toSelf: summary(toSelf),
        toStranger: summary(toStranger),
        withStranger: summary(withStranger),
        threadsAfter: summary(threadsAfter),
      },
    );
    check(
      "the refused direct messages are client errors and write no error log line",
      logged.slice(loggedBefore).every((line) => !line.includes("Team API request failed")),
      { lines: logged.slice(loggedBefore) },
    );
  }

  // ---- Agents hidden from an older protocol ----
  {
    const notFound = sourceText("error.team.agentNotFound");
    const ids = (reply: Reply) => list(reply.body).map((item) => field(item, "id"));
    const v3 = await call("GET", TEAM_API_ROUTES.agents.all, { token: bobToken, protocol: 3 });
    const v6 = await call("GET", TEAM_API_ROUTES.agents.all, { token: bobToken, protocol: 6 });
    const v7 = await call("GET", TEAM_API_ROUTES.agents.all, { token: bobToken });
    const v8 = await call("GET", TEAM_API_ROUTES.agents.all, { token: bobToken, protocol: 8 });
    check(
      "the agent list leaves out the agents whose provider the client protocol does not know",
      isDeepStrictEqual(ids(v3), ["agent-ada"]) &&
        isDeepStrictEqual(ids(v6), ["agent-ada", "agent-oc"]) &&
        isDeepStrictEqual(ids(v7), ["agent-ada", "agent-oc", "agent-pi"]) &&
        isDeepStrictEqual(ids(v8), ["agent-ada", "agent-oc", "agent-pi"]),
      { v3: ids(v3), v6: ids(v6), v7: ids(v7), v8: ids(v8) },
    );
    // Each frozen list is the released vocabulary of its protocol. Protocol 8 and later hide none.
    const hiddenBy = (protocol: number) =>
      AGENT_PROVIDERS.filter((provider) => isPeerHiddenProvider(provider, protocol));
    const expectedHidden: Record<number, readonly string[]> = {
      1: ["opencode", "antigravity", "acp", "cursor", "cline", "pi", "muse", "inception", "deepseek", "openrouter"],
      3: ["opencode", "antigravity", "acp", "cursor", "cline", "pi", "muse", "inception", "deepseek", "openrouter"],
      4: ["antigravity", "acp", "cursor", "cline", "pi", "muse", "inception", "deepseek", "openrouter"],
      5: ["cursor", "cline", "pi", "muse", "inception", "deepseek", "openrouter"],
      6: ["pi", "muse", "inception", "deepseek", "openrouter"],
      7: ["inception", "deepseek", "openrouter"],
      8: [],
      9: [],
    };
    const hiddenRows = Object.entries(expectedHidden).map(([protocol, expected]) => ({
      protocol: Number(protocol),
      hidden: hiddenBy(Number(protocol)),
      expected: AGENT_PROVIDERS.filter((provider) => expected.includes(provider)),
    }));
    check(
      "the frozen provider lists hide each provider that a protocol below 8 does not know, and protocol 8 hides none",
      hiddenRows.every((row) => isDeepStrictEqual(row.hidden, row.expected)),
      hiddenRows,
    );
    const listQueueCalls = callsOf("listQueue").length;
    const pathV3 = await call("GET", TEAM_API_ROUTES.agent.queue("agent-oc"), { token: bobToken, protocol: 3 });
    const pathV6 = await call("GET", TEAM_API_ROUTES.agent.queue("agent-pi"), { token: bobToken, protocol: 6 });
    const queryV6 = await call("GET", `${TEAM_API_ROUTES.workspaceFiles}?botId=agent-pi&path=notes.md`, {
      token: bobToken,
      protocol: 6,
    });
    check(
      "a hidden agent in the path or in the botId query gets 404 agentNotFound and reaches no service",
      [pathV3, pathV6, queryV6].every((reply) => errorIs(reply, 404, notFound)) &&
        callsOf("listQueue").length === listQueueCalls &&
        callsOf("resolveWorkspaceFile").length === 0,
      [summary(pathV3), summary(pathV6), summary(queryV6)],
    );
    const pathV7 = await call("GET", TEAM_API_ROUTES.agent.queue("agent-pi"), { token: bobToken });
    check("the same agent is reachable on protocol 7", pathV7.status === 200, summary(pathV7));

    const readHidden = await call("POST", AGENT_HIDDEN_ROUTES.read, { token: bobToken, json: {} });
    const readHiddenV6 = await call("POST", AGENT_HIDDEN_ROUTES.read, { token: bobToken, json: {}, protocol: 6 });
    check(
      "a member reads the hidden agents, without the agents that the client protocol does not know",
      readHidden.status === 200 &&
        isDeepStrictEqual(
          list(field(readHidden.body, "agents")).map((item) => field(item, "agentId")),
          ["agent-pi"],
        ) &&
        readHiddenV6.status === 200 &&
        list(field(readHiddenV6.body, "agents")).length === 0,
      [summary(readHidden), summary(readHiddenV6)],
    );
    const unsupported = await call("POST", AGENT_HIDDEN_ROUTES.read, { token: bobToken, json: {}, capabilities: [] });
    check(
      "the hidden-agent routes without the capability get 400 agentHideUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentHideUnsupported")),
      summary(unsupported),
    );
    const memberSet = await call("POST", AGENT_HIDDEN_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", hidden: true },
    });
    check(
      "a member cannot hide an agent",
      errorIs(memberSet, 403, sourceText("error.team.membersCannotHideAgents")) &&
        callsOf("setAgentHidden").length === 0,
      summary(memberSet),
    );
    const adminSetHidden = await call("POST", AGENT_HIDDEN_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-pi", hidden: false },
      protocol: 6,
    });
    check(
      "an admin cannot change an agent that the client protocol does not show",
      errorIs(adminSetHidden, 404, notFound) && callsOf("setAgentHidden").length === 0,
      summary(adminSetHidden),
    );
    const adminSet = await call("POST", AGENT_HIDDEN_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", hidden: true },
    });
    check(
      "an admin hides an agent and gets the new list",
      adminSet.status === 200 &&
        list(field(adminSet.body, "agents")).some((item) => field(item, "agentId") === "agent-ada") &&
        isDeepStrictEqual(callsOf("setAgentHidden").at(-1), [{ agentId: "agent-ada", hidden: true }]),
      summary(adminSet),
    );

    const memberDelete = await call("DELETE", TEAM_API_ROUTES.agent.one("agent-ada"), { token: bobToken });
    check(
      "a member cannot delete an agent",
      errorIs(memberDelete, 403, sourceText("error.team.membersCannotDeleteAgents")) &&
        callsOf("deleteAgent").length === 0,
      summary(memberDelete),
    );
  }

  // ---- Backup models (agent-backup-models-v1) ----
  {
    const backupCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, AGENT_BACKUP_MODELS_CAPABILITY];
    const backupModels = {
      automatic: true,
      order: [
        { provider: "codex", model: "gpt-5.5" },
        { provider: "claude", model: "claude-opus-4-5", providerAccountId: "a0123456789abcdef" },
      ],
    };
    const adminRead = await call("POST", AGENT_BACKUP_MODELS_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: backupCapabilities,
    });
    check(
      "an admin reads null backup models for an agent with none",
      adminRead.status === 200 && isDeepStrictEqual(adminRead.body, { backupModels: null, usageLimitReturn: null }),
      summary(adminRead),
    );
    const unsupported = await call("POST", AGENT_BACKUP_MODELS_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
    });
    check(
      "the backup-model routes without the capability get 400 agentSettingsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentSettingsUnsupported")),
      summary(unsupported),
    );
    const memberRead = await call("POST", AGENT_BACKUP_MODELS_ROUTES.settings, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities: backupCapabilities,
    });
    const memberSet = await call("POST", AGENT_BACKUP_MODELS_ROUTES.update, {
      token: bobToken,
      json: { agentId: "agent-ada", backupModels },
      capabilities: backupCapabilities,
    });
    check(
      "a member cannot read or set backup models",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        callsOf("updateAgent").length === 0,
      [summary(memberRead), summary(memberSet)],
    );
    const unknownProvider = await call("POST", AGENT_BACKUP_MODELS_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", backupModels: { automatic: false, order: [{ provider: "later", model: "m-1" }] } },
      capabilities: backupCapabilities,
    });
    const tooMany = await call("POST", AGENT_BACKUP_MODELS_ROUTES.update, {
      token: adaToken,
      json: {
        agentId: "agent-ada",
        backupModels: { automatic: false, order: Array.from({ length: 9 }, () => backupModels.order[0]) },
      },
      capabilities: backupCapabilities,
    });
    check(
      "the host refuses a provider it does not know and more than eight models, and writes nothing",
      unknownProvider.status === 400 && tooMany.status === 400 && callsOf("updateAgent").length === 0,
      [summary(unknownProvider), summary(tooMany)],
    );
    const adminSet = await call("POST", AGENT_BACKUP_MODELS_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", backupModels },
      capabilities: backupCapabilities,
    });
    const readBack = await call("POST", AGENT_BACKUP_MODELS_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: backupCapabilities,
    });
    check(
      "an admin sets backup models through the agent writer and reads them back",
      adminSet.status === 200 &&
        isDeepStrictEqual(adminSet.body, { backupModels, usageLimitReturn: null }) &&
        isDeepStrictEqual(readBack.body, { backupModels, usageLimitReturn: null }) &&
        isDeepStrictEqual(callsOf("updateAgent").at(-1), [{ agentId: "agent-ada", backupModels }]),
      [summary(adminSet), summary(readBack)],
    );
    const ada = agents.find((item) => item.id === "agent-ada");
    const usageLimitReturn = {
      provider: "claude" as const,
      model: "claude-opus-4-5",
      reasoningEffort: "medium" as const,
    };
    if (ada) ada.usageLimitReturn = usageLimitReturn;
    const atLimit = await call("POST", AGENT_BACKUP_MODELS_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: backupCapabilities,
    });
    if (ada) delete ada.usageLimitReturn;
    check(
      "an admin reads the model that the agent left for a usage limit",
      atLimit.status === 200 && isDeepStrictEqual(field(atLimit.body, "usageLimitReturn"), usageLimitReturn),
      summary(atLimit),
    );
    const adminClear = await call("POST", AGENT_BACKUP_MODELS_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", backupModels: null },
      capabilities: backupCapabilities,
    });
    const missing = await call("POST", AGENT_BACKUP_MODELS_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-none" },
      capabilities: backupCapabilities,
    });
    check(
      "an admin clears backup models, and an unknown agent gets 404",
      adminClear.status === 200 &&
        isDeepStrictEqual(adminClear.body, { backupModels: null, usageLimitReturn: null }) &&
        errorIs(missing, 404, sourceText("error.team.agentNotFound")),
      [summary(adminClear), summary(missing)],
    );
  }

  // ---- Task limit (agent-task-limit-v1) ----
  {
    const limitCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, AGENT_TASK_LIMIT_CAPABILITY];
    const writes = callsOf("updateAgent").length;
    const adminRead = await call("POST", AGENT_TASK_LIMIT_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: limitCapabilities,
    });
    check(
      "an admin reads a null task limit for an agent on the default",
      adminRead.status === 200 && isDeepStrictEqual(adminRead.body, { taskLimit: null }),
      summary(adminRead),
    );
    const unsupported = await call("POST", AGENT_TASK_LIMIT_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
    });
    check(
      "the task-limit routes without the capability get 400 agentSettingsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentSettingsUnsupported")),
      summary(unsupported),
    );
    const memberRead = await call("POST", AGENT_TASK_LIMIT_ROUTES.settings, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities: limitCapabilities,
    });
    const memberSet = await call("POST", AGENT_TASK_LIMIT_ROUTES.update, {
      token: bobToken,
      json: { agentId: "agent-ada", taskLimit: 3 },
      capabilities: limitCapabilities,
    });
    check(
      "a member cannot read or set the task limit",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        callsOf("updateAgent").length === writes,
      [summary(memberRead), summary(memberSet)],
    );
    const tooHigh = await call("POST", AGENT_TASK_LIMIT_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", taskLimit: 5 },
      capabilities: limitCapabilities,
    });
    const zero = await call("POST", AGENT_TASK_LIMIT_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", taskLimit: 0 },
      capabilities: limitCapabilities,
    });
    check(
      "the host refuses a task limit outside 1 to 4, and writes nothing",
      tooHigh.status === 400 && zero.status === 400 && callsOf("updateAgent").length === writes,
      [summary(tooHigh), summary(zero)],
    );
    const adminSet = await call("POST", AGENT_TASK_LIMIT_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", taskLimit: 3 },
      capabilities: limitCapabilities,
    });
    const readBack = await call("POST", AGENT_TASK_LIMIT_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: limitCapabilities,
    });
    check(
      "an admin sets the task limit through the agent writer and reads it back",
      adminSet.status === 200 &&
        isDeepStrictEqual(adminSet.body, { taskLimit: 3 }) &&
        isDeepStrictEqual(readBack.body, { taskLimit: 3 }) &&
        isDeepStrictEqual(callsOf("updateAgent").at(-1), [{ agentId: "agent-ada", taskLimit: 3 }]),
      [summary(adminSet), summary(readBack)],
    );
    const adminClear = await call("POST", AGENT_TASK_LIMIT_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", taskLimit: null },
      capabilities: limitCapabilities,
    });
    const missing = await call("POST", AGENT_TASK_LIMIT_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-none" },
      capabilities: limitCapabilities,
    });
    check(
      "an admin returns the agent to the default task limit, and an unknown agent gets 404",
      adminClear.status === 200 &&
        isDeepStrictEqual(adminClear.body, { taskLimit: null }) &&
        errorIs(missing, 404, sourceText("error.team.agentNotFound")),
      [summary(adminClear), summary(missing)],
    );
    const hiddenRead = await call("POST", AGENT_TASK_LIMIT_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-pi" },
      capabilities: limitCapabilities,
      protocol: 6,
    });
    const hiddenSet = await call("POST", AGENT_TASK_LIMIT_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-pi", taskLimit: 3 },
      capabilities: limitCapabilities,
      protocol: 6,
    });
    check(
      "an admin cannot read or set the task limit of an agent that the client protocol does not show",
      errorIs(hiddenRead, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hiddenSet, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("updateAgent").length === writes + 2,
      [summary(hiddenRead), summary(hiddenSet)],
    );
  }

  // ---- Memory review (memory-review-v1) ----
  {
    const capabilities = [MEMORY_REVIEW_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 7 });
    check(
      "the host advertises memory-review-v1",
      list(field(compatibility.body, "capabilities")).includes(MEMORY_REVIEW_CAPABILITY),
      summary(compatibility),
    );
    const adminRead = await call("POST", MEMORY_REVIEW_ROUTES.settings, { token: adaToken, json: {}, capabilities });
    check(
      "an admin reads the default memory review of 20 turns and the values the host permits",
      adminRead.status === 200 && isDeepStrictEqual(adminRead.body, { interval: 20, choices: [0, 10, 20, 40] }),
      summary(adminRead),
    );
    const unsupported = await call("POST", MEMORY_REVIEW_ROUTES.settings, { token: adaToken, json: {} });
    check(
      "the memory review routes without the capability get 400 memoryReviewUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.memoryReviewUnsupported")),
      summary(unsupported),
    );
    const memberRead = await call("POST", MEMORY_REVIEW_ROUTES.settings, { token: bobToken, json: {}, capabilities });
    const memberSet = await call("POST", MEMORY_REVIEW_ROUTES.update, {
      token: bobToken,
      json: { interval: 0 },
      capabilities,
    });
    const invalid = await call("POST", MEMORY_REVIEW_ROUTES.update, {
      token: adaToken,
      json: { interval: 15 },
      capabilities,
    });
    check(
      "a member cannot read or set the memory review, the host refuses a value it does not permit, and nothing is saved",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        invalid.status === 400 &&
        memoryReview.get().interval === 20 &&
        !existsSync(memoryReviewFile),
      [summary(memberRead), summary(memberSet), summary(invalid)],
    );
    const off = await call("POST", MEMORY_REVIEW_ROUTES.update, {
      token: adaToken,
      json: { interval: 0 },
      capabilities,
    });
    const reloaded = new MemoryReviewPreferenceStore(memoryReviewFile);
    await runCauseEffect(reloaded.load());
    check(
      "an admin turns the memory review off; the host saves it and a restart reads it",
      off.status === 200 &&
        isDeepStrictEqual(off.body, { interval: 0, choices: [0, 10, 20, 40] }) &&
        memoryReview.get().interval === 0 &&
        reloaded.get().interval === 0,
      summary(off),
    );
    const on = await call("POST", MEMORY_REVIEW_ROUTES.update, {
      token: adaToken,
      json: { interval: 40 },
      capabilities,
    });
    check(
      "an admin turns the memory review on again at 40 turns",
      on.status === 200 && field(on.body, "interval") === 40 && memoryReview.get().interval === 40,
      summary(on),
    );
  }

  // ---- Default provider (provider-default-v1) ----
  {
    const capabilities = [PROVIDER_DEFAULT_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 7 });
    check(
      "the host advertises provider-default-v1",
      list(field(compatibility.body, "capabilities")).includes(PROVIDER_DEFAULT_CAPABILITY),
      summary(compatibility),
    );
    const adminRead = await call("POST", PROVIDER_DEFAULT_ROUTES.settings, { token: adaToken, json: {}, capabilities });
    check(
      "an admin reads the default provider of the host",
      adminRead.status === 200 && isDeepStrictEqual(adminRead.body, { provider: "codex", model: null }),
      summary(adminRead),
    );
    const unsupported = await call("POST", PROVIDER_DEFAULT_ROUTES.settings, { token: adaToken, json: {} });
    check(
      "the default-provider routes without the capability get 400 providerDefaultUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.providerDefaultUnsupported")),
      summary(unsupported),
    );
    const writes = callsOf("setDefaultProvider").length;
    const memberRead = await call("POST", PROVIDER_DEFAULT_ROUTES.settings, {
      token: bobToken,
      json: {},
      capabilities,
    });
    const memberSet = await call("POST", PROVIDER_DEFAULT_ROUTES.update, {
      token: bobToken,
      json: { provider: "claude", model: null },
      capabilities,
    });
    check(
      "a member cannot read or set the default provider",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        callsOf("setDefaultProvider").length === writes,
      [summary(memberRead), summary(memberSet)],
    );
    const unknownProvider = await call("POST", PROVIDER_DEFAULT_ROUTES.update, {
      token: adaToken,
      json: { provider: "not-a-provider", model: null },
      capabilities,
    });
    const badModel = await call("POST", PROVIDER_DEFAULT_ROUTES.update, {
      token: adaToken,
      json: { provider: "claude", model: "bad model" },
      capabilities,
    });
    check(
      "the host refuses an unknown provider or an invalid model, and writes nothing",
      unknownProvider.status === 400 && badModel.status === 400 && callsOf("setDefaultProvider").length === writes,
      [summary(unknownProvider), summary(badModel)],
    );
    const hiddenSet = await call("POST", PROVIDER_DEFAULT_ROUTES.update, {
      token: adaToken,
      json: { provider: "deepseek", model: null },
      capabilities,
    });
    check(
      "a protocol 7 admin cannot set DeepSeek, which that protocol does not show",
      hiddenSet.status === 400 && callsOf("setDefaultProvider").length === writes,
      summary(hiddenSet),
    );
    const adminSet = await call("POST", PROVIDER_DEFAULT_ROUTES.update, {
      token: adaToken,
      json: { provider: "deepseek", model: null },
      capabilities,
      protocol: 8,
    });
    const readBack = await call("POST", PROVIDER_DEFAULT_ROUTES.settings, {
      token: adaToken,
      json: {},
      capabilities,
      protocol: 8,
    });
    const oldRead = await call("POST", PROVIDER_DEFAULT_ROUTES.settings, { token: adaToken, json: {}, capabilities });
    check(
      "a protocol 8 admin sets DeepSeek as the default and reads it back; protocol 7 reads no default",
      adminSet.status === 200 &&
        isDeepStrictEqual(adminSet.body, { provider: "deepseek", model: null }) &&
        isDeepStrictEqual(readBack.body, { provider: "deepseek", model: null }) &&
        isDeepStrictEqual(oldRead.body, { provider: null, model: null }) &&
        isDeepStrictEqual(callsOf("setDefaultProvider").at(-1), [
          { preferredProvider: "deepseek", preferredModel: null },
        ]),
      [summary(adminSet), summary(readBack), summary(oldRead)],
    );
  }

  // ---- Browser profiles (browser-profiles-v1) ----
  {
    const profileCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, BROWSER_PROFILES_CAPABILITY];
    const admin = (path: string, json: Json = {}, protocol?: number) =>
      call("POST", path, {
        token: adaToken,
        json,
        capabilities: profileCapabilities,
        ...(protocol === undefined ? {} : { protocol }),
      });
    const unsupported = await call("POST", BROWSER_PROFILES_ROUTES.list, { token: adaToken, json: {} });
    const unsupportedTabs = await call("POST", BROWSER_PROFILES_ROUTES.tabs, { token: bobToken, json: {} });
    check(
      "the browser-profiles routes without the capability get 400 agentSettingsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentSettingsUnsupported")) &&
        errorIs(unsupportedTabs, 400, sourceText("error.team.agentSettingsUnsupported")),
      [summary(unsupported), summary(unsupportedTabs)],
    );
    const memberList = await call("POST", BROWSER_PROFILES_ROUTES.list, {
      token: bobToken,
      json: {},
      capabilities: profileCapabilities,
    });
    const memberCreate = await call("POST", BROWSER_PROFILES_ROUTES.create, {
      token: bobToken,
      json: { name: "Member profile" },
      capabilities: profileCapabilities,
    });
    const memberAssign = await call("POST", BROWSER_PROFILES_ROUTES.updateAgent, {
      token: bobToken,
      json: { agentId: "agent-ada", profile: { kind: "agent" } },
      capabilities: profileCapabilities,
    });
    check(
      "a member cannot list, create or assign browser profiles",
      errorIs(memberList, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberCreate, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberAssign, 403, sourceText("error.team.adminRequired")) &&
        callsOf("updateAgentBrowserProfile").length === 0,
      [summary(memberList), summary(memberCreate), summary(memberAssign)],
    );
    const empty = await admin(BROWSER_PROFILES_ROUTES.list);
    check(
      "an admin lists no profile, and every agent in the shared profile",
      empty.status === 200 &&
        isDeepStrictEqual(empty.body, { profiles: [], sharedAgentIds: ["agent-ada", "agent-oc", "agent-pi"] }),
      summary(empty),
    );
    const created = await admin(BROWSER_PROFILES_ROUTES.create, { name: "Client A" });
    const profileId = field(created.body, "id");
    const taken = await admin(BROWSER_PROFILES_ROUTES.create, { name: "client a" });
    const longName = await admin(BROWSER_PROFILES_ROUTES.create, { name: "x".repeat(61) });
    check(
      "an admin creates a profile; a used name gets 409 and a long name 400",
      created.status === 200 &&
        typeof profileId === "string" &&
        /^[0-9a-f]{32}$/.test(profileId) &&
        field(created.body, "name") === "Client A" &&
        isDeepStrictEqual(field(created.body, "agentIds"), []) &&
        errorIs(taken, 409, sourceText("error.backend.browserProfileNameTaken")) &&
        longName.status === 400,
      [summary(created), summary(taken), summary(longName)],
    );
    assert.ok(typeof profileId === "string", "The browser profile was not created.");
    const assigned = await admin(BROWSER_PROFILES_ROUTES.updateAgent, {
      agentId: "agent-ada",
      profile: { kind: "profile", profileId },
    });
    const readBack = await admin(BROWSER_PROFILES_ROUTES.agent, { agentId: "agent-ada" });
    const listed = await admin(BROWSER_PROFILES_ROUTES.list);
    check(
      "an admin moves an agent into the profile, and the list shows it there",
      assigned.status === 200 &&
        isDeepStrictEqual(assigned.body, { kind: "profile", profileId }) &&
        isDeepStrictEqual(readBack.body, { kind: "profile", profileId }) &&
        isDeepStrictEqual(field(listed.body, "profiles", 0, "agentIds"), ["agent-ada"]) &&
        isDeepStrictEqual(field(listed.body, "sharedAgentIds"), ["agent-oc", "agent-pi"]),
      [summary(assigned), summary(readBack), summary(listed)],
    );
    const unknownProfile = await admin(BROWSER_PROFILES_ROUTES.updateAgent, {
      agentId: "agent-oc",
      profile: { kind: "profile", profileId: "0".repeat(32) },
    });
    const unknownAgent = await admin(BROWSER_PROFILES_ROUTES.agent, { agentId: "agent-none" });
    const hiddenRead = await admin(BROWSER_PROFILES_ROUTES.agent, { agentId: "agent-pi" }, 6);
    const hiddenAssign = await admin(
      BROWSER_PROFILES_ROUTES.updateAgent,
      { agentId: "agent-pi", profile: { kind: "agent" } },
      6,
    );
    const olderList = await admin(BROWSER_PROFILES_ROUTES.list, {}, 6);
    check(
      "an unknown profile gets 409; an unknown agent, or one that the client protocol does not show, gets 404",
      errorIs(unknownProfile, 409, sourceText("error.backend.browserProfileNotFound")) &&
        errorIs(unknownAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hiddenRead, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hiddenAssign, 404, sourceText("error.team.agentNotFound")) &&
        isDeepStrictEqual(field(olderList.body, "sharedAgentIds"), ["agent-oc"]) &&
        callsOf("updateAgentBrowserProfile").length === 1,
      [summary(unknownProfile), summary(unknownAgent), summary(hiddenRead), summary(hiddenAssign), summary(olderList)],
    );
    profileTabs.push(
      { tabId: "tab-open", tabSession: { kind: "profile", profileId } },
      { tabId: "tab-private", tabSession: { kind: "profile", profileId } },
    );
    const hue = field(created.body, "hue");
    const memberTabs = await call("POST", BROWSER_PROFILES_ROUTES.tabs, {
      token: bobToken,
      json: {},
      capabilities: profileCapabilities,
    });
    const adminTabs = await admin(BROWSER_PROFILES_ROUTES.tabs);
    check(
      "a member reads the profile label of the tabs they can see, and nothing of a private tab",
      memberTabs.status === 200 &&
        isDeepStrictEqual(memberTabs.body, { tabs: [{ tabId: "tab-open", name: "Client A", hue }] }) &&
        isDeepStrictEqual(
          list(field(adminTabs.body, "tabs")).map((tab) => field(tab, "tabId")),
          ["tab-open", "tab-private"],
        ),
      [summary(memberTabs), summary(adminTabs)],
    );
    const renamed = await admin(BROWSER_PROFILES_ROUTES.update, { profileId, name: "Client B", hue: 150 });
    const badHue = await admin(BROWSER_PROFILES_ROUTES.update, { profileId, hue: 7 });
    check(
      "an admin renames and recolors a profile; a color outside the list gets 400",
      renamed.status === 200 &&
        field(renamed.body, "name") === "Client B" &&
        field(renamed.body, "hue") === 150 &&
        field(renamed.body, "tabCount") === 2 &&
        badHue.status === 400,
      [summary(renamed), summary(badHue)],
    );
    const bothTargets = await admin(BROWSER_PROFILES_ROUTES.clear, { profileId, agentId: "agent-ada" });
    const cleared = await admin(BROWSER_PROFILES_ROUTES.clear, { profileId });
    check(
      "a clear closes the tabs of the profile and clears its session; a clear of two targets gets 400",
      bothTargets.status === 400 &&
        cleared.status === 200 &&
        isDeepStrictEqual(cleared.body, {}) &&
        profileTabs.length === 0 &&
        isDeepStrictEqual(callsOf("clearTabSession").at(-1), [{ kind: "profile", profileId }]),
      [summary(bothTargets), summary(cleared)],
    );
    const deleted = await admin(BROWSER_PROFILES_ROUTES.delete, { profileId });
    const afterDelete = await admin(BROWSER_PROFILES_ROUTES.list);
    const adaAfter = await admin(BROWSER_PROFILES_ROUTES.agent, { agentId: "agent-ada" });
    check(
      "a delete moves the agents of the profile to the shared profile",
      deleted.status === 200 &&
        isDeepStrictEqual(afterDelete.body, {
          profiles: [],
          sharedAgentIds: ["agent-ada", "agent-oc", "agent-pi"],
        }) &&
        isDeepStrictEqual(adaAfter.body, { kind: "shared" }),
      [summary(deleted), summary(afterDelete), summary(adaAfter)],
    );
    check(
      "the host logs no profile name",
      !logged.some((line) => line.includes("Client A") || line.includes("Client B")),
      null,
    );
  }

  // ---- Disk space (storage-disk-v1) ----
  {
    const unsupported = await call("POST", STORAGE_DISK_ROUTES.disk, { token: bobToken, json: {} });
    check(
      "the disk route without the capability gets 400 storageUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.storageUnsupported")) && callsOf("disk").length === 0,
      summary(unsupported),
    );
    const diskCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, STORAGE_DISK_CAPABILITY];
    // Every signed-in member reads the disk, as the frozen contract says; the client shows the card to admins.
    const member = await call("POST", STORAGE_DISK_ROUTES.disk, {
      token: bobToken,
      json: {},
      capabilities: diskCapabilities,
    });
    const owner = await call("POST", STORAGE_DISK_ROUTES.disk, {
      token: adaToken,
      json: {},
      capabilities: diskCapabilities,
    });
    const expected = { freeBytes: 2 * 1024 ** 3, totalBytes: 64 * 1024 ** 3 };
    check(
      "a member and the owner read the free and total bytes of the host disk",
      member.status === 200 &&
        owner.status === 200 &&
        isDeepStrictEqual(member.body, expected) &&
        isDeepStrictEqual(owner.body, expected) &&
        callsOf("disk").length === 2,
      [summary(member), summary(owner)],
    );
    const withBody = await call("POST", STORAGE_DISK_ROUTES.disk, {
      token: bobToken,
      json: { path: "/" },
      capabilities: diskCapabilities,
    });
    check(
      "the disk route ignores a path in the body and reads the disk of the OpenBot data",
      withBody.status === 200 && isDeepStrictEqual(withBody.body, expected) && callsOf("disk").length === 3,
      summary(withBody),
    );
  }

  // ---- Machine use and alerts (machine-resources-v1) ----
  {
    const unsupported = await call("POST", MACHINE_RESOURCES_ROUTES.metrics, { token: adaToken, json: {} });
    check(
      "the machine routes without the capability get 400 machineResourcesUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.machineResourcesUnsupported")) &&
        callsOf("machineMetrics").length === 0,
      summary(unsupported),
    );
    const capabilities = [MACHINE_RESOURCES_CAPABILITY];
    const member = await call("POST", MACHINE_RESOURCES_ROUTES.metrics, { token: bobToken, json: {}, capabilities });
    const memberAlerts = await call("POST", MACHINE_RESOURCES_ROUTES.alerts, {
      token: bobToken,
      json: {},
      capabilities,
    });
    check(
      "a member cannot read the machine use or its alerts",
      member.status === 403 && memberAlerts.status === 403 && callsOf("machineMetrics").length === 0,
      [summary(member), summary(memberAlerts)],
    );
    const metrics = await call("POST", MACHINE_RESOURCES_ROUTES.metrics, { token: adaToken, json: {}, capabilities });
    check(
      "an admin reads the disk, memory and CPU of the host machine",
      metrics.status === 200 &&
        isDeepStrictEqual(metrics.body, machineMetrics) &&
        callsOf("machineMetrics").length === 1,
      summary(metrics),
    );
    const defaults = await call("POST", MACHINE_RESOURCES_ROUTES.alerts, { token: adaToken, json: {}, capabilities });
    check(
      "a new host has the default alert levels and no responsible member",
      defaults.status === 200 &&
        isDeepStrictEqual(defaults.body, {
          diskPercent: 90,
          memoryPercent: 90,
          cpuPercent: 95,
          responsibleMemberId: null,
        }),
      summary(defaults),
    );
    const toMember = await call("POST", MACHINE_RESOURCES_ROUTES.updateAlerts, {
      token: adaToken,
      json: { diskPercent: 80, memoryPercent: 90, cpuPercent: 95, responsibleMemberId: bobId },
      capabilities,
    });
    const tooLow = await call("POST", MACHINE_RESOURCES_ROUTES.updateAlerts, {
      token: adaToken,
      json: { diskPercent: 10, memoryPercent: 90, cpuPercent: 95, responsibleMemberId: null },
      capabilities,
    });
    check(
      "the host refuses a member who is not an admin and a level outside 50-99",
      errorIs(toMember, 400, sourceText("error.team.machineAlertMemberInvalid")) &&
        tooLow.status === 400 &&
        !existsSync(join(root, "machine-alerts.json")),
      [summary(toMember), summary(tooLow)],
    );
    const settings = { diskPercent: 80, memoryPercent: 85, cpuPercent: 97, responsibleMemberId: adaId };
    const saved = await call("POST", MACHINE_RESOURCES_ROUTES.updateAlerts, {
      token: adaToken,
      json: settings,
      capabilities,
    });
    const reread = await call("POST", MACHINE_RESOURCES_ROUTES.alerts, { token: adaToken, json: {}, capabilities });
    const file = parseJson(readFileSync(join(root, "machine-alerts.json"), "utf8"));
    check(
      "an admin saves the levels and names an admin, and the host keeps them in its file",
      saved.status === 200 &&
        isDeepStrictEqual(saved.body, settings) &&
        isDeepStrictEqual(reread.body, settings) &&
        isDeepStrictEqual(file, { version: 1, ...settings }),
      [summary(saved), summary(reread), file],
    );

    // The disk (95%) and memory (87%) are above the saved levels, so the first reading alerts ada.
    const firstAlert = new Promise<{ memberId: string | null; event: MachineAlertEvent }>((resolveAlert) => {
      const stop = machine.subscribe((memberId, event) => {
        stop();
        resolveAlert({ memberId, event });
      });
    });
    machine.start();
    const first = await firstAlert;
    // A device of ada that connects now gets the alert that is still in force.
    const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
      TEAM_PROTOCOL_V1_WEBSOCKET,
      `openbot-token.${adaToken}`,
    ]);
    await new Promise<void>((resolveOpen, reject) => {
      socket.addEventListener("open", () => resolveOpen(), { once: true });
      socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
    });
    const received = new Promise<MachineAlertEvent>((resolveEvent, reject) => {
      socket.addEventListener("message", (message) => {
        const event = machineAlertEvent(JSON.parse(String(message.data)));
        if (event?.alertId === first.event.alertId) resolveEvent(event);
      });
      socket.addEventListener("close", () => reject(new Error("The event socket closed.")), { once: true });
    });
    socket.send(
      JSON.stringify({ type: "agent-event-scope", includeConversations: false, capabilities: [capabilities[0]] }),
    );
    const delivered = await received;
    socket.close();
    machine.close();
    check(
      "the alert goes to the responsible admin, and a device that connects later gets it",
      first.memberId === adaId &&
        first.event.metric === "disk" &&
        first.event.percent === 95 &&
        first.event.level === 80 &&
        isDeepStrictEqual(delivered, first.event) &&
        typeof bobId === "string" &&
        machine.pending(bobId).length === 0,
      [first, delivered],
    );
  }

  // ---- Keys of the key-only providers (providers-v8) ----
  {
    const v8 = { token: adaToken, protocol: 8, capabilities: [PROVIDERS_V8_CAPABILITY] };
    const key = ["sk", "e2e", "deepseek", "fake0000"].join("-");
    const before = await call("POST", PROVIDERS_V8_ROUTES.apiKeyState, { ...v8, json: { provider: "deepseek" } });
    const set = await call("POST", PROVIDERS_V8_ROUTES.apiKeySet, { ...v8, json: { provider: "deepseek", key } });
    const after = await call("POST", PROVIDERS_V8_ROUTES.apiKeyState, { ...v8, json: { provider: "deepseek" } });
    check(
      "an admin on providers-v8 saves a DeepSeek key on the host, and the host starts the Pi CLI for it",
      before.status === 200 &&
        field(before.body, "status") === "missing" &&
        set.status === 200 &&
        isDeepStrictEqual(callsOf("setProviderKey"), [["deepseek", key]]) &&
        isDeepStrictEqual(callsOf("startKeyProviderCli"), [["deepseek"]]) &&
        isDeepStrictEqual(callsOf("changeProviderCredential"), [["deepseek"]]) &&
        after.status === 200 &&
        field(after.body, "status") === "saved",
      [summary(before), summary(set), summary(after)],
    );
    const cleared = await call("POST", PROVIDERS_V8_ROUTES.apiKeyClear, { ...v8, json: { provider: "deepseek" } });
    const afterClear = await call("POST", PROVIDERS_V8_ROUTES.apiKeyState, { ...v8, json: { provider: "deepseek" } });
    check(
      "an admin on providers-v8 clears the DeepSeek key",
      cleared.status === 200 &&
        isDeepStrictEqual(callsOf("clearProviderKey"), [["deepseek"]]) &&
        field(afterClear.body, "status") === "missing",
      [summary(cleared), summary(afterClear)],
    );
    const v5 = await call("POST", PROVIDERS_V5_ROUTES.apiKeySet, {
      token: adaToken,
      capabilities: [PROVIDERS_V5_CAPABILITY],
      json: { provider: "openrouter", key },
    });
    const member = await call("POST", PROVIDERS_V8_ROUTES.apiKeySet, {
      ...v8,
      token: bobToken,
      json: { provider: "openrouter", key },
    });
    check(
      "providers-v5 refuses a key-only provider's key, a member gets 403, and neither saves a key",
      v5.status === 400 && member.status === 403 && callsOf("setProviderKey").length === 1,
      [summary(v5), summary(member)],
    );
    // No Pi process runs while Pi downloads, so a restart of the provider would fail on the missing CLI.
    const pending = await call("POST", PROVIDERS_V8_ROUTES.apiKeySet, { ...v8, json: { provider: "inception", key } });
    check(
      "while the host downloads Pi, a key-only provider's key is saved without a provider restart",
      pending.status === 200 &&
        isDeepStrictEqual(callsOf("setProviderKey").at(-1), ["inception", key]) &&
        isDeepStrictEqual(callsOf("changeProviderCredential"), [["deepseek"]]),
      summary(pending),
    );
  }

  // ---- Usage reset credits (provider-usage-reset-v1) ----
  {
    const resetCapabilities = [PROVIDER_USAGE_RESET_CAPABILITY];
    const unsupported = await call("POST", PROVIDER_USAGE_RESET_ROUTES.list, {
      token: adaToken,
      json: { provider: "codex" },
    });
    check(
      "the usage reset routes without the capability get 400 providersUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.providersUnsupported")),
      summary(unsupported),
    );
    const memberList = await call("POST", PROVIDER_USAGE_RESET_ROUTES.list, {
      token: bobToken,
      json: { provider: "codex" },
      capabilities: resetCapabilities,
    });
    const memberReset = await call("POST", PROVIDER_USAGE_RESET_ROUTES.consume, {
      token: bobToken,
      json: { provider: "codex", accountId: "default" },
      capabilities: resetCapabilities,
    });
    check(
      "a member cannot read or spend usage reset credits",
      errorIs(memberList, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberReset, 403, sourceText("error.team.adminRequired")) &&
        callsOf("resetProviderUsage").length === 0,
      [summary(memberList), summary(memberReset)],
    );
    const adminList = await call("POST", PROVIDER_USAGE_RESET_ROUTES.list, {
      token: adaToken,
      json: { provider: "codex" },
      capabilities: resetCapabilities,
    });
    check(
      "an admin reads the usage reset credits of the host's accounts",
      adminList.status === 200 &&
        isDeepStrictEqual(adminList.body, { accounts: [{ provider: "codex", accountId: "default", available: 2 }] }),
      summary(adminList),
    );
    const badAccount = await call("POST", PROVIDER_USAGE_RESET_ROUTES.consume, {
      token: adaToken,
      json: { provider: "codex", accountId: "../default" },
      capabilities: resetCapabilities,
    });
    const adminReset = await call("POST", PROVIDER_USAGE_RESET_ROUTES.consume, {
      token: adaToken,
      json: { provider: "codex", accountId: "default" },
      capabilities: resetCapabilities,
    });
    check(
      "an admin spends one credit, and an invalid account gets 400",
      badAccount.status === 400 &&
        adminReset.status === 200 &&
        isDeepStrictEqual(adminReset.body, { outcome: "reset" }) &&
        isDeepStrictEqual(callsOf("resetProviderUsage"), [[{ provider: "codex", accountId: "default" }]]),
      [summary(badAccount), summary(adminReset)],
    );
  }

  // ---- Bitwarden on the host (bitwarden-connector-v1) ----
  {
    const bitwardenCapabilities = [BITWARDEN_CONNECTOR_CAPABILITY];
    const input = {
      serverUrl: "https://vault.example.com/",
      clientId: BW_CLIENT_ID,
      clientSecret: BW_CLIENT_SECRET,
      masterPassword: BW_MASTER_PASSWORD,
    };
    const connectAs = (token: string, json: unknown) =>
      call("POST", BITWARDEN_CONNECTOR_ROUTES.connect, { token, json, capabilities: bitwardenCapabilities });
    const unsupported = await call("POST", BITWARDEN_CONNECTOR_ROUTES.status, { token: adaToken, json: {} });
    check(
      "the Bitwarden routes without the capability get 400 connectorsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.connectorsUnsupported")),
      summary(unsupported),
    );
    const memberConnect = await connectAs(bobToken, input);
    const memberDisconnect = await call("POST", BITWARDEN_CONNECTOR_ROUTES.disconnect, {
      token: bobToken,
      json: {},
      capabilities: bitwardenCapabilities,
    });
    check(
      "a member cannot connect or disconnect the host's Bitwarden",
      errorIs(memberConnect, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberDisconnect, 403, sourceText("error.team.adminRequired")) &&
        bitwardenCalls.length === 0,
      [summary(memberConnect), summary(memberDisconnect)],
    );
    const plainHttp = await connectAs(adaToken, { ...input, serverUrl: "http://vault.example.com" });
    check(
      "a server address that is not https is refused before bw runs",
      plainHttp.status === 200 &&
        isDeepStrictEqual(plainHttp.body, {
          state: "disconnected",
          serverUrl: null,
          error: sourceText("error.connector.bitwardenHostInput"),
        }) &&
        bitwardenCalls.length === 0,
      summary(plainHttp),
    );
    const wrongSettled = bitwardenSettled(bitwardenConnector);
    const wrong = await connectAs(adaToken, { ...input, masterPassword: "wrong-master-password" });
    const wrongStatus = await wrongSettled;
    check(
      "a wrong master password leaves no connection, no stored file and no signed-in CLI data",
      field(wrong.body, "state") === "connecting" &&
        !wrongStatus.connected &&
        wrongStatus.error === sourceText("error.connector.bitwardenHostFailed") &&
        bitwardenCalls.some((entry) => entry.args[0] === "login") &&
        !existsSync(bitwardenFile) &&
        !existsSync(bitwardenData),
      { wrong: summary(wrong), wrongStatus },
    );
    bitwardenCalls.length = 0;
    const settled = bitwardenSettled(bitwardenConnector);
    const connect = await connectAs(adaToken, input);
    const connected = await settled;
    const status = await call("POST", BITWARDEN_CONNECTOR_ROUTES.status, {
      token: adaToken,
      json: {},
      capabilities: bitwardenCapabilities,
    });
    check(
      "an admin connects: the host answers connecting at once, then reports connected",
      isDeepStrictEqual(connect.body, { state: "connecting", serverUrl: "https://vault.example.com", error: null }) &&
        connected.connected &&
        isDeepStrictEqual(status.body, { state: "connected", serverUrl: "https://vault.example.com", error: null }),
      { connect: summary(connect), connected, status: summary(status) },
    );
    const commands = bitwardenCalls.map((entry) => entry.args.join(" "));
    const envOf = (prefix: string) => bitwardenCalls.find((entry) => entry.args.join(" ").startsWith(prefix))?.env;
    check(
      "the host signs in with the API key and unlocks with the master password, only through the environment",
      commands.includes("config server https://vault.example.com") &&
        commands.includes("login --apikey") &&
        commands.includes("unlock --passwordenv BW_PASSWORD --raw") &&
        envOf("login")?.BW_CLIENTSECRET === BW_CLIENT_SECRET &&
        envOf("unlock")?.BW_PASSWORD === BW_MASTER_PASSWORD &&
        bitwardenCalls.every(
          (entry) =>
            !entry.args.some((arg) => BW_SECRETS.includes(arg)) &&
            (entry.args[0] === "unlock" || entry.env.BW_PASSWORD === undefined) &&
            (entry.args[0] === "login" || entry.env.BW_CLIENTSECRET === undefined),
        ),
      commands,
    );
    const stored = existsSync(bitwardenFile) ? readFileSync(bitwardenFile, "utf8") : "";
    const replies = [plainHttp, wrong, connect, status].map((reply) => reply.text).join("\n");
    check(
      "the stored file, the answers and the logs carry no secret in plain text",
      stored !== "" && ![stored, replies, ...logged].some((text) => BW_SECRETS.some((secret) => text.includes(secret))),
      { storedBytes: stored.length },
    );
    const restarted = createBitwardenHost();
    await runCauseEffect(restarted.load());
    const before = bitwardenCalls.length;
    const logins = await runCauseEffect(restarted.loginsFor("https://example.com"));
    const password = await runCauseEffect(restarted.secretFor(BW_ITEM_ID, "https://example.com", "password"));
    const afterRestart = bitwardenCalls.slice(before).map((entry) => entry.args.join(" "));
    check(
      "after a restart the host unlocks again from the stored connection, with no new sign-in",
      restarted.connected() &&
        logins?.[0]?.username === "ada" &&
        password === BW_LOGIN_PASSWORD &&
        afterRestart.includes("unlock --passwordenv BW_PASSWORD --raw") &&
        !afterRestart.some((command) => command.startsWith("login") || command.startsWith("config")),
      { afterRestart, logins },
    );
    await runCauseEffect(restarted.dispose());
    // A disconnect while an agent's vault call unlocks from the stored record: the stopped unlock
    // must not put an error back into the status that the disconnect cleared.
    const racing = createBitwardenHost();
    await runCauseEffect(racing.load());
    let release = () => {};
    const unlockStarted = new Promise<void>((started) => {
      bitwardenUnlockGate = { started, released: new Promise<void>((done) => (release = done)) };
    });
    const pendingLogins = runCauseEffect(racing.loginsFor("https://example.com")).then(
      (value) => ({ value }),
      () => ({ value: "failed" as const }),
    );
    await unlockStarted;
    const pendingDisconnect = runCauseEffect(racing.disconnect());
    bitwardenUnlockGate = null;
    release();
    const [raced] = await Promise.all([pendingLogins, pendingDisconnect]);
    check(
      "a disconnect during an unlock from the stored connection leaves no error and no access",
      racing.status().error === null && !racing.connected() && (raced.value === "failed" || raced.value === null),
      { status: racing.status(), raced },
    );
    await runCauseEffect(racing.dispose());
    const disconnect = await call("POST", BITWARDEN_CONNECTOR_ROUTES.disconnect, {
      token: adaToken,
      json: {},
      capabilities: bitwardenCapabilities,
    });
    check(
      "disconnect removes the stored connection and the host's CLI data",
      isDeepStrictEqual(disconnect.body, { state: "disconnected", serverUrl: null, error: null }) &&
        !existsSync(bitwardenFile) &&
        !existsSync(bitwardenData) &&
        !bitwardenConnector.connected(),
      summary(disconnect),
    );
  }

  // ---- The host's Vault (vault-v1) ----
  {
    const vaultCapabilities = [VAULT_CAPABILITY];
    const vaultCall = (token: string, path: string, json: unknown = {}) =>
      call("POST", path, { token, json, capabilities: vaultCapabilities });
    const login = {
      kind: "login",
      id: null,
      website: "https://shop.example.com",
      username: "ada@example.com",
      notes: "",
      password: VAULT_PASSWORD,
    };
    const unsupported = await call("POST", VAULT_ROUTES.list, { token: adaToken, json: {} });
    check(
      "the Vault routes without the capability get 400 vaultUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.vaultUnsupported")),
      summary(unsupported),
    );
    const memberList = await vaultCall(bobToken, VAULT_ROUTES.list);
    const memberSave = await vaultCall(bobToken, VAULT_ROUTES.save, login);
    check(
      "a member cannot list or change the host's Vault",
      errorIs(memberList, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSave, 403, sourceText("error.team.adminRequired")) &&
        vault.state().items.length === 0,
      [summary(memberList), summary(memberSave)],
    );
    const saved = await vaultCall(adaToken, VAULT_ROUTES.save, login);
    const items = field(saved.body, "items");
    const itemId = field(saved.body, "items", 0, "id");
    check(
      "an admin adds a login; the answer lists it with no password",
      saved.status === 200 &&
        field(saved.body, "status") === "ready" &&
        Array.isArray(items) &&
        items.length === 1 &&
        field(saved.body, "items", 0, "hasPassword") === true &&
        typeof itemId === "string" &&
        !saved.text.includes(VAULT_PASSWORD) &&
        !readFileSync(vaultFile, "utf8").includes(VAULT_PASSWORD),
      summary(saved),
    );
    assert.ok(typeof itemId === "string", "the Vault save did not answer an item id.");
    const listed = await vaultCall(adaToken, VAULT_ROUTES.list);
    check(
      "the list carries the login with no password",
      listed.status === 200 &&
        field(listed.body, "items", 0, "username") === "ada@example.com" &&
        !listed.text.includes(VAULT_PASSWORD),
      summary(listed),
    );
    const memberReveal = await vaultCall(bobToken, VAULT_ROUTES.reveal, { id: itemId, field: "password" });
    const revealed = await vaultCall(adaToken, VAULT_ROUTES.reveal, { id: itemId, field: "password" });
    check(
      "only an admin gets the saved password, and only from reveal",
      errorIs(memberReveal, 403, sourceText("error.team.adminRequired")) &&
        !memberReveal.text.includes(VAULT_PASSWORD) &&
        revealed.status === 200 &&
        isDeepStrictEqual(revealed.body, { value: VAULT_PASSWORD }),
      [summary(memberReveal), { status: revealed.status }],
    );
    const badCard = await vaultCall(adaToken, VAULT_ROUTES.save, {
      kind: "card",
      id: null,
      label: "",
      nameOnCard: "Ada",
      expMonth: 12,
      expYear: 2030,
      billingContactId: null,
      number: "4111111111111112",
      securityCode: "123",
    });
    const malformed = await vaultCall(adaToken, VAULT_ROUTES.save, { ...login, kind: "note" });
    check(
      "a card number that fails the check is refused with catalog text, and a malformed item is refused",
      errorIs(badCard, 400, sourceText("error.vault.cardNumberInvalid")) &&
        malformed.status === 400 &&
        vault.state().items.length === 1,
      [summary(badCard), summary(malformed)],
    );
    const readableReset = await vaultCall(adaToken, VAULT_ROUTES.reset);
    check(
      "a reset of a Vault that the host can read gets 409 and keeps every item",
      errorIs(readableReset, 409, sourceText("error.team.vaultResetReadable")) && vault.state().items.length === 1,
      summary(readableReset),
    );
    const deleted = await vaultCall(adaToken, VAULT_ROUTES.delete, { id: itemId });
    const missing = await vaultCall(adaToken, VAULT_ROUTES.delete, { id: itemId });
    check(
      "an admin deletes the login; a second delete says the item is gone",
      deleted.status === 200 &&
        isDeepStrictEqual(deleted.body, { status: "ready", items: [] }) &&
        errorIs(missing, 400, sourceText("error.vault.itemMissing")),
      [summary(deleted), summary(missing)],
    );
    // A file that the host cannot decrypt: the Vault is `unreadable` until an admin resets it.
    writeFileSync(vaultFile, JSON.stringify({ version: 1, record: "bm90LWEtcmVjb3Jk" }));
    await Effect.runPromise(vault.load());
    const unreadable = await vaultCall(adaToken, VAULT_ROUTES.list);
    const reset = await vaultCall(adaToken, VAULT_ROUTES.reset);
    check(
      "an admin resets a Vault that the host cannot read to no items",
      isDeepStrictEqual(unreadable.body, { status: "unreadable", items: [] }) &&
        reset.status === 200 &&
        isDeepStrictEqual(reset.body, { status: "ready", items: [] }),
      [summary(unreadable), summary(reset)],
    );
  }

  // ---- API keys in the host's Vault (vault-v2), and vault-v1 on the same host ----
  {
    const v1Call = (token: string, path: string, json: unknown = {}) =>
      call("POST", path, { token, json, capabilities: [VAULT_CAPABILITY] });
    const v2Call = (token: string, path: string, json: unknown = {}) =>
      call("POST", path, { token, json, capabilities: [VAULT_V2_CAPABILITY] });
    /** The kind of each listed item, in order. */
    const kinds = (body: Json | undefined) => {
      const items = field(body, "items");
      return Array.isArray(items) ? items.map((item) => field(item, "kind")) : undefined;
    };
    const apiKey = { kind: "apiKey", id: null, name: "OPENAI_API_KEY", notes: "Billing", key: VAULT_API_KEY };
    const login = {
      kind: "login",
      id: null,
      website: "https://shop.example.com",
      username: "ada@example.com",
      notes: "",
      password: VAULT_PASSWORD,
    };
    const unsupported = await v1Call(adaToken, VAULT_V2_ROUTES.list);
    const memberSave = await v2Call(bobToken, VAULT_V2_ROUTES.save, apiKey);
    check(
      "the vault-v2 routes need vault-v2 and an owner or admin",
      errorIs(unsupported, 400, sourceText("error.team.vaultUnsupported")) &&
        errorIs(memberSave, 403, sourceText("error.team.adminRequired")) &&
        vault.state().items.length === 0,
      [summary(unsupported), summary(memberSave)],
    );
    const saved = await v2Call(adaToken, VAULT_V2_ROUTES.save, apiKey);
    const keyId = field(saved.body, "items", 0, "id");
    check(
      "an admin adds an API key; the answer lists its name with no key",
      saved.status === 200 &&
        field(saved.body, "items", 0, "kind") === "apiKey" &&
        field(saved.body, "items", 0, "name") === "OPENAI_API_KEY" &&
        field(saved.body, "items", 0, "hasKey") === true &&
        typeof keyId === "string" &&
        !saved.text.includes(VAULT_API_KEY) &&
        !readFileSync(vaultFile, "utf8").includes(VAULT_API_KEY),
      summary(saved),
    );
    assert.ok(typeof keyId === "string", "the vault-v2 save did not answer an item id.");
    const duplicate = await v2Call(adaToken, VAULT_V2_ROUTES.save, apiKey);
    const badName = await v2Call(adaToken, VAULT_V2_ROUTES.save, { ...apiKey, name: "openai key" });
    const v1ApiKey = await v1Call(adaToken, VAULT_ROUTES.save, apiKey);
    check(
      "a second key of the same name and a name that is not a variable are refused; vault-v1 cannot add a key",
      errorIs(duplicate, 400, sourceText("error.vault.apiKeyNameTaken")) &&
        errorIs(badName, 400, sourceText("error.vault.apiKeyNameInvalid")) &&
        v1ApiKey.status === 400 &&
        vault.state().items.length === 1,
      [summary(duplicate), summary(badName), summary(v1ApiKey)],
    );
    const v1Login = await v1Call(adaToken, VAULT_ROUTES.save, login);
    const v1List = await v1Call(adaToken, VAULT_ROUTES.list);
    const v1Delete = await v1Call(adaToken, VAULT_ROUTES.delete, { id: keyId });
    const v1Reveal = await v1Call(adaToken, VAULT_ROUTES.reveal, { id: keyId, field: "key" });
    check(
      "vault-v1 on the same host lists no API key, keeps it when it saves a login, and cannot delete or reveal it",
      v1Login.status === 200 &&
        isDeepStrictEqual(kinds(v1List.body), ["login"]) &&
        errorIs(v1Delete, 400, sourceText("error.vault.itemMissing")) &&
        v1Reveal.status === 400 &&
        !v1Reveal.text.includes(VAULT_API_KEY) &&
        vault.state().items.some((item) => item.id === keyId),
      [summary(v1Login), summary(v1List), summary(v1Delete), summary(v1Reveal)],
    );
    const v2List = await v2Call(adaToken, VAULT_V2_ROUTES.list);
    const revealed = await v2Call(adaToken, VAULT_V2_ROUTES.reveal, { id: keyId, field: "key" });
    check(
      "vault-v2 lists the login and the API key, and reveals the key to an admin only from reveal",
      isDeepStrictEqual(kinds(v2List.body), ["login", "apiKey"]) &&
        !v2List.text.includes(VAULT_API_KEY) &&
        isDeepStrictEqual(revealed.body, { value: VAULT_API_KEY }),
      [summary(v2List), { status: revealed.status }],
    );
    const loginId = field(v1Login.body, "items", 0, "id");
    const deletedKey = await v2Call(adaToken, VAULT_V2_ROUTES.delete, { id: keyId });
    const deletedLogin = await v2Call(adaToken, VAULT_V2_ROUTES.delete, { id: loginId });
    check(
      "an admin deletes the API key and the login through vault-v2",
      deletedKey.status === 200 &&
        isDeepStrictEqual(deletedLogin.body, { status: "ready", items: [] }) &&
        vault.state().items.length === 0,
      [summary(deletedKey), summary(deletedLogin)],
    );
  }

  // ---- A password saved from the secure card (browser-secret-vault-v1) ----
  {
    const capabilities = ["browser-secret-handoff", BROWSER_SECRET_VAULT_CAPABILITY];
    const answer = { requestId: "auth-1", agentId: "agent-ada", secret: VAULT_PASSWORD, decision: "takeover" };
    const before = callsOf("respondToBrowserSecret").length;
    const unsupported = await call("POST", BROWSER_SECRET_VAULT_ROUTES.respond, {
      token: adaToken,
      json: answer,
      capabilities: ["browser-secret-handoff"],
    });
    const noHandoff = await call("POST", BROWSER_SECRET_VAULT_ROUTES.respond, {
      token: adaToken,
      json: answer,
      capabilities: [BROWSER_SECRET_VAULT_CAPABILITY],
    });
    const member = await call("POST", BROWSER_SECRET_VAULT_ROUTES.respond, {
      token: bobToken,
      json: answer,
      capabilities,
    });
    check(
      "a save without either capability gets 400, and a member gets 403; none reaches the agent",
      errorIs(unsupported, 400, sourceText("error.team.vaultUnsupported")) &&
        errorIs(noHandoff, 400, sourceText("error.team.secureAuthUnsupported")) &&
        errorIs(member, 403, sourceText("error.team.adminRequired")) &&
        callsOf("respondToBrowserSecret").length === before,
      [summary(unsupported), summary(noHandoff), summary(member)],
    );
    const saved = await call("POST", BROWSER_SECRET_VAULT_ROUTES.respond, {
      token: adaToken,
      json: answer,
      capabilities,
    });
    check(
      "an admin submits the password with a save; the answer does not carry it",
      saved.status === 200 &&
        isDeepStrictEqual(saved.body, {}) &&
        !saved.text.includes(VAULT_PASSWORD) &&
        // The route sends a submit with the save, whatever decision the body names.
        isDeepStrictEqual(callsOf("respondToBrowserSecret").at(-1), [
          { requestId: "auth-1", agentId: "agent-ada", decision: "submit", secret: VAULT_PASSWORD, saveToVault: true },
        ]),
      summary(saved),
    );
  }

  // ---- A CSV import into the host's Vault (vault-import-v1) ----
  {
    const csvPassword = ["vault", "e2e", "csv", "password"].join("-");
    const importCall = (token: string, json: unknown, capabilities = [VAULT_IMPORT_CAPABILITY]) =>
      call("POST", VAULT_IMPORT_ROUTES.import, { token, json, capabilities });
    const csv = [
      "url,username,password",
      `https://mail.example.com,ada,${csvPassword}`,
      `http://old.example.com,ada,${csvPassword}`,
    ].join("\n");
    const unsupported = await importCall(adaToken, { csv }, [VAULT_CAPABILITY]);
    const member = await importCall(bobToken, { csv });
    check(
      "a CSV import needs vault-import-v1 and an owner or admin",
      errorIs(unsupported, 400, sourceText("error.team.vaultUnsupported")) &&
        errorIs(member, 403, sourceText("error.team.adminRequired")) &&
        vault.state().items.length === 0,
      [summary(unsupported), summary(member)],
    );
    const loggedBefore = logged.length;
    const imported = await importCall(adaToken, { csv });
    const logins = vault.state().items.filter((item) => item.kind === "login");
    check(
      "an admin imports a CSV export: the HTTPS login is added, the other row skipped, and only the counts answer",
      imported.status === 200 &&
        isDeepStrictEqual(imported.body, { imported: 1, skipped: 1 }) &&
        logins.length === 1 &&
        logins[0] !== undefined &&
        vault.reveal({ id: logins[0].id, field: "password" }) === csvPassword &&
        !imported.text.includes(csvPassword) &&
        !logged.slice(loggedBefore).some((line) => line.includes(csvPassword)),
      summary(imported),
    );
    const notCsv = await importCall(adaToken, { csv: "name\nnothing" });
    check(
      "a file that is not a password export gets the Vault's own sentence",
      errorIs(notCsv, 400, sourceText("error.vault.csvInvalid")),
      summary(notCsv),
    );
  }

  // ---- Routine result destinations (routine-results-v1) ----
  {
    const resultCapabilities = [ROUTINE_RESULTS_CAPABILITY];
    const chosen = { connectionId: "slack-acme", placeId: "C0123", placeName: "general" };
    const unsupported = await call("POST", ROUTINE_RESULTS_ROUTES.options, { token: adaToken, json: {} });
    check(
      "the routine result routes without the capability get 400 routineResultsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.routineResultsUnsupported")),
      summary(unsupported),
    );
    const memberOptions = await call("POST", ROUTINE_RESULTS_ROUTES.options, {
      token: bobToken,
      json: {},
      capabilities: resultCapabilities,
    });
    const memberSet = await call("POST", ROUTINE_RESULTS_ROUTES.setDestination, {
      token: bobToken,
      json: { agentId: "agent-ada", routineId: "routine-ada", destination: chosen },
      capabilities: resultCapabilities,
    });
    check(
      "a member cannot read the places or set a destination",
      errorIs(memberOptions, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        callsOf("setRoutineResultDestination").length === 0,
      [summary(memberOptions), summary(memberSet)],
    );
    const options = await call("POST", ROUTINE_RESULTS_ROUTES.options, {
      token: adaToken,
      json: {},
      capabilities: resultCapabilities,
    });
    const before = await call("POST", ROUTINE_RESULTS_ROUTES.destination, {
      token: adaToken,
      json: { agentId: "agent-ada", routineId: "routine-ada" },
      capabilities: resultCapabilities,
    });
    check(
      "an admin reads the connections with their places, and no destination yet",
      options.status === 200 &&
        isDeepStrictEqual(options.body, { connections: routineResultOptions }) &&
        before.status === 200 &&
        isDeepStrictEqual(before.body, { destination: null }),
      [summary(options), summary(before)],
    );
    const set = await call("POST", ROUTINE_RESULTS_ROUTES.setDestination, {
      token: adaToken,
      json: { agentId: "agent-ada", routineId: "routine-ada", destination: chosen },
      capabilities: resultCapabilities,
    });
    const after = await call("POST", ROUTINE_RESULTS_ROUTES.destination, {
      token: adaToken,
      json: { agentId: "agent-ada", routineId: "routine-ada" },
      capabilities: resultCapabilities,
    });
    const saved = { ...chosen, platform: "slack", connectionName: "Acme" };
    check(
      "an admin sets a destination, and the host adds the connection's name and platform",
      set.status === 200 &&
        isDeepStrictEqual(set.body, { destination: saved }) &&
        isDeepStrictEqual(after.body, { destination: saved }) &&
        isDeepStrictEqual(callsOf("setRoutineResultDestination").at(-1), [
          { agentId: "agent-ada", routineId: "routine-ada", destination: chosen },
        ]),
      [summary(set), summary(after)],
    );
    const gone = await call("POST", ROUTINE_RESULTS_ROUTES.destination, {
      token: adaToken,
      json: { agentId: "agent-ada", routineId: "routine-none" },
      capabilities: resultCapabilities,
    });
    const cleared = await call("POST", ROUTINE_RESULTS_ROUTES.setDestination, {
      token: adaToken,
      json: { agentId: "agent-ada", routineId: "routine-ada", destination: null },
      capabilities: resultCapabilities,
    });
    check(
      "a routine that is gone gets 400 routineGone, and a null destination stops sending",
      errorIs(gone, 400, sourceText("error.backend.routineGone")) &&
        cleared.status === 200 &&
        isDeepStrictEqual(cleared.body, { destination: null }),
      [summary(gone), summary(cleared)],
    );
  }

  // ---- Queue routes ----
  {
    const bobSender = { id: bobId, name: "Bob" };
    const queue = await call("GET", TEAM_API_ROUTES.agent.queue("agent-ada"), { token: bobToken });
    check(
      "the queue route returns the queue of the agent in the path",
      queue.status === 200 &&
        field(queue.body, "botId") === "agent-ada" &&
        field(queue.body, "deliveries", 0, "id") === "delivery-1" &&
        isDeepStrictEqual(callsOf("listQueue").at(-1), ["agent-ada"]),
      summary(queue),
    );
    const acknowledge = await call("POST", TEAM_API_ROUTES.agent.failuresAcknowledge("agent-ada"), {
      token: bobToken,
      json: { turnId: "turn-1" },
    });
    const acknowledgeEmpty = await call("POST", TEAM_API_ROUTES.agent.failuresAcknowledge("agent-ada"), {
      token: bobToken,
      json: {},
    });
    check(
      "acknowledging a failed turn gives 204, and a missing turnId gives 400",
      acknowledge.status === 204 &&
        isDeepStrictEqual(callsOf("acknowledgeFailedTurn"), [["agent-ada", "turn-1"]]) &&
        acknowledgeEmpty.status === 400,
      [summary(acknowledge), summary(acknowledgeEmpty)],
    );
    const cancel = await call("POST", TEAM_API_ROUTES.agent.queueCancel("agent-ada"), {
      token: bobToken,
      json: { deliveryId: "delivery-1" },
    });
    check(
      "cancel gives 204 and names the delivery",
      cancel.status === 204 && isDeepStrictEqual(callsOf("cancelQueuedMessage"), [["agent-ada", "delivery-1"]]),
      summary(cancel),
    );
    const steer = await call("POST", TEAM_API_ROUTES.agent.queueSteer("agent-ada"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", expectedTurnId: "turn-2" },
    });
    const steerGone = await call("POST", TEAM_API_ROUTES.agent.queueSteer("agent-gone"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", expectedTurnId: "turn-2" },
    });
    const steerDeferred = await call("POST", TEAM_API_ROUTES.agent.queueSteer("agent-oc"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", expectedTurnId: "turn-2" },
    });
    check(
      "steer gives 204 for a listed agent, 404 for an agent that is not listed, and 409 with the reason when the provider defers steering",
      steer.status === 204 &&
        errorIs(steerGone, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(steerDeferred, 409, sourceText("error.backend.steerUnsupported")) &&
        isDeepStrictEqual(callsOf("steerQueuedMessage"), [
          [{ agentId: "agent-ada", deliveryId: "delivery-1", expectedTurnId: "turn-2" }],
          [{ agentId: "agent-oc", deliveryId: "delivery-1", expectedTurnId: "turn-2" }],
        ]),
      [summary(steer), summary(steerGone), summary(steerDeferred)],
    );
    const update = await call("POST", TEAM_API_ROUTES.agent.queueUpdate("agent-ada"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", text: "changed text", keepAttachmentIds: ["kept-1"], attachmentDraftIds: [] },
    });
    check(
      "update gives 204 and sends the text with the caller as sender",
      update.status === 204 &&
        isDeepStrictEqual(callsOf("updateQueuedMessage"), [
          [
            {
              agentId: "agent-ada",
              deliveryId: "delivery-1",
              text: "changed text",
              keepAttachmentIds: ["kept-1"],
              attachmentDraftIds: [],
            },
            bobSender,
          ],
        ]),
      { status: update.status, calls: callsOf("updateQueuedMessage") },
    );
    const updateTooLong = await call("POST", TEAM_API_ROUTES.agent.queueUpdate("agent-ada"), {
      token: bobToken,
      json: { deliveryId: "delivery-1", text: "x".repeat(INPUT_LIMITS.messageText + 1) },
    });
    check(
      "update with a text over the limit gets 400 and reaches no service",
      updateTooLong.status === 400 && callsOf("updateQueuedMessage").length === 1,
      summary(updateTooLong),
    );
    const reorder = await call("POST", TEAM_API_ROUTES.agent.queueReorder("agent-ada"), {
      token: bobToken,
      json: { deliveryIds: ["delivery-2", "delivery-1"] },
    });
    const reorderBad = await call("POST", TEAM_API_ROUTES.agent.queueReorder("agent-ada"), {
      token: bobToken,
      json: { deliveryIds: "delivery-1" },
    });
    check(
      "reorder gives 204 with the new order, and a non-array order gets 400",
      reorder.status === 204 &&
        isDeepStrictEqual(callsOf("reorderQueue"), [
          [{ agentId: "agent-ada", deliveryIds: ["delivery-2", "delivery-1"] }],
        ]) &&
        reorderBad.status === 400,
      [summary(reorder), summary(reorderBad)],
    );
    const interrupt = await call("POST", TEAM_API_ROUTES.agent.interrupt("agent-ada"), {
      token: bobToken,
      json: { turnId: "turn-3" },
    });
    const interruptGone = await call("POST", TEAM_API_ROUTES.agent.interrupt("agent-gone"), {
      token: bobToken,
      json: { turnId: "turn-3" },
    });
    check(
      "interrupt gives 204 for a listed agent and 404 for an agent that is not listed",
      interrupt.status === 204 &&
        errorIs(interruptGone, 404, sourceText("error.team.agentNotFound")) &&
        isDeepStrictEqual(callsOf("interrupt"), [["agent-ada", "turn-3"]]),
      [summary(interrupt), summary(interruptGone)],
    );

    const unsupported = sourceText("error.team.queueEditUnsupported");
    const begin = { action: "begin", deliveryId: "delivery-1", editId: "edit-1" };
    const noCapability = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), {
      token: bobToken,
      json: begin,
      capabilities: [],
    });
    const oldProtocol = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), {
      token: bobToken,
      json: begin,
      protocol: 2,
    });
    check(
      "queue edit without the capability or below protocol 3 gets 400 queueEditUnsupported",
      errorIs(noCapability, 400, unsupported) &&
        errorIs(oldProtocol, 400, unsupported) &&
        callsOf("editQueuedMessage").length === 0,
      [summary(noCapability), summary(oldProtocol)],
    );
    const edit = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), { token: bobToken, json: begin });
    check(
      "queue edit begin gives 200 with the queue and the caller as sender",
      edit.status === 200 &&
        field(edit.body, "botId") === "agent-ada" &&
        isDeepStrictEqual(callsOf("editQueuedMessage").at(-1), ["agent-ada", begin, bobSender]),
      summary(edit),
    );
    const rejected = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), {
      token: bobToken,
      json: { ...begin, editId: "edit-rejected" },
    });
    check(
      "a queue edit that the queue refuses gets 409 with its reason",
      rejected.status === 409 &&
        field(rejected.body, "error") === "Queue edit rejected: another editor holds this message.",
      summary(rejected),
    );
    const editCalls = callsOf("editQueuedMessage").length;
    const malformed = await call("POST", TEAM_API_ROUTES.agent.queueEdit("agent-ada"), {
      token: bobToken,
      json: { action: "replace", deliveryId: "delivery-1", editId: "edit-2" },
    });
    check(
      "a malformed queue edit on protocol 7 gets 400 and reaches no service",
      malformed.status === 400 && callsOf("editQueuedMessage").length === editCalls,
      summary(malformed),
    );
  }

  // ---- Side questions: any member asks, the chat and the queue do not change ----
  {
    const sideCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, SIDE_QUESTION_CAPABILITY];
    const callsBefore = calls.length;
    const unsupported = await call("POST", SIDE_QUESTION_ROUTES.ask, {
      token: bobToken,
      json: { agentId: "agent-ada", question: "What file was that?", earlier: [] },
    });
    check(
      "a side question without side-question-v1 gets 400 sideQuestionUnsupported and reaches no agent",
      errorIs(unsupported, 400, sourceText("error.team.sideQuestionUnsupported")) &&
        callsOf("askSideQuestion").length === 0,
      summary(unsupported),
    );
    const empty = await call("POST", SIDE_QUESTION_ROUTES.ask, {
      token: bobToken,
      capabilities: sideCapabilities,
      json: { agentId: "agent-ada", question: "   ", earlier: [] },
    });
    const malformed = await call("POST", SIDE_QUESTION_ROUTES.ask, {
      token: bobToken,
      capabilities: sideCapabilities,
      json: { agentId: "agent-ada", question: "Why?", earlier: "none" },
    });
    check(
      "an empty or malformed side question gets 400 and reaches no agent",
      empty.status === 400 && malformed.status === 400 && callsOf("askSideQuestion").length === 0,
      [summary(empty), summary(malformed)],
    );
    const hiddenAgent = await call("POST", SIDE_QUESTION_ROUTES.ask, {
      token: bobToken,
      capabilities: sideCapabilities,
      protocol: 6,
      json: { agentId: "agent-pi", question: "Hello?", earlier: [] },
    });
    const missingAgent = await call("POST", SIDE_QUESTION_ROUTES.ask, {
      token: bobToken,
      capabilities: sideCapabilities,
      json: { agentId: "agent-gone", question: "Hello?", earlier: [] },
    });
    check(
      "a side question to an agent hidden from the client or not on the host gets 404",
      errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(missingAgent, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("askSideQuestion").length === 0,
      [summary(hiddenAgent), summary(missingAgent)],
    );
    const earlier = [{ question: "Which flag?", answer: "The --force flag." }];
    // Two at once, as a member asks while another side question still runs.
    const [first, second] = await Promise.all([
      call("POST", SIDE_QUESTION_ROUTES.ask, {
        token: bobToken,
        capabilities: sideCapabilities,
        json: { agentId: "agent-ada", question: "What does it do?", earlier },
      }),
      call("POST", SIDE_QUESTION_ROUTES.ask, {
        token: adaToken,
        capabilities: sideCapabilities,
        json: { agentId: "agent-ada", question: "Which file?", earlier: [] },
      }),
    ]);
    const asked = callsOf("askSideQuestion");
    check(
      "a member and an admin each get the answer, and the host gets the earlier turns",
      first.status === 200 &&
        field(first.body, "answer") === "Answer to What does it do?" &&
        second.status === 200 &&
        field(second.body, "answer") === "Answer to Which file?" &&
        asked.some((args) =>
          isDeepStrictEqual(args, [{ agentId: "agent-ada", question: "What does it do?", earlier }]),
        ),
      [summary(first), summary(second)],
    );
    const busy = await call("POST", SIDE_QUESTION_ROUTES.ask, {
      token: bobToken,
      capabilities: sideCapabilities,
      json: { agentId: "agent-ada", question: "busy?", earlier: [] },
    });
    check(
      "a failed side question gets 409 with the sentence for the member",
      errorIs(busy, 409, sourceText("error.agent.sideQuestionBusy")),
      summary(busy),
    );
    // `sendMessage` and the other chat routes are `unused` stand-ins, so a call to one would also fail
    // the answers above. This shows that a side question recorded nothing but itself.
    check(
      "side questions do not reach the chat, the queue or a turn",
      calls.slice(callsBefore).every((entry) => entry.method === "askSideQuestion"),
      calls.slice(callsBefore).map((entry) => entry.method),
    );
  }

  // ---- Attachments and files ----
  {
    const nameRequired = sourceText("error.team.attachmentNameRequired");
    const prepareCalls = () => callsOf("prepareImportedAttachments").length;
    const bytes = new TextEncoder().encode("hello attachment");
    const badNames = [
      await call("POST", TEAM_API_ROUTES.attachments, { token: bobToken, bytes }),
      await call("POST", `${TEAM_API_ROUTES.attachments}?name=${encodeURIComponent("../escape.txt")}`, {
        token: bobToken,
        bytes,
      }),
      await call("POST", `${TEAM_API_ROUTES.attachments}?name=${"n".repeat(INPUT_LIMITS.attachmentName + 1)}`, {
        token: bobToken,
        bytes,
      }),
    ];
    const longMime = await call(
      "POST",
      `${TEAM_API_ROUTES.attachments}?name=notes.txt&mime=${"m".repeat(INPUT_LIMITS.mimeType + 1)}`,
      { token: bobToken, bytes },
    );
    const noToken = await call("POST", `${TEAM_API_ROUTES.attachments}?name=notes.txt`, { bytes });
    check(
      "an upload with no name, a path in the name, a long name or a long MIME type gets 400, and one with no token 401",
      badNames.every((reply) => errorIs(reply, 400, nameRequired)) &&
        errorIs(longMime, 400, "The attachment MIME type is too long.") &&
        noToken.status === 401 &&
        prepareCalls() === 0,
      [...badNames, longMime, noToken].map(summary),
    );
    const oversized = await rawCall(
      `${TEAM_API_ROUTES.attachments}?name=big.bin`,
      bobToken,
      ATTACHMENT_LIMITS.fileBytes + 1,
      null,
    );
    check(
      "an upload that declares more than 100 MB gets 413 before its body is read",
      oversized.status === 413 &&
        field(oversized.body, "error") === "Attachment exceeds the 100 MB limit." &&
        prepareCalls() === 0,
      oversized,
    );
    const upload = await call("POST", `${TEAM_API_ROUTES.attachments}?name=notes.txt&mime=text%2Fplain`, {
      token: bobToken,
      bytes,
    });
    const preparedData = uploads[0];
    check(
      "an upload gives 201 with the draft, and the service gets the exact bytes",
      upload.status === 201 &&
        field(upload.body, "id") === "draft-1" &&
        field(upload.body, "size") === bytes.length &&
        preparedData?.name === "notes.txt" &&
        preparedData.mimeType === "text/plain" &&
        Buffer.from(bytes).equals(preparedData.bytes),
      summary(upload),
    );
    const download = await call("GET", TEAM_API_ROUTES.attachment("att-1"), { token: bobToken });
    check(
      "an attachment download gives the bytes, the MIME type and an encoded file name",
      download.status === 200 &&
        download.text === attachmentBytes &&
        download.headers.get("content-type") === "text/plain" &&
        download.headers.get("content-disposition") === "attachment; filename*=UTF-8''report%20one.txt",
      { status: download.status, headers: Object.fromEntries(download.headers) },
    );
    const missing = await call("GET", TEAM_API_ROUTES.attachment("att-missing"), { token: bobToken });
    check(
      "a missing attachment gets 404 attachmentNotFound",
      errorIs(missing, 404, sourceText("error.team.attachmentNotFound")),
      summary(missing),
    );
    const discard = await call("DELETE", TEAM_API_ROUTES.attachment("draft-1"), { token: bobToken });
    check(
      "deleting a draft attachment gives 204 and discards it",
      discard.status === 204 && isDeepStrictEqual(callsOf("discardDraftAttachment"), [["draft-1"]]),
      summary(discard),
    );

    const cancelCalls = callsOf("cancelQueuedMessage").length;
    const largeJson = new TextEncoder().encode(JSON.stringify({ deliveryId: "delivery-1", padding: "p".repeat(MIB) }));
    const tooLarge = await rawCall(
      TEAM_API_ROUTES.agent.queueCancel("agent-ada"),
      bobToken,
      largeJson.length,
      largeJson,
    );
    check(
      "a JSON body over 1 MiB gets 413 requestTooLarge and reaches no service",
      tooLarge.status === 413 &&
        field(tooLarge.body, "error") === sourceText("error.team.requestTooLarge") &&
        callsOf("cancelQueuedMessage").length === cancelCalls,
      tooLarge,
    );

    const sharedMissing = await call("GET", TEAM_API_ROUTES.sharedFiles, { token: bobToken });
    const shared = await call("GET", `${TEAM_API_ROUTES.sharedFiles}?path=shared.txt`, { token: bobToken });
    const sharedBig = await call("GET", `${TEAM_API_ROUTES.sharedFiles}?path=big.bin`, { token: bobToken });
    check(
      "shared files: no path gets 400, a file gives its bytes, a file over 100 MB gets 413",
      errorIs(sharedMissing, 400, "A valid shared file path is required.") &&
        shared.status === 200 &&
        shared.text === "shared file bytes\n" &&
        shared.headers.get("content-disposition") === "attachment; filename*=UTF-8''shared.txt" &&
        errorIs(sharedBig, 413, sourceText("error.team.sharedFileTooLarge")),
      [summary(sharedMissing), summary(shared), summary(sharedBig)],
    );
    const workspaceMissing = await call("GET", `${TEAM_API_ROUTES.workspaceFiles}?path=notes.md`, { token: bobToken });
    const workspace = await call("GET", `${TEAM_API_ROUTES.workspaceFiles}?botId=agent-ada&path=notes.md`, {
      token: bobToken,
    });
    const workspaceBig = await call("GET", `${TEAM_API_ROUTES.workspaceFiles}?botId=agent-ada&path=big.bin`, {
      token: bobToken,
    });
    check(
      "workspace files: no agent gets 400, a file gives its bytes, a file over 100 MB gets 413",
      errorIs(workspaceMissing, 400, "A valid agent id is required.") &&
        workspace.status === 200 &&
        workspace.text === "# workspace notes\n" &&
        errorIs(workspaceBig, 413, sourceText("error.team.workspaceFileTooLarge")),
      [summary(workspaceMissing), summary(workspace), summary(workspaceBig)],
    );
  }

  // ---- An unexpected failure is a private 500 with a redacted log ----
  {
    const loggedBefore = logged.length;
    const status = await call("GET", TEAM_API_ROUTES.agents.status, { token: bobToken });
    const newLines = logged.slice(loggedBefore);
    check(
      "an unexpected service error gets 500 requestFailed without its detail",
      errorIs(status, 500, sourceText("error.team.requestFailed")) && !status.text.includes(FAKE_SECRET),
      summary(status),
    );
    check(
      "the unexpected error is logged once with the secret redacted",
      newLines.some((line) => line.includes("Team API request failed")) &&
        newLines.every((line) => !line.includes(FAKE_SECRET)) &&
        newLines.some((line) => line.includes("[redacted]")),
      { lines: newLines.length },
    );
  }

  // ---- A direct message to a disabled member ----
  // Last, because disabling Ada ends her sessions.
  {
    await Effect.runPromise(store.updateMember(adaId, { disabled: true }));
    const loggedBefore = logged.length;
    const toDisabled = await call("POST", TEAM_API_ROUTES.direct.messages, {
      token: bobToken,
      json: { memberId: adaId, text: "hello disabled", clientMessageId: "client-message-4" },
    });
    const threadsAfter = await call("GET", TEAM_API_ROUTES.direct.threads, { token: bobToken });
    check(
      "a direct message to a disabled member gets 404, is not stored and writes no error log line",
      errorIs(toDisabled, 404, sourceText("error.team.directRecipientUnavailable")) &&
        threadsAfter.status === 200 &&
        list(threadsAfter.body).length === 0 &&
        logged.slice(loggedBefore).every((line) => !line.includes("Team API request failed")),
      { toDisabled: summary(toDisabled), threadsAfter: summary(threadsAfter) },
    );
  }
  check(
    "no log line holds a session token, an invitation token or the fake secret",
    logged.every(
      (line) =>
        !line.includes(FAKE_SECRET) &&
        !line.includes(owner.sessionToken) &&
        !line.includes(adaToken) &&
        !line.includes(bobToken) &&
        !line.includes(adminInvite.token),
    ),
    { lines: logged.length },
  );
} finally {
  if (server) await Effect.runPromise(server.stop());
  database.close();
  rmSync(root, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.passed);
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed: failed.length === 0, checks }, null, 2)}\n`);
for (const item of checks) process.stdout.write(`${item.passed ? "ok" : "FAILED"} ${item.name}\n`);
assert.equal(failed.length, 0, `${failed.length} checks failed; see ${join(OUT, "report.json")}`);
