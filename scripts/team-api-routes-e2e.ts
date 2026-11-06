// Drives the real `TeamApiServer` on a loopback port over HTTP, as a remote client does. The team
// store and the direct-message store are the real ones on temporary files. The agent service, the
// mailbox and the browser are small in-memory stand-ins that record each call, so a check can show
// that a refused request did not reach them. The checks cover the protocol and auth gates, sign-in
// and account tickets, the admin-only routes, the host's Bitwarden connection over a fake `bw`, the
// host's WhatsApp numbers over a stand-in messaging service (`whatsapp-connector-v1`), the
// host's password managers (`password-managers-v1`) over the real engine with a stand-in Proton
// Pass driver and the real Bitwarden adapter, the
// host's Vault (`vault-v1`, its API keys through `vault-v2`, and the CSV import of `vault-import-v1`)
// over the real service and store,
// a password that an admin saves from the secure card (`browser-secret-vault-v1`),
// direct-message isolation, agents hidden from an older
// protocol, the queue routes, message delete (`message-delete-v1`) under the agent roles, the attachment and file routes with their size limits, and the error
// codes. Writes .openbot-build/team-api-routes-e2e/report.json.
// Run: `bun run test:team-api-routes` (the preload gives the server's import graph an `electron`).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_PROVIDERS,
  type AgentEvent,
  type AgentModelId,
  type AgentModelOption,
  type AgentProviderId,
  type AgentStatus,
  type AgentSummary,
  type AttachmentDataInput,
  type BitwardenConnectorStatus,
  type CentralAuthUser,
  CHANNEL_CHATS_CAPABILITY,
  type CustomAgentResult,
  type CustomAgentSummary,
  type CustomProviderResult,
  type CustomProviderSummary,
  DEFAULT_AGENT_DEFAULTS,
  decodeHostPasswordManagerList,
  decodeHostPasswordManagerStatus,
  decodeHostWhatsAppLinkState,
  decodeHostWhatsAppOverview,
  disconnectedPasswordManager,
  type HiddenAgentsSnapshot,
  type PasswordManagerConnectMethod,
  type PasswordManagerStatus,
  type QueueSnapshot,
  type RoutineResultConnectionOption,
  type RoutineResultDestination,
  type WhatsAppAccount,
  type WhatsAppLinkState,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { TEAM_PROTOCOL_V1_WEBSOCKET } from "@openbot/contracts/team-protocol";
import {
  AGENT_BACKUP_MODELS_CAPABILITY,
  AGENT_BACKUP_MODELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_COLORS_CAPABILITY, AGENT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/agent-colors-v1";
import {
  AGENT_FAST_MODE_CAPABILITY,
  AGENT_FAST_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_FOLDERS_CAPABILITY, AGENT_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/agent-folders-v1";
import { AGENT_HIDDEN_CAPABILITY, AGENT_HIDDEN_ROUTES } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import {
  AGENT_INSTRUCTIONS_CAPABILITY,
  AGENT_INSTRUCTIONS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-instructions-v1";
import { AGENT_NEW_CHAT_CAPABILITY, AGENT_NEW_CHAT_ROUTES } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import {
  AGENT_NOTIFICATION_LEVELS_CAPABILITY,
  AGENT_NOTIFICATION_LEVELS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import {
  AGENT_PLAN_CARD_CAPABILITY,
  AGENT_PLAN_CARD_ROUTES,
} from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import {
  AGENT_TASK_LIMIT_CAPABILITY,
  AGENT_TASK_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import {
  AGENT_THREAD_REPLIES_CAPABILITY,
  AGENT_THREAD_REPLIES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-replies-v1";
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
import { CHAT_COLORS_CAPABILITY, CHAT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/chat-colors-v1";
import {
  CONTEXT_COMPACT_CAPABILITY,
  CONTEXT_COMPACT_ROUTES,
  ContextCompactRefusedError,
} from "@openbot/contracts/team-protocol/context-compact-v1";
import {
  CONVERSATION_UNREAD_FROM_CAPABILITY,
  CONVERSATION_UNREAD_FROM_ROUTE,
} from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import {
  CUSTOM_AGENTS_CAPABILITY,
  CUSTOM_AGENTS_CODECS,
  CUSTOM_AGENTS_ROUTES,
} from "@openbot/contracts/team-protocol/custom-agents-v1";
import {
  CUSTOM_PROVIDER_HARNESS_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_CODECS,
  CUSTOM_PROVIDER_HARNESS_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
import {
  HOST_KEY_ROTATION_CAPABILITY,
  HOST_KEY_ROTATION_ROUTES,
} from "@openbot/contracts/team-protocol/host-key-rotation-v1";
import { LOCAL_SERVERS_CAPABILITY, LOCAL_SERVERS_ROUTES } from "@openbot/contracts/team-protocol/local-servers-v1";
import {
  MACHINE_RESOURCES_CAPABILITY,
  MACHINE_RESOURCES_ROUTES,
  type MachineAlertEvent,
  machineAlertEvent,
} from "@openbot/contracts/team-protocol/machine-resources-v1";
import { MEMORY_REVIEW_CAPABILITY, MEMORY_REVIEW_ROUTES } from "@openbot/contracts/team-protocol/memory-review-v1";
import { MESSAGE_DELETE_CAPABILITY, MESSAGE_DELETE_ROUTES } from "@openbot/contracts/team-protocol/message-delete-v1";
import {
  PASSWORD_MANAGERS_CAPABILITY,
  PASSWORD_MANAGERS_CODECS,
  PASSWORD_MANAGERS_ROUTES,
} from "@openbot/contracts/team-protocol/password-managers-v1";
import {
  PROVIDER_DEFAULT_CAPABILITY,
  PROVIDER_DEFAULT_ROUTES,
} from "@openbot/contracts/team-protocol/provider-default-v1";
import {
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDER_USAGE_RESET_ROUTES,
} from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import { PROVIDERS_ADMIN_CAPABILITY, PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { PROVIDERS_V5_CAPABILITY, PROVIDERS_V5_ROUTES } from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_CAPABILITY, PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { QueueEditRejectedError, TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import {
  ROUTINE_RESULTS_CAPABILITY,
  ROUTINE_RESULTS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-results-v1";
import { SIDE_QUESTION_CAPABILITY, SIDE_QUESTION_ROUTES } from "@openbot/contracts/team-protocol/side-question-v1";
import { SIDEBAR_PINS_CAPABILITY, SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { STORAGE_DISK_CAPABILITY, STORAGE_DISK_ROUTES } from "@openbot/contracts/team-protocol/storage-disk-v1";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { TEAM_LONG_CAPABILITY_LISTS_CAPABILITY, TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { VAULT_IMPORT_CAPABILITY, VAULT_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_CAPABILITY, VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY, VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";
import {
  WHATSAPP_CONNECTOR_CAPABILITY,
  WHATSAPP_CONNECTOR_CODECS,
  WHATSAPP_CONNECTOR_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { SteerUnsupportedError } from "../src/backend/agent/queue-controls";
import { AgentLifecycleFailed } from "../src/backend/agent-service";
import { BrowserProfileStore } from "../src/backend/browser-profiles/browser-profile-store";
import { BrowserProxyStore } from "../src/backend/browser-profiles/browser-proxy-store";
import type { BrowserTabSession } from "../src/backend/browser-state";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MessageDeleteRefused } from "../src/backend/message-delete";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineResultError } from "../src/backend/routine-results/routine-results";
import { TeamChatStore } from "../src/backend/team-chat-store";
import type { AgentAccessState } from "../src/main/agent-access-store";
import { createAgentFolders } from "../src/main/agent-folders";
import { createAgentHostSettings } from "../src/main/agent-host-settings";
import { createAgentInstructionsFiles } from "../src/main/agent-instructions-files";
import { AgentNotificationLevelStore } from "../src/main/agent-notification-level-store";
import { type BitwardenCliRunner, BitwardenConnectorService } from "../src/main/bitwarden-connector-service";
import { BitwardenConnectorStore } from "../src/main/bitwarden-connector-store";
import { createBrowserProfileService } from "../src/main/browser-profile-service";
import { MachineAlertMonitor, MachineAlertPreferenceStore } from "../src/main/machine-alerts";
import { MemoryReviewPreferenceStore } from "../src/main/memory-review-preference-store";
import type { PasswordManagerDriver } from "../src/main/password-managers/driver";
import { PasswordManagersService } from "../src/main/password-managers/password-managers-service";
import { RemoteWorkflowError } from "../src/main/remote-service-effects";
import { SidebarPinStore } from "../src/main/sidebar-pin-store";
import type {
  TeamApiAgentAccess,
  TeamApiAgents,
  TeamApiAgentTasks,
  TeamApiBrowser,
  TeamApiConnectors,
  TeamApiMailbox,
} from "../src/main/team-api/dependencies";
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

/** The disks of a browse name the disk of the home folder. */
function startDisk(volumes: Json | undefined): boolean {
  const root = parse(realpathSync(homedir())).root;
  return list(volumes).some((volume) => field(volume, "path") === root);
}

// One model with a fast tier and one without: the fast-mode models route lists only the first.
const FAST_MODE_MODELS: AgentModelOption[] = [
  {
    provider: "codex",
    id: "gpt-fast",
    name: "GPT Fast",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
    fastServiceTier: "priority",
  },
  {
    provider: "codex",
    id: "gpt-standard",
    name: "GPT Standard",
    description: "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  },
];

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

// The host's agent event listener. Only a chat colour change (`chat-colors-v1`) sends an event in this run.
const agentEventListeners = new Set<(event: AgentEvent, memberId?: string) => void>();
// The roles of this host. Empty roles give every member `manage`, as a host without roles does; the
// message delete checks set "everyone" to a lower level for one agent.
let accessLevels: AgentAccessState = { revision: 0, everyone: {}, roles: [] };
const agentAccess: TeamApiAgentAccess = {
  get: () => accessLevels,
  levels: () => accessLevels,
  subscribe: () => () => undefined,
  set: unused("agentAccess.set"),
  copyAgent: unused("agentAccess.copyAgent"),
};

const fakeAgents: TeamApiAgents = {
  on: (_event, listener) => {
    agentEventListeners.add(listener);
  },
  off: (_event, listener) => {
    agentEventListeners.delete(listener);
  },
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
  // Only an exact colour (`agent-colors-v1`) or a chat colour (`chat-colors-v1`) reaches this writer in
  // this run. A chat colour change sends `agents-changed`, as the agent service does.
  updateAgent: (input) =>
    Effect.sync(() => {
      record(input.chatColor === undefined ? "updateAgentColor" : "updateAgentChatColor", input);
      const target = agents.find((item) => item.id === input.agentId);
      if (!target) throw new Error("Agent not found.");
      if (input.avatarColor === null) delete target.avatarColor;
      else if (input.avatarColor !== undefined) target.avatarColor = input.avatarColor;
      if (input.chatColor === null) delete target.chatColor;
      else if (input.chatColor !== undefined) target.chatColor = input.chatColor;
      if (input.chatColor !== undefined)
        for (const listener of agentEventListeners) listener({ type: "agents-changed", agents });
      return target;
    }),
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
  // The chat of each agent shows every message but `message-gone`. A page around a message starts with it.
  readConversationPageFor: (agentId, memberId, anchor, limit, options) => {
    record("readConversationPageFor", agentId, memberId, anchor, limit, options);
    const shown = anchor?.type === "around" && anchor.messageId !== "message-gone";
    return Effect.succeed({
      agentId,
      threadId: `thread-${agentId}`,
      activeTurnId: null,
      revision: 1,
      messages:
        shown && anchor?.type === "around"
          ? [
              {
                id: anchor.messageId,
                author: "assistant",
                text: "Reply",
                createdAt: "2026-11-05T08:00:00.000Z",
                status: "completed",
              },
            ]
          : [],
      references: {},
      pageInfo: { hasOlder: false, olderCursor: null },
    });
  },
  searchConversationMessages: unused("searchConversationMessages"),
  searchConversationFiles: unused("searchConversationFiles"),
  markConversationRead: unused("markConversationRead"),
  // The mark moves to the message shown before `fromMessageId`, which this fake names `before-<id>`.
  markConversationUnread: (agentId, memberId, fromMessageId, options) => {
    record("markConversationUnread", agentId, memberId, fromMessageId, options);
    return Effect.succeed({
      unreadCount: 2,
      firstUnreadMessageId: fromMessageId ?? null,
      throughMessageId: fromMessageId ? `before-${fromMessageId}` : null,
    });
  },
  listWorkspaceDirectory: unused("listWorkspaceDirectory"),
  sendMessage: unused("sendMessage"),
  setMessageReaction: unused("setMessageReaction"),
  // A member owns `message-of-<member id>`. `message-gone` is not shown and `message-busy` is in a
  // running turn, as the agent service answers them.
  deleteConversationMessage: (input, access) => {
    record("deleteConversationMessage", input, access);
    if (input.messageId === "message-gone") return Effect.fail(new MessageDeleteRefused({ reason: "not-found" }));
    if (input.messageId === "message-busy") return Effect.fail(new MessageDeleteRefused({ reason: "busy" }));
    if (!access.deleteAny && input.messageId !== `message-of-${access.memberId}`)
      return Effect.fail(new MessageDeleteRefused({ reason: "forbidden" }));
    return Effect.void;
  },
  clearAgentContext: unused("clearAgentContext"),
  compactAgentContext: (agentId) => Effect.sync(() => record("compactAgentContext", agentId)),
  compactTaskContext: (input) => {
    record("compactTaskContext", input);
    if (input.taskId === "task-busy")
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "compact task context",
          cause: new ContextCompactRefusedError(sourceText("error.agent.waitBeforeCompactContext")),
        }),
      );
    return Effect.void;
  },
  agentIdForRequest: () => undefined,
  respondToPrompt: unused("respondToPrompt"),
  respondToApproval: unused("respondToApproval"),
  respondToBrowserSecret: (input) => Effect.sync(() => record("respondToBrowserSecret", input)),
  respondToBrowserTakeover: unused("respondToBrowserTakeover"),
};

// Only a reply in a side thread (`agent-thread-replies-v1`) reaches the side threads in this run.
const fakeAgentTasks: TeamApiAgentTasks = {
  listAgents: () => agents,
  listTasks: unused("listTasks"),
  readTask: unused("readTask"),
  startTask: unused("startTask"),
  sendMessage: (input, sender) =>
    Effect.sync(() => {
      record("sendTaskMessage", input, sender);
      return {
        messageId: "message-reply",
        deliveries: [{ id: "delivery-reply", recipientAgentId: input.agentId, status: "queued", position: 1 }],
      };
    }),
  stopTask: unused("stopTask"),
  closeTask: unused("closeTask"),
  reopenTask: unused("reopenTask"),
  renameTask: unused("renameTask"),
  deleteTask: unused("deleteTask"),
  listTaskReads: unused("listTaskReads"),
  markTaskRead: unused("markTaskRead"),
  branchTask: unused("branchTask"),
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
// The host's password managers (`password-managers-v1`): the real engine with a stand-in Proton
// Pass driver that records each call. It records the kind of a
// connect method only, so a check can show that the access key reached the driver.
const PROTON_PASS_KEY = "pst_e2eAccessKeyThatNoAnswerCarries::e2eEncryptionKey";
const PROTON_PASS_SIGN_IN = "https://account.proton.me/authorize?code=e2e";
let protonPassStatus = disconnectedPasswordManager("protonpass", ["browser", "key"]);
const protonPassListeners = new Set<(status: PasswordManagerStatus) => void>();
function setProtonPass(change: Partial<PasswordManagerStatus>): PasswordManagerStatus {
  protonPassStatus = { ...protonPassStatus, ...change };
  for (const listener of protonPassListeners) listener(protonPassStatus);
  return protonPassStatus;
}
const protonPassDriver: PasswordManagerDriver = {
  id: "protonpass",
  prefix: "proton:",
  brand: "Proton Pass",
  signInHosts: ["account.proton.me"],
  vault: {
    connected: () => protonPassStatus.state === "connected",
    loginsFor: () => Effect.succeed(null),
    secretFor: () => Effect.succeed(null),
  },
  status: () => protonPassStatus,
  connect: (method: PasswordManagerConnectMethod) =>
    Effect.sync(() => {
      record("protonpass.connect", method.kind, method.kind === "key" && method.key === PROTON_PASS_KEY);
      return method.kind === "key"
        ? setProtonPass({
            state: "connected",
            step: null,
            signInUrl: null,
            vaultNames: ["Shared with OpenBot"],
            loginCount: 0,
          })
        : setProtonPass({ state: "signing-in", step: "browser", signInUrl: PROTON_PASS_SIGN_IN });
    }),
  cancel: () =>
    Effect.sync(() => {
      record("protonpass.cancel");
      return protonPassStatus.state === "signing-in"
        ? setProtonPass(disconnectedPasswordManager("protonpass", ["browser", "key"]))
        : protonPassStatus;
    }),
  disconnect: () =>
    Effect.sync(() => {
      record("protonpass.disconnect");
      return setProtonPass(disconnectedPasswordManager("protonpass", ["browser", "key"]));
    }),
  onChanged: (listener) => {
    protonPassListeners.add(listener);
    return () => protonPassListeners.delete(listener);
  },
};
const passwordManagers = new PasswordManagersService([protonPassDriver]);
// The host's WhatsApp numbers (`whatsapp-connector-v1`): an in-memory stand-in for the messaging
// service that records each call. The other connector routes are not part of this run.
const WHATSAPP_NUMBER = "48600100200";
const whatsappAccount: WhatsAppAccount = {
  workspaceId: WHATSAPP_NUMBER,
  ownNumber: true,
  allowedSenders: [],
  pendingRequests: [{ code: "K7Q2ZP", senderId: "48600100400", name: "Ola", expiresAt: "2026-11-03T21:00:00.000Z" }],
};
/** The link of the stand-in fails with this error, or waits while it is null. */
let whatsappLinkError: WhatsAppLinkState["error"] = null;
const whatsappMessaging: TeamApiConnectors["messaging"] = {
  slackOverview: unused("slackOverview"),
  discordOverview: unused("discordOverview"),
  telegramOverview: unused("telegramOverview"),
  connectSlackWorkspace: unused("connectSlackWorkspace"),
  connectDiscordGuild: unused("connectDiscordGuild"),
  connectTelegramChat: unused("connectTelegramChat"),
  completeSlackWorkspace: unused("completeSlackWorkspace"),
  completeDiscordGuild: unused("completeDiscordGuild"),
  disconnectSlackWorkspace: unused("disconnectSlackWorkspace"),
  disconnectDiscordGuild: unused("disconnectDiscordGuild"),
  disconnectTelegramChat: unused("disconnectTelegramChat"),
  addOrchestrator: unused("addOrchestrator"),
  addTelegramOrchestrator: unused("addTelegramOrchestrator"),
  discordAccess: unused("discordAccess"),
  listDiscordRoles: unused("listDiscordRoles"),
  setDiscordAccess: unused("setDiscordAccess"),
  reconnect: (platform, workspaceId, opensPage) =>
    Effect.sync(() => {
      record("whatsapp.reconnect", platform, workspaceId, opensPage);
      return null;
    }),
  setEnabled: (platform, workspaceId, enabled) =>
    Effect.sync(() => record("whatsapp.setEnabled", platform, workspaceId, enabled)),
  whatsappOverview: () => {
    record("whatsapp.overview");
    return {
      connections: [
        {
          workspaceId: WHATSAPP_NUMBER,
          platform: "whatsapp",
          enabled: true,
          state: "connected",
          workspaceName: "+48 600 100 200",
          botUserId: `${WHATSAPP_NUMBER}:3@s.whatsapp.net`,
          missingScopes: [],
          retryAt: null,
          credentials: "saved",
          orchestratorAgentId: null,
        },
      ],
      accounts: [structuredClone(whatsappAccount)],
    };
  },
  whatsappLinkState: () => {
    record("whatsapp.linkState");
    return {
      status: whatsappLinkError ? "failed" : "waiting",
      qr: whatsappLinkError ? null : "2@e2e-qr-ref,e2e-noise-key,e2e-identity-key,e2e-adv-secret",
      code: null,
      workspaceId: null,
      error: whatsappLinkError,
    };
  },
  startWhatsAppLink: (input) =>
    Effect.sync(() => {
      record("whatsapp.startLink", input);
      return {
        status: "waiting",
        qr: input.method === "qr" ? "2@e2e-qr-ref,e2e-noise-key,e2e-identity-key,e2e-adv-secret" : null,
        code: input.method === "code" ? "E2EPAIR1" : null,
        workspaceId: null,
        error: null,
      };
    }),
  cancelWhatsAppLink: () => Effect.sync(() => record("whatsapp.cancelLink")),
  disconnectWhatsAppNumber: (workspaceId) => Effect.sync(() => record("whatsapp.disconnect", workspaceId)),
  addWhatsAppOrchestrator: (input) =>
    Effect.sync(() => {
      record("whatsapp.addOrchestrator", input);
      return { agentId: "agent-whatsapp-orchestrator", sectionId: "section-integrations" };
    }),
  listWhatsAppGroups: (workspaceId) =>
    Effect.sync(() => {
      record("whatsapp.groups", workspaceId);
      return { groups: [{ id: "120363000000000001@g.us", name: "Family" }] };
    }),
  addWhatsAppSender: (workspaceId, sender) =>
    Effect.sync(() => {
      record("whatsapp.addSender", workspaceId, sender);
      whatsappAccount.allowedSenders.push(sender);
    }),
  removeWhatsAppSender: (workspaceId, senderId) =>
    Effect.sync(() => {
      record("whatsapp.removeSender", workspaceId, senderId);
      whatsappAccount.allowedSenders = whatsappAccount.allowedSenders.filter((sender) => sender.id !== senderId);
    }),
  answerWhatsAppRequest: (workspaceId, code, approve) =>
    Effect.sync(() => record("whatsapp.answerRequest", workspaceId, code, approve)),
  setWhatsAppOwnNumber: (workspaceId, ownNumber) =>
    Effect.sync(() => {
      record("whatsapp.setOwnNumber", workspaceId, ownNumber);
      whatsappAccount.ownNumber = ownNumber;
    }),
};
const connectors: TeamApiConnectors = {
  github: {
    status: unused("github.status"),
    pages: unused("github.pages"),
    connect: unused("github.connect"),
    cancel: unused("github.cancel"),
    disconnect: unused("github.disconnect"),
    repositories: unused("github.repositories"),
  },
  messaging: whatsappMessaging,
};
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
const ROTATED_HOST_KEY = "-----BEGIN PUBLIC KEY-----\nrotated-e2e\n-----END PUBLIC KEY-----\n";
/** The account service refuses the next handover, as when it holds another key for the host. */
let refuseHostKeyRotation = false;
/** The servers that the stand-in of `LocalServers` runs. */
const localServerList: { serverId: string; name: string; published: boolean }[] = [];
const memoryReview = new MemoryReviewPreferenceStore(memoryReviewFile);
// The real store of the levels that each member chose for each agent, on a temporary file.
const agentLevelsFile = join(root, "agent-notification-levels.json");
const agentLevels = new AgentNotificationLevelStore(agentLevelsFile);
// The real store of the chats that each member pinned, on a temporary file.
const sidebarPinsFile = join(root, "sidebar-pins.json");
const sidebarPinStore = new SidebarPinStore(sidebarPinsFile);
// The host's endpoints in memory. The one on Pi has a header and a context window that stay on the host.
let customEndpoints: CustomProviderSummary[] = [
  {
    id: "spark",
    name: "DGX Spark",
    baseUrl: "http://spark.local:8080/v1",
    hasApiKey: false,
    headerNames: ["X-Tenant"],
    models: [{ id: "qwen3-coder", name: "Qwen3 Coder", contextWindow: 131072 }],
    harness: "pi",
  },
];
const customEndpointResult = (): CustomProviderResult => ({ providers: customEndpoints, restart: "not-running" });
// The host's custom agents in memory. An environment value stays here; a summary names the variable only.
let customAgentList: CustomAgentSummary[] = [
  {
    id: "goose",
    name: "Goose",
    command: "goose",
    args: ["acp"],
    envNames: ["GOOSE_PROVIDER"],
    usagePrompt: null,
    resolvedCommand: "/usr/local/bin/goose",
  },
];
const customAgentResult = (): CustomAgentResult => ({ agents: customAgentList, restart: "not-running" });
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
    proxies: new BrowserProxyStore(database),
    // The script saves no proxy password, so the cipher only has to exist.
    cipher: { canPersist: () => true, encrypt: (value) => Buffer.from(value, "utf8") },
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
      proxyFailure: () => null,
      forgetProxyFailure: () => undefined,
      clearTabSession: (tabSession) => Effect.sync(() => record("clearTabSession", tabSession)),
      releaseProfileProxy: () => Effect.void,
    },
  });

  server = new TeamApiServer({
    appVersion: APP_VERSION,
    store,
    agents: fakeAgents,
    agentTasks: fakeAgentTasks,
    agentAccess,
    mailbox,
    browser,
    chat: new TeamChatStore(database),
    // The real host-settings service, over an agent writer that records each change.
    admin: {
      customAgents: {
        list: () => Effect.succeed(customAgentList),
        save: (input) =>
          Effect.sync(() => {
            record("saveCustomAgent", input.id, input.env);
            const { env, ...agent } = input;
            customAgentList = [
              ...customAgentList.filter((saved) => saved.id !== input.id),
              { ...agent, envNames: env.map(({ name }) => name), resolvedCommand: null },
            ];
            return customAgentResult();
          }),
        remove: (id) =>
          Effect.sync(() => {
            customAgentList = customAgentList.filter((saved) => saved.id !== id);
            return customAgentResult();
          }),
      },
      // The real folder checks on temporary folders, over an agent writer that records each change.
      folders: createAgentFolders({
        service: {
          listAgents: () => agents,
          sharedRoot: join(root, "OpenBot", "Shared"),
          updateAgent: (input) =>
            Effect.sync(() => {
              record("updateAgentFolders", input);
              const target = agents.find((item) => item.id === input.agentId);
              if (!target) throw new Error("Agent not found.");
              if (input.additionalFolders) target.additionalFolders = input.additionalFolders;
              if (input.excludedFolders) target.excludedFolders = input.excludedFolders;
              return target;
            }),
        },
        userDataPath: join(root, "user-data"),
      }),
      // The real instruction file in a temporary workspace, over an agent that records each save.
      instructions: createAgentInstructionsFiles({
        listAgents: () => agents,
        instructionsSaving: (agentId, text) => {
          record("instructionsSaving", agentId, text);
          return (written) => record("instructionsSaved", agentId, written);
        },
      }),
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
              if (input.allowNewChat === null) delete target.allowNewChat;
              else if (input.allowNewChat !== undefined) target.allowNewChat = input.allowNewChat;
              if (input.quickAcknowledgement === null) delete target.quickAcknowledgement;
              else if (input.quickAcknowledgement !== undefined)
                target.quickAcknowledgement = input.quickAcknowledgement;
              if (input.fastMode !== undefined) target.fastMode = input.fastMode;
              return target;
            }),
          listModels: () => FAST_MODE_MODELS,
        },
        busyMessageMode: { get: () => ({ mode: "queue" }) },
        agentDefaults: { get: () => DEFAULT_AGENT_DEFAULTS },
      }),
      memoryReview,
      // A stand-in for `HostService.rotateIdentityKey`; `host-key-rotation-e2e.ts` checks the real
      // signing. This checks the gate and that a refused request never reaches the host.
      hostKey: {
        rotate: () =>
          refuseHostKeyRotation
            ? Effect.fail(new RemoteWorkflowError({ cause: new Error(sourceText("error.host.keyRotationRefused")) }))
            : Effect.sync(() => {
                record("rotateHostKey");
                return { publicKey: ROTATED_HOST_KEY };
              }),
      },
      // A stand-in for `LocalServers`; `local-servers-e2e.ts` starts real children. This checks the gate
      // and the wire, and that a refused request never reaches the desktop app.
      localServers: {
        list: () => Effect.sync(() => ({ servers: [...localServerList], limit: 5 })),
        create: (name) =>
          name.trim().length < INPUT_LIMITS.serverNameMin
            ? Effect.fail(
                new RemoteWorkflowError({
                  cause: new Error(
                    sourceText("error.team.serverNameLength", {
                      min: INPUT_LIMITS.serverNameMin,
                      max: INPUT_LIMITS.serverName,
                    }),
                  ),
                }),
              )
            : Effect.sync(() => {
                record("createLocalServer", name);
                const server = { serverId: `local-server-${localServerList.length + 1}`, name, published: true };
                localServerList.push(server);
                return server;
              }),
        delete: (serverId) =>
          Effect.suspend(() => {
            const index = localServerList.findIndex((server) => server.serverId === serverId);
            if (index < 0)
              return Effect.fail(
                new RemoteWorkflowError({ cause: new Error(sourceText("error.remote.localServerNotFound")) }),
              );
            record("deleteLocalServer", serverId);
            localServerList.splice(index, 1);
            return Effect.void;
          }),
      },
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
          list: () => customEndpoints,
          save: (input) =>
            Effect.sync(() => {
              record("saveCustomProvider", input.id, input.harness);
              const { apiKey, headers, harness, ...endpoint } = input;
              customEndpoints = [
                ...customEndpoints,
                {
                  ...endpoint,
                  hasApiKey: apiKey !== null,
                  headerNames: headers.map(({ name }) => name),
                  harness: harness ?? "opencode",
                },
              ];
              return customEndpointResult();
            }),
          remove: (id) =>
            Effect.sync(() => {
              customEndpoints = customEndpoints.filter((endpoint) => endpoint.id !== id);
              return customEndpointResult();
            }),
        },
        pasteSignIn: false,
      },
    },
    bitwardenConnector,
    passwordManagers,
    connectors,
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
    sidebarPins: {
      snapshot: (memberId, hiddenIds) => sidebarPinStore.snapshot(memberId, hiddenIds),
      set: (memberId, items, hiddenIds) => sidebarPinStore.set(memberId, items, hiddenIds),
      seed: (memberId, items, hiddenIds) => sidebarPinStore.seed(memberId, items, hiddenIds),
      subscribe: (listener) => sidebarPinStore.subscribe(listener),
    },
    agentNotificationLevels: {
      snapshot: (memberId, hiddenIds) => agentLevels.snapshot(memberId, hiddenIds),
      set: (memberId, input) => agentLevels.set(memberId, input),
      setServer: (memberId, level) => agentLevels.setServer(memberId, level),
      subscribe: (listener) => agentLevels.subscribe(listener),
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
        field(compatibility.body, "protocol", "maximum") === TEAM_PROTOCOL_V9,
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
    const newer = await call("GET", TEAM_API_ROUTES.identity, { protocol: TEAM_PROTOCOL_V9 + 1 });
    check(
      "a newer protocol gets 426 host_update_required with the client version",
      newer.status === 426 &&
        field(newer.body, "code") === "host_update_required" &&
        field(newer.body, "client", "protocol") === TEAM_PROTOCOL_V9 + 1,
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
    // The released vocabulary of each protocol, written out again here so that a change to the host
    // copy fails this check. A provider added later is hidden below protocol 8 with no edit here.
    const known1 = ["codex", "claude", "grok"];
    const known4 = [...known1, "opencode"];
    const known5 = [...known4, "antigravity", "acp"];
    const known6 = [...known5, "cursor", "cline"];
    const known7 = [...known6, "pi", "muse"];
    const known: Record<number, readonly string[] | null> = {
      1: known1,
      2: known1,
      3: known1,
      4: known4,
      5: known5,
      6: known6,
      7: known7,
      8: null,
      9: null,
    };
    const hiddenRows = Object.entries(known).map(([protocol, names]) => ({
      protocol: Number(protocol),
      hidden: hiddenBy(Number(protocol)),
      expected: names === null ? [] : AGENT_PROVIDERS.filter((provider) => !names.includes(provider)),
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

  // ---- Agent folders (agent-folders-v1) ----
  {
    const capabilities = [AGENT_FOLDERS_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const projects = join(root, "projects");
    mkdirSync(join(projects, "app", "build"), { recursive: true });
    mkdirSync(join(projects, ".hidden"), { recursive: true });
    mkdirSync(join(root, "workspaces", "agent-ada"), { recursive: true });
    mkdirSync(join(root, "OpenBot", "Shared"), { recursive: true });
    writeFileSync(join(projects, "notes.txt"), "not a folder\n");
    const app = realpathSync(join(projects, "app"));
    const build = realpathSync(join(projects, "app", "build"));
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises agent-folders-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(AGENT_FOLDERS_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(AGENT_FOLDERS_CAPABILITY),
      [summary(compatibility), list(field(older.body, "capabilities")).length],
    );
    const writes = callsOf("updateAgentFolders").length;
    const unsupported = await call("POST", AGENT_FOLDERS_ROUTES.read, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      protocol: TEAM_PROTOCOL_V9,
    });
    check(
      "the folder routes without the capability get 400 agentFoldersUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentFoldersUnsupported")),
      summary(unsupported),
    );
    const memberRead = await call("POST", AGENT_FOLDERS_ROUTES.read, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      ...v9,
    });
    const memberBrowse = await call("POST", AGENT_FOLDERS_ROUTES.browse, {
      token: bobToken,
      json: { agentId: "agent-ada", path: null },
      ...v9,
    });
    const memberAdd = await call("POST", AGENT_FOLDERS_ROUTES.add, {
      token: bobToken,
      json: { agentId: "agent-ada", path: app },
      ...v9,
    });
    check(
      "a member cannot read, browse or change the folders of an agent",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberBrowse, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberAdd, 403, sourceText("error.team.adminRequired")) &&
        callsOf("updateAgentFolders").length === writes,
      [summary(memberRead), summary(memberBrowse), summary(memberAdd)],
    );
    const browse = await call("POST", AGENT_FOLDERS_ROUTES.browse, {
      token: adaToken,
      json: { agentId: "agent-ada", path: projects },
      ...v9,
    });
    check(
      "an admin lists the folders in a host folder, without files and hidden folders",
      browse.status === 200 &&
        field(browse.body, "path") === realpathSync(projects) &&
        field(browse.body, "parentPath") === realpathSync(root) &&
        isDeepStrictEqual(field(browse.body, "entries"), [{ name: "app", path: app }]) &&
        field(browse.body, "truncated") === false,
      summary(browse),
    );
    const home = await call("POST", AGENT_FOLDERS_ROUTES.browse, {
      token: adaToken,
      json: { agentId: "agent-ada", path: null },
      ...v9,
    });
    const gone = await call("POST", AGENT_FOLDERS_ROUTES.browse, {
      token: adaToken,
      json: { agentId: "agent-ada", path: join(projects, "gone") },
      ...v9,
    });
    check(
      "a browse without a path lists the home folder, names the home folder and the start disk, and a missing folder gets 404 folderUnavailable",
      home.status === 200 &&
        field(home.body, "path") === realpathSync(homedir()) &&
        field(home.body, "home") === realpathSync(homedir()) &&
        startDisk(field(home.body, "volumes")) &&
        errorIs(gone, 404, sourceText("error.team.folderUnavailable")),
      [summary(home).status, field(home.body, "volumes"), summary(gone)],
    );
    const added = await call("POST", AGENT_FOLDERS_ROUTES.add, {
      token: adaToken,
      json: { agentId: "agent-ada", path: app },
      ...v9,
    });
    const readBack = await call("POST", AGENT_FOLDERS_ROUTES.read, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      ...v9,
    });
    check(
      "an admin adds a host folder through the agent writer and reads it back",
      added.status === 200 &&
        field(added.body, "outcome") === "added" &&
        isDeepStrictEqual(field(readBack.body, "folders"), [{ path: app, found: true }]) &&
        isDeepStrictEqual(callsOf("updateAgentFolders").at(-1), [{ agentId: "agent-ada", additionalFolders: [app] }]),
      [summary(added), summary(readBack)],
    );
    const covered = await call("POST", AGENT_FOLDERS_ROUTES.add, {
      token: adaToken,
      json: { agentId: "agent-ada", path: build },
      ...v9,
    });
    const userData = await call("POST", AGENT_FOLDERS_ROUTES.add, {
      token: adaToken,
      json: { agentId: "agent-ada", path: join(root, "user-data") },
      ...v9,
    });
    const file = await call("POST", AGENT_FOLDERS_ROUTES.add, {
      token: adaToken,
      json: { agentId: "agent-ada", path: join(projects, "notes.txt") },
      ...v9,
    });
    check(
      "the host does not add a folder in an added folder, the app data, or a file, and writes nothing",
      field(covered.body, "outcome") === "covered" &&
        field(covered.body, "coverage", "reason") === "in-folder" &&
        field(userData.body, "refusal") === "protected" &&
        field(file.body, "refusal") === "missing" &&
        callsOf("updateAgentFolders").length === writes + 1,
      [summary(covered), summary(userData), summary(file)],
    );
    const excluded = await call("POST", AGENT_FOLDERS_ROUTES.exclude, {
      token: adaToken,
      json: { agentId: "agent-ada", path: build },
      ...v9,
    });
    const outside = await call("POST", AGENT_FOLDERS_ROUTES.exclude, {
      token: adaToken,
      json: { agentId: "agent-ada", path: projects },
      ...v9,
    });
    const included = await call("POST", AGENT_FOLDERS_ROUTES.include, {
      token: adaToken,
      json: { agentId: "agent-ada", path: build },
      ...v9,
    });
    check(
      "an admin excludes a folder in an added folder and includes it again; a folder outside is refused",
      field(excluded.body, "outcome") === "excluded" &&
        isDeepStrictEqual(field(excluded.body, "list", "excluded"), [build]) &&
        field(outside.body, "refusal") === "outside" &&
        field(included.body, "outcome") === "included" &&
        isDeepStrictEqual(field(included.body, "list", "excluded"), []),
      [summary(excluded), summary(outside), summary(included)],
    );
    const removed = await call("POST", AGENT_FOLDERS_ROUTES.remove, {
      token: adaToken,
      json: { agentId: "agent-ada", path: app },
      ...v9,
    });
    check(
      "an admin removes the added folder",
      field(removed.body, "outcome") === "removed" &&
        isDeepStrictEqual(field(removed.body, "list", "folders"), []) &&
        isDeepStrictEqual(callsOf("updateAgentFolders").at(-1), [{ agentId: "agent-ada", additionalFolders: [] }]),
      summary(removed),
    );
    const missing = await call("POST", AGENT_FOLDERS_ROUTES.read, {
      token: adaToken,
      json: { agentId: "agent-none" },
      ...v9,
    });
    const hidden = await call("POST", AGENT_FOLDERS_ROUTES.add, {
      token: adaToken,
      json: { agentId: "agent-pi", path: app },
      capabilities,
      protocol: 6,
    });
    check(
      "an unknown agent and an agent that the client protocol does not show get 404, and the host writes nothing",
      errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hidden, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("updateAgentFolders").length === writes + 4,
      [summary(missing), summary(hidden)],
    );
    const emptyPath = await call("POST", AGENT_FOLDERS_ROUTES.add, {
      token: adaToken,
      json: { agentId: "agent-ada", path: "" },
      ...v9,
    });
    check(
      "an empty folder path gets 400, and the host writes nothing",
      emptyPath.status === 400 && callsOf("updateAgentFolders").length === writes + 4,
      summary(emptyPath),
    );
  }

  // ---- Agent instructions (agent-instructions-v1) ----
  {
    const capabilities = [AGENT_INSTRUCTIONS_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const workspace = join(root, "workspaces", "agent-ada");
    mkdirSync(workspace, { recursive: true });
    const instructionsPath = join(workspace, "AGENTS.md");
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises agent-instructions-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(AGENT_INSTRUCTIONS_CAPABILITY) &&
        older.status === 200 &&
        !list(field(older.body, "capabilities")).includes(AGENT_INSTRUCTIONS_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", AGENT_INSTRUCTIONS_ROUTES.read, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      protocol: TEAM_PROTOCOL_V9,
    });
    check(
      "the instructions routes without the capability get 400 agentInstructionsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentInstructionsUnsupported")),
      summary(unsupported),
    );
    const memberRead = await call("POST", AGENT_INSTRUCTIONS_ROUTES.read, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      ...v9,
    });
    const memberSave = await call("POST", AGENT_INSTRUCTIONS_ROUTES.save, {
      token: bobToken,
      json: { agentId: "agent-ada", text: "# Member\n", expected: "" },
      ...v9,
    });
    check(
      "a member cannot read or save the instructions of an agent",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSave, 403, sourceText("error.team.adminRequired")) &&
        callsOf("instructionsSaving").length === 0 &&
        !existsSync(instructionsPath),
      [summary(memberRead), summary(memberSave)],
    );
    const empty = await call("POST", AGENT_INSTRUCTIONS_ROUTES.read, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      ...v9,
    });
    check(
      "an admin reads an instruction file that does not exist yet",
      empty.status === 200 && isDeepStrictEqual(empty.body, { fileName: "AGENTS.md", exists: false, text: "" }),
      summary(empty),
    );
    const saved = await call("POST", AGENT_INSTRUCTIONS_ROUTES.save, {
      token: adaToken,
      json: { agentId: "agent-ada", text: "# Ada\nAnswer in Polish.\n", expected: "" },
      ...v9,
    });
    const readBack = await call("POST", AGENT_INSTRUCTIONS_ROUTES.read, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      ...v9,
    });
    const file = { fileName: "AGENTS.md", exists: true, text: "# Ada\nAnswer in Polish.\n" };
    check(
      "an admin saves the file, the host writes it in the workspace, and a read gives the new text",
      saved.status === 200 &&
        isDeepStrictEqual(saved.body, file) &&
        isDeepStrictEqual(readBack.body, file) &&
        readFileSync(instructionsPath, "utf8") === file.text &&
        isDeepStrictEqual(callsOf("instructionsSaved"), [["agent-ada", true]]),
      [summary(saved), summary(readBack)],
    );
    const stale = await call("POST", AGENT_INSTRUCTIONS_ROUTES.save, {
      token: adaToken,
      json: { agentId: "agent-ada", text: "# Stale\n", expected: "" },
      ...v9,
    });
    check(
      "a save from a text that changed gets 409 with the host's sentence, and the file stays",
      errorIs(stale, 409, sourceText("error.agent.instructionsChanged")) &&
        readFileSync(instructionsPath, "utf8") === file.text,
      summary(stale),
    );
    const tooLong = await call("POST", AGENT_INSTRUCTIONS_ROUTES.save, {
      token: adaToken,
      json: { agentId: "agent-ada", text: "x".repeat(32_001), expected: file.text },
      ...v9,
    });
    check(
      "a text longer than the editor saves gets 400, and the file stays",
      tooLong.status === 400 && readFileSync(instructionsPath, "utf8") === file.text,
      summary(tooLong),
    );
    const missing = await call("POST", AGENT_INSTRUCTIONS_ROUTES.read, {
      token: adaToken,
      json: { agentId: "agent-none" },
      ...v9,
    });
    const hidden = await call("POST", AGENT_INSTRUCTIONS_ROUTES.read, {
      token: adaToken,
      json: { agentId: "agent-pi" },
      capabilities,
      protocol: 6,
    });
    check(
      "an unknown agent and an agent that the client protocol does not show get 404",
      errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hidden, 404, sourceText("error.team.agentNotFound")),
      [summary(missing), summary(hidden)],
    );
  }

  // ---- Exact agent colours (agent-colors-v1) ----
  {
    const colorCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, AGENT_COLORS_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises agent-colors-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(AGENT_COLORS_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(AGENT_COLORS_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", AGENT_COLORS_ROUTES.read, { token: bobToken, json: {} });
    check(
      "the colour routes without the capability get 400 agentColorsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentColorsUnsupported")),
      summary(unsupported),
    );
    const empty = await call("POST", AGENT_COLORS_ROUTES.read, {
      token: bobToken,
      json: {},
      capabilities: colorCapabilities,
    });
    check(
      "a member reads an empty list when no agent has a colour",
      empty.status === 200 && isDeepStrictEqual(empty.body, { agents: [] }),
      summary(empty),
    );
    const writes = callsOf("updateAgentColor").length;
    const upperCase = await call("POST", AGENT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", color: "#A1B2C3" },
      capabilities: colorCapabilities,
    });
    const extraField = await call("POST", AGENT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", color: "#a1b2c3", avatarHue: 10 },
      capabilities: colorCapabilities,
    });
    const notShown = await call("POST", AGENT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-pi", color: "#a1b2c3" },
      capabilities: colorCapabilities,
      protocol: 6,
    });
    check(
      "a colour that is not lower-case #rrggbb, an unknown field, or an agent that the protocol does not show is refused, and nothing is written",
      upperCase.status === 400 &&
        extraField.status === 400 &&
        errorIs(notShown, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("updateAgentColor").length === writes,
      [summary(upperCase), summary(extraField), summary(notShown)],
    );
    const set = await call("POST", AGENT_COLORS_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-pi", color: "#a1b2c3" },
      capabilities: colorCapabilities,
    });
    const readBack = await call("POST", AGENT_COLORS_ROUTES.read, {
      token: adaToken,
      json: {},
      capabilities: colorCapabilities,
    });
    const readV6 = await call("POST", AGENT_COLORS_ROUTES.read, {
      token: adaToken,
      json: {},
      capabilities: colorCapabilities,
      protocol: 6,
    });
    const expected = { agents: [{ agentId: "agent-pi", color: "#a1b2c3" }] };
    check(
      "a member with manage access sets a colour through the agent writer, and the read leaves out an agent that the protocol does not show",
      set.status === 200 &&
        isDeepStrictEqual(set.body, expected) &&
        isDeepStrictEqual(readBack.body, expected) &&
        isDeepStrictEqual(callsOf("updateAgentColor").at(-1), [{ agentId: "agent-pi", avatarColor: "#a1b2c3" }]) &&
        readV6.status === 200 &&
        isDeepStrictEqual(readV6.body, { agents: [] }),
      [summary(set), summary(readBack), summary(readV6)],
    );
    const removed = await call("POST", AGENT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-pi", color: null },
      capabilities: colorCapabilities,
    });
    check(
      "a null colour removes the colour",
      removed.status === 200 &&
        isDeepStrictEqual(removed.body, { agents: [] }) &&
        isDeepStrictEqual(callsOf("updateAgentColor").at(-1), [{ agentId: "agent-pi", avatarColor: null }]),
      summary(removed),
    );
  }

  // ---- Agent chat colours (chat-colors-v1) ----
  {
    const chatCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, CHAT_COLORS_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises chat-colors-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(CHAT_COLORS_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(CHAT_COLORS_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const writes = callsOf("updateAgentChatColor").length;
    const unsupportedRead = await call("POST", CHAT_COLORS_ROUTES.read, { token: bobToken, json: {} });
    const unsupportedSet = await call("POST", CHAT_COLORS_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", color: "#a1b2c3" },
    });
    check(
      "the chat colour routes without the capability get 400 chatColorsUnsupported, and nothing is written",
      errorIs(unsupportedRead, 400, sourceText("error.team.chatColorsUnsupported")) &&
        errorIs(unsupportedSet, 400, sourceText("error.team.chatColorsUnsupported")) &&
        callsOf("updateAgentChatColor").length === writes,
      [summary(unsupportedRead), summary(unsupportedSet)],
    );
    const empty = await call("POST", CHAT_COLORS_ROUTES.read, {
      token: bobToken,
      json: {},
      capabilities: chatCapabilities,
    });
    check(
      "a member reads empty lists when no agent and no member has a chat colour",
      empty.status === 200 && isDeepStrictEqual(empty.body, { agents: [], members: [] }),
      summary(empty),
    );
    const upperCase = await call("POST", CHAT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", color: "#A1B2C3" },
      capabilities: chatCapabilities,
    });
    const extraField = await call("POST", CHAT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", color: "#a1b2c3", avatarColor: "#a1b2c3" },
      capabilities: chatCapabilities,
    });
    const notShown = await call("POST", CHAT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-pi", color: "#a1b2c3" },
      capabilities: chatCapabilities,
      protocol: 6,
    });
    check(
      "a chat colour that is not lower-case #rrggbb, an unknown field, or an agent that the protocol does not show is refused, and nothing is written",
      upperCase.status === 400 &&
        extraField.status === 400 &&
        errorIs(notShown, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("updateAgentChatColor").length === writes,
      [summary(upperCase), summary(extraField), summary(notShown)],
    );
    const set = await call("POST", CHAT_COLORS_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-pi", color: "#a1b2c3" },
      capabilities: chatCapabilities,
    });
    const readBack = await call("POST", CHAT_COLORS_ROUTES.read, {
      token: adaToken,
      json: {},
      capabilities: chatCapabilities,
    });
    const readV6 = await call("POST", CHAT_COLORS_ROUTES.read, {
      token: adaToken,
      json: {},
      capabilities: chatCapabilities,
      protocol: 6,
    });
    const expected = { agents: [{ agentId: "agent-pi", color: "#a1b2c3" }], members: [] };
    check(
      "a member with manage access sets a chat colour through the agent writer, the avatar colour does not change, and the read leaves out an agent that the protocol does not show",
      set.status === 200 &&
        isDeepStrictEqual(set.body, expected) &&
        isDeepStrictEqual(readBack.body, expected) &&
        isDeepStrictEqual(callsOf("updateAgentChatColor").at(-1), [{ agentId: "agent-pi", chatColor: "#a1b2c3" }]) &&
        agents.find((item) => item.id === "agent-pi")?.avatarColor === undefined &&
        readV6.status === 200 &&
        isDeepStrictEqual(readV6.body, { agents: [], members: [] }),
      [summary(set), summary(readBack), summary(readV6)],
    );
    const removed = await call("POST", CHAT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-pi", color: null },
      capabilities: chatCapabilities,
    });
    check(
      "a null chat colour removes the chat colour",
      removed.status === 200 &&
        isDeepStrictEqual(removed.body, { agents: [], members: [] }) &&
        isDeepStrictEqual(callsOf("updateAgentChatColor").at(-1), [{ agentId: "agent-pi", chatColor: null }]),
      summary(removed),
    );

    // The host sends the whole list when a socket declares the capability, and again after each change.
    const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
      TEAM_PROTOCOL_V1_WEBSOCKET,
      `openbot-token.${bobToken}`,
    ]);
    const events: unknown[] = [];
    const waiters = new Set<() => void>();
    socket.addEventListener("message", (message) => {
      const value = JSON.parse(String(message.data));
      if (isDynamicRecord(value) && value.type === "chat-colors-changed") {
        events.push(value);
        for (const wake of waiters) wake();
      }
    });
    await new Promise<void>((resolveOpen, reject) => {
      socket.addEventListener("open", () => resolveOpen(), { once: true });
      socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
    });
    /** Whether the socket has `count` chat colour events before the deadline. */
    const received = (count: number) =>
      new Promise<boolean>((resolveReceived) => {
        if (events.length >= count) return resolveReceived(true);
        const timer = setTimeout(() => {
          waiters.delete(wake);
          resolveReceived(false);
        }, 5_000);
        const wake = () => {
          if (events.length < count) return;
          clearTimeout(timer);
          waiters.delete(wake);
          resolveReceived(true);
        };
        waiters.add(wake);
      });
    socket.send(
      JSON.stringify({ type: "agent-event-scope", includeConversations: false, capabilities: chatCapabilities }),
    );
    const declared = await received(1);
    await call("POST", CHAT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", color: "#0a0b0c" },
      capabilities: chatCapabilities,
    });
    const changed = await received(2);
    socket.close();
    await call("POST", CHAT_COLORS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", color: null },
      capabilities: chatCapabilities,
    });
    check(
      "a socket gets the list when it declares chat-colors-v1, and the new list after a change",
      declared &&
        changed &&
        isDeepStrictEqual(events.slice(0, 2), [
          { type: "chat-colors-changed", agents: [], members: [] },
          { type: "chat-colors-changed", agents: [{ agentId: "agent-ada", color: "#0a0b0c" }], members: [] },
        ]),
      events,
    );
  }

  // ---- Agent new chats (agent-new-chat-v1) ----
  {
    const newChatCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, AGENT_NEW_CHAT_CAPABILITY];
    const writes = callsOf("updateAgent").length;
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises agent-new-chat-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(AGENT_NEW_CHAT_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(AGENT_NEW_CHAT_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const adminRead = await call("POST", AGENT_NEW_CHAT_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: newChatCapabilities,
    });
    check(
      "an admin reads the host default for an agent without its own choice",
      adminRead.status === 200 &&
        isDeepStrictEqual(adminRead.body, { allowNewChat: DEFAULT_AGENT_DEFAULTS.allowNewChat }),
      summary(adminRead),
    );
    const unsupported = await call("POST", AGENT_NEW_CHAT_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
    });
    check(
      "the new-chat routes without the capability get 400 agentSettingsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentSettingsUnsupported")),
      summary(unsupported),
    );
    const memberRead = await call("POST", AGENT_NEW_CHAT_ROUTES.settings, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities: newChatCapabilities,
    });
    const memberSet = await call("POST", AGENT_NEW_CHAT_ROUTES.update, {
      token: bobToken,
      json: { agentId: "agent-ada", allowNewChat: true },
      capabilities: newChatCapabilities,
    });
    const invalid = await call("POST", AGENT_NEW_CHAT_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", allowNewChat: null },
      capabilities: newChatCapabilities,
    });
    check(
      "a member cannot read or set new chats, a value that is not a boolean gets 400, and nothing is written",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        invalid.status === 400 &&
        callsOf("updateAgent").length === writes,
      [summary(memberRead), summary(memberSet), summary(invalid)],
    );
    const results: boolean[] = [];
    for (const allowNewChat of [true, false]) {
      const adminSet = await call("POST", AGENT_NEW_CHAT_ROUTES.update, {
        token: adaToken,
        json: { agentId: "agent-ada", allowNewChat },
        capabilities: newChatCapabilities,
      });
      const readBack = await call("POST", AGENT_NEW_CHAT_ROUTES.settings, {
        token: adaToken,
        json: { agentId: "agent-ada" },
        capabilities: newChatCapabilities,
      });
      results.push(
        adminSet.status === 200 &&
          isDeepStrictEqual(adminSet.body, { allowNewChat }) &&
          isDeepStrictEqual(readBack.body, { allowNewChat }) &&
          isDeepStrictEqual(callsOf("updateAgent").at(-1), [{ agentId: "agent-ada", allowNewChat }]),
      );
    }
    check(
      "an admin turns new chats on and off through the agent writer and reads each value back",
      results.every(Boolean),
      results,
    );
    const missing = await call("POST", AGENT_NEW_CHAT_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-none" },
      capabilities: newChatCapabilities,
    });
    const hiddenSet = await call("POST", AGENT_NEW_CHAT_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-pi", allowNewChat: true },
      capabilities: newChatCapabilities,
      protocol: 6,
    });
    check(
      "an unknown agent and an agent that the client protocol does not show get 404",
      errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hiddenSet, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("updateAgent").length === writes + 2,
      [summary(missing), summary(hiddenSet)],
    );
  }

  // ---- Plan card before long tasks (agent-plan-card-v1) ----
  {
    const planCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, AGENT_PLAN_CARD_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises agent-plan-card-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(AGENT_PLAN_CARD_CAPABILITY) &&
        older.status === 200 &&
        !list(field(older.body, "capabilities")).includes(AGENT_PLAN_CARD_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const writes = callsOf("updateAgent").length;
    const adminRead = await call("POST", AGENT_PLAN_CARD_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: planCapabilities,
    });
    check(
      "an admin reads the host default plan card setting of an agent without its own",
      adminRead.status === 200 &&
        isDeepStrictEqual(adminRead.body, { quickAcknowledgement: DEFAULT_AGENT_DEFAULTS.quickAcknowledgement }),
      summary(adminRead),
    );
    const unsupported = await call("POST", AGENT_PLAN_CARD_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
    });
    check(
      "the plan card routes without the capability get 400 agentSettingsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentSettingsUnsupported")),
      summary(unsupported),
    );
    const memberRead = await call("POST", AGENT_PLAN_CARD_ROUTES.settings, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities: planCapabilities,
    });
    const memberSet = await call("POST", AGENT_PLAN_CARD_ROUTES.update, {
      token: bobToken,
      json: { agentId: "agent-ada", quickAcknowledgement: true },
      capabilities: planCapabilities,
    });
    check(
      "a member cannot read or set the plan card",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        callsOf("updateAgent").length === writes,
      [summary(memberRead), summary(memberSet)],
    );
    const notBoolean = await call("POST", AGENT_PLAN_CARD_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", quickAcknowledgement: null },
      capabilities: planCapabilities,
    });
    check(
      "the host refuses a plan card value that is not a boolean, and writes nothing",
      notBoolean.status === 400 && callsOf("updateAgent").length === writes,
      summary(notBoolean),
    );
    const adminOn = await call("POST", AGENT_PLAN_CARD_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", quickAcknowledgement: true },
      capabilities: planCapabilities,
    });
    const readOn = await call("POST", AGENT_PLAN_CARD_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: planCapabilities,
    });
    check(
      "an admin turns on the plan card through the agent writer and reads it back",
      adminOn.status === 200 &&
        isDeepStrictEqual(adminOn.body, { quickAcknowledgement: true }) &&
        isDeepStrictEqual(readOn.body, { quickAcknowledgement: true }) &&
        isDeepStrictEqual(callsOf("updateAgent").at(-1), [{ agentId: "agent-ada", quickAcknowledgement: true }]),
      [summary(adminOn), summary(readOn)],
    );
    const adminOff = await call("POST", AGENT_PLAN_CARD_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-ada", quickAcknowledgement: false },
      capabilities: planCapabilities,
    });
    const missing = await call("POST", AGENT_PLAN_CARD_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-none" },
      capabilities: planCapabilities,
    });
    check(
      "an admin turns off the plan card, and an unknown agent gets 404",
      adminOff.status === 200 &&
        isDeepStrictEqual(adminOff.body, { quickAcknowledgement: false }) &&
        errorIs(missing, 404, sourceText("error.team.agentNotFound")),
      [summary(adminOff), summary(missing)],
    );
    const hiddenRead = await call("POST", AGENT_PLAN_CARD_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-pi" },
      capabilities: planCapabilities,
      protocol: 6,
    });
    const hiddenSet = await call("POST", AGENT_PLAN_CARD_ROUTES.update, {
      token: adaToken,
      json: { agentId: "agent-pi", quickAcknowledgement: true },
      capabilities: planCapabilities,
      protocol: 6,
    });
    check(
      "an admin cannot read or set the plan card of an agent that the client protocol does not show",
      errorIs(hiddenRead, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hiddenSet, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("updateAgent").length === writes + 2,
      [summary(hiddenRead), summary(hiddenSet)],
    );
  }

  // ---- Fast mode (agent-fast-mode-v1) ----
  {
    const fastCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, AGENT_FAST_MODE_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises agent-fast-mode-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(AGENT_FAST_MODE_CAPABILITY) &&
        older.status === 200 &&
        !list(field(older.body, "capabilities")).includes(AGENT_FAST_MODE_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const writes = callsOf("updateAgent").length;
    const unsupported = await call("POST", AGENT_FAST_MODE_ROUTES.settings, {
      token: bobToken,
      json: { agentId: "agent-ada" },
    });
    check(
      "the fast mode routes without the capability get 400 agentSettingsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentSettingsUnsupported")),
      summary(unsupported),
    );
    const models = await call("POST", AGENT_FAST_MODE_ROUTES.models, {
      token: bobToken,
      json: {},
      capabilities: fastCapabilities,
    });
    check(
      "a member reads only the models that have a fast tier, with the tier id",
      models.status === 200 &&
        isDeepStrictEqual(models.body, {
          models: [{ provider: "codex", id: "gpt-fast", fastServiceTier: "priority" }],
        }),
      summary(models),
    );
    const unset = await call("POST", AGENT_FAST_MODE_ROUTES.settings, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities: fastCapabilities,
    });
    check(
      "a member reads null for an agent whose fast mode was never set",
      unset.status === 200 && isDeepStrictEqual(unset.body, { fastMode: null }),
      summary(unset),
    );
    const notBoolean = await call("POST", AGENT_FAST_MODE_ROUTES.update, {
      token: bobToken,
      json: { agentId: "agent-ada", fastMode: null },
      capabilities: fastCapabilities,
    });
    check(
      "the host refuses a fast mode value that is not a boolean, and writes nothing",
      notBoolean.status === 400 && callsOf("updateAgent").length === writes,
      summary(notBoolean),
    );
    const memberOn = await call("POST", AGENT_FAST_MODE_ROUTES.update, {
      token: bobToken,
      json: { agentId: "agent-ada", fastMode: true },
      capabilities: fastCapabilities,
    });
    const readOn = await call("POST", AGENT_FAST_MODE_ROUTES.settings, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: fastCapabilities,
    });
    check(
      "a member turns on fast mode through the agent writer, and an admin reads it back",
      memberOn.status === 200 &&
        isDeepStrictEqual(memberOn.body, { fastMode: true }) &&
        isDeepStrictEqual(readOn.body, { fastMode: true }) &&
        isDeepStrictEqual(callsOf("updateAgent").at(-1), [{ agentId: "agent-ada", fastMode: true }]),
      [summary(memberOn), summary(readOn)],
    );
    const memberOff = await call("POST", AGENT_FAST_MODE_ROUTES.update, {
      token: bobToken,
      json: { agentId: "agent-ada", fastMode: false },
      capabilities: fastCapabilities,
    });
    const missing = await call("POST", AGENT_FAST_MODE_ROUTES.settings, {
      token: bobToken,
      json: { agentId: "agent-none" },
      capabilities: fastCapabilities,
    });
    check(
      "a member turns off fast mode, and an unknown agent gets 404",
      memberOff.status === 200 &&
        isDeepStrictEqual(memberOff.body, { fastMode: false }) &&
        errorIs(missing, 404, sourceText("error.team.agentNotFound")),
      [summary(memberOff), summary(missing)],
    );
    const hiddenSet = await call("POST", AGENT_FAST_MODE_ROUTES.update, {
      token: bobToken,
      json: { agentId: "agent-pi", fastMode: true },
      capabilities: fastCapabilities,
      protocol: 6,
    });
    check(
      "a member cannot set the fast mode of an agent that the client protocol does not show",
      errorIs(hiddenSet, 404, sourceText("error.team.agentNotFound")) && callsOf("updateAgent").length === writes + 2,
      summary(hiddenSet),
    );
  }

  // ---- Compact now (context-compact-v1) ----
  {
    const compactCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, CONTEXT_COMPACT_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises context-compact-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(CONTEXT_COMPACT_CAPABILITY) &&
        older.status === 200 &&
        !list(field(older.body, "capabilities")).includes(CONTEXT_COMPACT_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", CONTEXT_COMPACT_ROUTES.compact, {
      token: bobToken,
      json: { agentId: "agent-ada" },
    });
    check(
      "the compact routes without the capability get 400 contextCompactUnsupported, and compact nothing",
      errorIs(unsupported, 400, sourceText("error.team.contextCompactUnsupported")) &&
        callsOf("compactAgentContext").length === 0,
      summary(unsupported),
    );
    const chat = await call("POST", CONTEXT_COMPACT_ROUTES.compact, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities: compactCapabilities,
    });
    const task = await call("POST", CONTEXT_COMPACT_ROUTES.compactTask, {
      token: bobToken,
      json: { agentId: "agent-ada", taskId: "task-1" },
      capabilities: compactCapabilities,
    });
    check(
      "a member compacts the agent's chat and one of its tasks, with an empty answer",
      chat.status === 200 &&
        isDeepStrictEqual(chat.body, {}) &&
        task.status === 200 &&
        isDeepStrictEqual(task.body, {}) &&
        isDeepStrictEqual(callsOf("compactAgentContext"), [["agent-ada"]]) &&
        isDeepStrictEqual(callsOf("compactTaskContext"), [[{ agentId: "agent-ada", taskId: "task-1" }]]),
      [summary(chat), summary(task)],
    );
    const busy = await call("POST", CONTEXT_COMPACT_ROUTES.compactTask, {
      token: bobToken,
      json: { agentId: "agent-ada", taskId: "task-busy" },
      capabilities: compactCapabilities,
    });
    check(
      "a refused compaction gets 409 with the host's sentence",
      errorIs(busy, 409, sourceText("error.agent.waitBeforeCompactContext")),
      summary(busy),
    );
    const missing = await call("POST", CONTEXT_COMPACT_ROUTES.compact, {
      token: bobToken,
      json: { agentId: "agent-none" },
      capabilities: compactCapabilities,
    });
    const hidden = await call("POST", CONTEXT_COMPACT_ROUTES.compact, {
      token: bobToken,
      json: { agentId: "agent-pi" },
      capabilities: compactCapabilities,
      protocol: 6,
    });
    check(
      "an unknown agent, and an agent that the client protocol does not show, get 404 and compact nothing",
      errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hidden, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("compactAgentContext").length === 1,
      [summary(missing), summary(hidden)],
    );
  }

  // ---- Delete a message (message-delete-v1) ----
  {
    const deleteCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, MESSAGE_DELETE_CAPABILITY];
    const deletes = () => callsOf("deleteConversationMessage");
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises message-delete-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(MESSAGE_DELETE_CAPABILITY) &&
        older.status === 200 &&
        !list(field(older.body, "capabilities")).includes(MESSAGE_DELETE_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", MESSAGE_DELETE_ROUTES.agent, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: "message-1" },
    });
    check(
      "the delete routes without the capability get 400 messageDeleteUnsupported, and delete nothing",
      errorIs(unsupported, 400, sourceText("error.team.messageDeleteUnsupported")) && deletes().length === 0,
      summary(unsupported),
    );
    const chat = await call("POST", MESSAGE_DELETE_ROUTES.agent, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: "message-1" },
      capabilities: deleteCapabilities,
    });
    const task = await call("POST", MESSAGE_DELETE_ROUTES.task, {
      token: bobToken,
      json: { agentId: "agent-ada", taskId: "task-1", messageId: "message-2" },
      capabilities: deleteCapabilities,
    });
    check(
      "a member who manages the agent deletes any message of its chat and of one of its tasks, with an empty answer",
      chat.status === 200 &&
        isDeepStrictEqual(chat.body, {}) &&
        task.status === 200 &&
        isDeepStrictEqual(task.body, {}) &&
        isDeepStrictEqual(deletes(), [
          [
            { agentId: "agent-ada", messageId: "message-1" },
            { memberId: bobId, deleteAny: true },
          ],
          [
            { agentId: "agent-ada", taskId: "task-1", messageId: "message-2" },
            { memberId: bobId, deleteAny: true },
          ],
        ]),
      [summary(chat), summary(task), deletes()],
    );
    const busy = await call("POST", MESSAGE_DELETE_ROUTES.agent, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: "message-busy" },
      capabilities: deleteCapabilities,
    });
    const gone = await call("POST", MESSAGE_DELETE_ROUTES.task, {
      token: bobToken,
      json: { agentId: "agent-ada", taskId: "task-1", messageId: "message-gone" },
      capabilities: deleteCapabilities,
    });
    check(
      "a refused delete gets 409 for a running turn and 404 for a message that is not shown, with the host's sentence",
      errorIs(busy, 409, sourceText("error.backend.messageDeleteBusy")) &&
        errorIs(gone, 404, sourceText("error.backend.messageDeleteNotFound")),
      [summary(busy), summary(gone)],
    );
    accessLevels = { revision: 1, everyone: { "agent-ada": "chat" }, roles: [] };
    const before = deletes().length;
    const others = await call("POST", MESSAGE_DELETE_ROUTES.agent, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: "message-of-someone" },
      capabilities: deleteCapabilities,
    });
    const own = await call("POST", MESSAGE_DELETE_ROUTES.agent, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: `message-of-${bobId}` },
      capabilities: deleteCapabilities,
    });
    const admin = await call("POST", MESSAGE_DELETE_ROUTES.agent, {
      token: adaToken,
      json: { agentId: "agent-ada", messageId: "message-of-someone" },
      capabilities: deleteCapabilities,
    });
    check(
      "with chat on the agent, a member gets 403 for another message and deletes their own; an admin deletes any",
      errorIs(others, 403, sourceText("error.backend.messageDeleteForbidden")) &&
        own.status === 200 &&
        admin.status === 200 &&
        isDeepStrictEqual(deletes().slice(before), [
          [
            { agentId: "agent-ada", messageId: "message-of-someone" },
            { memberId: bobId, deleteAny: false },
          ],
          [
            { agentId: "agent-ada", messageId: `message-of-${bobId}` },
            { memberId: bobId, deleteAny: false },
          ],
          [
            { agentId: "agent-ada", messageId: "message-of-someone" },
            { memberId: adaId, deleteAny: true },
          ],
        ]),
      [summary(others), summary(own), summary(admin)],
    );
    accessLevels = { revision: 2, everyone: { "agent-ada": "view" }, roles: [] };
    const viewOnly = await call("POST", MESSAGE_DELETE_ROUTES.agent, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: `message-of-${bobId}` },
      capabilities: deleteCapabilities,
    });
    accessLevels = { revision: 3, everyone: {}, roles: [] };
    check(
      "a member who can only view the agent gets 403 agentViewOnly, and the host deletes nothing",
      errorIs(viewOnly, 403, sourceText("error.team.agentViewOnly")) && deletes().length === before + 3,
      summary(viewOnly),
    );
    const missing = await call("POST", MESSAGE_DELETE_ROUTES.agent, {
      token: bobToken,
      json: { agentId: "agent-none", messageId: "message-1" },
      capabilities: deleteCapabilities,
    });
    const hiddenAgent = await call("POST", MESSAGE_DELETE_ROUTES.task, {
      token: bobToken,
      json: { agentId: "agent-pi", taskId: "task-1", messageId: "message-1" },
      capabilities: deleteCapabilities,
      protocol: 6,
    });
    check(
      "an unknown agent, and an agent that the client protocol does not show, get 404 and delete nothing",
      errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        deletes().length === before + 3,
      [summary(missing), summary(hiddenAgent)],
    );
    // This host has no channel service, so the channel route answers as every channel route does.
    // `channel-notifications-e2e.ts` runs the real channel service.
    const channel = await call("POST", MESSAGE_DELETE_ROUTES.channel, {
      token: bobToken,
      json: { channelId: "channel-1", messageId: "message-1" },
      capabilities: [...deleteCapabilities, CHANNEL_CHATS_CAPABILITY],
    });
    check(
      "the channel delete route on a host without channels gets 400 channelsUnsupported",
      errorIs(channel, 400, sourceText("error.team.channelsUnsupported")),
      summary(channel),
    );
  }

  // ---- Mark unread from a message (conversation-unread-from-v1) ----
  {
    const unreadCapabilities = [AGENT_HIDDEN_CAPABILITY, CONVERSATION_UNREAD_FROM_CAPABILITY];
    const marks = () => callsOf("markConversationUnread");
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises conversation-unread-from-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(CONVERSATION_UNREAD_FROM_CAPABILITY) &&
        older.status === 200 &&
        !list(field(older.body, "capabilities")).includes(CONVERSATION_UNREAD_FROM_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", CONVERSATION_UNREAD_FROM_ROUTE, {
      token: bobToken,
      json: { agentId: "agent-ada", fromMessageId: "message-1" },
    });
    check(
      "the route without the capability gets 400 markUnreadUnsupported, and marks nothing",
      errorIs(unsupported, 400, sourceText("error.team.markUnreadUnsupported")) && marks().length === 0,
      summary(unsupported),
    );
    accessLevels = { revision: 4, everyone: { "agent-ada": "view" }, roles: [] };
    const viewer = await call("POST", CONVERSATION_UNREAD_FROM_ROUTE, {
      token: bobToken,
      json: { agentId: "agent-ada", fromMessageId: "message-1" },
      capabilities: unreadCapabilities,
    });
    accessLevels = { revision: 5, everyone: {}, roles: [] };
    check(
      "a member who can view the agent marks a message unread for themselves and gets the new read state, with the markers that their client does not show",
      viewer.status === 200 &&
        isDeepStrictEqual(viewer.body, {
          unreadCount: 2,
          firstUnreadMessageId: "message-1",
          throughMessageId: "before-message-1",
        }) &&
        isDeepStrictEqual(marks(), [
          [
            "agent-ada",
            bobId,
            "message-1",
            {
              excludeRoutineEvents: true,
              excludeRoutineRunEvents: true,
              excludeHostedSiteEvents: true,
              excludeRoutineQuietAnswers: true,
            },
          ],
        ]),
      [summary(viewer), marks()],
    );
    const gone = await call("POST", CONVERSATION_UNREAD_FROM_ROUTE, {
      token: bobToken,
      json: { agentId: "agent-ada", fromMessageId: "message-gone" },
      capabilities: unreadCapabilities,
    });
    const missing = await call("POST", CONVERSATION_UNREAD_FROM_ROUTE, {
      token: bobToken,
      json: { agentId: "agent-none", fromMessageId: "message-1" },
      capabilities: unreadCapabilities,
    });
    const hiddenAgent = await call("POST", CONVERSATION_UNREAD_FROM_ROUTE, {
      token: bobToken,
      json: { agentId: "agent-pi", fromMessageId: "message-1" },
      capabilities: unreadCapabilities,
      protocol: 6,
    });
    check(
      "a message the chat does not show, an unknown agent, and a hidden agent get 404 and mark nothing",
      errorIs(gone, 404, sourceText("error.backend.readBoundaryUnavailable")) &&
        errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        marks().length === 1,
      [summary(gone), summary(missing), summary(hiddenAgent)],
    );
    const malformed = await call("POST", CONVERSATION_UNREAD_FROM_ROUTE, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities: unreadCapabilities,
    });
    check(
      "a body without fromMessageId fails the wire codec and marks nothing",
      malformed.status === 400 && marks().length === 1,
      summary(malformed),
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

  // ---- Server key change (host-key-rotation-v1) ----
  {
    const capabilities = [HOST_KEY_ROTATION_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises host-key-rotation-v1 to a protocol 9 peer and not to a protocol 8 peer",
      list(field(compatibility.body, "capabilities")).includes(HOST_KEY_ROTATION_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(HOST_KEY_ROTATION_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", HOST_KEY_ROTATION_ROUTES.rotate, { token: owner.sessionToken, json: {} });
    check(
      "the server key route without the capability gets 400 hostKeyRotationUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.hostKeyRotationUnsupported")),
      summary(unsupported),
    );
    const adminRotate = await call("POST", HOST_KEY_ROTATION_ROUTES.rotate, {
      token: adaToken,
      json: {},
      capabilities,
    });
    const memberRotate = await call("POST", HOST_KEY_ROTATION_ROUTES.rotate, {
      token: bobToken,
      json: {},
      capabilities,
    });
    check(
      "an admin and a member cannot change the server key, and the host does not start a change",
      errorIs(adminRotate, 403, sourceText("error.team.ownerRequired")) &&
        errorIs(memberRotate, 403, sourceText("error.team.ownerRequired")) &&
        callsOf("rotateHostKey").length === 0,
      [summary(adminRotate), summary(memberRotate)],
    );
    const ownerRotate = await call("POST", HOST_KEY_ROTATION_ROUTES.rotate, {
      token: owner.sessionToken,
      json: {},
      capabilities,
    });
    check(
      "the owner changes the server key and gets only the new public key",
      ownerRotate.status === 200 &&
        isDeepStrictEqual(ownerRotate.body, { publicKey: ROTATED_HOST_KEY }) &&
        callsOf("rotateHostKey").length === 1,
      summary(ownerRotate),
    );
    refuseHostKeyRotation = true;
    const refusedRotate = await call("POST", HOST_KEY_ROTATION_ROUTES.rotate, {
      token: owner.sessionToken,
      json: {},
      capabilities,
    });
    refuseHostKeyRotation = false;
    check(
      "a refused key change gives the owner 409 with the reason, not a host fault",
      errorIs(refusedRotate, 409, sourceText("error.host.keyRotationRefused")),
      summary(refusedRotate),
    );
  }

  // ---- A reply in a side thread (agent-thread-replies-v1) ----
  {
    const capabilities = [AGENT_HIDDEN_CAPABILITY, AGENT_THREAD_REPLIES_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises agent-thread-replies-v1 to a protocol 9 peer and not to a protocol 8 peer",
      list(field(compatibility.body, "capabilities")).includes(AGENT_THREAD_REPLIES_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(AGENT_THREAD_REPLIES_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const reply = {
      agentId: "agent-ada",
      taskId: "task-1",
      text: "About this answer",
      attachmentDraftIds: [],
      replyToMessageId: "message-7",
      clientMessageId: "client-1",
    };
    const unsupported = await call("POST", AGENT_THREAD_REPLIES_ROUTES.send, { token: bobToken, json: reply });
    check(
      "the reply route without the capability gets 400 threadRemoteUnsupported, and sends nothing",
      errorIs(unsupported, 400, sourceText("error.backend.threadRemoteUnsupported")) &&
        callsOf("sendTaskMessage").length === 0,
      summary(unsupported),
    );
    const sent = await call("POST", AGENT_THREAD_REPLIES_ROUTES.send, { token: bobToken, json: reply, capabilities });
    const [sentInput, sentSender] = callsOf("sendTaskMessage")[0] ?? [];
    check(
      "a member sends a reply to a side thread: the host gets the task, the reply target and the member, and answers the receipt",
      sent.status === 202 &&
        field(sent.body, "messageId") === "message-reply" &&
        isDeepStrictEqual(sentInput, reply) &&
        isDynamicRecord(sentSender) &&
        sentSender.id === bobId,
      [summary(sent), callsOf("sendTaskMessage")],
    );
    const extra = await call("POST", AGENT_THREAD_REPLIES_ROUTES.send, {
      token: bobToken,
      json: { ...reply, voiceRecordingDraftId: "voice-1" },
      capabilities,
    });
    const empty = await call("POST", AGENT_THREAD_REPLIES_ROUTES.send, {
      token: bobToken,
      json: { ...reply, text: " " },
      capabilities,
    });
    const noTarget = await call("POST", AGENT_THREAD_REPLIES_ROUTES.send, {
      token: bobToken,
      json: { ...reply, replyToMessageId: "" },
      capabilities,
    });
    check(
      "the frozen codec refuses an unknown field, a reply with no text and no file, and an empty reply target",
      extra.status === 400 &&
        empty.status === 400 &&
        noTarget.status === 400 &&
        callsOf("sendTaskMessage").length === 1,
      [summary(extra), summary(empty), summary(noTarget)],
    );
    const hidden = await call("POST", AGENT_THREAD_REPLIES_ROUTES.send, {
      token: bobToken,
      json: { ...reply, agentId: "agent-pi" },
      capabilities,
      protocol: 6,
    });
    const missing = await call("POST", AGENT_THREAD_REPLIES_ROUTES.send, {
      token: bobToken,
      json: { ...reply, agentId: "agent-none" },
      capabilities,
    });
    check(
      "an unknown agent, and an agent that the client protocol does not show, get 404 and send nothing",
      errorIs(hidden, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("sendTaskMessage").length === 1,
      [summary(hidden), summary(missing)],
    );
  }

  // ---- Servers on the host computer (local-servers-v1) ----
  {
    const capabilities = [LOCAL_SERVERS_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises local-servers-v1 to a protocol 9 peer and not to a protocol 8 peer",
      list(field(compatibility.body, "capabilities")).includes(LOCAL_SERVERS_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(LOCAL_SERVERS_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", LOCAL_SERVERS_ROUTES.list, { token: owner.sessionToken, json: {} });
    check(
      "the local servers route without the capability gets 400 localServersUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.localServersUnsupported")),
      summary(unsupported),
    );
    const adminCreate = await call("POST", LOCAL_SERVERS_ROUTES.create, {
      token: adaToken,
      json: { name: "Admin studio" },
      capabilities,
    });
    const memberList = await call("POST", LOCAL_SERVERS_ROUTES.list, { token: bobToken, json: {}, capabilities });
    check(
      "an admin and a member cannot list or create servers on the host computer",
      errorIs(adminCreate, 403, sourceText("error.team.ownerRequired")) &&
        errorIs(memberList, 403, sourceText("error.team.ownerRequired")) &&
        callsOf("createLocalServer").length === 0,
      [summary(adminCreate), summary(memberList)],
    );
    const shortName = await call("POST", LOCAL_SERVERS_ROUTES.create, {
      token: owner.sessionToken,
      json: { name: "Lab" },
      capabilities,
    });
    check(
      "a name that the server name check refuses gives the owner 409 with the reason",
      errorIs(
        shortName,
        409,
        sourceText("error.team.serverNameLength", { min: INPUT_LIMITS.serverNameMin, max: INPUT_LIMITS.serverName }),
      ) && callsOf("createLocalServer").length === 0,
      summary(shortName),
    );
    const ownerCreate = await call("POST", LOCAL_SERVERS_ROUTES.create, {
      token: owner.sessionToken,
      json: { name: "Design studio" },
      capabilities,
    });
    const ownerList = await call("POST", LOCAL_SERVERS_ROUTES.list, {
      token: owner.sessionToken,
      json: {},
      capabilities,
    });
    const created = { serverId: "local-server-1", name: "Design studio", published: true };
    check(
      "the owner creates a server on the host computer and then lists it with the limit",
      ownerCreate.status === 200 &&
        isDeepStrictEqual(ownerCreate.body, created) &&
        ownerList.status === 200 &&
        isDeepStrictEqual(ownerList.body, { servers: [created], limit: 5 }) &&
        isDeepStrictEqual(callsOf("createLocalServer"), [["Design studio"]]),
      [summary(ownerCreate), summary(ownerList)],
    );
    const memberDelete = await call("POST", LOCAL_SERVERS_ROUTES.delete, {
      token: bobToken,
      json: { serverId: created.serverId },
      capabilities,
    });
    const unknownDelete = await call("POST", LOCAL_SERVERS_ROUTES.delete, {
      token: owner.sessionToken,
      json: { serverId: "not-on-this-computer" },
      capabilities,
    });
    check(
      "a member cannot delete a server on the host computer, and a server that is not there gets 409",
      errorIs(memberDelete, 403, sourceText("error.team.ownerRequired")) &&
        errorIs(unknownDelete, 409, sourceText("error.remote.localServerNotFound")) &&
        callsOf("deleteLocalServer").length === 0,
      [summary(memberDelete), summary(unknownDelete)],
    );
    const ownerDelete = await call("POST", LOCAL_SERVERS_ROUTES.delete, {
      token: owner.sessionToken,
      json: { serverId: created.serverId },
      capabilities,
    });
    const afterDelete = await call("POST", LOCAL_SERVERS_ROUTES.list, {
      token: owner.sessionToken,
      json: {},
      capabilities,
    });
    check(
      "the owner deletes a server on the host computer, and the list no longer has it",
      ownerDelete.status === 200 &&
        isDeepStrictEqual(ownerDelete.body, {}) &&
        isDeepStrictEqual(afterDelete.body, { servers: [], limit: 5 }) &&
        isDeepStrictEqual(callsOf("deleteLocalServer"), [[created.serverId]]),
      [summary(ownerDelete), summary(afterDelete)],
    );
  }

  // ---- Agent notification levels (agent-notification-levels-v1) ----
  {
    const capabilities = [AGENT_NOTIFICATION_LEVELS_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    check(
      "the host advertises agent-notification-levels-v1 to a protocol 9 peer",
      list(field(compatibility.body, "capabilities")).includes(AGENT_NOTIFICATION_LEVELS_CAPABILITY) &&
        list(field(compatibility.body, "capabilities")).includes(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY),
      summary(compatibility),
    );
    // Protocols 7 and 8 read at most 128 capabilities, so their list leaves out the protocol 9 ones.
    for (const protocol of [7, 8]) {
      const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol });
      const names = list(field(older.body, "capabilities"));
      check(
        `a protocol ${protocol} peer gets at most 128 capabilities and none of protocol 9`,
        older.status === 200 &&
          names.length <= 128 &&
          !names.includes(AGENT_NOTIFICATION_LEVELS_CAPABILITY) &&
          !names.includes(TEAM_LONG_CAPABILITY_LISTS_CAPABILITY),
        `${names.length} capabilities`,
      );
    }
    const unsupported = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.read, { token: bobToken, json: {} });
    check(
      "the agent notification level routes without the capability get 400 agentNotificationLevelsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentNotificationLevelsUnsupported")),
      summary(unsupported),
    );
    const memberSet = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", level: "nothing" },
      capabilities,
    });
    const memberRead = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.read, {
      token: bobToken,
      json: {},
      capabilities,
    });
    const adminRead = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.read, {
      token: adaToken,
      json: {},
      capabilities,
    });
    check(
      "a member sets a level for an agent; it is the member's own, and another member does not see it",
      memberSet.status === 200 &&
        isDeepStrictEqual(memberSet.body, { server: null, agents: [{ agentId: "agent-ada", level: "nothing" }] }) &&
        isDeepStrictEqual(memberRead.body, memberSet.body) &&
        adminRead.status === 200 &&
        isDeepStrictEqual(adminRead.body, { server: null, agents: [] }),
      [summary(memberSet), summary(memberRead), summary(adminRead)],
    );
    const missing = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-none", level: "all" },
      capabilities,
    });
    const hiddenSet = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-pi", level: "all" },
      capabilities,
      protocol: 6,
    });
    const invalid = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", level: "loud" },
      capabilities,
    });
    check(
      "an unknown agent and an agent that the client protocol does not show get 404, and a wrong level gets 400",
      errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hiddenSet, 404, sourceText("error.team.agentNotFound")) &&
        invalid.status === 400,
      [summary(missing), summary(hiddenSet), summary(invalid)],
    );
    // The file has one entry: the member that chose a level. A restart reads it.
    const saved = JSON.parse(readFileSync(agentLevelsFile, "utf8"));
    const memberKeys = isDynamicRecord(saved) && isDynamicRecord(saved.members) ? Object.keys(saved.members) : [];
    const reloaded = new AgentNotificationLevelStore(agentLevelsFile);
    await runCauseEffect(reloaded.load());
    const reloadedLevels = memberKeys.map((key) => reloaded.snapshot(key));
    const cleared = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", level: null },
      capabilities,
    });
    check(
      "the host keeps the level after a restart, and a null level removes it",
      memberKeys.length === 1 &&
        isDeepStrictEqual(reloadedLevels, [{ server: null, agents: [{ agentId: "agent-ada", level: "nothing" }] }]) &&
        cleared.status === 200 &&
        isDeepStrictEqual(cleared.body, { server: null, agents: [] }),
      [summary(cleared), reloadedLevels],
    );
    // The member's level of the whole server: their own, kept after a restart, and removed with null.
    const serverSet = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.server, {
      token: bobToken,
      json: { level: "needs-me" },
      capabilities,
    });
    const adminServerRead = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.read, {
      token: adaToken,
      json: {},
      capabilities,
    });
    const serverInvalid = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.server, {
      token: bobToken,
      json: { level: "loud" },
      capabilities,
    });
    const serverReloaded = new AgentNotificationLevelStore(agentLevelsFile);
    await runCauseEffect(serverReloaded.load());
    const keptServerLevels = memberKeys.map((key) => serverReloaded.serverLevel(key));
    const serverCleared = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.server, {
      token: bobToken,
      json: { level: null },
      capabilities,
    });
    check(
      "a member sets their own server level, another member does not see it, a restart keeps it, and null removes it",
      serverSet.status === 200 &&
        isDeepStrictEqual(serverSet.body, { server: "needs-me", agents: [] }) &&
        isDeepStrictEqual(adminServerRead.body, { server: null, agents: [] }) &&
        serverInvalid.status === 400 &&
        isDeepStrictEqual(keptServerLevels, ["needs-me"]) &&
        isDeepStrictEqual(serverCleared.body, { server: null, agents: [] }),
      [summary(serverSet), summary(adminServerRead), summary(serverInvalid), keptServerLevels, summary(serverCleared)],
    );

    // Changes that a member makes at the same time all stay, as two fast clicks or a desktop and a phone
    // do: each one builds on the one saved before it.
    const together = await Promise.all([
      call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
        token: bobToken,
        json: { agentId: "agent-ada", level: "nothing" },
        capabilities,
      }),
      call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
        token: bobToken,
        json: { agentId: "agent-oc", level: "all" },
        capabilities,
      }),
      call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.server, {
        token: bobToken,
        json: { level: "needs-me" },
        capabilities,
      }),
    ]);
    const afterTogether = await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.read, {
      token: bobToken,
      json: {},
      capabilities,
    });
    const togetherAgents = isDynamicRecord(afterTogether.body)
      ? list(afterTogether.body.agents).toSorted((left, right) =>
          String(isDynamicRecord(left) ? left.agentId : "").localeCompare(
            String(isDynamicRecord(right) ? right.agentId : ""),
          ),
        )
      : [];
    check(
      "level changes that a member makes at the same time all stay",
      together.every((reply) => reply.status === 200) &&
        isDynamicRecord(afterTogether.body) &&
        afterTogether.body.server === "needs-me" &&
        isDeepStrictEqual(togetherAgents, [
          { agentId: "agent-ada", level: "nothing" },
          { agentId: "agent-oc", level: "all" },
        ]),
      [together.map(summary), summary(afterTogether)],
    );
    for (const agentId of ["agent-ada", "agent-oc"])
      await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
        token: bobToken,
        json: { agentId, level: null },
        capabilities,
      });
    await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.server, {
      token: bobToken,
      json: { level: null },
      capabilities,
    });

    // A change on one device reaches the other devices of the same member at once, and no other member.
    const openLevelsSocket = async (token: string) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
        TEAM_PROTOCOL_V1_WEBSOCKET,
        `openbot-token.${token}`,
      ]);
      const events: unknown[] = [];
      const waiters = new Set<() => void>();
      socket.addEventListener("message", (message) => {
        const value = JSON.parse(String(message.data));
        if (isDynamicRecord(value) && value.type === "agent-notification-levels-changed") {
          events.push(value);
          for (const wake of waiters) wake();
        }
      });
      await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener("open", () => resolveOpen(), { once: true });
        socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
      });
      socket.send(
        JSON.stringify({
          type: "agent-event-scope",
          includeConversations: false,
          capabilities: [AGENT_NOTIFICATION_LEVELS_CAPABILITY],
        }),
      );
      /** Whether a levels event came before the deadline. */
      const arrived = (deadlineMs: number) =>
        new Promise<boolean>((resolveArrived) => {
          if (events.length > 0) return resolveArrived(true);
          const timer = setTimeout(() => {
            waiters.delete(wake);
            resolveArrived(false);
          }, deadlineMs);
          const wake = () => {
            clearTimeout(timer);
            waiters.delete(wake);
            resolveArrived(true);
          };
          waiters.add(wake);
        });
      return { socket, events, arrived };
    };
    /**
     * Makes a change until the socket gets its event. The host reads the capabilities of the socket from
     * its first message, and no answer says that it did, so a change can come before it.
     */
    const changeUntilEvent = async (
      device: Awaited<ReturnType<typeof openLevelsSocket>>,
      change: () => Promise<unknown>,
    ) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await change();
        if (await device.arrived(5_000)) return true;
      }
      return false;
    };
    const bobOther = await openLevelsSocket(bobToken);
    const adaDevice = await openLevelsSocket(adaToken);
    const bobGot = await changeUntilEvent(bobOther, () =>
      call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.server, { token: bobToken, json: { level: "all" }, capabilities }),
    );
    // Ada's own change is her first event: an event of bob would have come before it on her socket.
    const adaGot = await changeUntilEvent(adaDevice, () =>
      call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
        token: adaToken,
        json: { agentId: "agent-ada", level: "needs-me" },
        capabilities,
      }),
    );
    const bobEvents = [...bobOther.events].slice(0, 1);
    const adaEvents = [...adaDevice.events].slice(0, 1);
    bobOther.socket.close();
    adaDevice.socket.close();
    await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.server, {
      token: bobToken,
      json: { level: null },
      capabilities,
    });
    await call("POST", AGENT_NOTIFICATION_LEVELS_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", level: null },
      capabilities,
    });
    check(
      "a change of a member's levels reaches the other devices of that member at once, and no other member",
      bobGot &&
        adaGot &&
        isDeepStrictEqual(bobEvents, [{ type: "agent-notification-levels-changed", server: "all", agents: [] }]) &&
        isDeepStrictEqual(adaEvents, [
          {
            type: "agent-notification-levels-changed",
            server: null,
            agents: [{ agentId: "agent-ada", level: "needs-me" }],
          },
        ]),
      [bobEvents, adaEvents],
    );
  }

  // ---- Pinned chats (sidebar-pins-v1) ----
  {
    const capabilities = [SIDEBAR_PINS_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises sidebar-pins-v1 to a protocol 9 peer and not to a protocol 8 peer",
      list(field(compatibility.body, "capabilities")).includes(SIDEBAR_PINS_CAPABILITY) &&
        older.status === 200 &&
        !list(field(older.body, "capabilities")).includes(SIDEBAR_PINS_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", SIDEBAR_PINS_ROUTES.read, { token: bobToken, json: {} });
    check(
      "the pinned chats routes without the capability get 400 sidebarPinsUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.sidebarPinsUnsupported")),
      summary(unsupported),
    );
    const first = await call("POST", SIDEBAR_PINS_ROUTES.read, { token: bobToken, json: {}, capabilities });
    const seeded = await call("POST", SIDEBAR_PINS_ROUTES.seed, {
      token: bobToken,
      json: {
        items: [
          { kind: "agent", id: "agent-ada" },
          { kind: "channel", id: "channel-plans" },
        ],
      },
      capabilities,
    });
    const seededAgain = await call("POST", SIDEBAR_PINS_ROUTES.seed, {
      token: bobToken,
      json: { items: [{ kind: "agent", id: "agent-oc" }] },
      capabilities,
    });
    check(
      "a member without pins reads an empty list with no time, and the first seed saves the pins of the device once",
      first.status === 200 &&
        isDeepStrictEqual(first.body, { items: [], updatedAt: null }) &&
        seeded.status === 200 &&
        isDynamicRecord(seeded.body) &&
        isDeepStrictEqual(seeded.body.items, [
          { kind: "agent", id: "agent-ada" },
          { kind: "channel", id: "channel-plans" },
        ]) &&
        typeof seeded.body.updatedAt === "string" &&
        isDeepStrictEqual(seededAgain.body, seeded.body),
      [summary(first), summary(seeded), summary(seededAgain)],
    );
    const replaced = await call("POST", SIDEBAR_PINS_ROUTES.set, {
      token: bobToken,
      json: {
        items: [
          { kind: "channel", id: "channel-plans" },
          { kind: "agent", id: "agent-oc" },
          { kind: "agent", id: "agent-pi" },
        ],
      },
      capabilities,
    });
    const adminRead = await call("POST", SIDEBAR_PINS_ROUTES.read, { token: adaToken, json: {}, capabilities });
    check(
      "a member replaces their pins in a new order, and another member does not see them",
      replaced.status === 200 &&
        isDynamicRecord(replaced.body) &&
        isDeepStrictEqual(replaced.body.items, [
          { kind: "channel", id: "channel-plans" },
          { kind: "agent", id: "agent-oc" },
          { kind: "agent", id: "agent-pi" },
        ]) &&
        isDeepStrictEqual(adminRead.body, { items: [], updatedAt: null }),
      [summary(replaced), summary(adminRead)],
    );
    // A protocol 6 peer does not see the Pi agent: the read leaves its pin out, and a save keeps it.
    const olderRead = await call("POST", SIDEBAR_PINS_ROUTES.read, {
      token: bobToken,
      json: {},
      capabilities,
      protocol: 6,
    });
    const olderSet = await call("POST", SIDEBAR_PINS_ROUTES.set, {
      token: bobToken,
      json: { items: [{ kind: "agent", id: "agent-oc" }] },
      capabilities,
      protocol: 6,
    });
    const afterOlder = await call("POST", SIDEBAR_PINS_ROUTES.read, { token: bobToken, json: {}, capabilities });
    check(
      "a peer that cannot see an agent does not read its pin, and its save keeps that pin",
      isDynamicRecord(olderRead.body) &&
        isDeepStrictEqual(olderRead.body.items, [
          { kind: "channel", id: "channel-plans" },
          { kind: "agent", id: "agent-oc" },
        ]) &&
        isDynamicRecord(olderSet.body) &&
        isDeepStrictEqual(olderSet.body.items, [{ kind: "agent", id: "agent-oc" }]) &&
        isDynamicRecord(afterOlder.body) &&
        isDeepStrictEqual(afterOlder.body.items, [
          { kind: "agent", id: "agent-oc" },
          { kind: "agent", id: "agent-pi" },
        ]),
      [summary(olderRead), summary(olderSet), summary(afterOlder)],
    );
    const invalid = await Promise.all(
      [
        {
          items: [
            { kind: "agent", id: "agent-oc" },
            { kind: "agent", id: "agent-oc" },
          ],
        },
        { items: [{ kind: "workflow", id: "workflow-1" }] },
        { items: [], extra: true },
        { items: [{ kind: "agent", id: "" }] },
      ].map((json) => call("POST", SIDEBAR_PINS_ROUTES.set, { token: bobToken, json, capabilities })),
    );
    const afterInvalid = await call("POST", SIDEBAR_PINS_ROUTES.read, { token: bobToken, json: {}, capabilities });
    check(
      "a duplicate pin, an unknown kind, an extra field and an empty id get 400 and change nothing",
      invalid.every((reply) => reply.status === 400) && isDeepStrictEqual(afterInvalid.body, afterOlder.body),
      [invalid.map(summary), summary(afterInvalid)],
    );
    // The file has one entry: the member that pinned. A restart reads it.
    const saved = JSON.parse(readFileSync(sidebarPinsFile, "utf8"));
    const pinKeys = isDynamicRecord(saved) && isDynamicRecord(saved.members) ? Object.keys(saved.members) : [];
    const reloaded = new SidebarPinStore(sidebarPinsFile);
    await runCauseEffect(reloaded.load());
    check(
      "the host keeps the pins after a restart",
      pinKeys.length === 1 &&
        isDeepStrictEqual(
          pinKeys.map((key) => reloaded.snapshot(key)),
          [afterOlder.body],
        ),
      pinKeys.map((key) => reloaded.snapshot(key)),
    );

    // A change on one device reaches the other devices of the same member at once, and no other member.
    const openPinsSocket = async (token: string) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
        TEAM_PROTOCOL_V1_WEBSOCKET,
        `openbot-token.${token}`,
      ]);
      const events: unknown[] = [];
      const waiters = new Set<() => void>();
      socket.addEventListener("message", (message) => {
        const value = JSON.parse(String(message.data));
        if (isDynamicRecord(value) && value.type === "sidebar-pins-changed") {
          events.push(value);
          for (const wake of waiters) wake();
        }
      });
      await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener("open", () => resolveOpen(), { once: true });
        socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
      });
      socket.send(JSON.stringify({ type: "agent-event-scope", includeConversations: false, capabilities }));
      const arrived = (deadlineMs: number) =>
        new Promise<boolean>((resolveArrived) => {
          if (events.length > 0) return resolveArrived(true);
          const timer = setTimeout(() => {
            waiters.delete(wake);
            resolveArrived(false);
          }, deadlineMs);
          const wake = () => {
            clearTimeout(timer);
            waiters.delete(wake);
            resolveArrived(true);
          };
          waiters.add(wake);
        });
      return { socket, events, arrived };
    };
    // The host reads the capabilities of the socket from its first message, and no answer says that it
    // did, so a change can come before it. Each attempt saves a different list, so each one is a change.
    const changeUntilEvent = async (
      device: Awaited<ReturnType<typeof openPinsSocket>>,
      token: string,
      lists: { kind: string; id: string }[][],
    ) => {
      for (const items of lists) {
        await call("POST", SIDEBAR_PINS_ROUTES.set, { token, json: { items }, capabilities });
        if (await device.arrived(5_000)) return items;
      }
      return null;
    };
    // A protocol 9 save replaces the pin of the Pi agent too, so the events below hold only what was sent.
    await call("POST", SIDEBAR_PINS_ROUTES.set, { token: bobToken, json: { items: [] }, capabilities });
    const bobOther = await openPinsSocket(bobToken);
    const adaDevice = await openPinsSocket(adaToken);
    // Channel pins: these sockets send no protocol capability, so the host leaves out the OpenCode agent.
    const bobLists = [
      [{ kind: "channel", id: "channel-bob-1" }],
      [{ kind: "channel", id: "channel-bob-2" }],
      [
        { kind: "channel", id: "channel-bob-1" },
        { kind: "channel", id: "channel-bob-2" },
      ],
    ];
    const bobSent = await changeUntilEvent(bobOther, bobToken, bobLists);
    const adaLists = [
      [{ kind: "channel", id: "channel-ada-1" }],
      [{ kind: "channel", id: "channel-ada-2" }],
      [
        { kind: "channel", id: "channel-ada-1" },
        { kind: "channel", id: "channel-ada-2" },
      ],
    ];
    const adaSent = await changeUntilEvent(adaDevice, adaToken, adaLists);
    const bobEvent = bobOther.events[0];
    const adaEvent = adaDevice.events[0];
    bobOther.socket.close();
    adaDevice.socket.close();
    check(
      "a change of a member's pins reaches the other devices of that member at once, and no other member",
      bobSent !== null &&
        adaSent !== null &&
        isDynamicRecord(bobEvent) &&
        // An event of an earlier attempt can come late, so the first event holds one of the sent lists.
        bobLists.some((items) => isDeepStrictEqual(bobEvent.items, items)) &&
        typeof bobEvent.updatedAt === "string" &&
        isDynamicRecord(adaEvent) &&
        // Ada's own change is her first event: an event of bob would have come before it on her socket.
        adaLists.some((items) => isDeepStrictEqual(adaEvent.items, items)),
      [bobEvent, adaEvent],
    );
  }

  // ---- A read mark change goes to the connections of its member only ----
  {
    const openInvalidationSocket = async (token: string) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
        TEAM_PROTOCOL_V1_WEBSOCKET,
        `openbot-token.${token}`,
      ]);
      const revisions: number[] = [];
      const waiters = new Set<() => void>();
      socket.addEventListener("message", (message) => {
        const value = JSON.parse(String(message.data));
        if (isDynamicRecord(value) && value.type === "conversation-invalidated" && typeof value.revision === "number") {
          revisions.push(value.revision);
          for (const wake of waiters) wake();
        }
      });
      await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener("open", () => resolveOpen(), { once: true });
        socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
      });
      /** Whether the socket has the revision before the deadline. */
      const arrived = (revision: number) =>
        new Promise<boolean>((resolveArrived) => {
          if (revisions.includes(revision)) return resolveArrived(true);
          const timer = setTimeout(() => {
            waiters.delete(wake);
            resolveArrived(false);
          }, 5_000);
          const wake = () => {
            if (!revisions.includes(revision)) return;
            clearTimeout(timer);
            waiters.delete(wake);
            resolveArrived(true);
          };
          waiters.add(wake);
        });
      return { socket, revisions, arrived };
    };
    const emit = (revision: number, memberId?: string) => {
      for (const listener of agentEventListeners)
        listener({ type: "conversation-invalidated", agentId: "agent-ada", revision }, memberId);
    };
    const adaDevice = await openInvalidationSocket(adaToken);
    const bobDevice = await openInvalidationSocket(bobToken);
    // The host adds a socket to its clients after the upgrade, so an event to all members shows when both are in.
    emit(90_500);
    const ready = (await adaDevice.arrived(90_500)) && (await bobDevice.arrived(90_500));
    emit(90_501, adaId);
    // An event to all members after it: bob's socket would have the member event before this one.
    emit(90_502);
    const after = (await adaDevice.arrived(90_502)) && (await bobDevice.arrived(90_502));
    adaDevice.socket.close();
    bobDevice.socket.close();
    check(
      "an invalidation for one member reaches the connections of that member, and no other member",
      ready &&
        after &&
        isDeepStrictEqual(adaDevice.revisions, [90_500, 90_501, 90_502]) &&
        isDeepStrictEqual(bobDevice.revisions, [90_500, 90_502]),
      { ada: adaDevice.revisions, bob: bobDevice.revisions },
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

  // ---- Custom agents (custom-agents-v1) ----
  {
    const v9 = { token: adaToken, capabilities: [CUSTOM_AGENTS_CAPABILITY], protocol: TEAM_PROTOCOL_V9 };
    const decoded = (route: string, reply: Reply) => CUSTOM_AGENTS_CODECS.get(route)?.response(200, reply.body);
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises custom-agents-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(CUSTOM_AGENTS_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(CUSTOM_AGENTS_CAPABILITY),
      [summary(compatibility), list(field(older.body, "capabilities")).length],
    );
    const goose = {
      id: "goose",
      name: "Goose",
      command: "goose",
      args: ["acp"],
      envNames: ["GOOSE_PROVIDER"],
      usagePrompt: null,
      resolvedCommand: "/usr/local/bin/goose",
    };
    const listed = await call("POST", CUSTOM_AGENTS_ROUTES.list, { ...v9, json: {} });
    check(
      "an admin lists the custom agents with the variable names only",
      listed.status === 200 &&
        isDeepStrictEqual(listed.body, [goose]) &&
        isDeepStrictEqual(decoded(CUSTOM_AGENTS_ROUTES.list, listed), [goose]),
      summary(listed),
    );
    const secret = "sk-custom-agent-secret";
    const saved = await call("POST", CUSTOM_AGENTS_ROUTES.save, {
      ...v9,
      json: {
        id: "cursor",
        name: "Cursor",
        command: "cursor-agent",
        args: ["acp"],
        env: [{ name: "CURSOR_API_KEY", value: secret }],
        usagePrompt: null,
      },
    });
    const cursor = {
      id: "cursor",
      name: "Cursor",
      command: "cursor-agent",
      args: ["acp"],
      envNames: ["CURSOR_API_KEY"],
      usagePrompt: null,
      resolvedCommand: null,
    };
    check(
      "an admin adds an agent: the value reaches the host, and the result names the variable only",
      saved.status === 200 &&
        isDeepStrictEqual(callsOf("saveCustomAgent"), [["cursor", [{ name: "CURSOR_API_KEY", value: secret }]]]) &&
        !JSON.stringify(saved.body).includes(secret) &&
        isDeepStrictEqual(decoded(CUSTOM_AGENTS_ROUTES.save, saved), {
          agents: [goose, cursor],
          restart: "not-running",
        }),
      summary(saved),
    );
    const unsupported = await call("POST", CUSTOM_AGENTS_ROUTES.list, {
      token: adaToken,
      json: {},
      protocol: TEAM_PROTOCOL_V9,
    });
    const member = await call("POST", CUSTOM_AGENTS_ROUTES.delete, { ...v9, token: bobToken, json: { id: "cursor" } });
    check(
      "the custom agent routes without the capability get 400 customAgentsUnavailable, and a member gets 403",
      errorIs(unsupported, 400, sourceText("error.provider.customAgentsUnavailable")) &&
        errorIs(member, 403, sourceText("error.team.adminRequired")),
      [summary(unsupported), summary(member)],
    );
    const deleted = await call("POST", CUSTOM_AGENTS_ROUTES.delete, { ...v9, json: { id: "cursor" } });
    check(
      "an admin removes an agent, and the result lists the one that stays",
      deleted.status === 200 &&
        isDeepStrictEqual(decoded(CUSTOM_AGENTS_ROUTES.delete, deleted), { agents: [goose], restart: "not-running" }),
      summary(deleted),
    );
  }

  // ---- Custom endpoint harness (custom-provider-harness-v1) ----
  {
    const harness = { token: adaToken, capabilities: [CUSTOM_PROVIDER_HARNESS_CAPABILITY] };
    const released = { token: adaToken, capabilities: [PROVIDERS_ADMIN_CAPABILITY] };
    const decoded = (route: string, reply: Reply) =>
      CUSTOM_PROVIDER_HARNESS_CODECS.get(route)?.response(200, reply.body);
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 7 });
    check(
      "the host advertises custom-provider-harness-v1",
      list(field(compatibility.body, "capabilities")).includes(CUSTOM_PROVIDER_HARNESS_CAPABILITY),
      summary(compatibility),
    );
    const spark = {
      id: "spark",
      name: "DGX Spark",
      baseUrl: "http://spark.local:8080/v1",
      hasApiKey: false,
      models: [{ id: "qwen3-coder", name: "Qwen3 Coder" }],
    };
    const listed = await call("POST", CUSTOM_PROVIDER_HARNESS_ROUTES.customList, { ...harness, json: {} });
    const releasedList = await call("POST", PROVIDERS_ADMIN_ROUTES.customList, { ...released, json: {} });
    check(
      "an admin lists the endpoint on Pi with its harness, and providers-v1 lists it as it did, without the harness",
      listed.status === 200 &&
        isDeepStrictEqual(listed.body, [{ ...spark, harness: "pi" }]) &&
        isDeepStrictEqual(decoded(CUSTOM_PROVIDER_HARNESS_ROUTES.customList, listed), [{ ...spark, harness: "pi" }]) &&
        isDeepStrictEqual(releasedList.body, [spark]),
      [summary(listed), summary(releasedList)],
    );
    const saved = await call("POST", CUSTOM_PROVIDER_HARNESS_ROUTES.customSave, {
      ...harness,
      json: {
        id: "studio",
        name: "Studio Local",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKey: null,
        models: [{ id: "gpt-oss", name: "GPT-OSS" }],
        headers: [],
        harness: "pi",
      },
    });
    const studio = {
      id: "studio",
      name: "Studio Local",
      baseUrl: "http://127.0.0.1:11434/v1",
      hasApiKey: false,
      models: [{ id: "gpt-oss", name: "GPT-OSS" }],
      harness: "opencode",
    };
    check(
      "a save names no harness: the host adds the endpoint on OpenCode, and the result names each harness",
      saved.status === 200 &&
        isDeepStrictEqual(callsOf("saveCustomProvider"), [["studio", undefined]]) &&
        isDeepStrictEqual(decoded(CUSTOM_PROVIDER_HARNESS_ROUTES.customSave, saved), {
          providers: [{ ...spark, harness: "pi" }, studio],
          restart: "not-running",
        }),
      summary(saved),
    );
    const unsupported = await call("POST", CUSTOM_PROVIDER_HARNESS_ROUTES.customList, { ...released, json: {} });
    const member = await call("POST", CUSTOM_PROVIDER_HARNESS_ROUTES.customDelete, {
      ...harness,
      token: bobToken,
      json: { id: "studio" },
    });
    check(
      "the harness routes without the capability get 400 providersUnsupported, and a member gets 403",
      errorIs(unsupported, 400, sourceText("error.team.providersUnsupported")) &&
        errorIs(member, 403, sourceText("error.team.adminRequired")),
      [summary(unsupported), summary(member)],
    );
    const deleted = await call("POST", CUSTOM_PROVIDER_HARNESS_ROUTES.customDelete, {
      ...harness,
      json: { id: "studio" },
    });
    check(
      "an admin removes the endpoint, and the result names the harness of the one that stays",
      deleted.status === 200 &&
        isDeepStrictEqual(decoded(CUSTOM_PROVIDER_HARNESS_ROUTES.customDelete, deleted), {
          providers: [{ ...spark, harness: "pi" }],
          restart: "not-running",
        }),
      summary(deleted),
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

  // ---- WhatsApp numbers on the host (whatsapp-connector-v1) ----
  {
    const v9 = { capabilities: [WHATSAPP_CONNECTOR_CAPABILITY], protocol: TEAM_PROTOCOL_V9 };
    const whatsappCalls = () => calls.filter((entry) => entry.method.startsWith("whatsapp."));
    /** The answer as the client reads it: the frozen codec, then the client's decoder. */
    const asClient = <T>(route: string, reply: Reply, decode: (value: unknown) => T): T => {
      const codec = WHATSAPP_CONNECTOR_CODECS.get(route);
      assert(codec, route);
      return decode(codec.response(reply.status, reply.body));
    };
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises whatsapp-connector-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(WHATSAPP_CONNECTOR_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(WHATSAPP_CONNECTOR_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", WHATSAPP_CONNECTOR_ROUTES.overview, {
      token: adaToken,
      json: {},
      protocol: TEAM_PROTOCOL_V9,
    });
    const memberOverview = await call("POST", WHATSAPP_CONNECTOR_ROUTES.overview, { token: bobToken, json: {}, ...v9 });
    const memberLink = await call("POST", WHATSAPP_CONNECTOR_ROUTES.linkStart, {
      token: bobToken,
      json: { method: "qr", phoneNumber: null, ownNumber: true },
      ...v9,
    });
    check(
      "a client without the capability gets 400, and a member cannot read or link the host's numbers",
      errorIs(unsupported, 400, sourceText("error.team.connectorsUnsupported")) &&
        errorIs(memberOverview, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberLink, 403, sourceText("error.team.adminRequired")) &&
        whatsappCalls().length === 0,
      [summary(unsupported), summary(memberOverview), summary(memberLink)],
    );
    const overview = await call("POST", WHATSAPP_CONNECTOR_ROUTES.overview, { token: adaToken, json: {}, ...v9 });
    const read = asClient(WHATSAPP_CONNECTOR_ROUTES.overview, overview, decodeHostWhatsAppOverview);
    check(
      "an admin reads the host's numbers, their senders and their pairing requests",
      overview.status === 200 &&
        read.connections.length === 1 &&
        read.connections[0]?.workspaceId === WHATSAPP_NUMBER &&
        read.connections[0]?.state === "connected" &&
        read.accounts[0]?.ownNumber === true &&
        read.accounts[0]?.pendingRequests[0]?.code === "K7Q2ZP",
      summary(overview),
    );
    const qr = await call("POST", WHATSAPP_CONNECTOR_ROUTES.linkStart, {
      token: adaToken,
      json: { method: "qr", phoneNumber: null, ownNumber: false },
      ...v9,
    });
    const badPhone = await call("POST", WHATSAPP_CONNECTOR_ROUTES.linkStart, {
      token: adaToken,
      json: { method: "code", phoneNumber: "not a number", ownNumber: true },
      ...v9,
    });
    const code = await call("POST", WHATSAPP_CONNECTOR_ROUTES.linkStart, {
      token: adaToken,
      json: { method: "code", phoneNumber: "+48 (600) 100-200", ownNumber: true },
      ...v9,
    });
    const qrState = asClient(WHATSAPP_CONNECTOR_ROUTES.linkStart, qr, decodeHostWhatsAppLinkState);
    const codeState = asClient(WHATSAPP_CONNECTOR_ROUTES.linkStart, code, decodeHostWhatsAppLinkState);
    check(
      "a link answers the host's QR code or pairing code; a phone number that is not one is refused before the host links",
      qrState.status === "waiting" &&
        qrState.qr?.startsWith("2@") === true &&
        codeState.code === "E2EPAIR1" &&
        badPhone.status === 400 &&
        isDeepStrictEqual(callsOf("whatsapp.startLink"), [
          [{ method: "qr", phoneNumber: null, ownNumber: false }],
          [{ method: "code", phoneNumber: WHATSAPP_NUMBER, ownNumber: true }],
        ]),
      [summary(qr), summary(badPhone), summary(code)],
    );
    whatsappLinkError = "timeout";
    const failed = await call("POST", WHATSAPP_CONNECTOR_ROUTES.linkState, { token: adaToken, json: {}, ...v9 });
    whatsappLinkError = null;
    const cancel = await call("POST", WHATSAPP_CONNECTOR_ROUTES.linkCancel, { token: adaToken, json: {}, ...v9 });
    const failedState = asClient(WHATSAPP_CONNECTOR_ROUTES.linkState, failed, decodeHostWhatsAppLinkState);
    // A later host can name a link error that this build does not know; the wire carries it as text.
    const laterState = asClient(
      WHATSAPP_CONNECTOR_ROUTES.linkState,
      { ...failed, body: isDynamicRecord(failed.body) ? { ...failed.body, error: "rate_limited" } : null },
      decodeHostWhatsAppLinkState,
    );
    check(
      "a failed link reads its error, a later host's unknown error reads as unavailable, and a cancel reaches the host",
      failedState.status === "failed" &&
        failedState.error === "timeout" &&
        laterState.error === "unavailable" &&
        cancel.status === 200 &&
        callsOf("whatsapp.cancelLink").length === 1,
      [summary(failed), summary(cancel)],
    );
    const addContact = await call("POST", WHATSAPP_CONNECTOR_ROUTES.senderAdd, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER, sender: { id: "+48 600 100 300", kind: "contact", name: " " } },
      ...v9,
    });
    const badGroup = await call("POST", WHATSAPP_CONNECTOR_ROUTES.senderAdd, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER, sender: { id: "family", kind: "group", name: "Family" } },
      ...v9,
    });
    const groups = await call("POST", WHATSAPP_CONNECTOR_ROUTES.groups, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER },
      ...v9,
    });
    const removeContact = await call("POST", WHATSAPP_CONNECTOR_ROUTES.senderRemove, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER, senderId: "48600100300" },
      ...v9,
    });
    check(
      "an admin adds a contact in digits, lists the groups and removes the contact; a group id that is not one is refused",
      addContact.status === 200 &&
        badGroup.status === 400 &&
        isDeepStrictEqual(callsOf("whatsapp.addSender"), [
          [WHATSAPP_NUMBER, { id: "48600100300", kind: "contact", name: "48600100300" }],
        ]) &&
        isDeepStrictEqual(field(groups.body, "groups"), [{ id: "120363000000000001@g.us", name: "Family" }]) &&
        removeContact.status === 200 &&
        whatsappAccount.allowedSenders.length === 0,
      [summary(addContact), summary(badGroup), summary(groups), summary(removeContact)],
    );
    const badCode = await call("POST", WHATSAPP_CONNECTOR_ROUTES.requestAnswer, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER, code: "??", approve: true },
      ...v9,
    });
    const answer = await call("POST", WHATSAPP_CONNECTOR_ROUTES.requestAnswer, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER, code: "k7q2zp", approve: true },
      ...v9,
    });
    const ownNumber = await call("POST", WHATSAPP_CONNECTOR_ROUTES.ownNumber, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER, ownNumber: false },
      ...v9,
    });
    const orchestrator = await call("POST", WHATSAPP_CONNECTOR_ROUTES.orchestrator, {
      token: adaToken,
      json: {},
      ...v9,
    });
    check(
      "an admin answers a pairing request, sets the number kind and adds the orchestrator on the host's default model",
      badCode.status === 400 &&
        answer.status === 200 &&
        isDeepStrictEqual(callsOf("whatsapp.answerRequest"), [[WHATSAPP_NUMBER, "K7Q2ZP", true]]) &&
        ownNumber.status === 200 &&
        whatsappAccount.ownNumber === false &&
        isDeepStrictEqual(orchestrator.body, {
          agentId: "agent-whatsapp-orchestrator",
          sectionId: "section-integrations",
        }) &&
        isDeepStrictEqual(callsOf("whatsapp.addOrchestrator"), [[{}]]),
      [summary(badCode), summary(answer), summary(ownNumber), summary(orchestrator)],
    );
    const pause = await call("POST", WHATSAPP_CONNECTOR_ROUTES.enabled, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER, enabled: false },
      ...v9,
    });
    const reconnect = await call("POST", WHATSAPP_CONNECTOR_ROUTES.reconnect, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER },
      ...v9,
    });
    const disconnect = await call("POST", WHATSAPP_CONNECTOR_ROUTES.disconnect, {
      token: adaToken,
      json: { workspaceId: WHATSAPP_NUMBER },
      ...v9,
    });
    check(
      "an admin pauses, reconnects and disconnects a number of the host",
      pause.status === 200 &&
        reconnect.status === 200 &&
        disconnect.status === 200 &&
        isDeepStrictEqual(callsOf("whatsapp.setEnabled"), [["whatsapp", WHATSAPP_NUMBER, false]]) &&
        isDeepStrictEqual(callsOf("whatsapp.reconnect"), [["whatsapp", WHATSAPP_NUMBER, false]]) &&
        isDeepStrictEqual(callsOf("whatsapp.disconnect"), [[WHATSAPP_NUMBER]]),
      [summary(pause), summary(reconnect), summary(disconnect)],
    );
  }

  // ---- Password managers on the host (password-managers-v1) ----
  {
    const v9 = { capabilities: [PASSWORD_MANAGERS_CAPABILITY], protocol: TEAM_PROTOCOL_V9 };
    const managerCalls = () => calls.filter((entry) => entry.method.startsWith("protonpass."));
    /** The answer as the client reads it: the frozen codec, then the client's decoder. */
    const asClient = <T>(route: string, reply: Reply, decode: (value: unknown) => T): T => {
      const codec = PASSWORD_MANAGERS_CODECS.get(route);
      assert(codec, route);
      return decode(codec.response(reply.status, reply.body));
    };
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises password-managers-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(PASSWORD_MANAGERS_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(PASSWORD_MANAGERS_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", PASSWORD_MANAGERS_ROUTES.list, {
      token: adaToken,
      json: {},
      protocol: TEAM_PROTOCOL_V9,
    });
    const memberList = await call("POST", PASSWORD_MANAGERS_ROUTES.list, { token: bobToken, json: {}, ...v9 });
    const memberConnect = await call("POST", PASSWORD_MANAGERS_ROUTES.connect, {
      token: bobToken,
      json: { manager: "protonpass", method: { kind: "key", key: PROTON_PASS_KEY } },
      ...v9,
    });
    check(
      "a client without the capability gets 400, and a member cannot read or connect the host's managers",
      errorIs(unsupported, 400, sourceText("error.team.connectorsUnsupported")) &&
        errorIs(memberList, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberConnect, 403, sourceText("error.team.adminRequired")) &&
        managerCalls().length === 0,
      [summary(unsupported), summary(memberList), summary(memberConnect)],
    );
    const listed = await call("POST", PASSWORD_MANAGERS_ROUTES.list, { token: adaToken, json: {}, ...v9 });
    const managers = asClient(PASSWORD_MANAGERS_ROUTES.list, listed, decodeHostPasswordManagerList);
    check(
      "an admin lists the host's managers with the methods that each one takes",
      isDeepStrictEqual(
        managers.map((status) => [status.manager, status.state, status.methods]),
        [["protonpass", "disconnected", ["browser", "key"]]],
      ),
      summary(listed),
    );
    const unknown = await call("POST", PASSWORD_MANAGERS_ROUTES.connect, {
      token: adaToken,
      json: { manager: "lastpass", method: { kind: "browser" } },
      ...v9,
    });
    const notRegistered = await call("POST", PASSWORD_MANAGERS_ROUTES.connect, {
      token: adaToken,
      json: { manager: "bitwarden", method: { kind: "browser" } },
      ...v9,
    });
    // A manager that offers only the browser sign-in refuses a pasted key.
    setProtonPass({ methods: ["browser"] });
    const noMethod = await call("POST", PASSWORD_MANAGERS_ROUTES.connect, {
      token: adaToken,
      json: { manager: "protonpass", method: { kind: "key", key: PROTON_PASS_KEY } },
      ...v9,
    });
    setProtonPass({ methods: ["browser", "key"] });
    check(
      "the host refuses an unknown manager, a manager that it does not run, and a method that the manager does not take",
      unknown.status === 400 &&
        notRegistered.status === 400 &&
        errorIs(noMethod, 400, sourceText("error.connector.passwordManagerMethod")) &&
        managerCalls().length === 0,
      [summary(unknown), summary(notRegistered), summary(noMethod)],
    );
    const browser = await call("POST", PASSWORD_MANAGERS_ROUTES.connect, {
      token: adaToken,
      json: { manager: "protonpass", method: { kind: "browser" } },
      ...v9,
    });
    const signingIn = asClient(PASSWORD_MANAGERS_ROUTES.connect, browser, decodeHostPasswordManagerStatus);
    const cancel = await call("POST", PASSWORD_MANAGERS_ROUTES.cancel, {
      token: adaToken,
      json: { manager: "protonpass" },
      ...v9,
    });
    const cancelled = asClient(PASSWORD_MANAGERS_ROUTES.cancel, cancel, decodeHostPasswordManagerStatus);
    check(
      "a browser sign-in answers the sign-in page on the manager's host, and cancel stops it",
      signingIn.state === "signing-in" &&
        signingIn.step === "browser" &&
        passwordManagers.signInPage("protonpass", signingIn) === PROTON_PASS_SIGN_IN &&
        passwordManagers.signInPage("protonpass", { ...signingIn, signInUrl: "https://evil.example/authorize" }) ===
          null &&
        cancelled.state === "disconnected" &&
        isDeepStrictEqual(callsOf("protonpass.connect"), [["browser", false]]) &&
        callsOf("protonpass.cancel").length === 1,
      [summary(browser), summary(cancel)],
    );
    const connect = await call("POST", PASSWORD_MANAGERS_ROUTES.connect, {
      token: adaToken,
      json: { manager: "protonpass", method: { kind: "key", key: PROTON_PASS_KEY } },
      ...v9,
    });
    const connected = asClient(PASSWORD_MANAGERS_ROUTES.connect, connect, decodeHostPasswordManagerStatus);
    const after = await call("POST", PASSWORD_MANAGERS_ROUTES.list, { token: adaToken, json: {}, ...v9 });
    check(
      "an admin connects with an access key; the key reaches the driver and no answer carries it",
      connected.state === "connected" &&
        isDeepStrictEqual(connected.vaultNames, ["Shared with OpenBot"]) &&
        isDeepStrictEqual(callsOf("protonpass.connect").at(-1), ["key", true]) &&
        !connect.text.includes(PROTON_PASS_KEY) &&
        !after.text.includes(PROTON_PASS_KEY) &&
        passwordManagers.routes().some((route) => route.prefix === "proton:" && route.vault.connected()),
      [summary(connect), summary(after)],
    );
    const disconnect = await call("POST", PASSWORD_MANAGERS_ROUTES.disconnect, {
      token: adaToken,
      json: { manager: "protonpass" },
      ...v9,
    });
    const disconnected = asClient(PASSWORD_MANAGERS_ROUTES.disconnect, disconnect, decodeHostPasswordManagerStatus);
    check(
      "disconnect stops the connection on the host",
      disconnected.state === "disconnected" &&
        callsOf("protonpass.disconnect").length === 1 &&
        !protonPassDriver.vault.connected(),
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
    const longQueue = Array.from({ length: 33 }, (_, index) => `delivery-${index + 1}`).toReversed();
    const reorderLong = await call("POST", TEAM_API_ROUTES.agent.queueReorder("agent-ada"), {
      token: bobToken,
      json: { deliveryIds: longQueue },
    });
    const reorderTooLong = await call("POST", TEAM_API_ROUTES.agent.queueReorder("agent-ada"), {
      token: bobToken,
      json: { deliveryIds: Array.from({ length: INPUT_LIMITS.queueReorder + 1 }, (_, index) => `delivery-${index}`) },
    });
    check(
      "reorder gives 204 with the new order, and a non-array order gets 400",
      reorder.status === 204 &&
        isDeepStrictEqual(callsOf("reorderQueue"), [
          [{ agentId: "agent-ada", deliveryIds: ["delivery-2", "delivery-1"] }],
          [{ agentId: "agent-ada", deliveryIds: longQueue }],
        ]) &&
        reorderBad.status === 400 &&
        reorderTooLong.status === 400,
      [summary(reorder), summary(reorderLong), summary(reorderBad), summary(reorderTooLong)],
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
