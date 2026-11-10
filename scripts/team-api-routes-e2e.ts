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
// where each routine runs (`routine-run-place-v1`) over stand-in routine records,
// a password that an admin saves from the secure card (`browser-secret-vault-v1`),
// a transfer file larger than one part, sent and read in parts (`instance-transfer-chunks-v1`),
// direct-message isolation, agents hidden from an older
// protocol, the queue routes, message delete (`message-delete-v1`) under the agent roles, the attachment and file routes with their size limits,
// a Grok Bot export sent in parts (`agent-import-v2`) to the real import service, and the error
// codes. Writes .openbot-build/team-api-routes-e2e/report.json.
// Run: `bun run test:team-api-routes` (the preload gives the server's import graph an `electron`).
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
  type AgentTask,
  type AttachmentDataInput,
  type BitwardenConnectorStatus,
  type CentralAuthUser,
  CHANNEL_CHATS_CAPABILITY,
  type ChannelRoutine,
  type ConversationMessage,
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
  type HermesImportPreview,
  type HiddenAgentsSnapshot,
  INSTANCE_TRANSFER_LIMITS,
  type PasswordManagerConnectMethod,
  type PasswordManagerStatus,
  type ProviderDetectionSettings,
  type QueueDelivery,
  type QueueSnapshot,
  type Routine,
  type RoutineResultConnectionOption,
  type RoutineResultDestination,
  type UpdateChannelRoutineInput,
  type UpdateRoutineInput,
  type VoiceLiveEvent,
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
import { AGENT_IMPORT_CAPABILITY, AGENT_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/agent-import-v1";
import {
  AGENT_IMPORT_V2_CAPABILITY,
  AGENT_IMPORT_V2_CHUNK_BYTES,
  AGENT_IMPORT_V2_ROUTES,
  agentImportV2ChunkPath,
} from "@openbot/contracts/team-protocol/agent-import-v2";
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
  AGENT_QUEUE_TASK_CAPABILITY,
  AGENT_QUEUE_TASK_ROUTES,
} from "@openbot/contracts/team-protocol/agent-queue-task-v1";
import {
  AGENT_TASK_LIMIT_CAPABILITY,
  AGENT_TASK_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import {
  AGENT_THREAD_PAGES_CAPABILITY,
  AGENT_THREAD_PAGES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-pages-v1";
import {
  AGENT_THREAD_QUEUE_CAPABILITY,
  AGENT_THREAD_QUEUE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-queue-v1";
import {
  AGENT_THREAD_REPLIES_CAPABILITY,
  AGENT_THREAD_REPLIES_ROUTES,
} from "@openbot/contracts/team-protocol/agent-thread-replies-v1";
import {
  AGENT_USAGE_LIMIT_CAPABILITY,
  AGENT_USAGE_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-usage-limit-v1";
import {
  AGENT_WAITS_CAPABILITY,
  AGENT_WAITS_REQUEST_TEXT_LIMIT,
  AGENT_WAITS_ROUTES,
} from "@openbot/contracts/team-protocol/agent-waits-v1";
import {
  BACKGROUND_PROCESS_COMMAND_LIMIT,
  BACKGROUND_PROCESSES_CAPABILITY,
  BACKGROUND_PROCESSES_ROUTES,
} from "@openbot/contracts/team-protocol/background-processes-v1";
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
  BROWSING_MEMORY_CAPABILITY,
  BROWSING_MEMORY_ROUTES,
} from "@openbot/contracts/team-protocol/browsing-memory-v1";
import {
  CHANNEL_PICTURE_CAPABILITY,
  CHANNEL_PICTURE_ROUTES,
} from "@openbot/contracts/team-protocol/channel-picture-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CHAT_COLORS_CAPABILITY, CHAT_COLORS_ROUTES } from "@openbot/contracts/team-protocol/chat-colors-v1";
import { CHAT_HISTORY_CAPABILITY, CHAT_HISTORY_ROUTES } from "@openbot/contracts/team-protocol/chat-history-v1";
import {
  CLAUDE_COMPACT_WINDOW_CAPABILITY,
  CLAUDE_COMPACT_WINDOW_CODECS,
  CLAUDE_COMPACT_WINDOW_ROUTES,
} from "@openbot/contracts/team-protocol/claude-compact-window-v1";
import {
  CLAUDE_USER_SETUP_CAPABILITY,
  CLAUDE_USER_SETUP_CODECS,
  CLAUDE_USER_SETUP_ROUTES,
} from "@openbot/contracts/team-protocol/claude-user-setup-v1";
import { CODEX_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/codex-api-key-v1";
import {
  CONTEXT_COMPACT_CAPABILITY,
  CONTEXT_COMPACT_ROUTES,
  ContextCompactRefusedError,
} from "@openbot/contracts/team-protocol/context-compact-v1";
import { ContextResetBusyError } from "@openbot/contracts/team-protocol/context-reset-v1";
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
  CUSTOM_PROVIDER_EDIT_CAPABILITY,
  CUSTOM_PROVIDER_EDIT_CODECS,
  CUSTOM_PROVIDER_EDIT_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-edit-v1";
import {
  CUSTOM_PROVIDER_HARNESS_CAPABILITY,
  CUSTOM_PROVIDER_HARNESS_CODECS,
  CUSTOM_PROVIDER_HARNESS_ROUTES,
} from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
import { HERMES_IMPORT_CAPABILITY, HERMES_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/hermes-import-v1";
import {
  HOST_KEY_ROTATION_CAPABILITY,
  HOST_KEY_ROTATION_ROUTES,
} from "@openbot/contracts/team-protocol/host-key-rotation-v1";
import {
  INSTANCE_TRANSFER_CHUNK_BYTES,
  INSTANCE_TRANSFER_CHUNKS_CAPABILITY,
  INSTANCE_TRANSFER_CHUNKS_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-chunks-v1";
import {
  INSTANCE_TRANSFER_CAPABILITY,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import {
  LIVE_VOICE_CAPABILITY,
  LIVE_VOICE_ROUTES,
  type LiveVoiceEvent,
  liveVoiceEvent,
} from "@openbot/contracts/team-protocol/live-voice-v1";
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
  PROVIDER_DETECTION_CAPABILITY,
  PROVIDER_DETECTION_ROUTES,
} from "@openbot/contracts/team-protocol/provider-detection-v1";
import {
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDER_USAGE_RESET_ROUTES,
} from "@openbot/contracts/team-protocol/provider-usage-reset-v1";
import {
  PROVIDER_USE_CAPABILITY,
  PROVIDER_USE_CODECS,
  PROVIDER_USE_ROUTES,
} from "@openbot/contracts/team-protocol/provider-use-v1";
import { PROVIDERS_ADMIN_CAPABILITY, PROVIDERS_ADMIN_ROUTES } from "@openbot/contracts/team-protocol/providers-v1";
import { PROVIDERS_V5_CAPABILITY, PROVIDERS_V5_ROUTES } from "@openbot/contracts/team-protocol/providers-v5";
import { PROVIDERS_V8_CAPABILITY, PROVIDERS_V8_ROUTES } from "@openbot/contracts/team-protocol/providers-v8";
import { QueueEditRejectedError, TEAM_QUEUE_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/queue-edit-v1";
import {
  ROUTINE_RESULTS_CAPABILITY,
  ROUTINE_RESULTS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-results-v1";
import {
  decodeRoutineRunCommandResponse,
  ROUTINE_RUN_COMMAND_CAPABILITY,
  ROUTINE_RUN_COMMAND_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-command-v1";
import {
  ROUTINE_RUN_PLACE_CAPABILITY,
  ROUTINE_RUN_PLACE_ROUTES,
} from "@openbot/contracts/team-protocol/routine-run-place-v1";
import { ROUTINES_ONCE_CAPABILITY, ROUTINES_ONCE_ROUTES } from "@openbot/contracts/team-protocol/routines-once-v1";
import { SIDE_QUESTION_CAPABILITY, SIDE_QUESTION_ROUTES } from "@openbot/contracts/team-protocol/side-question-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { SIDEBAR_PINS_CAPABILITY, SIDEBAR_PINS_ROUTES } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { SKILL_LEARNING_CAPABILITY, SKILL_LEARNING_ROUTES } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { STORAGE_DISK_CAPABILITY, STORAGE_DISK_ROUTES } from "@openbot/contracts/team-protocol/storage-disk-v1";
import {
  THREAD_MESSAGE_SEARCH_CAPABILITY,
  THREAD_MESSAGE_SEARCH_ROUTES,
} from "@openbot/contracts/team-protocol/thread-message-search-v1";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol/v1";
import { TEAM_LONG_CAPABILITY_LISTS_CAPABILITY, TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { VAULT_IMPORT_CAPABILITY, VAULT_IMPORT_ROUTES } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_CAPABILITY, VAULT_ROUTES } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY, VAULT_V2_ROUTES } from "@openbot/contracts/team-protocol/vault-v2";
import { VAULT_V3_CAPABILITY, VAULT_V3_ROUTES } from "@openbot/contracts/team-protocol/vault-v3";
import {
  WHATSAPP_CONNECTOR_CAPABILITY,
  WHATSAPP_CONNECTOR_CODECS,
  WHATSAPP_CONNECTOR_ROUTES,
} from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
import { parseTwoStepKey, twoStepCode } from "@openbot/contracts/two-step-code";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger } from "@openbot/logging";
import { RoutineInputError } from "@openbot/team-client/routine-schedule";
import { Effect } from "effect";
import { strToU8, unzipSync, zipSync } from "fflate";
import { SteerUnsupportedError } from "../src/backend/agent/queue-controls";
import { AgentLifecycleFailed } from "../src/backend/agent-service";
import { AgentWaitError } from "../src/backend/agent-waits/agent-wait-store";
import { BrowserProfileStore } from "../src/backend/browser-profiles/browser-profile-store";
import { BrowserProxyStore } from "../src/backend/browser-profiles/browser-proxy-store";
import type { BrowserTabSession } from "../src/backend/browser-state";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelService } from "../src/backend/channel-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { MessageDeleteRefused } from "../src/backend/message-delete";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { RoutineResultError } from "../src/backend/routine-results/routine-results";
import type { OwnedRoutineRecord } from "../src/backend/routine-store";
import { TeamChatStore } from "../src/backend/team-chat-store";
import type { AgentAccessState } from "../src/main/agent-access-store";
import { createAgentFolders } from "../src/main/agent-folders";
import { createAgentHostSettings } from "../src/main/agent-host-settings";
import { AgentImportService } from "../src/main/agent-import-service";
import { createAgentInstructionsFiles } from "../src/main/agent-instructions-files";
import { AgentNotificationLevelStore } from "../src/main/agent-notification-level-store";
import { type BitwardenCliRunner, BitwardenConnectorService } from "../src/main/bitwarden-connector-service";
import { BitwardenConnectorStore } from "../src/main/bitwarden-connector-store";
import { createBrowserProfileService } from "../src/main/browser-profile-service";
import { BrowsingMemoryPreferenceStore } from "../src/main/browsing-memory-preference-store";
import {
  claudeCompactWindowControl,
  createClaudeCompactWindowPreferenceStore,
} from "../src/main/claude-compact-window-preference-store";
import {
  claudeUserSetupControl,
  createClaudeUserSetupPreferenceStore,
} from "../src/main/claude-user-setup-preference-store";
import { createCustomProviderChanges } from "../src/main/custom-provider-changes";
import { CustomProviderStore } from "../src/main/custom-provider-store";
import {
  INSTANCE_TRANSFER_FORMAT,
  INSTANCE_TRANSFER_MANIFEST,
  INSTANCE_TRANSFER_VERSION,
} from "../src/main/instance-transfer-manifest";
import { MachineAlertMonitor, MachineAlertPreferenceStore } from "../src/main/machine-alerts";
import { MemoryReviewPreferenceStore } from "../src/main/memory-review-preference-store";
import type { PasswordManagerDriver } from "../src/main/password-managers/driver";
import { PasswordManagersService } from "../src/main/password-managers/password-managers-service";
import { downloadTransferInParts, uploadTransferInParts } from "../src/main/remote-instance-transfer-chunks";
import { RemoteRequestError } from "../src/main/remote-server-errors";
import { RemoteWorkflowError } from "../src/main/remote-service-effects";
import { SidebarPinStore } from "../src/main/sidebar-pin-store";
import { SkillLearningPreferenceStore } from "../src/main/skill-learning-preference-store";
import type {
  TeamApiAgentAccess,
  TeamApiAgents,
  TeamApiAgentTasks,
  TeamApiBrowser,
  TeamApiConnectors,
  TeamApiLiveVoice,
  TeamApiMailbox,
  TeamApiRoutineRunPlaces,
} from "../src/main/team-api/dependencies";
import { isPeerHiddenProvider } from "../src/main/team-api/provider-visibility";
import { WEBRTC_FRAME_BODY_BUDGET } from "../src/main/team-api/request-helpers";
import { TeamApiServer } from "../src/main/team-api-server";
import { TeamStore } from "../src/main/team-store";
import { VaultService } from "../src/main/vault-service";
import { VaultStore } from "../src/main/vault-store";
import { emptyInstanceTransferService } from "./instance-transfer-e2e-fixture";

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
  /** Another host of the same team store. The main host has no channels. */
  base?: string;
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
const transferUploads = join(root, "user-data", "instance-transfer-uploads");
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
// Where the host's scan looks: on, with no more addresses or folders.
let detectionSettings: ProviderDetectionSettings = { enabled: true, addresses: [], folders: [], hiddenIds: [] };
/** What the host's scan finds: one model server and one ACP agent command. */
const DETECTED_SERVER = {
  id: "ollama",
  name: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  models: [{ id: "llama3" }],
};
const DETECTED_AGENT = { id: "gemini", name: "Gemini CLI", command: "/usr/local/bin/gemini", args: ["--acp"] };
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
/** The profiles of the host's Hermes folder, as the host's reader answers them. */
const HERMES_PREVIEW = {
  token: "3f0c2a8e-5b1d-4c7e-9a2f-6d8b1e4c7a90",
  home: "~/.hermes",
  profiles: [
    {
      key: "default",
      name: "Hermes",
      path: "~/.hermes",
      model: "anthropic/claude-sonnet-4-5",
      agent: null,
      items: [
        { id: "instructions", kind: "instructions", status: "ready", names: [], count: 1, reason: null },
        { id: "mcp:github", kind: "mcpServer", status: "approve", names: ["github"], count: 1, reason: "mcpOff" },
        { id: "secrets", kind: "secrets", status: "skipped", names: ["OPENAI_API_KEY"], count: 1, reason: "secrets" },
      ],
    },
  ],
} satisfies HermesImportPreview;

const agents = [
  agent("agent-ada", "Ada", "claude", "claude-sonnet-4-5"),
  agent("agent-oc", "Oscar", "opencode", "anthropic/claude-sonnet-4-5"),
  agent("agent-pi", "Pia", "pi", "anthropic/claude-sonnet-4-5"),
];
// Only the transfer service lists this agent. Its workspace file makes an export of two parts.
const transferAgent = agent("agent-transfer", "Tess", "claude", "claude-sonnet-4-5");
mkdirSync(transferAgent.workspacePath, { recursive: true });
writeFileSync(join(transferAgent.workspacePath, "random.bin"), randomBytes(INSTANCE_TRANSFER_CHUNK_BYTES + 4096));

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
// Whether the fake host's Codex logged in with an OpenAI API key (`codex-api-key-v1`).
let codexOnKey = false;
// `provider-use-v1`: the providers that are off. An agent uses Claude, so the host refuses to turn it off.
const offProviders = new Set<string>();
const NO_STATUS: AgentStatus = {
  phase: "ready",
  cliVersion: null,
  auth: { kind: "unknown" },
  capabilities: { chat: "ready", browser: "unavailable", computerUse: "unavailable" },
  message: null,
  fullAccess: true,
};

/** The fake host's provider rows. The released status routes drop `apiKeyInUse` and `off`. */
function providerStatus(): AgentStatus {
  return {
    ...NO_STATUS,
    providers: (["codex", "claude", "grok"] as const).map((id) => ({
      id,
      state: "available" as const,
      version: null,
      message: null,
      ...(id === "codex" && codexOnKey ? { apiKeyInUse: true } : {}),
      ...(offProviders.has(id) ? { off: true } : {}),
    })),
  };
}

let hidden: HiddenAgentsSnapshot = { agents: [{ agentId: "agent-pi", hiddenAt: new Date(0).toISOString() }] };

// The host's agent event listener. Only a chat colour change (`chat-colors-v1`) sends an event in this run.
const agentEventListeners = new Set<(event: AgentEvent, memberId?: string) => void>();
// The roles of this host. Empty roles give every member `manage`, as a host without roles does; the
// message delete checks set "everyone" to a lower level for one agent.
let accessLevels: AgentAccessState = { revision: 0, everyone: {}, roles: [] };
/** The free disk space that the import service reads. Null: the disk does not say. */
let importFreeBytes: number | null = null;
/** The host's access listener. Only the live voice check sends a change in this run. */
const accessListeners = new Set<(serverId: string, state: AgentAccessState) => void>();
const agentAccess: TeamApiAgentAccess = {
  get: () => accessLevels,
  levels: () => accessLevels,
  subscribe: (listener) => {
    accessListeners.add(listener);
    return () => accessListeners.delete(listener);
  },
  set: unused("agentAccess.set"),
  copyAgent: unused("agentAccess.copyAgent"),
};

// The routine records of `agent-ada` for `routine-run-place-v1`: a schedule routine, a webhook routine
// and a `once` routine, all in the agent's chat. A save records its input and keeps the new place.
const routineRecordTimes = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z" };
let routineRecords: OwnedRoutineRecord[] = [
  {
    id: "routine-ada",
    ownerId: "agent-ada",
    name: "Morning report",
    instruction: "Report the overnight changes.",
    active: true,
    timezone: "Europe/Warsaw",
    limitPolicy: "wait",
    missedPolicy: "skip",
    runIn: "chat",
    trigger: {
      kind: "schedule",
      id: "trigger-ada",
      routineId: "routine-ada",
      schedule: { kind: "daily", time: "08:00" },
      nextRunAt: "2026-11-08T07:00:00.000Z",
      ...routineRecordTimes,
    },
    ...routineRecordTimes,
  },
  {
    id: "routine-hook",
    ownerId: "agent-ada",
    name: "Deploy watch",
    instruction: "Check each deploy.",
    active: true,
    timezone: "Europe/Warsaw",
    runIn: "chat",
    trigger: {
      kind: "webhook",
      routeId: "route-hook",
      url: "https://hooks.example.test/route-hook",
      eventType: "deploy",
      filters: [],
      ...routineRecordTimes,
    },
    ...routineRecordTimes,
  },
  {
    id: "routine-once",
    ownerId: "agent-ada",
    name: "Launch day check",
    instruction: "Check the launch.",
    active: true,
    timezone: "Europe/Warsaw",
    runIn: "chat",
    trigger: {
      kind: "schedule",
      id: "trigger-once",
      routineId: "routine-once",
      schedule: { kind: "once", date: "2026-12-01", time: "09:00" },
      nextRunAt: "2026-12-01T08:00:00.000Z",
      ...routineRecordTimes,
    },
    ...routineRecordTimes,
  },
];
// The routines of `channel-once` for `routines-once-v1`: a daily routine that the released channel
// routes show, and a `once` routine that only the new routes show.
let channelRoutineRecords: ChannelRoutine[] = [
  {
    id: "channel-routine-daily",
    channelId: "channel-once",
    name: "Daily status",
    instruction: "Post the status.",
    active: true,
    timezone: "Europe/Warsaw",
    trigger: {
      id: "trigger-channel-daily",
      routineId: "channel-routine-daily",
      schedule: { kind: "daily", time: "09:00" },
      nextRunAt: "2026-11-08T08:00:00.000Z",
      ...routineRecordTimes,
    },
    ...routineRecordTimes,
  },
  {
    id: "channel-routine-once",
    channelId: "channel-once",
    name: "Launch post",
    instruction: "Post the launch notes.",
    active: true,
    timezone: "Europe/Warsaw",
    trigger: {
      id: "trigger-channel-once",
      routineId: "channel-routine-once",
      schedule: { kind: "once", date: "2026-12-02", time: "10:00" },
      nextRunAt: "2026-12-02T09:00:00.000Z",
      ...routineRecordTimes,
    },
    ...routineRecordTimes,
  },
];

/** A schedule routine record as the routine API gives it. A webhook routine is not one. */
function agentRoutineOf(routine: OwnedRoutineRecord): Routine {
  if (routine.trigger.kind !== "schedule") throw new RoutineInputError(sourceText("error.backend.routineGone"));
  const { kind: _kind, ...trigger } = routine.trigger;
  const { ownerId, trigger: _record, ...fields } = routine;
  return { ...fields, agentId: ownerId, trigger };
}

/** The fields that a routine update sets. A field that the update leaves out keeps its value. */
function routineChanges(input: UpdateRoutineInput | UpdateChannelRoutineInput) {
  return {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.instruction === undefined ? {} : { instruction: input.instruction }),
    ...(input.active === undefined ? {} : { active: input.active }),
    ...(input.limitPolicy === undefined ? {} : { limitPolicy: input.limitPolicy }),
    ...(input.missedPolicy === undefined ? {} : { missedPolicy: input.missedPolicy }),
  };
}

const fakeRoutineRunPlaces: TeamApiRoutineRunPlaces = {
  list: (owner) => routineRecords.filter((routine) => routine.ownerId === owner.id),
  get: (owner, routineId) =>
    routineRecords.find((routine) => routine.ownerId === owner.id && routine.id === routineId) ?? null,
  save: (owner, routineId, input) => {
    record("saveRoutineRecord", owner, routineId, input);
    const current = routineRecords.find((routine) => routine.id === routineId);
    if (!current) throw new Error("No routine record to save.");
    const saved = { ...current, ...(input.runIn ? { runIn: input.runIn } : {}) };
    routineRecords = routineRecords.map((routine) => (routine.id === routineId ? saved : routine));
    return saved;
  },
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
  listWaits: (agentId) => {
    record("listWaits", agentId);
    return {
      agentId,
      waits: [
        {
          id: "wait-open",
          agentId,
          note: "Waits for the nightly build.",
          requestMessageId: "message-wait",
          // Longer than the contract carries, so the host must cut it.
          requestText: "r".repeat(AGENT_WAITS_REQUEST_TEXT_LIMIT + 50),
          routineId: null,
          createdAt: "2026-11-05T07:00:00.000Z",
          wokenAt: null,
          wakeDeliveryId: null,
        },
      ],
    };
  },
  cancelWait: (agentId, waitId) => {
    record("cancelWait", agentId, waitId);
    if (waitId !== "wait-open") throw new AgentWaitError(sourceText("error.backend.agentWaitGone"));
  },
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
  reorderQueue: (input) => {
    record("reorderQueue", input);
    // An order of a side thread that names a message that left its queue is stale.
    if (input.deliveryIds.includes("delivery-stale"))
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "reorderQueue",
          cause: new Error(sourceText("error.backend.queueOrderStale")),
        }),
      );
    return Effect.void;
  },
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
  resolveLocalWorkspaceFile: (agentId, path) =>
    Effect.sync(() => {
      record("resolveLocalWorkspaceFile", agentId, path);
      return {
        path: workspacePath,
        name: "notes.md",
        size: readFileSync(workspacePath).length,
        insideWorkspace: false,
      };
    }),
  deleteAgent: (agentId) => Effect.sync(() => record("deleteAgent", agentId)),
  // Only `agent-usage-limit-v1` reads the snapshot in this run: a usage limit holds Ada and the hidden Pi.
  getRuntimeSnapshot: () => ({
    agents: [],
    activeTurns: [],
    work: [],
    latestMessages: [],
    attentionComplete: true,
    pendingPrompts: [],
    pendingApprovals: [],
    pendingBrowserTakeovers: [],
    failedTurns: [],
    usageLimits: [
      { agentId: "agent-ada", resetsAt: 1_900_000_000 },
      { agentId: "agent-pi", resetsAt: null },
    ],
    usageLimitedModels: [
      { provider: "claude", model: "claude-sonnet-4-5" },
      { provider: "pi", model: "anthropic/claude-sonnet-4-5" },
    ],
    failedModels: [{ provider: "codex", model: "gpt-5", providerAccountId: "a0123456789abcdef" }],
  }),
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
  saveSkillSuggestion: (input) => {
    record("saveSkillSuggestion", input);
    return Effect.succeed({ saved: input.messageId === "suggestion-1" });
  },
  saveProfile: unused("saveProfile"),
  createAgent: unused("createAgent"),
  committedAgentDuplication: unused("committedAgentDuplication"),
  duplicateAgent: unused("duplicateAgent"),
  commitAgentDuplication: unused("commitAgentDuplication"),
  // Only an exact colour (`agent-colors-v1`), a chat colour (`chat-colors-v1`) or a move at a usage
  // limit (`agent-usage-limit-v1`) reaches this writer in this run. A chat colour change sends
  // `agents-changed`, as the agent service does.
  updateAgent: (input) =>
    Effect.sync(() => {
      record(
        input.leaveUsageLimit
          ? "updateAgentModel"
          : input.chatColor === undefined
            ? "updateAgentColor"
            : "updateAgentChatColor",
        input,
      );
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
  // The released routine routes and `routines-once-v1` read and write the schedule routine records.
  listRoutines: (agentId) =>
    routineRecords
      .filter((routine) => routine.ownerId === agentId && routine.trigger.kind === "schedule")
      .map(agentRoutineOf),
  createRoutine: (input) => {
    record("createRoutine", input);
    const { agentId, schedule, limitPolicy, missedPolicy, runIn, ...fields } = input;
    const id = `routine-new-${routineRecords.length + 1}`;
    const created: OwnedRoutineRecord = {
      id,
      ownerId: agentId,
      ...fields,
      limitPolicy: limitPolicy ?? "wait",
      missedPolicy: missedPolicy ?? "skip",
      runIn: runIn ?? "chat",
      trigger: {
        kind: "schedule",
        id: `trigger-${id}`,
        routineId: id,
        schedule,
        nextRunAt: "2026-12-05T09:00:00.000Z",
        ...routineRecordTimes,
      },
      ...routineRecordTimes,
    };
    routineRecords = [...routineRecords, created];
    return agentRoutineOf(created);
  },
  // A run place change (`routine-run-place-v1`), and each change of `routines-once-v1`.
  updateRoutine: (input, options) => {
    record("updateRoutine", input, options);
    const current = routineRecords.find(
      (routine) => routine.ownerId === input.agentId && routine.id === input.routineId,
    );
    if (current?.trigger.kind !== "schedule") throw new RoutineInputError(sourceText("error.backend.routineGone"));
    const saved: OwnedRoutineRecord = {
      ...current,
      ...routineChanges(input),
      ...(input.runIn ? { runIn: input.runIn } : {}),
      trigger: input.schedule ? { ...current.trigger, schedule: input.schedule } : current.trigger,
    };
    routineRecords = routineRecords.map((routine) => (routine.id === input.routineId ? saved : routine));
    return agentRoutineOf(saved);
  },
  deleteRoutine: unused("deleteRoutine"),
  testRoutine: unused("testRoutine"),
  listRoutineRuns: unused("listRoutineRuns"),
  listChannelMemories: unused("listChannelMemories"),
  createChannelMemory: unused("createChannelMemory"),
  updateChannelMemory: unused("updateChannelMemory"),
  deleteChannelMemory: unused("deleteChannelMemory"),
  clearChannelMemories: unused("clearChannelMemories"),
  listChannelRoutines: (channelId) => channelRoutineRecords.filter((routine) => routine.channelId === channelId),
  createChannelRoutine: (input) => {
    record("createChannelRoutine", input);
    const { channelId, schedule, limitPolicy, missedPolicy, ...fields } = input;
    const id = `channel-routine-new-${channelRoutineRecords.length + 1}`;
    const created: ChannelRoutine = {
      id,
      channelId,
      ...fields,
      limitPolicy: limitPolicy ?? "wait",
      missedPolicy: missedPolicy ?? "skip",
      trigger: {
        id: `trigger-${id}`,
        routineId: id,
        schedule,
        nextRunAt: "2026-12-06T09:00:00.000Z",
        ...routineRecordTimes,
      },
      ...routineRecordTimes,
    };
    channelRoutineRecords = [...channelRoutineRecords, created];
    return created;
  },
  updateChannelRoutine: (input) => {
    record("updateChannelRoutine", input);
    const current = channelRoutineRecords.find(
      (routine) => routine.channelId === input.channelId && routine.id === input.routineId,
    );
    if (!current) throw new RoutineInputError(sourceText("error.backend.routineGone"));
    const saved: ChannelRoutine = {
      ...current,
      ...routineChanges(input),
      trigger: input.schedule ? { ...current.trigger, schedule: input.schedule } : current.trigger,
    };
    channelRoutineRecords = channelRoutineRecords.map((routine) => (routine.id === input.routineId ? saved : routine));
    return saved;
  },
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
                // A memory review's skill question, for the skill-learning-v1 projection.
                ...(anchor.messageId === "skill-question"
                  ? { itemType: "skill-suggestion:create", skillSuggestion: { name: "Weekly report" } }
                  : {}),
              },
            ]
          : [],
      references: {},
      pageInfo: { hasOlder: false, olderCursor: null },
    });
  },
  // Ada has one hit in her own chat and one in her side thread `task-1`; Pi has one in his own chat.
  searchConversationMessages: (query, agentId, cursor, limit, includeSideThreads) => {
    record("searchConversationMessages", query, agentId, cursor, limit, includeSideThreads);
    const hit = (id: string): ConversationMessage => ({
      id,
      author: "assistant",
      text: `Found ${query}`,
      createdAt: "2026-11-05T08:00:00.000Z",
      status: "completed",
    });
    const results = [
      { agentId: "agent-ada", message: hit("hit-chat") },
      { agentId: "agent-ada", message: hit("hit-thread"), taskId: "task-1" },
      { agentId: "agent-pi", message: hit("hit-pi") },
    ].filter((result) => (includeSideThreads || !result.taskId) && (!agentId || result.agentId === agentId));
    return { results, total: results.length, nextCursor: null };
  },
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
  // `agent-oc` has work that runs, as the agent service answers it.
  deleteAgentHistory: (agentId) => {
    record("deleteAgentHistory", agentId);
    if (agentId === "agent-oc")
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "delete agent history",
          cause: new ContextResetBusyError(sourceText("error.agent.waitBeforeDeleteHistory")),
        }),
      );
    return Effect.succeed(undefined);
  },
  // This host has no channel service, so no channel route reaches these.
  clearChannelContext: unused("clearChannelContext"),
  compactChannelContext: unused("compactChannelContext"),
  deleteChannelHistory: unused("deleteChannelHistory"),
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

// Only a reply in a side thread (`agent-thread-replies-v1`) and a page of its older messages
// (`agent-thread-pages-v1`) reach the side threads in this run. The thread holds one message before
// `message-7`, and no other message.
// The thread list has one thread with a waiting message (`agent-thread-queue-v1`) and one without.
// With `longThreadQueue`, the waiting thread holds 20 messages of 100,000 characters: more than one
// WebRTC frame.
let longThreadQueue = false;
const fakeAgentTasks: TeamApiAgentTasks = {
  listAgents: () => agents,
  listTasks: (agentId) => {
    record("listTasks", agentId);
    const task = (id: string, queue: QueueDelivery[]): AgentTask => ({
      id,
      agentId,
      threadId: `thread-${id}`,
      origin: "user",
      title: id,
      state: queue.length > 0 ? "queued" : "idle",
      outcome: null,
      hold: null,
      activeTurnId: null,
      progress: null,
      error: null,
      queuedMessages: queue.map((delivery) => ({
        deliveryId: delivery.id,
        text: delivery.text,
        createdAt: delivery.createdAt,
      })),
      queue,
      createdAt: "2026-11-05T07:00:00.000Z",
      updatedAt: "2026-11-05T07:00:00.000Z",
      closedAt: null,
    });
    const waiting: QueueDelivery = {
      id: "delivery-thread",
      messageId: "message-thread",
      recipientAgentId: agentId,
      sender: { kind: "user" },
      text: "queued in a thread",
      replyToMessageId: null,
      status: "queued",
      position: 1,
      turnId: null,
      error: null,
      createdAt: new Date(0).toISOString(),
      attachments: [
        {
          id: "attachment-thread",
          name: "notes.txt",
          size: 12,
          kind: "file",
          mimeType: "text/plain",
          previewKind: "text",
          previewUrl: "openbot-attachment://attachment-thread",
        },
      ],
    };
    const queue = longThreadQueue
      ? Array.from({ length: 20 }, (_, index) => ({
          ...waiting,
          id: `delivery-long-${index}`,
          text: "x".repeat(100_000),
          position: index + 1,
        }))
      : [waiting];
    return { agentId, tasks: [task("task-queued", queue), task("task-idle", [])], limit: 10 };
  },
  readTask: unused("readTask"),
  readTaskPage: (input) => {
    record("readTaskPage", input);
    return {
      conversation: {
        agentId: input.agentId,
        threadId: `thread-${input.taskId}`,
        activeTurnId: null,
        revision: 3,
        messages:
          input.beforeMessageId === "message-7"
            ? [
                {
                  id: "message-older",
                  author: "assistant",
                  text: "Older reply",
                  createdAt: "2026-11-05T07:00:00.000Z",
                  status: "completed",
                },
              ]
            : [],
      },
      hasOlder: false,
    };
  },
  startTask: unused("startTask"),
  runQueuedMessageAsTask: (input) => {
    record("runQueuedMessageAsTask", input);
    if (input.deliveryId !== "delivery-1")
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "find queued message",
          cause: new Error(sourceText("error.backend.queuedMessageUnavailable")),
        }),
      );
    return Effect.succeed({
      id: "task-from-queue",
      agentId: input.agentId,
      threadId: "thread-task-from-queue",
      origin: "user",
      title: "queued text",
      state: "queued",
      outcome: null,
      hold: null,
      activeTurnId: null,
      progress: null,
      error: null,
      queuedMessages: [{ deliveryId: input.deliveryId, text: "queued text", createdAt: "2026-11-05T07:00:00.000Z" }],
      createdAt: "2026-11-05T07:00:00.000Z",
      updatedAt: "2026-11-05T07:00:00.000Z",
      closedAt: null,
    });
  },
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
/** A two-step setup key as a site shows it: grouped and in lower case. The host saves it in upper case. */
const VAULT_TWO_STEP_KEY = "e2ev ault twos tepk ey23";
const VAULT_TWO_STEP_SECRET = "E2EVAULTTWOSTEPKEY23";
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
// Codex live voice as the agent service runs it for a member: each start records its owner and
// answers the offer, and the test sends the transcript and the end as the service does.
const liveVoiceListeners = new Set<(event: VoiceLiveEvent, memberId: string | null) => void>();
let liveVoiceStarts = 0;
/** Wakes the test that waits for the host to stop a voice by itself. */
let liveVoiceStopped: (() => void) | null = null;
const liveVoice: TeamApiLiveVoice = {
  startLiveVoice: (input, voice, owner) => {
    record("startLiveVoice", input, voice, owner?.memberId ?? null, owner?.sender?.id ?? null);
    if (input.sdp === "offer-without-sign-in")
      return Effect.fail(
        new AgentLifecycleFailed({
          operation: "startLiveVoice",
          cause: new Error(sourceText("error.voice.live.signIn")),
        }),
      );
    liveVoiceStarts += 1;
    return Effect.succeed({ sessionId: `voice-${liveVoiceStarts}`, sdp: `answer to ${input.sdp}` });
  },
  stopLiveVoice: (sessionId, memberId) =>
    Effect.sync(() => {
      record("stopLiveVoice", sessionId, memberId);
      liveVoiceStopped?.();
    }),
  subscribe: (listener) => {
    liveVoiceListeners.add(listener);
    return () => liveVoiceListeners.delete(listener);
  },
};
// The real memory review store on a temporary file, as the host keeps it.
const memoryReviewFile = join(root, "memory-review.json");
const ROTATED_HOST_KEY = "-----BEGIN PUBLIC KEY-----\nrotated-e2e\n-----END PUBLIC KEY-----\n";
/** The account service refuses the next handover, as when it holds another key for the host. */
let refuseHostKeyRotation = false;
/** The servers that the stand-in of `LocalServers` runs. */
const localServerList: { serverId: string; name: string; published: boolean }[] = [];
const memoryReview = new MemoryReviewPreferenceStore(memoryReviewFile);
// The real skill learning store on a temporary file, as the host keeps it.
const skillLearningFile = join(root, "skill-learning.json");
const skillLearning = new SkillLearningPreferenceStore(skillLearningFile);
// The real browsing memory store on a temporary file, as the host keeps it.
const browsingMemoryFile = join(root, "browsing-memory.json");
const browsingMemory = new BrowsingMemoryPreferenceStore(browsingMemoryFile);
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
let channelHost: TeamApiServer | null = null;
let channelService: ChannelService | null = null;

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

  // The real import service. Only the preview runs here, so the agent writer is never reached.
  const agentImport = new AgentImportService(
    {
      listAgents: () => [],
      createAgentProfile: () => Effect.die("The import is not applied in this run."),
      createRoutine: unused("agentImport.createRoutine"),
      createMemory: unused("agentImport.createMemory"),
      memoryLimit: () => 50,
      initializeMemorySelection: unused("agentImport.initializeMemorySelection"),
      setAvatar: () => Effect.die("The export has no avatars."),
      deleteAgent: () => Effect.die("The import is not applied in this run."),
      channels: { command: () => Effect.die("The export has no group chats.") },
      createChannelMemory: unused("agentImport.createChannelMemory"),
      createChannelRoutine: unused("agentImport.createChannelRoutine"),
      deleteChannel: () => Effect.die("The export has no group chats."),
    },
    { library: unused("agentImport.library"), installLocal: () => Effect.void },
    () => ({ id: "local", name: "Local" }),
    () => "UTC",
    join(root, "agent-import-uploads"),
    () => Effect.sync(() => importFreeBytes),
  );

  server = new TeamApiServer({
    appVersion: APP_VERSION,
    agentImport,
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
      skillLearning,
      browsingMemory,
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
      // The real switch over a file of the test folder; a change records the provider status event.
      claudeUserSetup: claudeUserSetupControl(
        createClaudeUserSetupPreferenceStore(join(root, "claude-user-setup.json")),
        () => record("claudeUserSetupChanged"),
      ),
      // The real size over a file of the test folder; a change records the provider status event.
      claudeCompactWindow: claudeCompactWindowControl(
        createClaudeCompactWindowPreferenceStore(join(root, "claude-compact-window.json")),
        () => record("claudeCompactWindowChanged"),
      ),
      // The host's scan: one model server, one agent, and a model list that echoes no key.
      providerDetection: {
        detection: {
          scanModelServers: () =>
            Effect.sync(() => {
              record("scanModelServers");
              return [DETECTED_SERVER];
            }),
          scanAgents: () =>
            Effect.sync(() => {
              record("scanAgents");
              return [DETECTED_AGENT];
            }),
          discoverModels: (input) =>
            Effect.sync(() => {
              record("discoverModels", input);
              return { models: [{ id: "llama3" }] };
            }),
        },
        settings: {
          get: () => detectionSettings,
          set: (next) =>
            Effect.sync(() => {
              record("setDetectionSettings", next);
              detectionSettings = next;
              return detectionSettings;
            }),
        },
      },
      // The run command of the agent service: Local scripts on for Ada only, one routine.
      routineRunCommand: {
        listAgents: () => agents,
        automationRunCommand: (input) => {
          record("automationRunCommand", input);
          if (input.agentId !== "agent-ada") throw new Error(sourceText("error.agent.automationOff"));
          if (input.routineId !== "routine-ada") throw new Error(sourceText("error.backend.routineGone"));
          return `openbot-run ${input.agentId} ${input.routineId}`;
        },
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
          // Codex keeps the key in its own login, so the host passes it to the CLI, not to the key store.
          signInCodexWithApiKey: (key) =>
            Effect.sync(() => {
              record("signInCodexWithApiKey", key);
              codexOnKey = true;
              return NO_STATUS;
            }),
          // The released status routes drop `apiKeyInUse`, so `apiKeyState` reads it here for Codex.
          getStatus: () => providerStatus(),
          setProviderOn: (provider, on) => {
            record("setProviderOn", `${provider}:${on}`);
            if (!on && provider === "claude")
              return Effect.fail(
                new AgentLifecycleFailed({
                  operation: "setProviderOn",
                  cause: new Error(sourceText("error.provider.inUse", { provider: "Claude" })),
                }),
              );
            return Effect.sync(() => {
              if (on) offProviders.delete(provider);
              else offProviders.add(provider);
              return providerStatus();
            });
          },
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
          // Records the input that the route gives to the merge, which the real changes run.
          peerUpdate: (input) =>
            Effect.sync(() => {
              record("peerUpdateCustomProvider", input);
              customEndpoints = customEndpoints.map((endpoint) =>
                endpoint.id === input.id ? { ...endpoint, name: input.name } : endpoint,
              );
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
    // The real transfer service and parts over an empty instance, with its upload folder on disk.
    instanceTransfer: emptyInstanceTransferService(transferUploads, [transferAgent]),
    browserProfiles,
    machine,
    // The host reads its own Hermes folder: one profile under a token.
    hermesImport: {
      read: () =>
        Effect.sync(() => {
          record("readHermes");
          return HERMES_PREVIEW;
        }),
      apply: (input) =>
        Effect.sync(() => {
          record("applyHermes", input);
          return {
            agents: agents.filter((agent) => agent.id === "agent-ada"),
            skipped: [],
            channels: [],
            skippedChannels: [],
            warnings: [],
          };
        }),
      discard: (token) => Effect.sync(() => record("discardHermes", token)),
    },
    // The host lists what an adopted program reported, with the command line already redacted.
    backgroundProcesses: {
      list: () =>
        Effect.sync(() => {
          record("listBackgroundProcesses");
          return [
            {
              id: "4242-1700000000",
              pid: 4242,
              command: `node server.js --token [redacted] ${"x".repeat(BACKGROUND_PROCESS_COMMAND_LIMIT)}`,
              startedAt: 1_700_000_000_000,
              ports: [5173],
              agentId: "agent-ada",
            },
          ];
        }),
      stop: (id) => Effect.sync(() => record("stopBackgroundProcess", id)),
    },
    liveVoice,
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
    routineRunPlaces: fakeRoutineRunPlaces,
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
    const response = await fetch(`${options.base ?? base}${path}`, { method, headers, body });
    const text = await response.text();
    let parsed: Json = null;
    if (response.headers.get("content-type")?.startsWith("application/json")) parsed = parseJson(text);
    return { status: response.status, body: parsed, text, headers: response.headers };
  }

  /** One raw request with a declared length, for the body limits that `fetch` cannot reach. */
  function rawCall(
    path: string,
    token: string,
    contentLength: number,
    body: Uint8Array | null,
    options: CallOptions = {},
  ): Promise<ReplySummary> {
    return new Promise((resolveCall, rejectCall) => {
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method: "POST",
          path,
          headers: {
            ...protocolHeaders({ ...options, token }),
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

  // ---- Delete history and channel context (chat-history-v1) ----
  {
    const historyCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, CHAT_HISTORY_CAPABILITY];
    const deletes = () => callsOf("deleteAgentHistory");
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises chat-history-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(CHAT_HISTORY_CAPABILITY) &&
        older.status === 200 &&
        !list(field(older.body, "capabilities")).includes(CHAT_HISTORY_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", CHAT_HISTORY_ROUTES.agentDelete, {
      token: bobToken,
      json: { agentId: "agent-ada" },
    });
    const unsupportedChannel = await call("POST", CHAT_HISTORY_ROUTES.channelClear, {
      token: bobToken,
      json: { channelId: "channel-1" },
    });
    check(
      "the routes without the capability get 400 historyDeleteUnsupported or channelContextUnsupported, and delete nothing",
      errorIs(unsupported, 400, sourceText("error.team.historyDeleteUnsupported")) &&
        errorIs(unsupportedChannel, 400, sourceText("error.team.channelContextUnsupported")) &&
        deletes().length === 0,
      [summary(unsupported), summary(unsupportedChannel)],
    );
    const deleted = await call("POST", CHAT_HISTORY_ROUTES.agentDelete, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities: historyCapabilities,
    });
    check(
      "a member who manages the agent deletes the history of its chat, with an empty answer",
      deleted.status === 200 && isDeepStrictEqual(deleted.body, {}) && isDeepStrictEqual(deletes(), [["agent-ada"]]),
      summary(deleted),
    );
    const busy = await call("POST", CHAT_HISTORY_ROUTES.agentDelete, {
      token: bobToken,
      json: { agentId: "agent-oc" },
      capabilities: historyCapabilities,
    });
    check(
      "a delete while work runs gets 409 with the host's sentence",
      errorIs(busy, 409, sourceText("error.agent.waitBeforeDeleteHistory")),
      summary(busy),
    );
    accessLevels = { revision: 1, everyone: { "agent-ada": "chat" }, roles: [] };
    const chatOnly = await call("POST", CHAT_HISTORY_ROUTES.agentDelete, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities: historyCapabilities,
    });
    const admin = await call("POST", CHAT_HISTORY_ROUTES.agentDelete, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities: historyCapabilities,
    });
    accessLevels = { revision: 2, everyone: {}, roles: [] };
    check(
      "with chat on the agent, a member gets 403 agentManageDenied; an admin deletes the history",
      errorIs(chatOnly, 403, sourceText("error.team.agentManageDenied")) &&
        admin.status === 200 &&
        isDeepStrictEqual(deletes(), [["agent-ada"], ["agent-oc"], ["agent-ada"]]),
      [summary(chatOnly), summary(admin)],
    );
    const missing = await call("POST", CHAT_HISTORY_ROUTES.agentDelete, {
      token: bobToken,
      json: { agentId: "agent-none" },
      capabilities: historyCapabilities,
    });
    const hidden = await call("POST", CHAT_HISTORY_ROUTES.agentDelete, {
      token: bobToken,
      json: { agentId: "agent-pi" },
      capabilities: historyCapabilities,
      protocol: 6,
    });
    check(
      "an unknown agent, and an agent that the client protocol does not show, get 404 and delete nothing",
      errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hidden, 404, sourceText("error.team.agentNotFound")) &&
        deletes().length === 3,
      [summary(missing), summary(hidden)],
    );
    // This host has no channel service, so the channel routes answer as every channel route does.
    // `channel-notifications-e2e.ts` runs the real channel service.
    const channelRoutes = [
      CHAT_HISTORY_ROUTES.channelClear,
      CHAT_HISTORY_ROUTES.channelCompact,
      CHAT_HISTORY_ROUTES.channelDelete,
    ];
    const channel = await Promise.all(
      channelRoutes.map((route) =>
        call("POST", route, {
          token: bobToken,
          json: { channelId: "channel-1" },
          capabilities: [...historyCapabilities, CHANNEL_CHATS_CAPABILITY],
        }),
      ),
    );
    check(
      "the channel routes on a host without channels get 400 channelsUnsupported",
      channel.every((answer) => errorIs(answer, 400, sourceText("error.team.channelsUnsupported"))),
      channel.map(summary),
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

  // ---- Skill learning (skill-learning-v1) ----
  {
    const capabilities = [SKILL_LEARNING_CAPABILITY];
    const choices = ["automatic", "ask", "off"];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises skill-learning-v1 on protocol 9 only",
      list(field(compatibility.body, "capabilities")).includes(SKILL_LEARNING_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(SKILL_LEARNING_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const adminRead = await call("POST", SKILL_LEARNING_ROUTES.settings, { token: adaToken, json: {}, capabilities });
    check(
      "an admin reads the default automatic skill learning and the values the host permits",
      adminRead.status === 200 && isDeepStrictEqual(adminRead.body, { mode: "automatic", choices }),
      summary(adminRead),
    );
    const unsupported = await call("POST", SKILL_LEARNING_ROUTES.settings, { token: adaToken, json: {} });
    check(
      "the skill learning routes without the capability get 400 skillLearningUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.skillLearningUnsupported")),
      summary(unsupported),
    );
    const memberRead = await call("POST", SKILL_LEARNING_ROUTES.settings, { token: bobToken, json: {}, capabilities });
    const memberSet = await call("POST", SKILL_LEARNING_ROUTES.update, {
      token: bobToken,
      json: { mode: "off" },
      capabilities,
    });
    const invalid = await call("POST", SKILL_LEARNING_ROUTES.update, {
      token: adaToken,
      json: { mode: "always" },
      capabilities,
    });
    check(
      "a member cannot read or set skill learning, the host refuses a value it does not permit, and nothing is saved",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        invalid.status === 400 &&
        skillLearning.get().mode === "automatic" &&
        !existsSync(skillLearningFile),
      [summary(memberRead), summary(memberSet), summary(invalid)],
    );
    const off = await call("POST", SKILL_LEARNING_ROUTES.update, {
      token: adaToken,
      json: { mode: "off" },
      capabilities,
    });
    const reloaded = new SkillLearningPreferenceStore(skillLearningFile);
    await runCauseEffect(reloaded.load());
    check(
      "an admin turns skill learning off; the host saves it and a restart reads it",
      off.status === 200 &&
        isDeepStrictEqual(off.body, { mode: "off", choices }) &&
        skillLearning.get().mode === "off" &&
        reloaded.get().mode === "off",
      summary(off),
    );
    const ask = await call("POST", SKILL_LEARNING_ROUTES.update, {
      token: adaToken,
      json: { mode: "ask" },
      capabilities,
    });
    check(
      "an admin sets skill learning to ask first",
      ask.status === 200 && field(ask.body, "mode") === "ask" && skillLearning.get().mode === "ask",
      summary(ask),
    );

    // The skill name of a skill question reaches only a client with the capability.
    const skillPagePath = `${TEAM_API_ROUTES.agent.conversationPage("agent-ada")}?around=skill-question`;
    const namedPage = await call("GET", skillPagePath, { token: bobToken, protocol: TEAM_PROTOCOL_V9, capabilities });
    const plainPage = await call("GET", skillPagePath, { token: bobToken, protocol: TEAM_PROTOCOL_V9 });
    const pageQuestion = (reply: Reply) => list(field(reply.body, "messages"))[0];
    check(
      "a conversation page carries the skill name of a skill question only with skill-learning-v1",
      namedPage.status === 200 &&
        isDeepStrictEqual(field(pageQuestion(namedPage), "skillSuggestion"), { name: "Weekly report" }) &&
        field(pageQuestion(namedPage), "itemType") === "skill-suggestion:create" &&
        plainPage.status === 200 &&
        field(pageQuestion(plainPage), "itemType") === "skill-suggestion:create" &&
        field(pageQuestion(plainPage), "skillSuggestion") === undefined,
      [summary(namedPage), summary(plainPage)],
    );

    // A member presses Save on a suggestion card. The host writes the skill in the background.
    const saveUnsupported = await call("POST", SKILL_LEARNING_ROUTES.save, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: "suggestion-1" },
    });
    const saveMalformed = await call("POST", SKILL_LEARNING_ROUTES.save, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: "" },
      capabilities,
    });
    // Protocol 6 does not know Pi, so the host hides `agent-pi`.
    const saveHidden = await call("POST", SKILL_LEARNING_ROUTES.save, {
      token: bobToken,
      protocol: 6,
      json: { agentId: "agent-pi", messageId: "suggestion-1" },
      capabilities,
    });
    const saveMissing = await call("POST", SKILL_LEARNING_ROUTES.save, {
      token: bobToken,
      json: { agentId: "agent-gone", messageId: "suggestion-1" },
      capabilities,
    });
    accessLevels = { revision: 6, everyone: { "agent-ada": "view" }, roles: [] };
    const saveViewer = await call("POST", SKILL_LEARNING_ROUTES.save, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: "suggestion-1" },
      capabilities,
    });
    accessLevels = { revision: 7, everyone: {}, roles: [] };
    check(
      "a skill save without the capability, with a bad body, to a hidden or missing agent, or from a viewer reaches no agent",
      errorIs(saveUnsupported, 400, sourceText("error.team.skillLearningUnsupported")) &&
        saveMalformed.status === 400 &&
        errorIs(saveHidden, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(saveMissing, 404, sourceText("error.team.agentNotFound")) &&
        saveViewer.status === 403 &&
        callsOf("saveSkillSuggestion").length === 0,
      [
        summary(saveUnsupported),
        summary(saveMalformed),
        summary(saveHidden),
        summary(saveMissing),
        summary(saveViewer),
      ],
    );
    const saved = await call("POST", SKILL_LEARNING_ROUTES.save, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: "suggestion-1" },
      capabilities,
    });
    const notSaved = await call("POST", SKILL_LEARNING_ROUTES.save, {
      token: bobToken,
      json: { agentId: "agent-ada", messageId: "suggestion-2" },
      capabilities,
    });
    check(
      "a member with chat level saves a suggestion; the host gets the agent and message, and a host that cannot save says so",
      saved.status === 200 &&
        isDeepStrictEqual(saved.body, { saved: true }) &&
        notSaved.status === 200 &&
        isDeepStrictEqual(notSaved.body, { saved: false }) &&
        isDeepStrictEqual(callsOf("saveSkillSuggestion"), [
          [{ agentId: "agent-ada", messageId: "suggestion-1" }],
          [{ agentId: "agent-ada", messageId: "suggestion-2" }],
        ]),
      [summary(saved), summary(notSaved)],
    );
  }

  // ---- Learn from my browsing (browsing-memory-v1) ----
  {
    const capabilities = [BROWSING_MEMORY_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises browsing-memory-v1 on protocol 9 only",
      list(field(compatibility.body, "capabilities")).includes(BROWSING_MEMORY_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(BROWSING_MEMORY_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const adminRead = await call("POST", BROWSING_MEMORY_ROUTES.settings, { token: adaToken, json: {}, capabilities });
    check(
      "an admin reads the default: learning from browsing is off",
      adminRead.status === 200 && isDeepStrictEqual(adminRead.body, { enabled: false }),
      summary(adminRead),
    );
    const unsupported = await call("POST", BROWSING_MEMORY_ROUTES.settings, { token: adaToken, json: {} });
    check(
      "the browsing memory routes without the capability get 400 browsingMemoryUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.browsingMemoryUnsupported")),
      summary(unsupported),
    );
    const memberRead = await call("POST", BROWSING_MEMORY_ROUTES.settings, { token: bobToken, json: {}, capabilities });
    const memberSet = await call("POST", BROWSING_MEMORY_ROUTES.update, {
      token: bobToken,
      json: { enabled: true },
      capabilities,
    });
    const invalid = await call("POST", BROWSING_MEMORY_ROUTES.update, {
      token: adaToken,
      json: { enabled: "yes" },
      capabilities,
    });
    check(
      "a member cannot read or set browsing memory, the host refuses a value that is not a boolean, and nothing is saved",
      errorIs(memberRead, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        invalid.status === 400 &&
        !browsingMemory.get().enabled &&
        !existsSync(browsingMemoryFile),
      [summary(memberRead), summary(memberSet), summary(invalid)],
    );
    const on = await call("POST", BROWSING_MEMORY_ROUTES.update, {
      token: adaToken,
      json: { enabled: true },
      capabilities,
    });
    const reloaded = new BrowsingMemoryPreferenceStore(browsingMemoryFile);
    await runCauseEffect(reloaded.load());
    check(
      "an admin turns learning from browsing on; the host saves it and a restart reads it",
      on.status === 200 &&
        isDeepStrictEqual(on.body, { enabled: true }) &&
        browsingMemory.get().enabled &&
        reloaded.get().enabled,
      summary(on),
    );
    const off = await call("POST", BROWSING_MEMORY_ROUTES.update, {
      token: adaToken,
      json: { enabled: false },
      capabilities,
    });
    check(
      "an admin turns learning from browsing off again",
      off.status === 200 && isDeepStrictEqual(off.body, { enabled: false }) && !browsingMemory.get().enabled,
      summary(off),
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

  // ---- Older messages of a side thread (agent-thread-pages-v1) ----
  {
    const capabilities = [AGENT_HIDDEN_CAPABILITY, AGENT_THREAD_PAGES_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises agent-thread-pages-v1 to a protocol 9 peer and not to a protocol 8 peer",
      list(field(compatibility.body, "capabilities")).includes(AGENT_THREAD_PAGES_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(AGENT_THREAD_PAGES_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const request = { agentId: "agent-ada", taskId: "task-1", beforeMessageId: "message-7", limit: 50 };
    const unsupported = await call("POST", AGENT_THREAD_PAGES_ROUTES.readOlder, { token: bobToken, json: request });
    check(
      "the page route without the capability gets 400 threadRemoteUnsupported, and reads nothing",
      errorIs(unsupported, 400, sourceText("error.backend.threadRemoteUnsupported")) &&
        callsOf("readTaskPage").length === 0,
      summary(unsupported),
    );
    const page = await call("POST", AGENT_THREAD_PAGES_ROUTES.readOlder, {
      token: bobToken,
      json: request,
      capabilities,
    });
    const conversation = field(page.body, "conversation");
    const messages = list(field(conversation, "messages"));
    check(
      "a member reads the older messages of a side thread: the host gets the task, the message and the limit, and answers the page",
      page.status === 200 &&
        field(page.body, "hasOlder") === false &&
        messages.length === 1 &&
        field(messages[0], "id") === "message-older" &&
        isDeepStrictEqual(callsOf("readTaskPage")[0], [request]),
      [summary(page), callsOf("readTaskPage")],
    );
    const extra = await call("POST", AGENT_THREAD_PAGES_ROUTES.readOlder, {
      token: bobToken,
      json: { ...request, anchor: "latest" },
      capabilities,
    });
    const tooMany = await call("POST", AGENT_THREAD_PAGES_ROUTES.readOlder, {
      token: bobToken,
      json: { ...request, limit: 101 },
      capabilities,
    });
    const noMessage = await call("POST", AGENT_THREAD_PAGES_ROUTES.readOlder, {
      token: bobToken,
      json: { ...request, beforeMessageId: "" },
      capabilities,
    });
    check(
      "the frozen codec refuses an unknown field, a limit over 100, and an empty message id",
      extra.status === 400 &&
        tooMany.status === 400 &&
        noMessage.status === 400 &&
        callsOf("readTaskPage").length === 1,
      [summary(extra), summary(tooMany), summary(noMessage)],
    );
    const hidden = await call("POST", AGENT_THREAD_PAGES_ROUTES.readOlder, {
      token: bobToken,
      json: { ...request, agentId: "agent-pi" },
      capabilities,
      protocol: 6,
    });
    const missing = await call("POST", AGENT_THREAD_PAGES_ROUTES.readOlder, {
      token: bobToken,
      json: { ...request, agentId: "agent-none" },
      capabilities,
    });
    check(
      "an unknown agent, and an agent that the client protocol does not show, get 404 and read nothing",
      errorIs(hidden, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("readTaskPage").length === 1,
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
    // codex-api-key-v1: an OpenAI key logs the host's Codex in and never reaches the key store.
    const openAiKey = ["sk", "e2e", "openai", "fake0000"].join("-");
    const keysBefore = callsOf("setProviderKey").length;
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    const stateBefore = await call("POST", PROVIDERS_V8_ROUTES.apiKeyState, { ...v8, json: { provider: "codex" } });
    const codex = await call("POST", PROVIDERS_V8_ROUTES.apiKeySet, {
      ...v8,
      json: { provider: "codex", key: openAiKey },
    });
    const stateAfter = await call("POST", PROVIDERS_V8_ROUTES.apiKeyState, { ...v8, json: { provider: "codex" } });
    const codexMember = await call("POST", PROVIDERS_V8_ROUTES.apiKeySet, {
      ...v8,
      token: bobToken,
      json: { provider: "codex", key: openAiKey },
    });
    check(
      "the host advertises codex-api-key-v1 to protocol 9, and an admin's OpenAI key logs Codex in, not the key store",
      list(field(compatibility.body, "capabilities")).includes(CODEX_API_KEY_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(CODEX_API_KEY_CAPABILITY) &&
        codex.status === 200 &&
        codexMember.status === 403 &&
        isDeepStrictEqual(callsOf("signInCodexWithApiKey"), [[openAiKey]]) &&
        callsOf("setProviderKey").length === keysBefore,
      [summary(codex), summary(codexMember)],
    );
    check(
      "apiKeyState answers for the host's Codex login, which the released status routes do not carry",
      field(stateBefore.body, "status") === "missing" && field(stateAfter.body, "status") === "saved",
      [summary(stateBefore), summary(stateAfter)],
    );
  }

  // ---- The on/off switch of the host's providers (provider-use-v1) ----
  {
    const use = { token: adaToken, protocol: TEAM_PROTOCOL_V9, capabilities: [PROVIDER_USE_CAPABILITY] };
    const decoded = (route: string, reply: Reply) => PROVIDER_USE_CODECS.get(route)?.response(200, reply.body);
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    const before = await call("POST", PROVIDER_USE_ROUTES.list, { ...use, json: {} });
    const off = await call("POST", PROVIDER_USE_ROUTES.set, { ...use, json: { provider: "grok", on: false } });
    const afterOff = await call("POST", PROVIDER_USE_ROUTES.list, { ...use, json: {} });
    const on = await call("POST", PROVIDER_USE_ROUTES.set, { ...use, json: { provider: "grok", on: true } });
    check(
      "the host advertises provider-use-v1 to protocol 9, and an admin turns a provider off and on",
      list(field(compatibility.body, "capabilities")).includes(PROVIDER_USE_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(PROVIDER_USE_CAPABILITY) &&
        before.status === 200 &&
        isDeepStrictEqual(field(before.body, "off"), []) &&
        off.status === 200 &&
        isDeepStrictEqual(field(off.body, "off"), ["grok"]) &&
        isDeepStrictEqual(field(afterOff.body, "off"), ["grok"]) &&
        on.status === 200 &&
        isDeepStrictEqual(field(on.body, "off"), []) &&
        decoded(PROVIDER_USE_ROUTES.set, off) !== undefined &&
        isDeepStrictEqual(callsOf("setProviderOn"), [["grok:false"], ["grok:true"]]),
      [summary(before), summary(off), summary(afterOff), summary(on)],
    );
    const member = await call("POST", PROVIDER_USE_ROUTES.set, {
      ...use,
      token: bobToken,
      json: { provider: "grok", on: false },
    });
    const memberList = await call("POST", PROVIDER_USE_ROUTES.list, { ...use, token: bobToken, json: {} });
    const inUse = await call("POST", PROVIDER_USE_ROUTES.set, { ...use, json: { provider: "claude", on: false } });
    const custom = await call("POST", PROVIDER_USE_ROUTES.set, { ...use, json: { provider: "acp", on: false } });
    const noCapability = await call("POST", PROVIDER_USE_ROUTES.list, {
      token: adaToken,
      protocol: TEAM_PROTOCOL_V9,
      json: {},
    });
    check(
      "a member cannot read or use the switch, the host refuses a provider in use and the custom agent provider, and a client without provider-use-v1 gets 400",
      member.status === 403 &&
        memberList.status === 403 &&
        errorIs(inUse, 409, sourceText("error.provider.inUse", { provider: "Claude" })) &&
        errorIs(custom, 400, sourceText("error.team.providerUseInvalid")) &&
        errorIs(noCapability, 400, sourceText("error.team.providerUseUnsupported")) &&
        callsOf("setProviderOn").length === 3 &&
        offProviders.size === 0,
      [summary(member), summary(memberList), summary(inUse), summary(custom), summary(noCapability)],
    );
  }

  // ---- "Use my Claude Code setup" of the host from a joined server (claude-user-setup-v1) ----
  {
    const setup = { token: adaToken, protocol: TEAM_PROTOCOL_V9, capabilities: [CLAUDE_USER_SETUP_CAPABILITY] };
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    const before = await call("POST", CLAUDE_USER_SETUP_ROUTES.settings, { ...setup, json: {} });
    const on = await call("POST", CLAUDE_USER_SETUP_ROUTES.update, { ...setup, json: { enabled: true } });
    const again = await call("POST", CLAUDE_USER_SETUP_ROUTES.update, { ...setup, json: { enabled: true } });
    const after = await call("POST", CLAUDE_USER_SETUP_ROUTES.settings, { ...setup, json: {} });
    const saved = parseJson(readFileSync(join(root, "claude-user-setup.json"), "utf8"));
    check(
      "the host advertises claude-user-setup-v1 to protocol 9 only, and an admin reads and turns on the switch, which the host saves and announces once",
      list(field(compatibility.body, "capabilities")).includes(CLAUDE_USER_SETUP_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(CLAUDE_USER_SETUP_CAPABILITY) &&
        isDeepStrictEqual(before.body, { enabled: false }) &&
        isDeepStrictEqual(on.body, { enabled: true }) &&
        isDeepStrictEqual(again.body, { enabled: true }) &&
        isDeepStrictEqual(after.body, { enabled: true }) &&
        CLAUDE_USER_SETUP_CODECS.get(CLAUDE_USER_SETUP_ROUTES.update)?.response(200, on.body) !== undefined &&
        isDeepStrictEqual(saved, { version: 1, enabled: true }) &&
        callsOf("claudeUserSetupChanged").length === 1,
      [summary(before), summary(on), summary(after)],
    );
    const member = await call("POST", CLAUDE_USER_SETUP_ROUTES.update, {
      ...setup,
      token: bobToken,
      json: { enabled: false },
    });
    const memberRead = await call("POST", CLAUDE_USER_SETUP_ROUTES.settings, { ...setup, token: bobToken, json: {} });
    const noCapability = await call("POST", CLAUDE_USER_SETUP_ROUTES.update, {
      token: adaToken,
      protocol: TEAM_PROTOCOL_V9,
      json: { enabled: false },
    });
    const off = await call("POST", CLAUDE_USER_SETUP_ROUTES.update, { ...setup, json: { enabled: false } });
    check(
      "a member cannot read or set the switch (403), a client without claude-user-setup-v1 gets 400, and neither changes it",
      member.status === 403 &&
        memberRead.status === 403 &&
        errorIs(noCapability, 400, sourceText("error.team.claudeUserSetupUnsupported")) &&
        isDeepStrictEqual(off.body, { enabled: false }) &&
        callsOf("claudeUserSetupChanged").length === 2,
      [summary(member), summary(memberRead), summary(noCapability), summary(off)],
    );
  }

  // ---- The size at which Claude Code compacts chats, from a joined server (claude-compact-window-v1) ----
  {
    const setup = { token: adaToken, protocol: TEAM_PROTOCOL_V9, capabilities: [CLAUDE_COMPACT_WINDOW_CAPABILITY] };
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    const before = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.settings, { ...setup, json: {} });
    const set = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.update, { ...setup, json: { tokens: 400_000 } });
    const again = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.update, { ...setup, json: { tokens: 400_000 } });
    const after = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.settings, { ...setup, json: {} });
    const saved = parseJson(readFileSync(join(root, "claude-compact-window.json"), "utf8"));
    check(
      "the host advertises claude-compact-window-v1 to protocol 9 only, and an admin reads and sets the size, which the host saves and announces once",
      list(field(compatibility.body, "capabilities")).includes(CLAUDE_COMPACT_WINDOW_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(CLAUDE_COMPACT_WINDOW_CAPABILITY) &&
        isDeepStrictEqual(before.body, { tokens: null }) &&
        isDeepStrictEqual(set.body, { tokens: 400_000 }) &&
        isDeepStrictEqual(again.body, { tokens: 400_000 }) &&
        isDeepStrictEqual(after.body, { tokens: 400_000 }) &&
        CLAUDE_COMPACT_WINDOW_CODECS.get(CLAUDE_COMPACT_WINDOW_ROUTES.update)?.response(200, set.body) !== undefined &&
        isDeepStrictEqual(saved, { version: 1, tokens: 400_000 }) &&
        callsOf("claudeCompactWindowChanged").length === 1,
      [summary(before), summary(set), summary(after)],
    );
    const tooSmall = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.update, { ...setup, json: { tokens: 50_000 } });
    const tooLarge = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.update, { ...setup, json: { tokens: 2_000_000 } });
    const fraction = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.update, { ...setup, json: { tokens: 150_000.5 } });
    const unchanged = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.settings, { ...setup, json: {} });
    check(
      "the host refuses a size below 100,000, above 1,000,000 or not whole, and keeps the saved size",
      tooSmall.status === 400 &&
        tooLarge.status === 400 &&
        fraction.status === 400 &&
        isDeepStrictEqual(unchanged.body, { tokens: 400_000 }) &&
        callsOf("claudeCompactWindowChanged").length === 1,
      [summary(tooSmall), summary(tooLarge), summary(fraction), summary(unchanged)],
    );
    const member = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.update, {
      ...setup,
      token: bobToken,
      json: { tokens: null },
    });
    const memberRead = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.settings, {
      ...setup,
      token: bobToken,
      json: {},
    });
    const noCapability = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.update, {
      token: adaToken,
      protocol: TEAM_PROTOCOL_V9,
      json: { tokens: null },
    });
    const reset = await call("POST", CLAUDE_COMPACT_WINDOW_ROUTES.update, { ...setup, json: { tokens: null } });
    check(
      "a member cannot read or set the size (403), a client without claude-compact-window-v1 gets 400, and an admin sets Claude Code's own size again",
      member.status === 403 &&
        memberRead.status === 403 &&
        errorIs(noCapability, 400, sourceText("error.team.claudeCompactWindowUnsupported")) &&
        isDeepStrictEqual(reset.body, { tokens: null }) &&
        callsOf("claudeCompactWindowChanged").length === 2,
      [summary(member), summary(memberRead), summary(noCapability), summary(reset)],
    );
  }

  // ---- The run command of a routine from a joined server (routine-run-command-v1) ----
  {
    const run = { token: adaToken, protocol: TEAM_PROTOCOL_V9, capabilities: [ROUTINE_RUN_COMMAND_CAPABILITY] };
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    const owner = await call("POST", ROUTINE_RUN_COMMAND_ROUTES.command, {
      ...run,
      json: { agentId: "agent-ada", routineId: "routine-ada" },
    });
    const gone = await call("POST", ROUTINE_RUN_COMMAND_ROUTES.command, {
      ...run,
      json: { agentId: "agent-ada", routineId: "routine-missing" },
    });
    const off = await call("POST", ROUTINE_RUN_COMMAND_ROUTES.command, {
      ...run,
      json: { agentId: "agent-oc", routineId: "routine-ada" },
    });
    check(
      "the host advertises routine-run-command-v1 to protocol 9 only, an admin gets the run command, and the host refuses Local scripts off and a gone routine with 409",
      list(field(compatibility.body, "capabilities")).includes(ROUTINE_RUN_COMMAND_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(ROUTINE_RUN_COMMAND_CAPABILITY) &&
        owner.status === 200 &&
        decodeRoutineRunCommandResponse(owner.body) === "openbot-run agent-ada routine-ada" &&
        errorIs(gone, 409, sourceText("error.backend.routineGone")) &&
        errorIs(off, 409, sourceText("error.agent.automationOff")),
      [summary(owner), summary(gone), summary(off)],
    );
    const calls = callsOf("automationRunCommand").length;
    const member = await call("POST", ROUTINE_RUN_COMMAND_ROUTES.command, {
      ...run,
      token: bobToken,
      json: { agentId: "agent-ada", routineId: "routine-ada" },
    });
    const noCapability = await call("POST", ROUTINE_RUN_COMMAND_ROUTES.command, {
      token: adaToken,
      protocol: TEAM_PROTOCOL_V9,
      json: { agentId: "agent-ada", routineId: "routine-ada" },
    });
    check(
      "a member cannot get a run command (403), a client without routine-run-command-v1 gets 400, and neither reaches the agent service",
      member.status === 403 &&
        errorIs(noCapability, 400, sourceText("error.team.routineRunCommandUnsupported")) &&
        callsOf("automationRunCommand").length === calls,
      [summary(member), summary(noCapability)],
    );
  }

  // ---- The channel picture from a joined server (channel-picture-v1) ----
  {
    // A second host of the same team store, with the real channel service over the test database.
    channelService = new ChannelService(
      database,
      new MailboxStore(join(root, "channel-mailbox"), join(root, "channel-shared"), database),
      new ChannelImages(join(root, "channel-images")),
      {
        agents: () => agents,
        generate: () => Effect.die(new Error("No model runs in this test.")),
        schedule: () => {},
        interrupt: () => Effect.void,
        busy: () => false,
        changed: () => {},
        error: (error) => {
          throw error;
        },
      },
    );
    const pictures = channelService;
    pictures.store.update(
      pictures.store.create("channel-pictures", {
        name: "pictures",
        title: "",
        instructions: "",
        members: [{ agentId: "agent-ada" }],
        leadAgentId: null,
      }),
    );
    channelHost = new TeamApiServer({
      appVersion: APP_VERSION,
      store,
      agents: fakeAgents,
      agentAccess,
      mailbox,
      browser,
      channels: pictures,
      now: () => clock,
      logger: createOpenBotLogger("team-api-e2e-channels", (line) => logged.push(line)),
    });
    const at = `http://127.0.0.1:${await Effect.runPromise(channelHost.start())}`;
    const channelId = "channel-pictures";
    const pictured = [CHANNEL_CHATS_CAPABILITY, CHANNEL_PICTURE_CAPABILITY];
    const use = { base: at, token: adaToken, protocol: TEAM_PROTOCOL_V9, capabilities: pictured };
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    const imagePath = (query: Record<string, string>) =>
      `${CHANNEL_PICTURE_ROUTES.image}?${new URLSearchParams({ channelId, ...query })}`;
    const put = (bytes: Uint8Array<ArrayBuffer>, options: CallOptions = {}, mimeType = "image/png") =>
      call("PUT", imagePath({}), { ...use, bytes, headers: { "Content-Type": mimeType }, ...options });
    /** The image bytes of a version. `call` reads the body as text, which changes binary bytes. */
    const readImage = async (version: string | null, token = adaToken) => {
      const response = await fetch(`${at}${imagePath({ v: version ?? "" })}`, {
        headers: protocolHeaders({ ...use, token }),
      });
      return {
        status: response.status,
        type: response.headers.get("content-type"),
        bytes: new Uint8Array(await response.arrayBuffer()),
      };
    };
    const decodedChannel = (path: string, reply: Reply) =>
      teamSideRouteCodec(path)?.response(path, reply.status, reply.body, {
        channelIsolation: true,
        channelPicture: true,
      });
    const versionOf = (reply: Reply) => {
      const url = field(reply.body, "imageUrl");
      return typeof url === "string" ? new URL(url).searchParams.get("v") : null;
    };

    const advertised = await call("GET", TEAM_API_ROUTES.compatibility, { base: at, protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { base: at, protocol: 8 });
    const mainHost = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    check(
      "a host with channels advertises channel-picture-v1 to protocol 9 only, and a host without channels does not",
      list(field(advertised.body, "capabilities")).includes(CHANNEL_PICTURE_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(CHANNEL_PICTURE_CAPABILITY) &&
        !list(field(mainHost.body, "capabilities")).includes(CHANNEL_PICTURE_CAPABILITY),
      [list(field(advertised.body, "capabilities")).length, list(field(older.body, "capabilities")).length],
    );

    const set = await put(png);
    const version = versionOf(set);
    const read = await readImage(version);
    const listed = await call("GET", CHANNEL_ROUTES.list, use);
    const listedOld = await call("GET", CHANNEL_ROUTES.list, { ...use, capabilities: [CHANNEL_CHATS_CAPABILITY] });
    const listedRow = list(listed.body).find((row) => field(row, "id") === channelId);
    const oldRow = list(listedOld.body).find((row) => field(row, "id") === channelId);
    check(
      "a PUT of the image route sets a channel image, a GET of its version answers the bytes, and only a peer with channel-picture-v1 gets imageUrl",
      set.status === 200 &&
        decodedChannel(imagePath({}), set) !== undefined &&
        version !== null &&
        read.status === 200 &&
        read.type === "image/png" &&
        Buffer.from(read.bytes).equals(Buffer.from(png)) &&
        field(listedRow, "imageUrl") === field(set.body, "imageUrl") &&
        oldRow !== undefined &&
        !objectKeys(oldRow).includes("imageUrl") &&
        !objectKeys(oldRow).includes("icon"),
      [summary(set), { status: read.status, body: read.type }, objectKeys(listedRow), objectKeys(oldRow)],
    );

    const draft = {
      name: "pictures",
      title: "",
      instructions: "",
      members: [{ agentId: "agent-ada" }],
      leadAgentId: null,
    };
    const icon = { name: "rocket", hue: 210 };
    const saved = await call("POST", CHANNEL_ROUTES.command, {
      ...use,
      json: { type: "save", operationId: "picture-icon", channelId, update: true, draft: { ...draft, icon } },
    });
    const savedOld = await call("POST", CHANNEL_ROUTES.command, {
      ...use,
      capabilities: [CHANNEL_CHATS_CAPABILITY],
      json: { type: "save", operationId: "picture-icon-old", channelId, update: true, draft: { ...draft, icon: null } },
    });
    const removed = await call("DELETE", imagePath({}), use);
    const staleRead = await call("GET", imagePath({ v: version ?? "" }), use);
    check(
      "a save draft carries the icon only with channel-picture-v1, a DELETE removes the image, and its old version answers 404",
      saved.status === 200 &&
        isDeepStrictEqual(field(saved.body, "icon"), icon) &&
        savedOld.status === 200 &&
        isDeepStrictEqual(pictures.store.get(channelId).icon, icon) &&
        removed.status === 200 &&
        decodedChannel(imagePath({}), removed) !== undefined &&
        field(removed.body, "imageUrl") === null &&
        isDeepStrictEqual(field(removed.body, "icon"), icon) &&
        errorIs(staleRead, 404, sourceText("error.team.avatarNotFound")),
      [summary(saved), summary(savedOld), summary(removed), summary(staleRead)],
    );

    const invalid = await put(new Uint8Array(Buffer.from("not an image")));
    const wrongType = await put(png, {}, "text/plain");
    const tooLarge = await put(new Uint8Array(Buffer.concat([Buffer.from(png), Buffer.alloc(512 * 1024)])));
    const missing = await call("DELETE", `${CHANNEL_PICTURE_ROUTES.image}?channelId=channel-missing`, use);
    const noCapability = await put(png, { capabilities: [CHANNEL_CHATS_CAPABILITY] });
    const noChannels = await put(png, { base });
    check(
      "the host refuses bytes that are not an image, another type, a body over 512 KiB, an unknown channel, a peer without channel-picture-v1 and a host without channels",
      errorIs(invalid, 400, sourceText("error.team.logoInvalid")) &&
        errorIs(wrongType, 415, sourceText("error.team.avatarType")) &&
        tooLarge.status === 413 &&
        errorIs(missing, 404, sourceText("error.backend.channelNotFound")) &&
        noCapability.status === 404 &&
        errorIs(noChannels, 400, sourceText("error.team.channelsUnsupported")) &&
        pictures.store.get(channelId).imageUrl === null,
      [
        summary(invalid),
        summary(wrongType),
        summary(tooLarge),
        summary(missing),
        summary(noCapability),
        summary(noChannels),
      ],
    );

    // A member who cannot see the channel's agent cannot see the channel: 404, as in the channel list.
    const shown = versionOf(await put(png));
    accessLevels = { revision: 8, everyone: { "agent-ada": "none" }, roles: [] };
    const hidden = await put(png, { token: bobToken });
    const hiddenRead = await call("GET", imagePath({ v: shown ?? "" }), { ...use, token: bobToken });
    accessLevels = { revision: 9, everyone: {}, roles: [] };
    const visible = await put(png, { token: bobToken });
    const visibleRead = await readImage(versionOf(visible), bobToken);
    check(
      "a member who does not see the channel gets 404, and a member who sees it sets and reads the image",
      errorIs(hidden, 404, sourceText("error.backend.channelNotFound")) &&
        errorIs(hiddenRead, 404, sourceText("error.backend.channelNotFound")) &&
        visible.status === 200 &&
        visibleRead.status === 200 &&
        Buffer.from(visibleRead.bytes).equals(Buffer.from(png)) &&
        pictures.store.get(channelId).imageUrl === field(visible.body, "imageUrl"),
      [summary(hidden), summary(hiddenRead), summary(visible), { status: visibleRead.status, body: visibleRead.type }],
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

  // ---- Custom endpoint edit (custom-provider-edit-v1) ----
  {
    const edit = { token: adaToken, capabilities: [CUSTOM_PROVIDER_EDIT_CAPABILITY], protocol: TEAM_PROTOCOL_V9 };
    const decoded = (route: string, reply: Reply) => CUSTOM_PROVIDER_EDIT_CODECS.get(route)?.response(200, reply.body);
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises custom-provider-edit-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(CUSTOM_PROVIDER_EDIT_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(CUSTOM_PROVIDER_EDIT_CAPABILITY),
      [summary(compatibility), list(field(older.body, "capabilities")).length],
    );
    const spark = {
      id: "spark",
      name: "DGX Spark",
      baseUrl: "http://spark.local:8080/v1",
      hasApiKey: false,
      models: [{ id: "qwen3-coder", name: "Qwen3 Coder" }],
      harness: "pi",
      headerNames: ["X-Tenant"],
    };
    const listed = await call("POST", CUSTOM_PROVIDER_EDIT_ROUTES.customList, { ...edit, json: {} });
    check(
      "an admin lists the endpoint with its harness and header names, without the model limits",
      listed.status === 200 &&
        isDeepStrictEqual(listed.body, [spark]) &&
        isDeepStrictEqual(decoded(CUSTOM_PROVIDER_EDIT_ROUTES.customList, listed), [spark]),
      summary(listed),
    );
    const updated = await call("POST", CUSTOM_PROVIDER_EDIT_ROUTES.customUpdate, {
      ...edit,
      json: {
        id: "spark",
        name: "Spark Lab",
        baseUrl: "http://spark.local:8080/v1",
        models: [
          { id: "qwen3-coder", name: "Qwen3 Coder" },
          { id: "gpt-oss", name: "GPT-OSS" },
        ],
        headers: [{ name: "X-Tenant", value: null }],
      },
    });
    check(
      "an edit reaches the host with no key, the header kept by name, and the model names only",
      updated.status === 200 &&
        isDeepStrictEqual(callsOf("peerUpdateCustomProvider"), [
          [
            {
              id: "spark",
              name: "Spark Lab",
              baseUrl: "http://spark.local:8080/v1",
              models: [
                { id: "qwen3-coder", name: "Qwen3 Coder" },
                { id: "gpt-oss", name: "GPT-OSS" },
              ],
              headers: [{ name: "X-Tenant", value: null }],
            },
          ],
        ]) &&
        isDeepStrictEqual(decoded(CUSTOM_PROVIDER_EDIT_ROUTES.customUpdate, updated), {
          providers: [{ ...spark, name: "Spark Lab" }],
          restart: "not-running",
        }),
      [summary(updated), callsOf("peerUpdateCustomProvider")],
    );
    const unsupported = await call("POST", CUSTOM_PROVIDER_EDIT_ROUTES.customUpdate, {
      token: adaToken,
      capabilities: [CUSTOM_PROVIDER_HARNESS_CAPABILITY],
      json: { id: "spark", name: "Spark", baseUrl: "http://spark.local:8080/v1", models: [] },
    });
    const member = await call("POST", CUSTOM_PROVIDER_EDIT_ROUTES.customUpdate, {
      ...edit,
      token: bobToken,
      json: { id: "spark", name: "Spark", baseUrl: "http://spark.local:8080/v1", models: [] },
    });
    check(
      "the edit route without the capability gets 400 providersUnsupported, and a member gets 403",
      errorIs(unsupported, 400, sourceText("error.team.providersUnsupported")) &&
        errorIs(member, 403, sourceText("error.team.adminRequired")) &&
        callsOf("peerUpdateCustomProvider").length === 1,
      [summary(unsupported), summary(member)],
    );

    // The real merge, over the real store on a temporary file: an edit from a joined admin keeps
    // the harness, the key, the header value and the limits of each model that it keeps.
    const store = new CustomProviderStore({
      path: join(root, "custom-providers.json"),
      cipher: { ...fakeCipher, canPersist: () => true },
    });
    await Effect.runPromise(
      store.save({
        id: "spark",
        name: "DGX Spark",
        baseUrl: "http://spark.local:8080/v1",
        apiKey: "sk-spark-host",
        models: [{ id: "qwen3-coder", name: "Qwen3 Coder", contextWindow: 131072, maxOutput: 8192 }],
        headers: [{ name: "X-Tenant", value: "acme" }],
        harness: "pi",
      }),
    );
    const harnesses: string[] = [];
    const changes = createCustomProviderChanges({
      service: {
        saveCustomProvider: (_id, _harness, persist) => persist(),
        updateCustomProvider: (_id, harness, _removed, persist) => {
          harnesses.push(harness);
          return persist();
        },
        removeCustomProvider: (_id, persist) => persist(),
        reloadCustomProviderConfig: () => Effect.succeed("not-running"),
        startHarnessForMovedAgents: () => Effect.void,
      },
      customProviders: store,
      providerRuntimes: { startCustomProviderHarness: () => Effect.void },
    });
    await Effect.runPromise(
      changes.peerUpdate({
        id: "spark",
        name: "Spark Lab",
        baseUrl: "http://spark.local:8080/v1",
        // A harness and a model limit that a peer cannot send over the wire are dropped all the same.
        harness: "opencode",
        models: [
          { id: "qwen3-coder", name: "Qwen3", contextWindow: 1 },
          { id: "gpt-oss", name: "GPT-OSS" },
        ],
        headers: [{ name: "X-Tenant", value: null }],
      }),
    );
    const merged = store.configs();
    check(
      "a joined admin's edit keeps the harness, the key, the header value and the kept model's limits",
      isDeepStrictEqual(harnesses, ["pi"]) &&
        isDeepStrictEqual(merged, [
          {
            id: "spark",
            name: "Spark Lab",
            baseUrl: "http://spark.local:8080/v1",
            apiKey: "sk-spark-host",
            models: [
              { id: "qwen3-coder", name: "Qwen3", contextWindow: 131072, maxOutput: 8192 },
              { id: "gpt-oss", name: "GPT-OSS" },
            ],
            headers: [{ name: "X-Tenant", value: "acme" }],
            harness: "pi",
          },
        ]),
      [harnesses, store.list()],
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

  // ---- Two-step keys in the host's Vault (vault-v3), and vault-v2 on the same host ----
  {
    const v2Call = (token: string, path: string, json: unknown = {}) =>
      call("POST", path, { token, json, capabilities: [VAULT_V2_CAPABILITY] });
    const v3Call = (token: string, path: string, json: unknown = {}) =>
      call("POST", path, { token, json, capabilities: [VAULT_V3_CAPABILITY] });
    const key = parseTwoStepKey(VAULT_TWO_STEP_SECRET);
    assert.ok(key, "the e2e two-step key does not parse.");
    /** True when the text carries the key in any form that the user typed or the host saved. */
    const hasKey = (text: string) =>
      text.includes(VAULT_TWO_STEP_SECRET) || text.toLowerCase().includes(VAULT_TWO_STEP_KEY);
    const login = {
      kind: "login",
      id: null,
      website: "https://code.example.com",
      username: "ada@example.com",
      notes: "",
      password: VAULT_PASSWORD,
      twoStepKey: VAULT_TWO_STEP_KEY,
    };
    const unsupported = await v2Call(adaToken, VAULT_V3_ROUTES.codes);
    const memberCodes = await v3Call(bobToken, VAULT_V3_ROUTES.codes);
    const memberSave = await v3Call(bobToken, VAULT_V3_ROUTES.save, login);
    check(
      "the vault-v3 routes need vault-v3 and an owner or admin",
      errorIs(unsupported, 400, sourceText("error.team.vaultUnsupported")) &&
        errorIs(memberCodes, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSave, 403, sourceText("error.team.adminRequired")) &&
        vault.state().items.length === 0,
      [summary(unsupported), summary(memberCodes), summary(memberSave)],
    );
    const badKey = await v3Call(adaToken, VAULT_V3_ROUTES.save, { ...login, twoStepKey: "not a key" });
    check(
      "a two-step key that is not a setup key is refused with catalog text, and no login is added",
      errorIs(badKey, 400, sourceText("error.vault.twoStepKeyInvalid")) && vault.state().items.length === 0,
      summary(badKey),
    );
    const saved = await v3Call(adaToken, VAULT_V3_ROUTES.save, login);
    const loginId = field(saved.body, "items", 0, "id");
    check(
      "an admin adds a login with a two-step key; the answer says it has one and carries no key",
      saved.status === 200 &&
        field(saved.body, "items", 0, "hasTwoStep") === true &&
        typeof loginId === "string" &&
        !hasKey(saved.text) &&
        !hasKey(readFileSync(vaultFile, "utf8")),
      summary(saved),
    );
    assert.ok(typeof loginId === "string", "the vault-v3 save did not answer an item id.");
    const before = Date.now();
    const codes = await v3Call(adaToken, VAULT_V3_ROUTES.codes);
    const after = Date.now();
    const expected = new Set([await twoStepCode(key, before), await twoStepCode(key, after)]);
    const code = field(codes.body, "codes", 0, "code");
    const remainingMs = field(codes.body, "codes", 0, "remainingMs");
    check(
      "codes answers the current code of the login, its period and its time left, with no key",
      codes.status === 200 &&
        field(codes.body, "codes", 0, "id") === loginId &&
        typeof code === "string" &&
        expected.has(code) &&
        field(codes.body, "codes", 0, "period") === 30 &&
        typeof remainingMs === "number" &&
        remainingMs > 0 &&
        remainingMs <= 30_000 &&
        !hasKey(codes.text),
      summary(codes),
    );
    const revealKey = await v3Call(adaToken, VAULT_V3_ROUTES.reveal, { id: loginId, field: "twoStepKey" });
    check("no reveal answers a two-step key", revealKey.status === 400 && !hasKey(revealKey.text), summary(revealKey));
    const v2List = await v2Call(adaToken, VAULT_V2_ROUTES.list);
    const v2Save = await v2Call(adaToken, VAULT_V2_ROUTES.save, {
      kind: "login",
      id: loginId,
      website: "https://code.example.com",
      username: "ada@code.example.com",
      notes: "Changed from vault-v2",
      password: null,
    });
    const keptCodes = await v3Call(adaToken, VAULT_V3_ROUTES.codes);
    check(
      "vault-v2 on the same host lists the login without hasTwoStep, and its save keeps the key",
      v2List.status === 200 &&
        field(v2List.body, "items", 0, "id") === loginId &&
        field(v2List.body, "items", 0, "hasTwoStep") === undefined &&
        v2Save.status === 200 &&
        field(v2Save.body, "items", 0, "username") === "ada@code.example.com" &&
        field(v2Save.body, "items", 0, "hasTwoStep") === undefined &&
        field(keptCodes.body, "codes", 0, "id") === loginId,
      [summary(v2List), summary(v2Save), summary(keptCodes)],
    );
    const kept = await v3Call(adaToken, VAULT_V3_ROUTES.save, {
      ...login,
      id: loginId,
      password: null,
      twoStepKey: undefined,
    });
    const removed = await v3Call(adaToken, VAULT_V3_ROUTES.save, {
      ...login,
      id: loginId,
      password: null,
      twoStepKey: "",
    });
    const noCodes = await v3Call(adaToken, VAULT_V3_ROUTES.codes);
    check(
      "a vault-v3 save without twoStepKey keeps the key, and an empty one removes it",
      field(kept.body, "items", 0, "hasTwoStep") === true &&
        field(removed.body, "items", 0, "hasTwoStep") === false &&
        isDeepStrictEqual(noCodes.body, { codes: [] }),
      [summary(kept), summary(removed), summary(noCodes)],
    );
    const deleted = await v3Call(adaToken, VAULT_V3_ROUTES.delete, { id: loginId });
    check(
      "an admin deletes the login through vault-v3",
      isDeepStrictEqual(deleted.body, { status: "ready", items: [] }) && vault.state().items.length === 0,
      summary(deleted),
    );
  }

  // ---- A transfer file in parts (instance-transfer-chunks-v1), applied with instance-transfer-v1 ----
  {
    const capabilities = [INSTANCE_TRANSFER_CAPABILITY, INSTANCE_TRANSFER_CHUNKS_CAPABILITY];
    const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
    const partsCall = (token: string, path: string, json: unknown = {}) =>
      call("POST", path, { token, json, capabilities });
    const sendPart = (
      token: string,
      uploadId: string,
      index: number,
      bytes: Uint8Array<ArrayBuffer>,
      digest?: string,
    ) =>
      call(
        "POST",
        `${INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadChunk}?${new URLSearchParams({
          uploadId,
          index: String(index),
          sha256: digest ?? sha256(bytes),
        })}`,
        { token, bytes, capabilities, headers: { "Content-Type": "application/octet-stream" } },
      );
    /** One export part as bytes: `call` reads the body as text. */
    const readPart = async (token: string, exportId: string, index: number) => {
      const response = await fetch(`${base}${INSTANCE_TRANSFER_CHUNKS_ROUTES.exportChunk}`, {
        method: "POST",
        headers: { ...protocolHeaders({ token, capabilities }), "Content-Type": "application/json" },
        body: JSON.stringify({ exportId, index }),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const text = new TextDecoder().decode(bytes);
      return {
        status: response.status,
        bytes,
        body: response.headers.get("content-type")?.startsWith("application/json") ? parseJson(text) : null,
        text,
        headers: response.headers,
      };
    };
    const uploads = () => (existsSync(transferUploads) ? readdirSync(transferUploads).sort() : []);
    const manifest = {
      format: INSTANCE_TRANSFER_FORMAT,
      version: INSTANCE_TRANSFER_VERSION,
      source: { appVersion: "e2e", exportedAt: "2026-11-09T00:00:00.000Z" },
      agents: [],
      settings: { mcpServers: [], customProviders: [], customAgents: [], sidebarSections: [], routineFlows: [] },
      shared: null,
      signedIn: [],
    };
    // Random bytes that the zip stores as they are, so the file has two parts.
    const file = zipSync({
      [INSTANCE_TRANSFER_MANIFEST]: strToU8(JSON.stringify(manifest)),
      "padding.bin": [new Uint8Array(randomBytes(INSTANCE_TRANSFER_CHUNK_BYTES + 4096)), { level: 0 }],
    });
    const firstPart = file.slice(0, INSTANCE_TRANSFER_CHUNK_BYTES);
    const lastPart = file.slice(INSTANCE_TRANSFER_CHUNK_BYTES);
    const begin = { size: file.length, sha256: sha256(file) };

    const unsupported = await call("POST", INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin, {
      token: adaToken,
      json: begin,
      capabilities: [INSTANCE_TRANSFER_CAPABILITY],
    });
    const member = await partsCall(bobToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin, begin);
    const tooLarge = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin, {
      size: INSTANCE_TRANSFER_LIMITS.archiveBytes + 1,
      sha256: begin.sha256,
    });
    check(
      "the parts routes need instance-transfer-chunks-v1 and an owner or admin, and a file over 2 GiB is refused",
      errorIs(unsupported, 400, sourceText("error.team.instanceTransferUnsupported")) &&
        errorIs(member, 403, sourceText("error.team.adminRequired")) &&
        errorIs(tooLarge, 400, sourceText("error.import.transferTooLarge")) &&
        uploads().length === 0,
      [summary(unsupported), summary(member), summary(tooLarge)],
    );

    const started = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin, begin);
    const uploadId = field(started.body, "uploadId");
    assert.ok(typeof uploadId === "string", "the upload did not start.");
    check(
      "an admin starts an upload: the host answers the part size and no parts, and writes one private .part file",
      started.status === 200 &&
        field(started.body, "chunkBytes") === INSTANCE_TRANSFER_CHUNK_BYTES &&
        isDeepStrictEqual(field(started.body, "received"), []) &&
        isDeepStrictEqual(uploads(), [`${uploadId}.part`]) &&
        (statSync(join(transferUploads, `${uploadId}.part`)).mode & 0o777) === 0o600,
      summary(started),
    );
    const wrongDigest = await sendPart(adaToken, uploadId, 0, firstPart, "0".repeat(64));
    const otherAdmin = await sendPart(owner.sessionToken, uploadId, 0, firstPart);
    const pastEnd = await sendPart(adaToken, uploadId, 2, lastPart);
    check(
      "a part with a wrong SHA-256 or index is refused, and another admin cannot use the upload id",
      errorIs(wrongDigest, 400, sourceText("error.import.transferPartInvalid")) &&
        errorIs(pastEnd, 400, sourceText("error.import.transferPartInvalid")) &&
        errorIs(otherAdmin, 400, sourceText("error.import.transferPartsClosed")),
      [summary(wrongDigest), summary(otherAdmin), summary(pastEnd)],
    );
    const first = await sendPart(adaToken, uploadId, 0, firstPart);
    const early = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadFinish, { uploadId });
    const resumed = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin, begin);
    check(
      "the host keeps a part, refuses to finish without all parts, and the same file resumes the same upload",
      first.status === 200 &&
        field(first.body, "receivedBytes") === INSTANCE_TRANSFER_CHUNK_BYTES &&
        errorIs(early, 400, sourceText("error.import.transferPartInvalid")) &&
        field(resumed.body, "uploadId") === uploadId &&
        isDeepStrictEqual(field(resumed.body, "received"), [0]),
      [summary(first), summary(early), summary(resumed)],
    );
    const second = await sendPart(adaToken, uploadId, 1, lastPart);
    const otherFinish = await partsCall(owner.sessionToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadFinish, { uploadId });
    const finished = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadFinish, { uploadId });
    const token = field(finished.body, "token");
    check(
      "after the last part the admin finishes the upload and gets the instance-transfer-v1 preview; another admin cannot",
      field(second.body, "receivedBytes") === file.length &&
        errorIs(otherFinish, 400, sourceText("error.import.transferPartsClosed")) &&
        finished.status === 200 &&
        typeof token === "string" &&
        isDeepStrictEqual(field(finished.body, "agents"), []) &&
        !finished.text.includes("avatarUrl") &&
        uploads().length === 1 &&
        uploads()[0]?.endsWith(".zip") === true,
      [summary(second), summary(otherFinish), summary(finished)],
    );
    // The file has no agents and no settings, so only apply's owner check and discard can run on it.
    const otherApply = await call("POST", INSTANCE_TRANSFER_ROUTES.apply, {
      token: owner.sessionToken,
      json: { token, keys: ["agent-1"], includeSettings: false, timezone: "UTC" },
      capabilities,
    });
    const otherDiscard = await call("POST", INSTANCE_TRANSFER_ROUTES.discard, {
      token: owner.sessionToken,
      json: { token },
      capabilities,
    });
    const keptForOwner = uploads().length === 1;
    const discarded = await call("POST", INSTANCE_TRANSFER_ROUTES.discard, {
      token: adaToken,
      json: { token },
      capabilities,
    });
    check(
      "the token goes to instance-transfer-v1: another admin cannot apply or discard it, its owner discards it and the file goes",
      errorIs(otherApply, 409, sourceText("error.import.exportClosed")) &&
        otherDiscard.status === 200 &&
        keptForOwner &&
        discarded.status === 200 &&
        uploads().length === 0,
      [summary(otherApply), summary(otherDiscard), summary(discarded)],
    );

    const again = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin, begin);
    const againId = String(field(again.body, "uploadId"));
    const otherAbort = await partsCall(owner.sessionToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadAbort, {
      uploadId: againId,
    });
    const keptAfterOtherAbort = uploads().length === 1;
    const aborted = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadAbort, { uploadId: againId });
    const afterAbort = await sendPart(adaToken, againId, 0, firstPart);
    check(
      "abort ends the admin's own upload and removes its file; another admin's abort changes nothing",
      againId !== uploadId &&
        otherAbort.status === 200 &&
        keptAfterOtherAbort &&
        aborted.status === 200 &&
        uploads().length === 0 &&
        errorIs(afterAbort, 400, sourceText("error.import.transferPartsClosed")),
      [summary(again), summary(otherAbort), summary(aborted), summary(afterAbort)],
    );

    const exportInput = { agentIds: [transferAgent.id], includeFiles: true, includeSettings: false };
    const memberExport = await partsCall(bobToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.exportBegin, exportInput);
    const exported = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.exportBegin, exportInput);
    const exportId = String(field(exported.body, "exportId"));
    const exportSize = field(exported.body, "size");
    const exportParts = [await readPart(adaToken, exportId, 0), await readPart(adaToken, exportId, 1)];
    const whole = Buffer.concat(exportParts.map((part) => part.bytes));
    const otherPart = await readPart(owner.sessionToken, exportId, 0);
    const missingPart = await readPart(adaToken, exportId, 2);
    check(
      "an admin exports in parts: each part matches its SHA-256 and the whole file; another admin and a missing part are refused",
      errorIs(memberExport, 403, sourceText("error.team.adminRequired")) &&
        exported.status === 200 &&
        field(exported.body, "chunkBytes") === INSTANCE_TRANSFER_CHUNK_BYTES &&
        typeof exportSize === "number" &&
        exportParts.every((part) => part.status === 200) &&
        exportParts[0]?.bytes.length === INSTANCE_TRANSFER_CHUNK_BYTES &&
        whole.length === exportSize &&
        isDeepStrictEqual(
          field(exported.body, "chunks"),
          exportParts.map((part) => sha256(part.bytes)),
        ) &&
        field(exported.body, "sha256") === sha256(whole) &&
        Array.isArray(field(exported.body, "warnings")) &&
        exportParts[0]?.headers.get("content-type") === "application/octet-stream" &&
        unzipSync(whole)["agents/agent-transfer/workspace/random.bin"]?.length ===
          INSTANCE_TRANSFER_CHUNK_BYTES + 4096 &&
        errorIs(otherPart, 400, sourceText("error.import.transferPartsClosed")) &&
        errorIs(missingPart, 400, sourceText("error.import.transferPartInvalid")) &&
        isDeepStrictEqual(uploads(), [`${exportId}.zip`]),
      [
        summary(memberExport),
        summary(exported),
        exportParts.map((part) => ({ status: part.status, bytes: part.bytes.length })),
        summary(otherPart),
        summary(missingPart),
      ],
    );
    const done = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.exportDone, { exportId });
    const afterDone = await readPart(adaToken, exportId, 0);
    check(
      "done removes the export file, and its id is closed",
      done.status === 200 &&
        uploads().length === 0 &&
        errorIs(afterDone, 400, sourceText("error.import.transferPartsClosed")),
      [summary(done), summary(afterDone)],
    );

    // The desktop workflow over this host: the three calls of `RemoteServerManager` that it uses go
    // over loopback HTTP as ada. The first send of part 1 fails as a lost connection does.
    const remoteFailure = async (response: Response) => {
      const text = await response.text();
      const message = String((text && field(parseJson(text), "error")) || "failed");
      return new RemoteWorkflowError({ cause: new RemoteRequestError(response.status, message) });
    };
    const hostFetch = (path: string, init: RequestInit) =>
      Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${base}${path}`, {
            ...init,
            headers: { ...protocolHeaders({ token: adaToken, capabilities }), ...init.headers },
          });
          if (!response.ok) throw await remoteFailure(response);
          return response;
        },
        catch: (error) => (error instanceof RemoteWorkflowError ? error : new RemoteWorkflowError({ cause: error })),
      });
    const sentParts: number[] = [];
    let dropNextPartOne = true;
    const remote = {
      request: <T>(_serverId: string, path: string, decoder: (value: unknown) => T, init: { body?: unknown } = {}) =>
        hostFetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(init.body ?? {}),
        }).pipe(
          Effect.flatMap((response) => Effect.promise(() => response.json())),
          Effect.map((value: unknown) => decoder(value)),
        ),
      sendInstanceTransferPart: (
        _serverId: string,
        part: { uploadId: string; index: number; sha256: string },
        bytes: Uint8Array,
      ) =>
        // Lazy, as the `Effect.fn` of the manager is: each retry runs it again.
        Effect.suspend(() => {
          sentParts.push(part.index);
          if (part.index === 1 && dropNextPartOne) {
            dropNextPartOne = false;
            return Effect.fail(new RemoteWorkflowError({ cause: new Error("The connection closed.") }));
          }
          const query = new URLSearchParams({
            uploadId: part.uploadId,
            index: String(part.index),
            sha256: part.sha256,
          });
          return hostFetch(`${INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadChunk}?${query}`, {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: Buffer.from(bytes),
          }).pipe(Effect.asVoid);
        }),
      readInstanceTransferPart: (_serverId: string, part: { exportId: string; index: number }) =>
        hostFetch(INSTANCE_TRANSFER_CHUNKS_ROUTES.exportChunk, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(part),
        }).pipe(Effect.flatMap((response) => Effect.promise(async () => new Uint8Array(await response.arrayBuffer())))),
    };
    const localFile = join(root, "transfer-upload.zip");
    writeFileSync(localFile, file);
    // A part that the host already has from an earlier try is not sent again.
    const earlier = await partsCall(adaToken, INSTANCE_TRANSFER_CHUNKS_ROUTES.uploadBegin, begin);
    await sendPart(adaToken, String(field(earlier.body, "uploadId")), 0, firstPart);
    const preview = await Effect.runPromise(uploadTransferInParts(remote, "host", localFile).pipe(Effect.result));
    const previewToken = preview._tag === "Success" ? preview.success.token : null;
    const stagedFiles = uploads();
    if (previewToken)
      await call("POST", INSTANCE_TRANSFER_ROUTES.discard, {
        token: adaToken,
        json: { token: previewToken },
        capabilities,
      });
    check(
      "the desktop upload resumes: it sends only the missing part, sends it again after a lost connection, and gets the preview",
      typeof previewToken === "string" &&
        isDeepStrictEqual(sentParts, [1, 1]) &&
        stagedFiles.length === 1 &&
        uploads().length === 0,
      { preview: preview._tag === "Success" ? "preview" : String(preview.failure), sentParts, stagedFiles },
    );
    const destination = join(root, "transfer-download.zip");
    const download = await Effect.runPromise(
      downloadTransferInParts(remote, "host", exportInput, destination).pipe(Effect.result),
    );
    const downloaded = existsSync(destination) ? unzipSync(readFileSync(destination)) : {};
    check(
      "the desktop download writes the whole file, checked part by part, and the host removes its copy",
      download._tag === "Success" &&
        downloaded["agents/agent-transfer/workspace/random.bin"]?.length === INSTANCE_TRANSFER_CHUNK_BYTES + 4096 &&
        !existsSync(`${destination}.part`) &&
        uploads().length === 0,
      { download: download._tag === "Success" ? "saved" : String(download.failure), files: Object.keys(downloaded) },
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

  // ---- Where each routine runs (routine-run-place-v1) ----
  {
    const capabilities = [AGENT_HIDDEN_CAPABILITY, ROUTINE_RUN_PLACE_CAPABILITY];
    const saves = () => [...callsOf("updateRoutine"), ...callsOf("saveRoutineRecord")];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises routine-run-place-v1 to a protocol 9 peer and not to a protocol 8 peer",
      list(field(compatibility.body, "capabilities")).includes(ROUTINE_RUN_PLACE_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(ROUTINE_RUN_PLACE_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", ROUTINE_RUN_PLACE_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", routineId: "routine-ada", runIn: "thread" },
    });
    check(
      "the set route without the capability gets 400 routineRunPlaceUnsupported, and saves nothing",
      errorIs(unsupported, 400, sourceText("error.team.routineRunPlaceUnsupported")) && saves().length === 0,
      summary(unsupported),
    );
    const before = await call("POST", ROUTINE_RUN_PLACE_ROUTES.list, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities,
    });
    const adminBefore = await call("POST", ROUTINE_RUN_PLACE_ROUTES.list, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities,
    });
    check(
      "a member reads the places of the schedule routines that the released routes show; an admin also reads the webhook routines; nobody reads a `once` routine",
      before.status === 200 &&
        isDeepStrictEqual(before.body, { routines: [{ routineId: "routine-ada", runIn: "chat" }] }) &&
        isDeepStrictEqual(adminBefore.body, {
          routines: [
            { routineId: "routine-ada", runIn: "chat" },
            { routineId: "routine-hook", runIn: "chat" },
          ],
        }),
      [summary(before), summary(adminBefore)],
    );
    const memberHook = await call("POST", ROUTINE_RUN_PLACE_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", routineId: "routine-hook", runIn: "thread" },
      capabilities,
    });
    const onceSet = await call("POST", ROUTINE_RUN_PLACE_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", routineId: "routine-once", runIn: "thread" },
      capabilities,
    });
    check(
      "a member who changes a webhook routine, and anybody who changes a `once` routine, gets 404 routineGone, and the host saves nothing",
      errorIs(memberHook, 404, sourceText("error.backend.routineGone")) &&
        errorIs(onceSet, 404, sourceText("error.backend.routineGone")) &&
        saves().length === 0,
      [summary(memberHook), summary(onceSet)],
    );
    const schedule = await call("POST", ROUTINE_RUN_PLACE_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", routineId: "routine-ada", runIn: "thread" },
      capabilities,
    });
    const webhook = await call("POST", ROUTINE_RUN_PLACE_ROUTES.set, {
      token: adaToken,
      json: { agentId: "agent-ada", routineId: "routine-hook", runIn: "thread" },
      capabilities,
    });
    check(
      "a member with manage access moves a schedule routine, and an admin a webhook routine, to their own threads; the host changes only the place, with no routine card in the chat",
      schedule.status === 200 &&
        isDeepStrictEqual(schedule.body, { routineId: "routine-ada", runIn: "thread" }) &&
        webhook.status === 200 &&
        isDeepStrictEqual(webhook.body, { routineId: "routine-hook", runIn: "thread" }) &&
        isDeepStrictEqual(saves(), [
          [{ agentId: "agent-ada", routineId: "routine-ada", runIn: "thread" }, { recordConversationEvent: false }],
          [
            { kind: "agent", id: "agent-ada" },
            "routine-hook",
            {
              name: "Deploy watch",
              instruction: "Check each deploy.",
              active: true,
              timezone: "Europe/Warsaw",
              runIn: "thread",
              trigger: { kind: "webhook", eventType: "deploy", filters: [], secretCiphertext: null },
            },
          ],
        ]),
      [summary(schedule), summary(webhook), saves()],
    );
    const same = await call("POST", ROUTINE_RUN_PLACE_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", routineId: "routine-ada", runIn: "thread" },
      capabilities,
    });
    const after = await call("POST", ROUTINE_RUN_PLACE_ROUTES.list, {
      token: adaToken,
      json: { agentId: "agent-ada" },
      capabilities,
    });
    check(
      "the place that is already saved saves nothing, and the list shows the new places",
      isDeepStrictEqual(same.body, { routineId: "routine-ada", runIn: "thread" }) &&
        saves().length === 2 &&
        isDeepStrictEqual(after.body, {
          routines: [
            { routineId: "routine-ada", runIn: "thread" },
            { routineId: "routine-hook", runIn: "thread" },
          ],
        }),
      [summary(same), summary(after)],
    );
    accessLevels = { revision: 10, everyone: { "agent-ada": "view" }, roles: [] };
    const viewerList = await call("POST", ROUTINE_RUN_PLACE_ROUTES.list, {
      token: bobToken,
      json: { agentId: "agent-ada" },
      capabilities,
    });
    const viewerSet = await call("POST", ROUTINE_RUN_PLACE_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", routineId: "routine-ada", runIn: "chat" },
      capabilities,
    });
    accessLevels = { revision: 11, everyone: {}, roles: [] };
    check(
      "a member who can only view the agent reads the places, gets 403 agentManageDenied on a change, and the host saves nothing",
      viewerList.status === 200 &&
        errorIs(viewerSet, 403, sourceText("error.team.agentManageDenied")) &&
        saves().length === 2,
      [summary(viewerList), summary(viewerSet)],
    );
    const gone = await call("POST", ROUTINE_RUN_PLACE_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", routineId: "routine-none", runIn: "chat" },
      capabilities,
    });
    const badPlace = await call("POST", ROUTINE_RUN_PLACE_ROUTES.set, {
      token: bobToken,
      json: { agentId: "agent-ada", routineId: "routine-ada", runIn: "side" },
      capabilities,
    });
    const missing = await call("POST", ROUTINE_RUN_PLACE_ROUTES.list, {
      token: bobToken,
      json: { agentId: "agent-none" },
      capabilities,
    });
    const hiddenAgent = await call("POST", ROUTINE_RUN_PLACE_ROUTES.list, {
      token: bobToken,
      json: { agentId: "agent-pi" },
      capabilities,
      protocol: 6,
    });
    check(
      "a routine that the agent does not have gets 404 routineGone, a place that the codec does not know gets 400, and an unknown or hidden agent gets 404; the host saves nothing",
      errorIs(gone, 404, sourceText("error.backend.routineGone")) &&
        badPlace.status === 400 &&
        errorIs(missing, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        saves().length === 2,
      [summary(gone), summary(badPlace), summary(missing), summary(hiddenAgent)],
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

  // ---- Message search with side threads (thread-message-search-v1) ----
  {
    const searchCapabilities = [AGENT_HIDDEN_CAPABILITY, TEAM_QUEUE_EDIT_CAPABILITY, THREAD_MESSAGE_SEARCH_CAPABILITY];
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises thread-message-search-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(THREAD_MESSAGE_SEARCH_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(THREAD_MESSAGE_SEARCH_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const searches = callsOf("searchConversationMessages").length;
    const unsupported = await call("POST", THREAD_MESSAGE_SEARCH_ROUTES.search, {
      token: bobToken,
      json: { query: "report", agentId: null, cursor: null },
    });
    const blank = await call("POST", THREAD_MESSAGE_SEARCH_ROUTES.search, {
      token: bobToken,
      capabilities: searchCapabilities,
      json: { query: "   ", agentId: null, cursor: null },
    });
    const extraField = await call("POST", THREAD_MESSAGE_SEARCH_ROUTES.search, {
      token: bobToken,
      capabilities: searchCapabilities,
      json: { query: "report", agentId: null, cursor: null, botId: "agent-ada" },
    });
    const hiddenAgent = await call("POST", THREAD_MESSAGE_SEARCH_ROUTES.search, {
      token: bobToken,
      capabilities: searchCapabilities,
      protocol: 6,
      json: { query: "report", agentId: "agent-pi", cursor: null },
    });
    check(
      "a search without the capability, with a blank query, with an unknown field, or for a hidden agent is refused and reaches no search",
      errorIs(unsupported, 400, sourceText("error.team.threadMessageSearchUnsupported")) &&
        errorIs(blank, 400, sourceText("error.team.searchQueryRequired")) &&
        extraField.status === 400 &&
        errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        callsOf("searchConversationMessages").length === searches,
      [summary(unsupported), summary(blank), summary(extraField), summary(hiddenAgent)],
    );
    const all = await call("POST", THREAD_MESSAGE_SEARCH_ROUTES.search, {
      token: bobToken,
      capabilities: searchCapabilities,
      json: { query: "report", agentId: null, cursor: null, limit: 500 },
    });
    const results = list(field(all.body, "results"));
    check(
      "a member finds messages of the agents' own chats and of their side threads, and each result names its task or null",
      all.status === 200 &&
        isDeepStrictEqual(
          results.map((result) => [
            field(result, "agentId"),
            field(field(result, "message"), "id"),
            field(result, "taskId"),
          ]),
          [
            ["agent-ada", "hit-chat", null],
            ["agent-ada", "hit-thread", "task-1"],
            ["agent-pi", "hit-pi", null],
          ],
        ) &&
        isDeepStrictEqual(callsOf("searchConversationMessages").at(-1), ["report", undefined, undefined, 100, true]),
      [summary(all), callsOf("searchConversationMessages").at(-1)],
    );
    const oneAgent = await call("POST", THREAD_MESSAGE_SEARCH_ROUTES.search, {
      token: bobToken,
      capabilities: searchCapabilities,
      json: { query: "report", agentId: "agent-ada", cursor: "c-1", limit: 10 },
    });
    check(
      "a search of one agent passes the agent, the cursor and the limit to the search, with side threads",
      oneAgent.status === 200 &&
        list(field(oneAgent.body, "results")).length === 2 &&
        isDeepStrictEqual(callsOf("searchConversationMessages").at(-1), ["report", "agent-ada", "c-1", 10, true]),
      [summary(oneAgent), callsOf("searchConversationMessages").at(-1)],
    );
    const olderPeer = await call("POST", THREAD_MESSAGE_SEARCH_ROUTES.search, {
      token: bobToken,
      capabilities: searchCapabilities,
      protocol: 6,
      json: { query: "report", agentId: null, cursor: null },
    });
    check(
      "a client that cannot see an agent gets no result of that agent",
      olderPeer.status === 200 &&
        list(field(olderPeer.body, "results")).every((result) => field(result, "agentId") !== "agent-pi") &&
        list(field(olderPeer.body, "results")).length === 2,
      summary(olderPeer),
    );
    const released = await call("GET", `${TEAM_API_ROUTES.messages.search}?q=report`, { token: bobToken });
    check(
      "the released search route still searches the agents' own chats only, without a task",
      released.status === 200 &&
        isDeepStrictEqual(
          list(field(released.body, "results")).map((result) => field(field(result, "message"), "id")),
          ["hit-chat", "hit-pi"],
        ) &&
        list(field(released.body, "results")).every((result) => field(result, "taskId") === undefined) &&
        isDeepStrictEqual(callsOf("searchConversationMessages").at(-1), [
          "report",
          undefined,
          undefined,
          50,
          undefined,
        ]),
      [summary(released), callsOf("searchConversationMessages").at(-1)],
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

  // ---- Codex live voice for a member (live-voice-v1) ----
  {
    const capabilities = [LIVE_VOICE_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const starts = () => callsOf("startLiveVoice").length;
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises live-voice-v1 to a protocol 9 peer only",
      list(field(compatibility.body, "capabilities")).includes(LIVE_VOICE_CAPABILITY) &&
        !list(field(older.body, "capabilities")).includes(LIVE_VOICE_CAPABILITY),
      [summary(compatibility), list(field(older.body, "capabilities")).length],
    );
    const start = { agentId: "agent-ada", sdp: "offer-1", voice: "maple" };
    const unsupported = await call("POST", LIVE_VOICE_ROUTES.start, { token: bobToken, json: start });
    check(
      "a start without live-voice-v1 gets 400 liveVoiceUnsupported and starts no voice",
      errorIs(unsupported, 400, sourceText("error.team.liveVoiceUnsupported")) && starts() === 0,
      summary(unsupported),
    );
    const unknownVoice = await call("POST", LIVE_VOICE_ROUTES.start, {
      token: bobToken,
      ...v9,
      json: { ...start, voice: "alloy" },
    });
    // Protocol 6 does not know Pi, so `agent-pi` is hidden from this client.
    const hiddenAgent = await call("POST", LIVE_VOICE_ROUTES.start, {
      token: bobToken,
      capabilities,
      protocol: 6,
      json: { ...start, agentId: "agent-pi" },
    });
    const missingAgent = await call("POST", LIVE_VOICE_ROUTES.start, {
      token: bobToken,
      ...v9,
      json: { ...start, agentId: "agent-gone" },
    });
    accessLevels = { revision: 12, everyone: { "agent-ada": "view" }, roles: [] };
    const viewer = await call("POST", LIVE_VOICE_ROUTES.start, { token: bobToken, ...v9, json: start });
    accessLevels = { revision: 13, everyone: {}, roles: [] };
    const noEvents = await call("POST", LIVE_VOICE_ROUTES.start, { token: bobToken, ...v9, json: start });
    check(
      "a voice outside the contract, a hidden or missing agent, a member who can only view, or a session with no event connection starts no voice",
      unknownVoice.status === 400 &&
        errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(missingAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(viewer, 403, sourceText("error.team.agentViewOnly")) &&
        errorIs(noEvents, 409, sourceText("error.voice.live.disconnected")) &&
        starts() === 0,
      [summary(unknownVoice), summary(hiddenAgent), summary(missingAgent), summary(viewer), summary(noEvents)],
    );

    // Each socket also declares chat-colors-v1: the host answers that declaration with the colour list,
    // so the list shows that the host has read the capabilities of the socket.
    const openVoiceSocket = async (token: string) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${TEAM_API_ROUTES.events}`, [
        TEAM_PROTOCOL_V1_WEBSOCKET,
        `openbot-token.${token}`,
      ]);
      const events: LiveVoiceEvent[] = [];
      const waiters = new Set<() => void>();
      let declared = false;
      socket.addEventListener("message", (message) => {
        const value = JSON.parse(String(message.data));
        if (isDynamicRecord(value) && value.type === "chat-colors-changed") declared = true;
        const event = liveVoiceEvent(value);
        if (event) events.push(event);
        for (const wake of waiters) wake();
      });
      await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener("open", () => resolveOpen(), { once: true });
        socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
      });
      const until = (ready: () => boolean) =>
        new Promise<boolean>((resolveReady) => {
          if (ready()) return resolveReady(true);
          const timer = setTimeout(() => {
            waiters.delete(wake);
            resolveReady(false);
          }, 5_000);
          const wake = () => {
            if (!ready()) return;
            clearTimeout(timer);
            waiters.delete(wake);
            resolveReady(true);
          };
          waiters.add(wake);
        });
      socket.send(
        JSON.stringify({
          type: "agent-event-scope",
          includeConversations: false,
          capabilities: [CHAT_COLORS_CAPABILITY, LIVE_VOICE_CAPABILITY],
        }),
      );
      const ready = await until(() => declared);
      return { socket, events, ready, until };
    };
    const bobSocket = await openVoiceSocket(bobToken);
    const adaSocket = await openVoiceSocket(adaToken);
    const started = await call("POST", LIVE_VOICE_ROUTES.start, { token: bobToken, ...v9, json: start });
    check(
      "a member who can chat starts live voice and gets the answer, with the member as owner and sender",
      bobSocket.ready &&
        adaSocket.ready &&
        started.status === 200 &&
        isDeepStrictEqual(started.body, { sessionId: "voice-1", sdp: "answer to offer-1" }) &&
        isDeepStrictEqual(callsOf("startLiveVoice"), [
          [{ agentId: "agent-ada", sdp: "offer-1" }, "maple", bobId, bobId],
        ]),
      [summary(started), callsOf("startLiveVoice")],
    );
    const emitVoice = (event: VoiceLiveEvent, memberId: string | null) => {
      for (const listener of liveVoiceListeners) listener(event, memberId);
    };
    emitVoice({ type: "transcript", sessionId: "voice-1", role: "user", text: "Hello Ada", final: true }, bobId);
    emitVoice({ type: "transcript", sessionId: "voice-local", role: "user", text: "Mine", final: true }, null);
    emitVoice({ type: "ended", sessionId: "voice-1", error: null }, bobId);
    const bobHeard = await bobSocket.until(() => bobSocket.events.some((event) => event.kind === "ended"));
    // Ada's socket gets a later event of her own, so an earlier event of bob would be there by then.
    emitVoice({ type: "ended", sessionId: "voice-ada", error: null }, adaId);
    const adaHeard = await adaSocket.until(() => adaSocket.events.length > 0);
    check(
      "the transcript and the end go only to the member who started the voice, and a session of the host computer goes to no member",
      bobHeard &&
        isDeepStrictEqual(bobSocket.events, [
          {
            type: "live-voice",
            kind: "transcript",
            sessionId: "voice-1",
            role: "user",
            text: "Hello Ada",
            final: true,
          },
          { type: "live-voice", kind: "ended", sessionId: "voice-1", error: null },
        ]) &&
        adaHeard &&
        isDeepStrictEqual(adaSocket.events, [
          { type: "live-voice", kind: "ended", sessionId: "voice-ada", error: null },
        ]),
      [bobSocket.events, adaSocket.events],
    );
    const stopped = await call("POST", LIVE_VOICE_ROUTES.stop, {
      token: bobToken,
      ...v9,
      json: { sessionId: "voice-1" },
    });
    check(
      "a member stops a voice as its owner only",
      stopped.status === 200 &&
        isDeepStrictEqual(stopped.body, {}) &&
        isDeepStrictEqual(callsOf("stopLiveVoice"), [["voice-1", bobId]]),
      [summary(stopped), callsOf("stopLiveVoice")],
    );
    const noSignIn = await call("POST", LIVE_VOICE_ROUTES.start, {
      token: bobToken,
      ...v9,
      json: { agentId: "agent-ada", sdp: "offer-without-sign-in" },
    });
    check(
      "a host without a Codex sign-in answers 409 with the sentence for the member, and no voice means OpenAI chooses",
      errorIs(noSignIn, 409, sourceText("error.voice.live.signIn")) &&
        isDeepStrictEqual(callsOf("startLiveVoice").at(-1), [
          { agentId: "agent-ada", sdp: "offer-without-sign-in" },
          null,
          bobId,
          bobId,
        ]),
      [summary(noSignIn), callsOf("startLiveVoice").at(-1)],
    );
    // Each spoken request goes to the agent as the member's message: a member who cannot chat any more loses the voice.
    const revoked = await call("POST", LIVE_VOICE_ROUTES.start, {
      token: bobToken,
      ...v9,
      json: { agentId: "agent-ada", sdp: "offer-revoked" },
    });
    accessLevels = { revision: 14, everyone: { "agent-ada": "view" }, roles: [] };
    for (const listener of accessListeners) listener(store.getIdentity()?.serverId ?? "", accessLevels);
    const stopsAfterRevoke = callsOf("stopLiveVoice").slice(1);
    accessLevels = { revision: 15, everyone: {}, roles: [] };
    for (const listener of accessListeners) listener(store.getIdentity()?.serverId ?? "", accessLevels);
    check(
      "a member who loses chat access to the agent loses the voice, and the host stops it only once",
      revoked.status === 200 &&
        field(revoked.body, "sessionId") === "voice-2" &&
        isDeepStrictEqual(stopsAfterRevoke, [["voice-2", bobId]]) &&
        callsOf("stopLiveVoice").length === 2,
      [summary(revoked), callsOf("stopLiveVoice")],
    );
    // A voice that runs when the member's last event connection closes stops with it.
    const second = await call("POST", LIVE_VOICE_ROUTES.start, {
      token: bobToken,
      ...v9,
      json: { agentId: "agent-ada", sdp: "offer-2" },
    });
    const closedStop = new Promise<boolean>((resolveStop) => {
      const timer = setTimeout(() => resolveStop(false), 5_000);
      liveVoiceStopped = () => {
        clearTimeout(timer);
        resolveStop(true);
      };
    });
    bobSocket.socket.close();
    const stoppedOnClose = await closedStop;
    liveVoiceStopped = null;
    adaSocket.socket.close();
    check(
      "the host stops a member's voice when the last event connection of its logical session closes",
      second.status === 200 &&
        field(second.body, "sessionId") === "voice-3" &&
        stoppedOnClose &&
        isDeepStrictEqual(callsOf("stopLiveVoice").at(-1), ["voice-3", bobId]),
      [summary(second), callsOf("stopLiveVoice")],
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
    const outsidePath = `${TEAM_API_ROUTES.workspaceFiles}?botId=agent-ada&path=${encodeURIComponent("~/Desktop/notes.md")}`;
    const localReads = callsOf("resolveLocalWorkspaceFile").length;
    const memberOutside = await call("GET", outsidePath, { token: bobToken });
    const memberLocalReads = callsOf("resolveLocalWorkspaceFile").length - localReads;
    const ownerOutside = await call("GET", outsidePath, { token: adaToken });
    check(
      "workspace files: a member reads with the workspace limit, and the owner reads as the local user does",
      memberOutside.status === 200 &&
        memberLocalReads === 0 &&
        isDeepStrictEqual(callsOf("resolveWorkspaceFile").at(-1), ["agent-ada", "~/Desktop/notes.md"]) &&
        ownerOutside.status === 200 &&
        ownerOutside.text === "# workspace notes\n" &&
        callsOf("resolveLocalWorkspaceFile").length === localReads + 1 &&
        isDeepStrictEqual(callsOf("resolveLocalWorkspaceFile").at(-1), ["agent-ada", "~/Desktop/notes.md"]),
      [summary(memberOutside), summary(ownerOutside), callsOf("resolveLocalWorkspaceFile")],
    );
  }

  // ---- A Grok Bot export sent in parts (agent-import-v2) ----
  {
    const importCapabilities = [AGENT_HIDDEN_CAPABILITY, AGENT_IMPORT_CAPABILITY, AGENT_IMPORT_V2_CAPABILITY];
    const asMember = { token: bobToken, capabilities: importCapabilities, protocol: TEAM_PROTOCOL_V9 };
    // Two full parts and one short part. Random bytes do not compress, so the stored file needs all of them.
    const exported = zipSync(
      {
        "grok-export/openbot-import.json": strToU8(
          JSON.stringify({
            format: "openbot-agent-import",
            version: 1,
            source: { app: "grok-bot", exportedAt: "2026-11-09T10:00:00Z" },
            agents: [
              {
                key: "large",
                name: "Large Export",
                title: "",
                description: "You came from a large export.",
                avatar: null,
                skills: [],
                routines: [],
                memories: ["The export is larger than 16 MB."],
                files: "agents/large/files",
              },
            ],
          }),
        ),
        "grok-export/agents/large/files/data.bin": new Uint8Array(randomBytes(2 * AGENT_IMPORT_V2_CHUNK_BYTES + 4096)),
      },
      { level: 0 },
    );
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    check(
      "the host advertises agent-import-v2 to a protocol 9 peer only, beside agent-import-v1",
      list(field(compatibility.body, "capabilities")).includes(AGENT_IMPORT_V2_CAPABILITY) &&
        list(field(compatibility.body, "capabilities")).includes(AGENT_IMPORT_CAPABILITY) &&
        older.status === 200 &&
        !list(field(older.body, "capabilities")).includes(AGENT_IMPORT_V2_CAPABILITY),
      [summary(compatibility), summary(older)],
    );
    const unsupported = await call("POST", AGENT_IMPORT_V2_ROUTES.open, {
      token: bobToken,
      json: { size: exported.length },
    });
    check(
      "open without the capability gets 400 agentImportUnsupported",
      errorIs(unsupported, 400, sourceText("error.team.agentImportUnsupported")),
      summary(unsupported),
    );
    importFreeBytes = exported.length - 1;
    const full = await call("POST", AGENT_IMPORT_V2_ROUTES.open, { ...asMember, json: { size: exported.length } });
    importFreeBytes = null;
    check(
      "open refuses an export that the free disk space cannot hold, with both sizes",
      // About 16 MB needs 0.1 GB, rounded up, and 1 byte less is 0.0 GB free, rounded down.
      errorIs(full, 400, sourceText("error.import.uploadDiskSpace", { size: "0.1", free: "0.0" })),
      summary(full),
    );
    const opened = await call("POST", AGENT_IMPORT_V2_ROUTES.open, { ...asMember, json: { size: exported.length } });
    const uploadId = String(field(opened.body, "uploadId"));
    check("open answers an upload id", opened.status === 200 && uploadId.length > 0, summary(opened));
    const send = (offset: number, bytes: Uint8Array<ArrayBuffer>, token = bobToken) =>
      call("POST", agentImportV2ChunkPath(uploadId, offset), { ...asMember, token, bytes });
    const early = await call("POST", AGENT_IMPORT_V2_ROUTES.stage, { ...asMember, json: { uploadId } });
    const skipped = await send(AGENT_IMPORT_V2_CHUNK_BYTES, exported.slice(0, 1024));
    const otherMember = await send(0, exported.slice(0, 1024), adaToken);
    check(
      "stage before the last part, a part at the wrong offset, and a part from another member are refused",
      early.status === 400 &&
        skipped.status === 409 &&
        errorIs(otherMember, 409, sourceText("error.import.exportClosed")),
      [summary(early), summary(skipped), summary(otherMember)],
    );
    const tooLarge = await rawCall(
      agentImportV2ChunkPath(uploadId, 0),
      bobToken,
      AGENT_IMPORT_V2_CHUNK_BYTES + 1,
      null,
      asMember,
    );
    check("a part over 8 MiB gets 413", tooLarge.status === 413, tooLarge);
    const received: unknown[] = [];
    for (let offset = 0; offset < exported.length; offset += AGENT_IMPORT_V2_CHUNK_BYTES) {
      const part = await send(offset, exported.slice(offset, offset + AGENT_IMPORT_V2_CHUNK_BYTES));
      received.push(part.status === 200 ? field(part.body, "received") : summary(part));
    }
    check(
      "three parts arrive in order, and each answer counts the bytes the host has",
      isDeepStrictEqual(received, [AGENT_IMPORT_V2_CHUNK_BYTES, 2 * AGENT_IMPORT_V2_CHUNK_BYTES, exported.length]),
      received,
    );
    const staged = await call("POST", AGENT_IMPORT_V2_ROUTES.stage, { ...asMember, json: { uploadId } });
    const agents = list(field(staged.body, "agents"));
    check(
      "stage answers the v1 preview of the complete export, with the size of its files",
      staged.status === 200 &&
        agents.length === 1 &&
        field(agents[0] ?? null, "name") === "Large Export" &&
        field(agents[0] ?? null, "fileBytes") === 2 * AGENT_IMPORT_V2_CHUNK_BYTES + 4096 &&
        field(agents[0] ?? null, "avatarUrl") === undefined,
      summary(staged),
    );
    const again = await call("POST", AGENT_IMPORT_V2_ROUTES.stage, { ...asMember, json: { uploadId } });
    const discarded = await call("POST", AGENT_IMPORT_ROUTES.discard, {
      ...asMember,
      json: { token: field(staged.body, "token") },
    });
    const applyClosed = await call("POST", AGENT_IMPORT_ROUTES.apply, {
      ...asMember,
      json: { token: field(staged.body, "token"), keys: ["large"], channelKeys: [], timezone: "UTC" },
    });
    check(
      "the upload is spent by stage; the v1 discard releases the token, so apply gets exportClosed",
      errorIs(again, 400, sourceText("error.import.exportClosed")) &&
        discarded.status === 200 &&
        errorIs(applyClosed, 409, sourceText("error.import.exportClosed")),
      [summary(again), summary(discarded), summary(applyClosed)],
    );
  }

  // ---- Open waits of an agent (agent-waits-v1) ----
  {
    const capabilities = [AGENT_WAITS_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const compatibility = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: TEAM_PROTOCOL_V9 });
    const older = await call("GET", TEAM_API_ROUTES.compatibility, { protocol: 8 });
    const advertised = list(field(compatibility.body, "capabilities"));
    const olderAdvertised = list(field(older.body, "capabilities"));
    check(
      "the host advertises agent-waits-v1, agent-queue-task-v1, background-processes-v1 and routines-once-v1 to a protocol 9 peer only",
      [
        AGENT_WAITS_CAPABILITY,
        AGENT_QUEUE_TASK_CAPABILITY,
        BACKGROUND_PROCESSES_CAPABILITY,
        ROUTINES_ONCE_CAPABILITY,
      ].every((capability) => advertised.includes(capability) && !olderAdvertised.includes(capability)),
      [summary(compatibility), olderAdvertised.length],
    );
    const unsupported = await call("POST", AGENT_WAITS_ROUTES.list, {
      token: bobToken,
      json: { agentId: "agent-ada" },
    });
    const hiddenAgent = await call("POST", AGENT_WAITS_ROUTES.list, {
      token: bobToken,
      capabilities,
      protocol: 6,
      json: { agentId: "agent-pi" },
    });
    const missingAgent = await call("POST", AGENT_WAITS_ROUTES.list, {
      token: bobToken,
      ...v9,
      json: { agentId: "agent-gone" },
    });
    accessLevels = { revision: 20, everyone: { "agent-ada": "view" }, roles: [] };
    const viewer = await call("POST", AGENT_WAITS_ROUTES.cancel, {
      token: bobToken,
      ...v9,
      json: { agentId: "agent-ada", waitId: "wait-open" },
    });
    accessLevels = { revision: 21, everyone: {}, roles: [] };
    check(
      "the waits without the capability, of a hidden or missing agent, or a cancel by a member who can only view are refused",
      errorIs(unsupported, 400, sourceText("error.team.agentWaitsUnsupported")) &&
        errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(missingAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(viewer, 403, sourceText("error.team.agentViewOnly")) &&
        callsOf("listWaits").length === 0 &&
        callsOf("cancelWait").length === 0,
      [summary(unsupported), summary(hiddenAgent), summary(missingAgent), summary(viewer)],
    );
    const listed = await call("POST", AGENT_WAITS_ROUTES.list, {
      token: bobToken,
      ...v9,
      json: { agentId: "agent-ada" },
    });
    const waits = list(field(listed.body, "waits"));
    check(
      "a member lists the open waits of an agent, and the host cuts each request text to the contract limit",
      listed.status === 200 &&
        field(listed.body, "agentId") === "agent-ada" &&
        waits.length === 1 &&
        field(waits[0], "id") === "wait-open" &&
        String(field(waits[0], "requestText")).length === AGENT_WAITS_REQUEST_TEXT_LIMIT,
      summary(listed),
    );
    const cancelled = await call("POST", AGENT_WAITS_ROUTES.cancel, {
      token: bobToken,
      ...v9,
      json: { agentId: "agent-ada", waitId: "wait-open" },
    });
    const closed = await call("POST", AGENT_WAITS_ROUTES.cancel, {
      token: bobToken,
      ...v9,
      json: { agentId: "agent-ada", waitId: "wait-closed" },
    });
    check(
      "a member cancels an open wait, and a wait that is already closed is refused with the host's message",
      cancelled.status === 200 &&
        isDeepStrictEqual(cancelled.body, {}) &&
        errorIs(closed, 409, sourceText("error.backend.agentWaitGone")) &&
        isDeepStrictEqual(callsOf("cancelWait"), [
          ["agent-ada", "wait-open"],
          ["agent-ada", "wait-closed"],
        ]),
      [summary(cancelled), summary(closed)],
    );
  }

  // ---- A queued message as a new side thread (agent-queue-task-v1) ----
  {
    const capabilities = [AGENT_QUEUE_TASK_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const body = { agentId: "agent-ada", deliveryId: "delivery-1" };
    const unsupported = await call("POST", AGENT_QUEUE_TASK_ROUTES.run, { token: bobToken, json: body });
    const extraField = await call("POST", AGENT_QUEUE_TASK_ROUTES.run, {
      token: bobToken,
      ...v9,
      json: { ...body, botId: "agent-ada" },
    });
    const hiddenAgent = await call("POST", AGENT_QUEUE_TASK_ROUTES.run, {
      token: bobToken,
      capabilities,
      protocol: 6,
      json: { ...body, agentId: "agent-pi" },
    });
    accessLevels = { revision: 22, everyone: { "agent-ada": "view" }, roles: [] };
    const viewer = await call("POST", AGENT_QUEUE_TASK_ROUTES.run, { token: bobToken, ...v9, json: body });
    accessLevels = { revision: 23, everyone: {}, roles: [] };
    check(
      "a move without the capability, with an unknown field, of a hidden agent, or by a member who can only view is refused",
      errorIs(unsupported, 400, sourceText("error.team.queuedMessageThreadUnsupported")) &&
        extraField.status === 400 &&
        errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(viewer, 403, sourceText("error.team.agentViewOnly")) &&
        callsOf("runQueuedMessageAsTask").length === 0,
      [summary(unsupported), summary(extraField), summary(hiddenAgent), summary(viewer)],
    );
    const moved = await call("POST", AGENT_QUEUE_TASK_ROUTES.run, { token: bobToken, ...v9, json: body });
    const gone = await call("POST", AGENT_QUEUE_TASK_ROUTES.run, {
      token: bobToken,
      ...v9,
      json: { ...body, deliveryId: "delivery-gone" },
    });
    check(
      "a member moves a queued message into a new side thread, and a message that left the queue is refused with the host's message",
      moved.status === 200 &&
        field(moved.body, "id") === "task-from-queue" &&
        field(moved.body, "agentId") === "agent-ada" &&
        errorIs(gone, 409, sourceText("error.backend.queuedMessageUnavailable")) &&
        isDeepStrictEqual(callsOf("runQueuedMessageAsTask"), [[body], [{ ...body, deliveryId: "delivery-gone" }]]),
      [summary(moved), summary(gone)],
    );
  }

  // ---- The queue of a side thread (agent-thread-queue-v1) ----
  {
    const capabilities = [AGENT_THREAD_QUEUE_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const listBody = { agentId: "agent-ada" };
    const order = { agentId: "agent-ada", taskId: "task-queued", deliveryIds: ["delivery-thread"] };
    const reordersBefore = callsOf("reorderQueue").length;
    const unsupported = await call("POST", AGENT_THREAD_QUEUE_ROUTES.list, { token: bobToken, json: listBody });
    const extraField = await call("POST", AGENT_THREAD_QUEUE_ROUTES.list, {
      token: bobToken,
      ...v9,
      json: { ...listBody, taskId: "task-queued" },
    });
    const hiddenAgent = await call("POST", AGENT_THREAD_QUEUE_ROUTES.list, {
      token: bobToken,
      capabilities,
      protocol: 6,
      json: { agentId: "agent-pi" },
    });
    accessLevels = { revision: 24, everyone: { "agent-ada": "view" }, roles: [] };
    const viewerList = await call("POST", AGENT_THREAD_QUEUE_ROUTES.list, { token: bobToken, ...v9, json: listBody });
    const viewerOrder = await call("POST", AGENT_THREAD_QUEUE_ROUTES.reorder, { token: bobToken, ...v9, json: order });
    accessLevels = { revision: 25, everyone: {}, roles: [] };
    check(
      "the thread queue routes without the capability, with an unknown field, of a hidden agent, or for a member who can only view are refused",
      errorIs(unsupported, 400, sourceText("error.team.threadQueueUnsupported")) &&
        extraField.status === 400 &&
        errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(viewerList, 403, sourceText("error.team.agentViewOnly")) &&
        errorIs(viewerOrder, 403, sourceText("error.team.agentViewOnly")) &&
        callsOf("reorderQueue").length === reordersBefore,
      [summary(unsupported), summary(extraField), summary(hiddenAgent), summary(viewerList), summary(viewerOrder)],
    );
    const listed = await call("POST", AGENT_THREAD_QUEUE_ROUTES.list, { token: bobToken, ...v9, json: listBody });
    const threads = field(listed.body, "threads");
    const delivery = field(listed.body, "threads", 0, "deliveries", 0);
    const attachments = field(delivery, "attachments");
    check(
      "a member reads the full queue of each side thread with a waiting message, without the preview URLs of the host",
      listed.status === 200 &&
        Array.isArray(threads) &&
        threads.length === 1 &&
        field(listed.body, "threads", 0, "taskId") === "task-queued" &&
        field(delivery, "id") === "delivery-thread" &&
        field(delivery, "text") === "queued in a thread" &&
        Array.isArray(attachments) &&
        attachments.length === 1 &&
        field(attachments[0], "previewUrl") === null,
      [summary(listed)],
    );
    longThreadQueue = true;
    const long = await call("POST", AGENT_THREAD_QUEUE_ROUTES.list, { token: bobToken, ...v9, json: listBody });
    longThreadQueue = false;
    const longDeliveries = field(long.body, "threads", 0, "deliveries");
    check(
      "a thread queue larger than one WebRTC frame answers with its first messages, in order, inside the frame",
      long.status === 200 &&
        Buffer.byteLength(long.text) <= WEBRTC_FRAME_BODY_BUDGET &&
        Array.isArray(longDeliveries) &&
        longDeliveries.length > 0 &&
        longDeliveries.length < 20 &&
        longDeliveries.every((entry, index) => field(entry, "id") === `delivery-long-${index}`),
      [summary(long)],
    );
    const reordered = await call("POST", AGENT_THREAD_QUEUE_ROUTES.reorder, { token: bobToken, ...v9, json: order });
    const stale = await call("POST", AGENT_THREAD_QUEUE_ROUTES.reorder, {
      token: bobToken,
      ...v9,
      json: { ...order, deliveryIds: ["delivery-stale"] },
    });
    check(
      "a member orders the queue of one side thread, and a stale order is refused with the host's message",
      reordered.status === 200 &&
        errorIs(stale, 409, sourceText("error.backend.queueOrderStale")) &&
        isDeepStrictEqual(callsOf("reorderQueue").slice(reordersBefore), [
          [order],
          [{ ...order, deliveryIds: ["delivery-stale"] }],
        ]),
      [summary(reordered), summary(stale)],
    );
  }

  // ---- Usage limits and the move at a usage limit (agent-usage-limit-v1) ----
  {
    const capabilities = [AGENT_USAGE_LIMIT_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const move = { agentId: "agent-ada", provider: "claude", model: "claude-opus-4-1", reasoningEffort: "high" };
    const movesBefore = callsOf("updateAgentModel").length;
    const unsupported = await call("POST", AGENT_USAGE_LIMIT_ROUTES.list, { token: bobToken, json: {} });
    const extraField = await call("POST", AGENT_USAGE_LIMIT_ROUTES.switch, {
      token: bobToken,
      ...v9,
      json: { ...move, backupModels: null },
    });
    const hiddenAgent = await call("POST", AGENT_USAGE_LIMIT_ROUTES.switch, {
      token: bobToken,
      capabilities,
      protocol: 6,
      json: { ...move, agentId: "agent-pi" },
    });
    accessLevels = { revision: 26, everyone: { "agent-ada": "chat" }, roles: [] };
    const chatOnly = await call("POST", AGENT_USAGE_LIMIT_ROUTES.switch, { token: bobToken, ...v9, json: move });
    accessLevels = { revision: 27, everyone: {}, roles: [] };
    const namedAccount = await call("POST", AGENT_USAGE_LIMIT_ROUTES.switch, {
      token: bobToken,
      ...v9,
      json: { ...move, providerAccountId: "a0123456789abcdef" },
    });
    check(
      "the usage limit routes without the capability, with an unknown field, of a hidden agent, for a member with only chat, or to a named account by a member are refused",
      errorIs(unsupported, 400, sourceText("error.team.usageLimitUnsupported")) &&
        extraField.status === 400 &&
        errorIs(hiddenAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(chatOnly, 403, sourceText("error.team.agentManageDenied")) &&
        errorIs(namedAccount, 403, sourceText("error.team.adminRequired")) &&
        callsOf("updateAgentModel").length === movesBefore,
      [summary(unsupported), summary(extraField), summary(hiddenAgent), summary(chatOnly), summary(namedAccount)],
    );
    const listed = await call("POST", AGENT_USAGE_LIMIT_ROUTES.list, {
      token: bobToken,
      capabilities,
      protocol: 6,
      json: {},
    });
    check(
      "a member reads the usage limits without an agent or a model of a provider that the peer's protocol does not know",
      listed.status === 200 &&
        isDeepStrictEqual(field(listed.body, "usageLimits"), [{ agentId: "agent-ada", resetsAt: 1_900_000_000 }]) &&
        isDeepStrictEqual(field(listed.body, "usageLimitedModels"), [
          { provider: "claude", model: "claude-sonnet-4-5" },
        ]) &&
        isDeepStrictEqual(field(listed.body, "failedModels"), [
          { provider: "codex", model: "gpt-5", providerAccountId: "a0123456789abcdef" },
        ]),
      [summary(listed)],
    );
    const moved = await call("POST", AGENT_USAGE_LIMIT_ROUTES.switch, { token: bobToken, ...v9, json: move });
    const adminMoved = await call("POST", AGENT_USAGE_LIMIT_ROUTES.switch, {
      token: adaToken,
      ...v9,
      json: { ...move, providerAccountId: "a0123456789abcdef" },
    });
    check(
      "a member with manage access moves the agent at a usage limit on its provider's own sign-in, and an admin moves it to a named account",
      moved.status === 200 &&
        adminMoved.status === 200 &&
        isDeepStrictEqual(callsOf("updateAgentModel").slice(movesBefore), [
          [{ ...move, providerAccountId: null, leaveUsageLimit: true }],
          [{ ...move, providerAccountId: "a0123456789abcdef", leaveUsageLimit: true }],
        ]),
      [summary(moved), summary(adminMoved)],
    );
  }

  // ---- The Hermes folder of the host (hermes-import-v1) ----
  {
    const capabilities = [HERMES_IMPORT_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const selection = { token: HERMES_PREVIEW.token, profiles: [{ key: "default", allow: ["mcp:github"] }] };
    const unsupported = await call("POST", HERMES_IMPORT_ROUTES.read, { token: adaToken, json: {} });
    const member = await call("POST", HERMES_IMPORT_ROUTES.read, { token: bobToken, ...v9, json: {} });
    const memberApply = await call("POST", HERMES_IMPORT_ROUTES.apply, { token: bobToken, ...v9, json: selection });
    check(
      "the Hermes routes without the capability, or for a member who is not an owner or admin, are refused",
      errorIs(unsupported, 400, sourceText("error.team.hermesImportUnsupported")) &&
        errorIs(member, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberApply, 403, sourceText("error.team.adminRequired")) &&
        callsOf("readHermes").length === 0 &&
        callsOf("applyHermes").length === 0,
      [summary(unsupported), summary(member), summary(memberApply)],
    );
    // The wire codec drops a folder that the client names, so the host reads only its own folder.
    const folder = await call("POST", HERMES_IMPORT_ROUTES.read, {
      token: adaToken,
      ...v9,
      json: { path: "/Users/ada/.hermes" },
    });
    const read = await call("POST", HERMES_IMPORT_ROUTES.read, { token: adaToken, ...v9, json: {} });
    const applied = await call("POST", HERMES_IMPORT_ROUTES.apply, { token: adaToken, ...v9, json: selection });
    const discarded = await call("POST", HERMES_IMPORT_ROUTES.discard, {
      token: adaToken,
      ...v9,
      json: { token: HERMES_PREVIEW.token },
    });
    check(
      "an admin reads the host's own Hermes folder also when the client names a folder, imports a profile with the items allowed, and closes a read",
      folder.status === 200 &&
        isDeepStrictEqual(folder.body, HERMES_PREVIEW) &&
        callsOf("readHermes").length === 2 &&
        read.status === 200 &&
        isDeepStrictEqual(read.body, HERMES_PREVIEW) &&
        applied.status === 200 &&
        isDeepStrictEqual(field(applied.body, "agents"), [{ agentId: "agent-ada", name: "Ada" }]) &&
        isDeepStrictEqual(callsOf("applyHermes"), [[selection]]) &&
        discarded.status === 200 &&
        isDeepStrictEqual(callsOf("discardHermes"), [[HERMES_PREVIEW.token]]),
      [summary(folder), summary(read), summary(applied), summary(discarded)],
    );
  }

  // ---- The scan of the host's model servers and ACP agents (provider-detection-v1) ----
  {
    const capabilities = [PROVIDER_DETECTION_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const settings = { enabled: true, addresses: ["http://10.0.0.5:8080/v1"], folders: [], hiddenIds: [] };
    const unsupported = await call("POST", PROVIDER_DETECTION_ROUTES.scanModelServers, { token: adaToken, json: {} });
    const member = await call("POST", PROVIDER_DETECTION_ROUTES.scanAgents, { token: bobToken, ...v9, json: {} });
    const memberSet = await call("POST", PROVIDER_DETECTION_ROUTES.updateSettings, {
      token: bobToken,
      ...v9,
      json: settings,
    });
    const badEntry = await call("POST", PROVIDER_DETECTION_ROUTES.updateSettings, {
      token: adaToken,
      ...v9,
      json: { ...settings, addresses: ["not an address"] },
    });
    check(
      "the detection routes without the capability, for a member who is not an owner or admin, or with an entry that is not valid are refused",
      errorIs(unsupported, 400, sourceText("error.team.providerDetectionUnsupported")) &&
        errorIs(member, 403, sourceText("error.team.adminRequired")) &&
        errorIs(memberSet, 403, sourceText("error.team.adminRequired")) &&
        badEntry.status === 400 &&
        callsOf("scanModelServers").length === 0 &&
        callsOf("scanAgents").length === 0 &&
        callsOf("setDetectionSettings").length === 0,
      [summary(unsupported), summary(member), summary(memberSet), summary(badEntry)],
    );
    const read = await call("POST", PROVIDER_DETECTION_ROUTES.settings, { token: adaToken, ...v9, json: {} });
    const updated = await call("POST", PROVIDER_DETECTION_ROUTES.updateSettings, {
      token: adaToken,
      ...v9,
      json: settings,
    });
    const servers = await call("POST", PROVIDER_DETECTION_ROUTES.scanModelServers, {
      token: adaToken,
      ...v9,
      json: {},
    });
    const found = await call("POST", PROVIDER_DETECTION_ROUTES.scanAgents, { token: adaToken, ...v9, json: {} });
    const discover = {
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKey: "sk-detection-secret",
      headers: [{ name: "X-Team", value: "header-secret" }],
    };
    const models = await call("POST", PROVIDER_DETECTION_ROUTES.discoverModels, {
      token: adaToken,
      ...v9,
      json: discover,
    });
    const answers = JSON.stringify([read.body, updated.body, servers.body, found.body, models.body]);
    check(
      "an admin reads and sets where the host looks, scans its model servers and agents, and lists the models of one address; no answer carries a key or a header value",
      read.status === 200 &&
        isDeepStrictEqual(read.body, { enabled: true, addresses: [], folders: [], hiddenIds: [] }) &&
        updated.status === 200 &&
        isDeepStrictEqual(updated.body, settings) &&
        isDeepStrictEqual(callsOf("setDetectionSettings"), [[settings]]) &&
        servers.status === 200 &&
        isDeepStrictEqual(servers.body, { servers: [DETECTED_SERVER] }) &&
        found.status === 200 &&
        isDeepStrictEqual(found.body, { agents: [DETECTED_AGENT] }) &&
        models.status === 200 &&
        isDeepStrictEqual(models.body, { models: [{ id: "llama3" }] }) &&
        isDeepStrictEqual(callsOf("discoverModels"), [[discover]]) &&
        !answers.includes("sk-detection-secret") &&
        !answers.includes("header-secret"),
      [summary(read), summary(updated), summary(servers), summary(found), summary(models)],
    );
  }

  // ---- Programs that agents left running (background-processes-v1) ----
  {
    const capabilities = [BACKGROUND_PROCESSES_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const unsupported = await call("POST", BACKGROUND_PROCESSES_ROUTES.list, { token: adaToken, json: {} });
    const member = await call("POST", BACKGROUND_PROCESSES_ROUTES.list, { token: bobToken, ...v9, json: {} });
    const memberStop = await call("POST", BACKGROUND_PROCESSES_ROUTES.stop, {
      token: bobToken,
      ...v9,
      json: { id: "4242-1700000000" },
    });
    check(
      "the program routes without the capability, and for a member who is not an owner or admin, are refused",
      errorIs(unsupported, 400, sourceText("error.team.backgroundProcessesUnsupported")) &&
        member.status === 403 &&
        memberStop.status === 403 &&
        callsOf("listBackgroundProcesses").length === 0 &&
        callsOf("stopBackgroundProcess").length === 0,
      [summary(unsupported), summary(member), summary(memberStop)],
    );
    const listed = await call("POST", BACKGROUND_PROCESSES_ROUTES.list, { token: adaToken, ...v9, json: {} });
    const programs = list(field(listed.body, "processes"));
    const command = String(field(programs[0], "command"));
    check(
      "an admin lists the programs with the redacted command cut to the contract limit, and no environment",
      listed.status === 200 &&
        programs.length === 1 &&
        command.length === BACKGROUND_PROCESS_COMMAND_LIMIT &&
        command.includes("[redacted]") &&
        isDeepStrictEqual(Object.keys(programs[0] ?? {}).sort(), [
          "agentId",
          "command",
          "id",
          "pid",
          "ports",
          "startedAt",
        ]) &&
        !listed.text.includes(FAKE_SECRET),
      summary(listed),
    );
    const stopped = await call("POST", BACKGROUND_PROCESSES_ROUTES.stop, {
      token: adaToken,
      ...v9,
      json: { id: "4242-1700000000" },
    });
    check(
      "an admin stops one program by its id",
      stopped.status === 200 &&
        isDeepStrictEqual(stopped.body, {}) &&
        isDeepStrictEqual(callsOf("stopBackgroundProcess"), [["4242-1700000000"]]),
      summary(stopped),
    );
  }

  // ---- One-time routines on a joined server (routines-once-v1) ----
  {
    const capabilities = [ROUTINES_ONCE_CAPABILITY, CHANNEL_CHATS_CAPABILITY];
    const v9 = { capabilities, protocol: TEAM_PROTOCOL_V9 };
    const agentOwner = { kind: "agent", id: "agent-ada" };
    const channelOwner = { kind: "channel", id: "channel-once" };
    const launch = { kind: "once", date: "2026-12-05", time: "10:00" };
    const newRoutine = (name: string) => ({
      name,
      instruction: "Check the release.",
      active: true,
      timezone: "Europe/Warsaw",
      schedule: launch,
    });
    const ids = (value: Json | undefined) => list(value).map((routine) => field(routine, "id"));
    const onceIds = (reply: Reply) => ids(field(reply.body, "routines"));
    const saved = (method: string) => parseJson(JSON.stringify(callsOf(method)));

    const unsupported = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: adaToken,
      protocol: TEAM_PROTOCOL_V9,
      json: { owner: agentOwner },
    });
    const unsupportedCreate = await call("POST", ROUTINES_ONCE_ROUTES.create, {
      token: adaToken,
      protocol: TEAM_PROTOCOL_V9,
      json: { owner: agentOwner, ...newRoutine("No capability") },
    });
    check(
      "the once routes without the capability get 400 routinesOnceUnsupported, and the host saves nothing",
      errorIs(unsupported, 400, sourceText("error.team.routinesOnceUnsupported")) &&
        errorIs(unsupportedCreate, 400, sourceText("error.team.routinesOnceUnsupported")) &&
        callsOf("createRoutine").length === 0,
      [summary(unsupported), summary(unsupportedCreate)],
    );

    const ownerList = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: owner.sessionToken,
      ...v9,
      json: { owner: agentOwner },
    });
    const releasedList = await call("GET", TEAM_API_ROUTES.agent.routines("agent-ada"), { token: owner.sessionToken });
    check(
      "the owner lists only the `once` routine of the agent, with its place, and the released list still leaves it out",
      ownerList.status === 200 &&
        isDeepStrictEqual(onceIds(ownerList), ["routine-once"]) &&
        field(ownerList.body, "routines", 0, "runIn") === "chat" &&
        field(ownerList.body, "routines", 0, "trigger", "schedule", "kind") === "once" &&
        releasedList.status === 200 &&
        isDeepStrictEqual(ids(releasedList.body), ["routine-ada"]),
      [summary(ownerList), summary(releasedList)],
    );

    const created = await call("POST", ROUTINES_ONCE_ROUTES.create, {
      token: adaToken,
      ...v9,
      json: { owner: agentOwner, ...newRoutine("Release check"), runIn: "thread" },
    });
    const releasedCreate = await call("POST", ROUTINES_ONCE_ROUTES.create, {
      token: adaToken,
      ...v9,
      json: { owner: agentOwner, ...newRoutine("Daily check"), schedule: { kind: "daily", time: "08:00" } },
    });
    const createdId = String(field(created.body, "routine", "id"));
    check(
      "an admin creates a `once` routine of the agent in its own thread, and the create route refuses a released schedule",
      created.status === 201 &&
        isDeepStrictEqual(field(created.body, "routine", "trigger", "schedule"), launch) &&
        field(created.body, "routine", "runIn") === "thread" &&
        releasedCreate.status === 400 &&
        isDeepStrictEqual(saved("createRoutine"), [
          [{ agentId: "agent-ada", ...newRoutine("Release check"), runIn: "thread" }],
        ]),
      [summary(created), summary(releasedCreate), saved("createRoutine")],
    );

    const toDaily = await call("POST", ROUTINES_ONCE_ROUTES.update, {
      token: owner.sessionToken,
      ...v9,
      json: { owner: agentOwner, id: createdId, name: "Release report", schedule: { kind: "daily", time: "07:30" } },
    });
    const onceAfterDaily = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: adaToken,
      ...v9,
      json: { owner: agentOwner },
    });
    const releasedAfterDaily = await call("GET", TEAM_API_ROUTES.agent.routines("agent-ada"), { token: adaToken });
    const backToOnce = await call("POST", ROUTINES_ONCE_ROUTES.update, {
      token: adaToken,
      ...v9,
      json: { owner: agentOwner, id: createdId, schedule: { kind: "once", date: "2026-12-06", time: "11:00" } },
    });
    const onceAfterOnce = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: adaToken,
      ...v9,
      json: { owner: agentOwner },
    });
    const missing = await call("POST", ROUTINES_ONCE_ROUTES.update, {
      token: adaToken,
      ...v9,
      json: { owner: agentOwner, id: "routine-none", name: "Gone" },
    });
    check(
      "the owner moves the new routine to a daily schedule and an admin moves it back to `once`; both lists follow, and an unknown routine gets 400 routineGone",
      toDaily.status === 200 &&
        field(toDaily.body, "routine", "name") === "Release report" &&
        field(toDaily.body, "routine", "trigger", "schedule", "kind") === "daily" &&
        isDeepStrictEqual(onceIds(onceAfterDaily), ["routine-once"]) &&
        isDeepStrictEqual(ids(releasedAfterDaily.body), ["routine-ada", createdId]) &&
        backToOnce.status === 200 &&
        field(backToOnce.body, "routine", "name") === "Release report" &&
        isDeepStrictEqual(field(backToOnce.body, "routine", "trigger", "schedule"), {
          kind: "once",
          date: "2026-12-06",
          time: "11:00",
        }) &&
        isDeepStrictEqual(onceIds(onceAfterOnce), ["routine-once", createdId]) &&
        errorIs(missing, 400, sourceText("error.backend.routineGone")),
      [summary(toDaily), summary(releasedAfterDaily), summary(backToOnce), summary(onceAfterOnce), summary(missing)],
    );

    // The channel host of the channel picture check runs the real channel service.
    const channels = channelService;
    const channelPort = channelHost?.port;
    assert.ok(channels && channelPort, "The channel host of the channel picture check does not run.");
    channels.store.update(
      channels.store.create("channel-once", {
        name: "once",
        title: "",
        instructions: "",
        members: [{ agentId: "agent-ada" }],
        leadAgentId: null,
      }),
    );
    const onChannels = { ...v9, base: `http://127.0.0.1:${channelPort}` };

    const updatesBefore = callsOf("updateRoutine").length;
    accessLevels = { revision: 30, everyone: { "agent-ada": "view" }, roles: [] };
    const viewerList = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: bobToken,
      ...v9,
      json: { owner: agentOwner },
    });
    const viewerCreate = await call("POST", ROUTINES_ONCE_ROUTES.create, {
      token: bobToken,
      ...v9,
      json: { owner: agentOwner, ...newRoutine("Viewer check") },
    });
    const viewerUpdate = await call("POST", ROUTINES_ONCE_ROUTES.update, {
      token: bobToken,
      ...v9,
      json: { owner: agentOwner, id: "routine-once", name: "Viewer check" },
    });
    accessLevels = { revision: 31, everyone: { "agent-ada": "none" }, roles: [] };
    const blockedAgent = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: bobToken,
      ...v9,
      json: { owner: agentOwner },
    });
    const blockedChannel = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: bobToken,
      ...onChannels,
      json: { owner: channelOwner },
    });
    accessLevels = { revision: 32, everyone: {}, roles: [] };
    check(
      "a member who can only view the agent reads its `once` routines and gets 403 agentManageDenied on a save; a member without access gets 404 for the agent and for a channel of only that agent",
      viewerList.status === 200 &&
        isDeepStrictEqual(onceIds(viewerList), ["routine-once", createdId]) &&
        errorIs(viewerCreate, 403, sourceText("error.team.agentManageDenied")) &&
        errorIs(viewerUpdate, 403, sourceText("error.team.agentManageDenied")) &&
        errorIs(blockedAgent, 404, sourceText("error.team.agentNotFound")) &&
        errorIs(blockedChannel, 404, sourceText("error.backend.channelNotFound")) &&
        callsOf("createRoutine").length === 1 &&
        callsOf("updateRoutine").length === updatesBefore,
      [
        summary(viewerList),
        summary(viewerCreate),
        summary(viewerUpdate),
        summary(blockedAgent),
        summary(blockedChannel),
      ],
    );

    const noChannels = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: adaToken,
      ...v9,
      json: { owner: channelOwner },
    });
    const noChannelChats = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: adaToken,
      ...onChannels,
      capabilities: [ROUTINES_ONCE_CAPABILITY],
      json: { owner: channelOwner },
    });
    check(
      "a channel on a host without channels, or from a client without channel-chats-v1, gets 400 channelsUnsupported",
      errorIs(noChannels, 400, sourceText("error.team.channelsUnsupported")) &&
        errorIs(noChannelChats, 400, sourceText("error.team.channelsUnsupported")),
      [summary(noChannels), summary(noChannelChats)],
    );

    const channelList = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: owner.sessionToken,
      ...onChannels,
      json: { owner: channelOwner },
    });
    const channelReleased = await call("POST", CHANNEL_ROUTES.routines, {
      token: owner.sessionToken,
      ...onChannels,
      json: { channelId: "channel-once" },
    });
    check(
      "the owner lists only the `once` routine of the channel, and the released channel list still leaves it out",
      channelList.status === 200 &&
        isDeepStrictEqual(onceIds(channelList), ["channel-routine-once"]) &&
        field(channelList.body, "routines", 0, "runIn") === undefined &&
        channelReleased.status === 200 &&
        isDeepStrictEqual(ids(channelReleased.body), ["channel-routine-daily"]),
      [summary(channelList), summary(channelReleased)],
    );

    const channelCreated = await call("POST", ROUTINES_ONCE_ROUTES.create, {
      token: adaToken,
      ...onChannels,
      json: { owner: channelOwner, ...newRoutine("Release post") },
    });
    const memberCreated = await call("POST", ROUTINES_ONCE_ROUTES.create, {
      token: bobToken,
      ...onChannels,
      json: { owner: channelOwner, ...newRoutine("Member post") },
    });
    const channelCreatedId = String(field(channelCreated.body, "routine", "id"));
    const memberCreatedId = String(field(memberCreated.body, "routine", "id"));
    const channelUpdated = await call("POST", ROUTINES_ONCE_ROUTES.update, {
      token: owner.sessionToken,
      ...onChannels,
      json: {
        owner: channelOwner,
        id: channelCreatedId,
        name: "Release notes",
        schedule: { kind: "daily", time: "12:00" },
      },
    });
    const channelMissing = await call("POST", ROUTINES_ONCE_ROUTES.update, {
      token: adaToken,
      ...onChannels,
      json: { owner: channelOwner, id: "channel-routine-none", name: "Gone" },
    });
    const channelOnceAfter = await call("POST", ROUTINES_ONCE_ROUTES.list, {
      token: adaToken,
      ...onChannels,
      json: { owner: channelOwner },
    });
    const channelReleasedAfter = await call("POST", CHANNEL_ROUTES.routines, {
      token: adaToken,
      ...onChannels,
      json: { channelId: "channel-once" },
    });
    check(
      "an admin, and a member who sees the channel, create `once` routines of the channel; the owner moves one to a daily schedule; both lists follow, and an unknown routine gets 400 routineGone",
      channelCreated.status === 201 &&
        isDeepStrictEqual(field(channelCreated.body, "routine", "trigger", "schedule"), launch) &&
        memberCreated.status === 201 &&
        channelUpdated.status === 200 &&
        field(channelUpdated.body, "routine", "name") === "Release notes" &&
        field(channelUpdated.body, "routine", "trigger", "schedule", "kind") === "daily" &&
        errorIs(channelMissing, 400, sourceText("error.backend.routineGone")) &&
        isDeepStrictEqual(onceIds(channelOnceAfter), ["channel-routine-once", memberCreatedId]) &&
        isDeepStrictEqual(ids(channelReleasedAfter.body), ["channel-routine-daily", channelCreatedId]) &&
        isDeepStrictEqual(saved("createChannelRoutine"), [
          [{ channelId: "channel-once", ...newRoutine("Release post") }],
          [{ channelId: "channel-once", ...newRoutine("Member post") }],
        ]),
      [
        summary(channelCreated),
        summary(memberCreated),
        summary(channelUpdated),
        summary(channelMissing),
        summary(channelOnceAfter),
        summary(channelReleasedAfter),
      ],
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
  if (channelHost) await Effect.runPromise(channelHost.stop());
  if (channelService) await Effect.runPromise(channelService.stop());
  if (server) await Effect.runPromise(server.stop());
  database.close();
  rmSync(root, { recursive: true, force: true });
}

const failed = checks.filter((item) => !item.passed);
writeFileSync(join(OUT, "report.json"), `${JSON.stringify({ passed: failed.length === 0, checks }, null, 2)}\n`);
for (const item of checks) process.stdout.write(`${item.passed ? "ok" : "FAILED"} ${item.name}\n`);
assert.equal(failed.length, 0, `${failed.length} checks failed; see ${join(OUT, "report.json")}`);
