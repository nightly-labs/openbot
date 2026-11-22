import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type AgentAccessChange,
  type StorageUsage,
  type StoredFileRow,
  WORKFLOW_GROUP_FIELDS,
  WORKFLOW_STEP_NAME_FIELD,
  type WorkflowDetail,
  type WorkflowGraph,
  type WorkflowMediaAccountCredits,
  type WorkflowMediaCatalogModel,
  type WorkflowMediaOptionValue,
  type WorkflowMediaPriceRequest,
  type WorkflowNode,
  workflowVideoLengthChoices,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_CAPABILITIES_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import { AGENT_ACCESS_CODECS, AGENT_ACCESS_ROUTES } from "@openbot/contracts/team-protocol/agent-access-v1";
import {
  decodeTeamProtocolSupportExpanded,
  TEAM_CURRENT_CAPABILITIES,
  teamCapabilitiesForProtocol,
  teamCapabilityHeaders,
} from "@openbot/contracts/team-protocol/current";
import { LIBRARY_FOLDERS_ROUTES } from "@openbot/contracts/team-protocol/library-folders-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { STORAGE_ROUTES } from "@openbot/contracts/team-protocol/storage-v1";
import { STORAGE_WORKFLOW_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/storage-workflow-files-v1";
import { TEAM_PROTOCOL_V7 } from "@openbot/contracts/team-protocol/v7";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { WORKFLOWS_AGENT_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-agent-files-v1";
import { WORKFLOWS_ANSWERS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-answers-v1";
import { WORKFLOWS_CHANNELS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-channels-v1";
import { WORKFLOWS_CHATS_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-chats-v1";
import {
  WORKFLOWS_HIGGSFIELD_CAPABILITY,
  WORKFLOWS_HIGGSFIELD_CODECS,
  WORKFLOWS_HIGGSFIELD_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-higgsfield-v1";
import { WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-account-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_CODECS,
  WORKFLOWS_MEDIA_CATALOG_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v1";
import {
  WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY,
  WORKFLOWS_MEDIA_CATALOG_V2_CODECS,
  WORKFLOWS_MEDIA_CATALOG_V2_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-catalog-v2";
import {
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY,
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CODECS,
  WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-service-account-v1";
import { WORKFLOWS_MEDIA_SIZE_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-size-v1";
import { WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY } from "@openbot/contracts/team-protocol/workflows-media-transparent-v1";
import {
  WORKFLOWS_MEDIA_CAPABILITY,
  WORKFLOWS_MEDIA_CODECS,
  WORKFLOWS_MEDIA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-media-v1";
import {
  WORKFLOWS_STEP_SETTINGS_CAPABILITY,
  WORKFLOWS_STEP_SETTINGS_CODECS,
  WORKFLOWS_STEP_SETTINGS_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-step-settings-v1";
import {
  WORKFLOWS_SUNRA_CAPABILITY,
  WORKFLOWS_SUNRA_CODECS,
  WORKFLOWS_SUNRA_ROUTES,
} from "@openbot/contracts/team-protocol/workflows-sunra-v1";
import {
  WORKFLOW_STEP_TEXT_LIMIT,
  WORKFLOWS_CAPABILITY,
  WORKFLOWS_CODECS,
  WORKFLOWS_ROUTES,
  workflowsEvent,
} from "@openbot/contracts/team-protocol/workflows-v1";
import { sourceText } from "@openbot/i18n/source";
import {
  decodeRemoteWorkflowDetail,
  decodeRemoteWorkflowRunDetail,
  decodeRemoteWorkflowVersions,
} from "@openbot/team-client/workflow-decoding";
import { plugin } from "bun";
import { Effect } from "effect";
import { providerLabel } from "../src/backend/agent/thread-items";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { LIBRARY_FOLDERS_FILE, LibraryFoldersStore } from "../src/backend/library-folders-store";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import { WORKFLOW_FOLDERS_FILE, WorkflowFoldersStore } from "../src/backend/workflow-folders-store";
import { type WorkflowFileOwnerSources, workflowFileOwners } from "../src/backend/workflows/workflow-file-owners";
import { WorkflowGitHubStore } from "../src/backend/workflows/workflow-github-store";
import { WorkflowRunStore } from "../src/backend/workflows/workflow-run-store";
import { WorkflowStore } from "../src/backend/workflows/workflow-store";
import { workflowScheduleDueAt } from "../src/backend/workflows/workflow-triggers";
import { createWorkflows, type WorkflowsHandle } from "../src/backend/workflows/workflows";
import { LibraryFoldersService } from "../src/main/library-folders-service";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/workflow-team-api-e2e");
let sunraSignedIn = false;
let mediaFileId = "e2e-media-file";
const sharedFileAgents = new Map<string, string>();
let higgsfieldSignedIn = false;
let serviceAccounts: WorkflowMediaAccountCredits[] = [];
const mediaAccounts: (string | null)[] = [];
const mediaRequests: { transparent: boolean; prompt: string; aspect: string }[] = [];
const mediaOptions: (readonly WorkflowMediaOptionValue[])[] = [];
const mediaImages: (readonly { role: string; attachmentId: string }[])[] = [];
const mediaModels: { model: string; catalogId: string }[] = [];
const mediaDurations: number[] = [];
const priceRequests: WorkflowMediaPriceRequest[] = [];
const LIVE_MODEL: WorkflowMediaCatalogModel = {
  id: "higgsfield-kling3_0_e2e",
  provider: "higgsfield",
  providerModel: "kling3_0_e2e",
  name: "Kling 3.0 e2e",
  maker: "Kuaishou",
  kinds: ["video"],
  aspects: ["16:9", "9:16", "1:1"],
  durations: Array.from({ length: 13 }, (_, index) => index + 3),
  resolutions: ["720p", "1080p"],
  transparent: false,
};
const LIVE_PRICE = 22.5;
const OPTIONS_MODEL: WorkflowMediaCatalogModel = {
  id: "higgsfield-seedance_e2e",
  provider: "higgsfield",
  providerModel: "seedance_e2e",
  name: "Seedance e2e",
  maker: "ByteDance",
  kinds: ["video"],
  aspects: ["16:9", "21:9", "3:4"],
  durations: [5, 10],
  resolutions: ["720p", "1080p"],
  transparent: false,
  options: [
    { name: "mode", kind: "choice", values: ["t2v", "omni_reference"], default: "t2v" },
    { name: "generate_audio", kind: "switch", values: ["off", "on"], default: "on" },
  ],
  inputs: ["frames", "references", "videos", "audios"],
  modes: [
    { value: "t2v", inputs: [] },
    { value: "omni_reference", inputs: ["frames", "references", "videos", "audios"] },
  ],
};
const CINEMA_MODEL: WorkflowMediaCatalogModel = {
  id: "higgsfield-cinema_e2e",
  provider: "higgsfield",
  providerModel: "cinema_e2e",
  name: "Cinema e2e",
  maker: "ByteDance",
  kinds: ["video"],
  aspects: ["21:9"],
  durations: [5],
  resolutions: ["720p"],
  transparent: false,
};
let liveModels: readonly WorkflowMediaCatalogModel[] = [LIVE_MODEL];
const sizeRequests: { attachmentId: string; width: number; height: number }[] = [];
let sizeFails = false;
const handoffs: { agentId: string; text: string; sourcePaths: readonly string[] }[] = [];
const MISSING_FILE = "e2e-missing-file";
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const MEMBER = { username: "member-user", password: "member-password-123" };
const STEP_DEADLINE_MS = 30_000;
const WEBHOOK_URL = "https://relay.example.test/hooks/e2e";
const SECRET = "whsec-e2e-not-a-real-secret";
const LONG_ANSWER = "a".repeat(40_000);

plugin({
  name: "workflow-team-api-electron-boundary",
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
const { AGENT_ACCESS_FILE, AgentAccessStore } = await import("../src/main/agent-access-store");
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
    "A real agent turn: agent steps answer through stand-ins, so no provider CLI or model runs.",
    "The relay webhook URL and secret: the host-events service is a stand-in, as the relay is outside this check.",
    "WebRTC: the member uses HTTP and the event socket; the frame budget is checked on the HTTP answer.",
  ],
  steps: [],
};

async function step<T>(
  name: string,
  run: () => Promise<T>,
  summarize: (value: T) => unknown = (value) => value,
): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: summarize(value) });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, label: string): JsonObject {
  assert.ok(isRecord(value), `${label} is not an object.`);
  return value;
}

function text(value: unknown, label: string): string {
  assert.equal(typeof value, "string", `${label} is not text.`);
  return String(value);
}

function list(value: unknown, label: string): unknown[] {
  assert.ok(Array.isArray(value), `${label} is not a list.`);
  return value;
}

const unused = () => Effect.die(new Error("Not used by this check."));
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
  importSignIn: unused,
  answerHttpSignIn: unused,
};

const root = await mkdtemp(join(tmpdir(), "openbot-workflow-team-api-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  workflows: WorkflowsHandle;
  workflowStore: WorkflowStore;
  workflowFolders: WorkflowFoldersStore;
  deletedFiles: Set<string>;
  server: InstanceType<typeof TeamApiServer>;
  team: InstanceType<typeof TeamStore>;
  port: number;
}

let host: Host | null = null;
const sockets: WebSocket[] = [];
let failingAgent = "";

async function startHost(): Promise<Host> {
  const database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  const access = new AgentAccessStore(join(userData, AGENT_ACCESS_FILE));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  assert.equal(await runCauseEffect(access.load()), true, "The roles file did not load.");
  if (!team.getIdentity()) await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const deliveries = new Map<string, string>();
  const workflowStore = new WorkflowStore({ database, nextDueAt: workflowScheduleDueAt(() => "UTC") });
  const runs = new WorkflowRunStore({ database });
  const workflowFolders = new WorkflowFoldersStore(join(userData, WORKFLOW_FOLDERS_FILE));
  await runCauseEffect(workflowFolders.initialize());
  const deletedFiles = new Set<string>();
  const scan = () =>
    Effect.sync(() =>
      workflowLibraryScan(
        {
          outputs: () => runs.mediaOutputs(),
          workflows: () => workflowStore.list(),
          folders: (workflowIds) => workflowFolders.getSnapshot({ workflowIds }),
        },
        deletedFiles,
      ),
    );
  const libraryFolderStore = new LibraryFoldersStore(join(userData, LIBRARY_FOLDERS_FILE));
  await runCauseEffect(libraryFolderStore.initialize());
  const libraryFolders = new LibraryFoldersService({
    store: libraryFolderStore,
    storage: { usage: scan, invalidate: () => undefined },
    agents: () => agents.listAgents(),
  });
  const workflows = await Effect.runPromise(
    createWorkflows({
      store: workflowStore,
      runs,
      github: new WorkflowGitHubStore({ database }),
      githubApp: () => null,
      delivery: (deliveryId) => {
        const agentId = deliveries.get(deliveryId);
        if (agentId === undefined) return null;
        return agentId === failingAgent
          ? { status: "failed", turnId: null, error: "The agent step failed in the e2e." }
          : { status: "completed", turnId: `turn-${deliveryId}`, error: null };
      },
      turnAnswer: () => LONG_ANSWER,
      sendHandoff: ({ agentId, idempotencyKey, text, sourcePaths }) =>
        Effect.sync(() => {
          handoffs.push({ agentId, text, sourcePaths });
          const deliveryId = `delivery-${idempotencyKey}`;
          deliveries.set(deliveryId, agentId);
          return deliveryId;
        }),
      filePath: (attachmentId) =>
        Effect.succeed(attachmentId === MISSING_FILE ? null : join(userData, "e2e-files", attachmentId)),
      stopDelivery: () => Effect.void,
      generateText: () => Effect.fail({ message: "No model step runs in this check." }),
      keepPicture: (draftId, types) =>
        mailbox.keepDraft(draftId, types).pipe(Effect.map((kept) => (typeof kept === "string" ? kept : kept.id))),
      sizePicture: (attachmentId, size) => {
        sizeRequests.push({ attachmentId, ...size });
        return sizeFails
          ? Effect.fail({ message: "The e2e crop failed." })
          : Effect.succeed(`${attachmentId}-${size.width}x${size.height}`);
      },
      mediaProviders: () => ({
        sunra: sunraSignedIn,
        higgsfield: higgsfieldSignedIn,
        accounts: serviceAccounts.map(({ provider, id, name }) => ({ provider, id, name })),
      }),
      mediaCredits: () =>
        Effect.succeed({
          sunra: sunraSignedIn ? { available: 120, quota: 500 } : null,
          higgsfield: higgsfieldSignedIn ? { available: 42, quota: null } : null,
          accounts: serviceAccounts,
        }),
      mediaCatalog: () => Effect.succeed({ models: higgsfieldSignedIn ? liveModels : [] }),
      mediaPrice: (request) =>
        Effect.sync(() => {
          priceRequests.push(request);
          return { credits: higgsfieldSignedIn && request.model === LIVE_MODEL.id ? LIVE_PRICE : null };
        }),
      generateMedia: (request) => {
        mediaAccounts.push(request.account);
        mediaModels.push({ model: request.model, catalogId: request.catalogId });
        mediaOptions.push(request.specs.options);
        mediaImages.push(request.images);
        mediaDurations.push(request.specs.duration);
        mediaRequests.push({
          transparent: request.specs.transparent,
          prompt: request.prompt,
          aspect: request.specs.aspect,
        });
        if (request.account === null) return Effect.succeed(mediaFileId);
        return agents.generateWorkflowMedia(request).pipe(
          Effect.mapError((failure) => ({
            message: failure.cause instanceof Error ? failure.cause.message : sourceText("error.workflow.mediaFailed"),
          })),
        );
      },
      notify: () => {},
      connectionOn: () => false,
      post: () => Effect.succeed({ posted: true as const }),
      changed: (workflowId) => agents.notifyWorkflowsChanged(workflowId),
      rearm: () => {},
      timezone: () => "UTC",
    }),
  );
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
    hiddenAgents: agents,
    agentAccess: access,
    storage: {
      usage: scan,
      deleteFile: (fileId) =>
        Effect.sync(() => {
          deletedFiles.add(fileId);
          return undefined;
        }),
      clear: unused,
      disk: unused,
      diskUse: unused,
    },
    libraryFolders,
    workflows: {
      ...workflows,
      get: (workflowId) =>
        workflows.get(workflowId).pipe(
          Effect.map(
            (detail): WorkflowDetail => ({
              ...detail,
              triggers: detail.triggers.map((trigger) =>
                trigger.type === "webhook" ? { ...trigger, webhookUrl: WEBHOOK_URL } : trigger,
              ),
            }),
          ),
        ),
      rotateWorkflowSecret: () => Effect.succeed({ secret: SECRET }),
    },
    admin: {
      routineResults: {
        options: () => Effect.succeed([]),
        destination: () => Effect.succeed(null),
        setDestination: () => Effect.succeed(null),
      },
    },
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, workflows, workflowStore, workflowFolders, deletedFiles, server, team, port };
}

function workflowLibraryScan(sources: WorkflowFileOwnerSources, deleted: ReadonlySet<string>): StorageUsage {
  const scannedAt = new Date(0).toISOString();
  return {
    scope: "host",
    agentId: null,
    conversationId: null,
    scannedAt,
    freeBytes: null,
    breakdown: [],
    agents: [],
    conversations: [],
    files: [...workflowFileOwners(sources)]
      .filter(([id]) => !deleted.has(id))
      .map(
        ([id, owner]): StoredFileRow => ({
          id,
          name: `${id}.png`,
          size: 1,
          kind: "image",
          mimeType: "image/png",
          previewKind: "none",
          previewUrl: null,
          source: "generated",
          agentId: sharedFileAgents.get(id) ?? null,
          conversation: null,
          messageId: null,
          createdAt: owner.createdAt ?? scannedAt,
          status: "available",
          deletable: true,
          workflow: owner.workflow,
        }),
      ),
    truncated: false,
  };
}

async function stopHost(): Promise<void> {
  if (!host) return;
  const stopping = host;
  host = null;
  await Effect.runPromise(stopping.server.stop()).catch(() => undefined);
  await Effect.runPromise(stopping.workflows.close()).catch(() => undefined);
  await runCauseEffect(stopping.agents.stop()).catch(() => undefined);
  stopping.database.close();
}

function current(): Host {
  assert.ok(host, "The host is not running.");
  return host;
}

async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown; capabilities?: readonly string[]; protocol?: number } = {},
): Promise<{ status: number; body: unknown }> {
  const protocol = input.protocol ?? TEAM_PROTOCOL_V7;
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(protocol),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    ...teamCapabilityHeaders(protocol, input.capabilities ?? teamCapabilitiesForProtocol(protocol)),
  };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${current().port}${path}`, {
    method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function wire(path: string, token: string, body: unknown): Promise<{ status: number; body: unknown }> {
  const codec = WORKFLOWS_CODECS.get(path);
  assert.ok(codec, `No workflows-v1 codec for ${path}.`);
  codec.request(body);
  const response = await call("POST", path, { token, body });
  return { status: response.status, body: codec.response(response.status, response.body) };
}

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF_BASE64 = "R0lGODlhAQABAAAAACw=";

async function sendDraft(
  token: string,
  name: string,
  mimeType: string,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const query = `?name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mimeType)}`;
  const response = await fetch(`http://127.0.0.1:${current().port}${TEAM_API_ROUTES.attachments}${query}`, {
    method: "POST",
    headers: { ...v9Headers(token), "Content-Type": "application/octet-stream" },
    body: bytes,
  });
  const body = await response.text();
  assert.equal(response.status, 201, `The upload of ${name} returned ${response.status}: ${body}`);
  return text(record(JSON.parse(body), "draft").id, "draft id");
}

function v9Headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V9),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    [TEAM_CAPABILITIES_HEADER]: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).join(","),
  };
}

type RefusalKey =
  | "error.workflow.missing"
  | "error.workflow.versionMissing"
  | "error.workflow.tooLargeToSend"
  | "error.team.agentViewOnly"
  | "error.team.agentManageDenied"
  | "error.workflow.stepMissing"
  | "error.workflow.runMissing"
  | "error.team.adminRequired";

async function refused(path: string, token: string, body: unknown, status: number, key: RefusalKey) {
  const response = await wire(path, token, body);
  assert.equal(response.status, status, `${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  assert.ok(JSON.stringify(response.body).includes(sourceText(key)), JSON.stringify(response.body));
  return response.status;
}

function answer<T>(path: string, body: unknown, decode: (value: unknown) => T): T {
  const codec = WORKFLOWS_CODECS.get(path);
  assert.ok(codec, `No workflows-v1 codec for ${path}.`);
  return decode(codec.response(200, body));
}

async function ok(path: string, token: string, body: unknown): Promise<JsonObject> {
  const response = await wire(path, token, body);
  assert.equal(response.status, 200, `${path} returned ${response.status}: ${JSON.stringify(response.body)}`);
  return record(response.body, path);
}

async function login(credentials: { username: string; password: string }): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: credentials });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  return text(record(response.body, "login").sessionToken, "session token");
}

let accessRevision = 0;
async function setLevels(ownerToken: string, everyone: AgentAccessChange["everyone"]) {
  const codec = AGENT_ACCESS_CODECS.get(AGENT_ACCESS_ROUTES.set);
  assert.ok(codec);
  const body: AgentAccessChange = { revision: accessRevision, everyone, roles: [] };
  codec.request(body);
  const response = await call("POST", AGENT_ACCESS_ROUTES.set, { token: ownerToken, body });
  assert.equal(response.status, 200, `Saving the roles returned ${response.status}.`);
  accessRevision += 1;
}

async function openEvents(token: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${current().port}${TEAM_API_ROUTES.events}`, [
    TEAM_PROTOCOL_V1_WEBSOCKET,
    `openbot-token.${token}`,
  ]);
  sockets.push(socket);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener("open", () => resolveOpen(), { once: true });
    socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
  });
  const snapshot = nextMessage(socket, (value) =>
    isRecord(value) && value.type === "runtime-snapshot" ? value : null,
  );
  socket.send(
    JSON.stringify({
      type: "agent-event-scope",
      includeConversations: false,
      capabilities: ["agent-runtime-snapshots", WORKFLOWS_CAPABILITY],
    }),
  );
  await snapshot;
  return socket;
}

function nextMessage<T>(socket: WebSocket, pick: (value: unknown) => T | null): Promise<T> {
  return new Promise((resolveMessage, reject) => {
    const onMessage = (event: MessageEvent) => {
      const picked = pick(JSON.parse(String(event.data)));
      if (picked === null) return;
      socket.removeEventListener("message", onMessage);
      resolveMessage(picked);
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", (event) => reject(new Error(`The event socket closed: ${event.code}.`)), {
      once: true,
    });
  });
}

const at = (x: number) => ({ x, y: 0 });
const agentNode = (id: string, agentId: string): WorkflowNode => ({
  id,
  kind: "agent",
  at: at(300),
  fields: { agentId, text: "Say hello." },
});
const promptNode: WorkflowNode = { id: "prompt", kind: "prompt", at: at(0), fields: { text: "Start." } };
const agentGraph = (agentId: string): WorkflowGraph => ({
  nodes: [promptNode, agentNode("agent", agentId)],
  edges: [{ id: "edge", from: "prompt", to: "agent", type: "text" }],
  strokes: [],
});
const channelOutput = (placeId: string): WorkflowNode => ({
  id: "output",
  kind: "output",
  at: at(600),
  fields: { target: "channel", connectionId: "messaging-e2e", placeId },
});
const withOutput = (graph: WorkflowGraph, output: WorkflowNode): WorkflowGraph => ({
  ...graph,
  nodes: [...graph.nodes, output],
  edges: [...graph.edges, { id: "edge-output", from: "agent", to: output.id, type: "text" }],
});

async function hostWorkflow(title: string, graph: WorkflowGraph): Promise<{ id: string; revision: number }> {
  const { workflows } = current();
  const created = await runCauseEffect(workflows.create({ title }));
  const saved = await runCauseEffect(
    workflows.saveGraph({ workflowId: created.summary.id, baseRevision: created.revision, graph }),
  );
  assert.ok(saved.ok, `Saving ${title} conflicted.`);
  return { id: created.summary.id, revision: saved.revision };
}

async function settled(runId: string, nodeId: string) {
  const { workflows } = current();
  for (;;) {
    await Effect.runPromise(workflows.sweep());
    const found = (await runCauseEffect(workflows.run(runId))).steps.find((candidate) => candidate.nodeId === nodeId);
    if (found && found.status !== "running") return found;
    await new Promise((done) => setImmediate(done));
  }
}

let requests = 0;
const requestId = () => `request-${++requests}`;

try {
  host = await startHost();
  const ownerToken = await login(OWNER);

  const setup = await step(
    "setup: an owner, a member, five agents with the levels manage, none, view, manage and chat",
    async () => {
      const { agents, team } = current();
      const create = async (name: string) =>
        (
          await runCauseEffect(
            agents.createAgentProfile({ name, description: name, avatarSeed: name.toLowerCase(), avatarHue: null }),
          )
        ).id;
      const open = await create("Open");
      const closed = await create("Closed");
      const viewer = await create("Viewer");
      const later = await create("Later");
      const chatter = await create("Chatter");
      const invite = await runCauseEffect(team.createInvite("member"));
      const joined = await call("POST", TEAM_API_ROUTES.join.server, {
        body: { inviteToken: invite.token, ...MEMBER },
      });
      assert.equal(joined.status, 201, `Join returned ${joined.status}.`);
      const memberToken = await login(MEMBER);
      await setLevels(ownerToken, { [closed]: "none", [viewer]: "view", [chatter]: "chat" });
      return { ids: { open, closed, viewer, later, chatter }, memberToken };
    },
    ({ ids }) => ({ ids }),
  );
  const { open, closed, viewer, later, chatter } = setup.ids;
  const member = setup.memberToken;
  failingAgent = later;

  await step("compatibility: the host advertises workflows-v1", async () => {
    const response = await call("GET", TEAM_API_ROUTES.compatibility);
    const capabilities = list(record(response.body, "compatibility").capabilities, "capabilities");
    assert.ok(capabilities.includes(WORKFLOWS_CAPABILITY), JSON.stringify(capabilities));
    return { capability: WORKFLOWS_CAPABILITY };
  });

  await step("old client: a client without workflows-v1 is told the server is too old", async () => {
    const response = await call("POST", WORKFLOWS_ROUTES.list, {
      token: member,
      body: {},
      capabilities: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V7).filter(
        (capability) => capability !== WORKFLOWS_CAPABILITY,
      ),
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.ok(JSON.stringify(response.body).includes(sourceText("error.workflow.serverTooOld")));
    return { status: response.status };
  });

  const ids = await step("list: the member's list leaves out the workflow of a closed agent", async () => {
    const created = await ok(WORKFLOWS_ROUTES.create, ownerToken, { title: "Open", graph: agentGraph(open) });
    const openId = text(record(created.summary, "summary").id, "workflow id");
    const closedWorkflow = await hostWorkflow("Closed", agentGraph(closed));
    const viewWorkflow = await hostWorkflow("Viewer", agentGraph(viewer));
    const owner = list((await ok(WORKFLOWS_ROUTES.list, ownerToken, {})).workflows, "owner list");
    const mine = list((await ok(WORKFLOWS_ROUTES.list, member, {})).workflows, "member list");
    const titles = (rows: unknown[]) => rows.map((row) => text(record(row, "summary").title, "title")).sort();
    assert.deepEqual(titles(owner), ["Closed", "Open", "Viewer"]);
    assert.deepEqual(titles(mine), ["Open", "Viewer"]);
    return { open: openId, closed: closedWorkflow.id, viewer: viewWorkflow.id };
  });

  await step("none: the closed agent's workflow and its run answer as missing", async () => {
    const get = await refused(WORKFLOWS_ROUTES.get, member, { workflowId: ids.closed }, 404, "error.workflow.missing");
    const { run } = await runCauseEffect(
      current().workflows.startRun({ workflowId: ids.closed, requestId: requestId() }),
    );
    const stop = await refused(WORKFLOWS_ROUTES.stopRun, member, { runId: run.id }, 404, "error.workflow.missing");
    const read = await refused(WORKFLOWS_ROUTES.run, member, { runId: run.id }, 404, "error.workflow.missing");
    const status = (await runCauseEffect(current().workflows.run(run.id))).run.status;
    assert.notEqual(status, "stopping", "A member stopped a run they cannot see.");
    return { get, stop, read, runStatus: status };
  });

  await step("view: the member reads a view agent's workflow, and a change, a run or a delete is refused", async () => {
    const detail = await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.viewer });
    const revision = Number(detail.revision);
    const save = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      { workflowId: ids.viewer, baseRevision: revision, graph: { nodes: [promptNode], edges: [], strokes: [] } },
      403,
      "error.team.agentManageDenied",
    );
    const start = await refused(
      WORKFLOWS_ROUTES.startRun,
      member,
      { workflowId: ids.viewer, requestId: requestId() },
      403,
      "error.team.agentViewOnly",
    );
    const remove = await refused(
      WORKFLOWS_ROUTES.delete,
      member,
      { workflowId: ids.viewer },
      403,
      "error.team.agentManageDenied",
    );
    assert.equal((await runCauseEffect(current().workflows.get(ids.viewer))).revision, revision);
    return { save, start, remove };
  });

  await step(
    "chat: the member runs a chat agent's workflow, but a change, a rename or a delete is refused",
    async () => {
      const workflow = await hostWorkflow("Chatter", agentGraph(chatter));
      const save = await refused(
        WORKFLOWS_ROUTES.saveGraph,
        member,
        {
          workflowId: workflow.id,
          baseRevision: workflow.revision,
          graph: { nodes: [promptNode], edges: [], strokes: [] },
        },
        403,
        "error.team.agentManageDenied",
      );
      const rename = await refused(
        WORKFLOWS_ROUTES.rename,
        member,
        { workflowId: workflow.id, title: "Renamed" },
        403,
        "error.team.agentManageDenied",
      );
      const remove = await refused(
        WORKFLOWS_ROUTES.delete,
        member,
        { workflowId: workflow.id },
        403,
        "error.team.agentManageDenied",
      );
      const started = await ok(WORKFLOWS_ROUTES.startRun, member, { workflowId: workflow.id, requestId: requestId() });
      const ended = await settled(text(record(started.run, "run").id, "run id"), "agent");
      assert.equal(ended.status, "done");
      const kept = await runCauseEffect(current().workflows.get(workflow.id));
      assert.equal(kept.revision, workflow.revision);
      assert.equal(kept.summary.title, "Chatter");
      return { save, rename, remove, run: ended.status };
    },
  );

  await step("deleted agent: an owner still sees a workflow whose agent is gone; a member does not", async () => {
    const workflow = await hostWorkflow("Gone", agentGraph("deleted-agent"));
    const titles = async (token: string) =>
      list((await ok(WORKFLOWS_ROUTES.list, token, {})).workflows, "list").map((row) =>
        text(record(row, "summary").title, "title"),
      );
    assert.ok((await titles(ownerToken)).includes("Gone"), "The owner lost the workflow of a deleted agent.");
    assert.ok(!(await titles(member)).includes("Gone"), "The member sees the workflow of a deleted agent.");
    await ok(WORKFLOWS_ROUTES.get, ownerToken, { workflowId: workflow.id });
    const hidden = await refused(
      WORKFLOWS_ROUTES.get,
      member,
      { workflowId: workflow.id },
      404,
      "error.workflow.missing",
    );
    await ok(WORKFLOWS_ROUTES.delete, ownerToken, { workflowId: workflow.id });
    return { owner: 200, member: hidden, deleted: 200 };
  });

  await step("change: a save that adds the closed agent answers as missing and keeps the graph", async () => {
    const detail = await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.open });
    const revision = Number(detail.revision);
    const graph: WorkflowGraph = {
      ...agentGraph(open),
      nodes: [...agentGraph(open).nodes, { ...agentNode("closed", closed), at: at(900) }],
    };
    const status = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      { workflowId: ids.open, baseRevision: revision, graph },
      404,
      "error.workflow.missing",
    );
    assert.equal((await runCauseEffect(current().workflows.get(ids.open))).revision, revision);
    return { status, revision };
  });

  await step("place output: only an owner or admin adds one or moves it; a member keeps it", async () => {
    const before = Number((await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.open })).revision);
    const posting = withOutput(agentGraph(open), channelOutput("C-first"));
    const denied = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      { workflowId: ids.open, baseRevision: before, graph: posting },
      403,
      "error.team.adminRequired",
    );
    const owner = await ok(WORKFLOWS_ROUTES.saveGraph, ownerToken, {
      workflowId: ids.open,
      baseRevision: before,
      graph: posting,
    });
    assert.equal(owner.ok, true);
    const moved = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      {
        workflowId: ids.open,
        baseRevision: Number(owner.revision),
        graph: withOutput(agentGraph(open), channelOutput("C-second")),
      },
      403,
      "error.team.adminRequired",
    );
    const kept: WorkflowGraph = {
      ...posting,
      nodes: posting.nodes.map((node) => ({ ...node, at: { x: node.at.x, y: 40 } })),
    };
    const saved = await ok(WORKFLOWS_ROUTES.saveGraph, member, {
      workflowId: ids.open,
      baseRevision: Number(owner.revision),
      graph: kept,
    });
    assert.equal(saved.ok, true);
    return { denied, owner: 200, moved, kept: 200 };
  });

  await step("chats: workflows-chats-v1 goes to protocol 9; only an owner adds Telegram and Slack nodes", async () => {
    const capabilities = async (protocol: number) =>
      list(
        record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
        "capabilities",
      );
    assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_CHATS_CAPABILITY));
    assert.ok(!(await capabilities(TEAM_PROTOCOL_V7)).includes(WORKFLOWS_CHATS_CAPABILITY));
    const before = Number((await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.open })).revision);
    const base = agentGraph(open);
    const chats: WorkflowGraph = withOutput(
      {
        ...base,
        nodes: [
          ...base.nodes,
          {
            id: "telegram-trigger",
            kind: "trigger",
            at: at(-300),
            fields: { trigger: "telegram", event: "mention", connectionId: "telegram-chat", text: "deploy" },
          },
        ],
      },
      {
        id: "slack-output",
        kind: "output",
        at: at(600),
        fields: { target: "slack", connectionId: "slack-workspace", action: "post", placeId: "C-slack" },
      },
    );
    const denied = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      { workflowId: ids.open, baseRevision: before, graph: chats },
      403,
      "error.team.adminRequired",
    );
    const owner = await ok(WORKFLOWS_ROUTES.saveGraph, ownerToken, {
      workflowId: ids.open,
      baseRevision: before,
      graph: chats,
    });
    assert.equal(owner.ok, true);
    const saved = await ok(WORKFLOWS_ROUTES.get, ownerToken, { workflowId: ids.open });
    const nodes = JSON.stringify(record(saved.graph, "graph").nodes);
    assert.ok(nodes.includes("telegram-chat") && nodes.includes("C-slack"), nodes);
    return { denied, owner: 200, capability: WORKFLOWS_CHATS_CAPABILITY };
  });

  await step("channels: workflows-channels-v1 goes to protocol 9; only an owner adds a channel output", async () => {
    const capabilities = async (protocol: number) =>
      list(
        record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
        "capabilities",
      );
    assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_CHANNELS_CAPABILITY));
    assert.ok(!(await capabilities(TEAM_PROTOCOL_V7)).includes(WORKFLOWS_CHANNELS_CAPABILITY));
    const before = Number((await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.open })).revision);
    const posting = withOutput(agentGraph(open), {
      id: "chat-channel-output",
      kind: "output",
      at: at(600),
      fields: { target: "chat-channel", channelId: "channel-e2e" },
    });
    const denied = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      { workflowId: ids.open, baseRevision: before, graph: posting },
      403,
      "error.team.adminRequired",
    );
    const owner = await ok(WORKFLOWS_ROUTES.saveGraph, ownerToken, {
      workflowId: ids.open,
      baseRevision: before,
      graph: posting,
    });
    assert.equal(owner.ok, true);
    const saved = await ok(WORKFLOWS_ROUTES.get, ownerToken, { workflowId: ids.open });
    const nodes = JSON.stringify(record(saved.graph, "graph").nodes);
    assert.ok(nodes.includes("chat-channel") && nodes.includes("channel-e2e"), nodes);
    return { denied, owner: 200, capability: WORKFLOWS_CHANNELS_CAPABILITY };
  });

  await step("names: a member groups and names a channel output, and its settings still need an owner", async () => {
    const before = Number((await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.open })).revision);
    const output: WorkflowNode = {
      id: "chat-channel-output",
      kind: "output",
      at: at(600),
      fields: { target: "chat-channel", channelId: "channel-e2e" },
    };
    const group = { [WORKFLOW_GROUP_FIELDS.id]: "group-e2e", [WORKFLOW_GROUP_FIELDS.name]: "Posts" };
    const grouped = (fields: WorkflowNode["fields"]): WorkflowGraph => {
      const graph = withOutput(agentGraph(open), { ...output, fields: { ...fields, ...group } });
      return {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.kind === "agent" ? { ...node, fields: { ...node.fields, ...group } } : node,
        ),
      };
    };
    const saved = await ok(WORKFLOWS_ROUTES.saveGraph, member, {
      workflowId: ids.open,
      baseRevision: before,
      graph: grouped(output.fields),
    });
    assert.equal(saved.ok, true);
    const after = await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.open });
    const nodes = JSON.stringify(record(after.graph, "graph").nodes);
    assert.ok(nodes.includes("group-e2e") && nodes.includes("Posts"), nodes);
    const name = { [WORKFLOW_STEP_NAME_FIELD]: "Post to the team" };
    const named = await ok(WORKFLOWS_ROUTES.saveGraph, member, {
      workflowId: ids.open,
      baseRevision: Number(after.revision),
      graph: grouped({ ...output.fields, ...name }),
    });
    assert.equal(named.ok, true);
    const renamed = await ok(WORKFLOWS_ROUTES.get, member, { workflowId: ids.open });
    const namedNodes = record(renamed.graph, "graph").nodes;
    assert.ok(JSON.stringify(namedNodes).includes("Post to the team"), JSON.stringify(namedNodes));
    const denied = await refused(
      WORKFLOWS_ROUTES.saveGraph,
      member,
      {
        workflowId: ids.open,
        baseRevision: Number(renamed.revision),
        graph: grouped({ ...output.fields, ...name, channelId: "other" }),
      },
      403,
      "error.team.adminRequired",
    );
    return { grouped: 200, named: 200, denied };
  });

  await step("restore: a version that names the closed agent answers as missing", async () => {
    const restored = await hostWorkflow("Restore", agentGraph(closed));
    const [version] = await runCauseEffect(current().workflows.versions(restored.id));
    assert.ok(version, "The first save made no version.");
    const saved = await runCauseEffect(
      current().workflows.saveGraph({
        workflowId: restored.id,
        baseRevision: restored.revision,
        graph: agentGraph(open),
      }),
    );
    assert.ok(saved.ok);
    await ok(WORKFLOWS_ROUTES.get, member, { workflowId: restored.id });
    const status = await refused(
      WORKFLOWS_ROUTES.restoreVersion,
      member,
      { workflowId: restored.id, versionId: version.id },
      404,
      "error.workflow.missing",
    );
    const graph = (await runCauseEffect(current().workflows.get(restored.id))).graph;
    assert.ok(!JSON.stringify(graph).includes(closed), "The restore put the closed agent back.");
    return { status };
  });

  await step("version graph: a member reads an old version, but not one that names the closed agent", async () => {
    const first = await hostWorkflow("Versions", agentGraph(open));
    const versions = decodeRemoteWorkflowVersions(
      await ok(WORKFLOWS_ROUTES.versions, member, { workflowId: first.id }),
    );
    const [version] = versions;
    assert.ok(version, "The first save made no version.");
    const read = await ok(WORKFLOWS_ROUTES.versionGraph, member, { workflowId: first.id, versionId: version.id });
    assert.deepEqual(read.graph, agentGraph(open));
    const closedWorkflow = await hostWorkflow("Versions closed", agentGraph(closed));
    const [closedVersion] = await runCauseEffect(current().workflows.versions(closedWorkflow.id));
    assert.ok(closedVersion);
    const saved = await runCauseEffect(
      current().workflows.saveGraph({
        workflowId: closedWorkflow.id,
        baseRevision: closedWorkflow.revision,
        graph: agentGraph(open),
      }),
    );
    assert.ok(saved.ok);
    const hidden = await refused(
      WORKFLOWS_ROUTES.versionGraph,
      member,
      { workflowId: closedWorkflow.id, versionId: closedVersion.id },
      404,
      "error.workflow.versionMissing",
    );
    const missing = await refused(
      WORKFLOWS_ROUTES.versionGraph,
      member,
      { workflowId: first.id, versionId: "no-such-version" },
      404,
      "error.workflow.versionMissing",
    );
    return { read: 200, hidden, missing };
  });

  await step("open values: unknown kinds and statuses cross, and the client shows them read-only", async () => {
    const detail = {
      summary: {
        id: "w",
        title: "Newer",
        steps: 2,
        updatedAt: "2026-10-25T00:00:00.000Z",
        lastRun: { status: "paused", at: "2026-10-25T00:00:00.000Z" },
      },
      graph: {
        nodes: [
          { ...promptNode, extra: "dropped" },
          {
            id: "video",
            kind: "video",
            at: at(300),
            fields: { prompt: "A cat." },
            schedule: { kind: "daily", time: "09:00" },
          },
        ],
        edges: [
          { id: "to-video", from: "prompt", to: "video", type: "text" },
          { id: "audio", from: "prompt", to: "video", type: "audio" },
        ],
        strokes: [],
      },
      revision: 3,
      triggers: [{ nodeId: "video", type: "chat", nextDueAt: null, webhookUrl: null }],
    };
    const shown = answer(WORKFLOWS_ROUTES.get, detail, decodeRemoteWorkflowDetail);
    assert.equal(shown.needsNewerApp, true);
    assert.equal(shown.summary.lastRun?.status, "stopped");
    assert.deepEqual(
      shown.graph.nodes.map(({ id, kind, locked }) => ({ id, kind, locked })),
      [
        { id: "prompt", kind: "prompt", locked: undefined },
        { id: "video", kind: "note", locked: true },
      ],
    );
    assert.equal(shown.graph.nodes[1]?.schedule, undefined);
    assert.equal(shown.graph.nodes[1]?.fields.prompt, "A cat.", "The placeholder lost the node's settings.");
    assert.deepEqual(shown.graph.edges, []);
    assert.equal(shown.triggers[0]?.type, "manual");
    const known = answer(
      WORKFLOWS_ROUTES.get,
      { ...detail, graph: { nodes: [promptNode], edges: [], strokes: [] } },
      decodeRemoteWorkflowDetail,
    );
    assert.equal(known.needsNewerApp, undefined, "A graph of known kinds was marked read-only.");
    const newerRun = {
      id: "r",
      workflowId: "w",
      number: 1,
      triggerNodeId: null,
      source: "chat",
      status: "paused",
      error: null,
      startedAt: "2026-10-25T00:00:00.000Z",
      endedAt: null,
    };
    const run = answer(
      WORKFLOWS_ROUTES.run,
      {
        run: newerRun,
        steps: [
          {
            id: "s",
            workflowId: "w",
            runId: "r",
            nodeId: "prompt",
            attempt: 1,
            agentId: null,
            status: "queued",
            output: null,
            branch: null,
            error: null,
            startedAt: null,
            endedAt: null,
          },
        ],
      },
      decodeRemoteWorkflowRunDetail,
    );
    assert.deepEqual([run.run.source, run.run.status, run.steps[0]?.status], ["manual", "stopped", "stopped"]);
    assert.throws(() => answer(WORKFLOWS_ROUTES.get, { ...detail, revision: -1 }, decodeRemoteWorkflowDetail));
    assert.throws(() =>
      answer(
        WORKFLOWS_ROUTES.run,
        { run: { ...newerRun, status: "Not a name" }, steps: [] },
        decodeRemoteWorkflowRunDetail,
      ),
    );
    const target = await hostWorkflow("Newer save", { nodes: [promptNode], edges: [], strokes: [] });
    const save = await wire(WORKFLOWS_ROUTES.saveGraph, ownerToken, {
      workflowId: target.id,
      baseRevision: target.revision,
      graph: { nodes: [promptNode, { id: "video", kind: "video", at: at(300), fields: {} }], edges: [], strokes: [] },
    });
    assert.equal(save.status, 400, JSON.stringify(save.body));
    assert.throws(() => WORKFLOWS_CODECS.get(WORKFLOWS_ROUTES.runs)?.request({ workflowId: "w", limit: 0 }));
    assert.throws(() => WORKFLOWS_CODECS.get(WORKFLOWS_ROUTES.runs)?.request({ workflowId: "w", limit: 51 }));
    return { placeholder: "note, locked", edges: 0, run: "manual/stopped", save: save.status };
  });

  await step("webhook: the URL goes to the owner only, and only the owner makes a new secret", async () => {
    const graph: WorkflowGraph = {
      nodes: [{ id: "hook", kind: "trigger", at: at(0), fields: { trigger: "webhook" } }, agentNode("agent", open)],
      edges: [{ id: "edge", from: "hook", to: "agent", type: "text" }],
      strokes: [],
    };
    const hook = await hostWorkflow("Webhook", graph);
    const urlOf = (detail: JsonObject) =>
      record(
        list(detail.triggers, "triggers").find((row) => record(row, "trigger").nodeId === "hook"),
        "trigger",
      ).webhookUrl;
    assert.equal(urlOf(await ok(WORKFLOWS_ROUTES.get, ownerToken, { workflowId: hook.id })), WEBHOOK_URL);
    assert.equal(urlOf(await ok(WORKFLOWS_ROUTES.get, member, { workflowId: hook.id })), null);
    const rotate = { workflowId: hook.id, nodeId: "hook" };
    const denied = await refused(WORKFLOWS_ROUTES.rotateWebhookSecret, member, rotate, 403, "error.team.adminRequired");
    const rotated = await ok(WORKFLOWS_ROUTES.rotateWebhookSecret, ownerToken, rotate);
    assert.equal(rotated.secret, SECRET);
    return { ownerUrl: "shown", memberUrl: null, memberRotate: denied, ownerRotate: 200 };
  });

  await step("run: a member's run crosses with its step output clipped to the wire limit", async () => {
    const started = await ok(WORKFLOWS_ROUTES.startRun, member, { workflowId: ids.open, requestId: requestId() });
    const runId = text(record(started.run, "run").id, "run id");
    const local = await settled(runId, "agent");
    assert.equal(local.output?.length, LONG_ANSWER.length);
    const read = await ok(WORKFLOWS_ROUTES.run, member, { runId });
    const agentStep = record(
      list(read.steps, "steps").find((row) => record(row, "step").nodeId === "agent"),
      "agent step",
    );
    assert.equal(text(agentStep.output, "output").length, WORKFLOW_STEP_TEXT_LIMIT);
    return { hostOutput: local.output?.length, wireOutput: WORKFLOW_STEP_TEXT_LIMIT };
  });

  await step("hidden now: a step of an agent that is hidden later does not cross", async () => {
    const workflow = await hostWorkflow("Later", agentGraph(later));
    const { run } = await runCauseEffect(
      current().workflows.startRun({ workflowId: workflow.id, requestId: requestId() }),
    );
    const ended = await settled(run.id, "agent");
    assert.equal(ended.status, "failed");
    assert.ok(ended.error);
    const saved = await runCauseEffect(
      current().workflows.saveGraph({
        workflowId: workflow.id,
        baseRevision: workflow.revision,
        graph: { nodes: [promptNode], edges: [], strokes: [] },
      }),
    );
    assert.ok(saved.ok);
    await setLevels(ownerToken, { [closed]: "none", [viewer]: "view", [chatter]: "chat", [later]: "none" });
    const nodesOf = (detail: JsonObject) =>
      list(detail.steps, "steps")
        .map((row) => text(record(row, "step").nodeId, "node id"))
        .sort();
    const mine = nodesOf(await ok(WORKFLOWS_ROUTES.run, member, { runId: run.id }));
    assert.deepEqual(mine, ["prompt"], "The member got the step of a hidden agent.");
    const ownerRead = await ok(WORKFLOWS_ROUTES.run, ownerToken, { runId: run.id });
    assert.deepEqual(nodesOf(ownerRead), ["agent", "prompt"]);
    const ownerStep = record(
      list(ownerRead.steps, "steps").find((row) => record(row, "step").nodeId === "agent"),
      "agent step",
    );
    assert.equal(ownerStep.error, ended.error, "The owner lost the step error.");
    const page = await ok(WORKFLOWS_ROUTES.runs, member, { workflowId: workflow.id, limit: 10 });
    assert.deepEqual(nodesOf(record(list(page.runs, "runs")[0], "run")), ["prompt"]);
    const retry = await refused(
      WORKFLOWS_ROUTES.retryStep,
      member,
      { stepId: ended.id, requestId: requestId() },
      404,
      "error.workflow.stepMissing",
    );
    const stop = await refused(WORKFLOWS_ROUTES.stopRun, member, { runId: run.id }, 404, "error.workflow.runMissing");
    return { member: mine, owner: ["agent", "prompt"], retry, stop };
  });

  await step("provider: a model step on a local-only provider answers as missing to a peer", async () => {
    const local = await hostWorkflow("Local model", {
      nodes: [
        promptNode,
        { id: "llm", kind: "llm", at: at(300), fields: { provider: "inception", model: "mercury", text: "Sum up." } },
      ],
      edges: [{ id: "edge", from: "prompt", to: "llm", type: "text" }],
      strokes: [],
    });
    const status = await refused(WORKFLOWS_ROUTES.get, member, { workflowId: local.id }, 404, "error.workflow.missing");
    const titles = list((await ok(WORKFLOWS_ROUTES.list, member, {})).workflows, "member list").map((row) =>
      text(record(row, "summary").title, "title"),
    );
    assert.ok(!titles.includes("Local model"), "The member list has a workflow of a local-only provider.");
    const remoteOwner = await refused(
      WORKFLOWS_ROUTES.get,
      ownerToken,
      { workflowId: local.id },
      404,
      "error.workflow.missing",
    );
    const llm = (await runCauseEffect(current().workflows.get(local.id))).graph.nodes.find((node) => node.id === "llm");
    assert.equal(llm?.fields.provider, "inception", "The host lost the model step settings.");
    return { member: status, remoteOwner, host: "settings kept" };
  });

  await step("event: a rename reaches the member's socket as workflows-changed", async () => {
    const socket = await openEvents(member);
    const changed = nextMessage(socket, (value) => {
      const event = workflowsEvent(value);
      return event && event.workflowId === ids.open ? event : null;
    });
    await ok(WORKFLOWS_ROUTES.rename, ownerToken, { workflowId: ids.open, title: "Open renamed" });
    return await changed;
  });

  await step("size: a workflow too large for one frame answers 413 with its own sentence", async () => {
    const nodes: WorkflowNode[] = Array.from({ length: 100 }, (_, index) => ({
      id: `text-${index}`,
      kind: "text",
      at: { x: index * 10, y: 0 },
      fields: { text: "b".repeat(20_000) },
    }));
    const huge = await hostWorkflow("Huge", { nodes, edges: [], strokes: [] });
    const status = await refused(
      WORKFLOWS_ROUTES.get,
      member,
      { workflowId: huge.id },
      413,
      "error.workflow.tooLargeToSend",
    );
    const titles = list((await ok(WORKFLOWS_ROUTES.list, member, {})).workflows, "member list").map((row) =>
      text(record(row, "summary").title, "title"),
    );
    assert.ok(titles.includes("Huge"), "The list left out a large workflow.");
    return { status };
  });

  await step("delete: the member deletes a workflow they can use", async () => {
    await ok(WORKFLOWS_ROUTES.delete, member, { workflowId: ids.open });
    const missing = await refused(
      WORKFLOWS_ROUTES.get,
      member,
      { workflowId: ids.open },
      404,
      "error.workflow.missing",
    );
    return { deleted: 200, after: missing };
  });

  await step(
    "media: a member keeps an uploaded PNG as a picture of the host; a GIF, a used draft and an old client are refused",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_MEDIA_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V7)).includes(WORKFLOWS_MEDIA_CAPABILITY));
      const codec = WORKFLOWS_MEDIA_CODECS.get(WORKFLOWS_MEDIA_ROUTES.keepPicture);
      assert.ok(codec, "No workflows-media-v1 codec for keep-picture.");
      const keep = async (draftId: string, capabilities = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)) => {
        codec.request({ draftId });
        const response = await call("POST", WORKFLOWS_MEDIA_ROUTES.keepPicture, {
          token: member,
          body: { draftId },
          protocol: TEAM_PROTOCOL_V9,
          capabilities,
        });
        return { status: response.status, body: codec.response(response.status, response.body) };
      };
      const png = Uint8Array.from(Buffer.from(PNG_BASE64, "base64"));
      const pngDraft = await sendDraft(member, "frame.png", "image/png", png);
      const gifDraft = await sendDraft(
        member,
        "frame.gif",
        "image/gif",
        Uint8Array.from(Buffer.from(GIF_BASE64, "base64")),
      );

      const old = await keep(
        pngDraft,
        teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).filter((capability) => capability !== WORKFLOWS_MEDIA_CAPABILITY),
      );
      assert.equal(old.status, 400, JSON.stringify(old.body));
      assert.ok(JSON.stringify(old.body).includes(sourceText("error.workflow.serverTooOld")), JSON.stringify(old.body));

      const gif = await keep(gifDraft);
      assert.notEqual(gif.status, 200, JSON.stringify(gif.body));
      assert.ok(JSON.stringify(gif.body).includes(sourceText("error.workflow.pictureType")), JSON.stringify(gif.body));

      const kept = await keep(pngDraft);
      assert.equal(kept.status, 200, JSON.stringify(kept.body));
      const fileId = text(record(kept.body, "keep-picture").fileId, "fileId");
      assert.notEqual(fileId, pngDraft, "The host answered the draft id, not a file id.");
      const file = await fetch(`http://127.0.0.1:${current().port}${TEAM_API_ROUTES.attachment(fileId)}`, {
        headers: v9Headers(member),
      });
      assert.equal(file.status, 200, `The kept picture returned ${file.status}.`);
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), png, "The kept picture has other bytes.");

      const used = await keep(pngDraft);
      assert.notEqual(used.status, 200, JSON.stringify(used.body));
      assert.ok(
        JSON.stringify(used.body).includes(sourceText("error.workflow.pictureMissing")),
        JSON.stringify(used.body),
      );
      return { old: old.status, gif: gif.status, kept: kept.status, file: file.status, used: used.status };
    },
  );

  await step(
    "sunra: a member reads whether the host has a Sunra sign-in and its credits; an old client is refused",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_SUNRA_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V7)).includes(WORKFLOWS_SUNRA_CAPABILITY));
      const codec = WORKFLOWS_SUNRA_CODECS.get(WORKFLOWS_SUNRA_ROUTES.providers);
      assert.ok(codec, "No workflows-sunra-v1 codec for providers.");
      const read = async (capabilities = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)) => {
        codec.request({});
        const response = await call("POST", WORKFLOWS_SUNRA_ROUTES.providers, {
          token: member,
          body: {},
          protocol: TEAM_PROTOCOL_V9,
          capabilities,
        });
        return { status: response.status, body: codec.response(response.status, response.body) };
      };
      const creditsCodec = WORKFLOWS_SUNRA_CODECS.get(WORKFLOWS_SUNRA_ROUTES.credits);
      assert.ok(creditsCodec, "No workflows-sunra-v1 codec for credits.");
      const credits = async () => {
        creditsCodec.request({});
        const response = await call("POST", WORKFLOWS_SUNRA_ROUTES.credits, {
          token: member,
          body: {},
          protocol: TEAM_PROTOCOL_V9,
          capabilities: teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9),
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        return creditsCodec.response(response.status, response.body);
      };
      const signedOut = await read();
      assert.equal(signedOut.status, 200, JSON.stringify(signedOut.body));
      assert.deepEqual(signedOut.body, { sunra: false });
      const creditsSignedOut = await credits();
      assert.deepEqual(creditsSignedOut, { sunra: null });
      sunraSignedIn = true;
      const signedIn = await read();
      assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
      assert.deepEqual(signedIn.body, { sunra: true });
      const creditsSignedIn = await credits();
      assert.deepEqual(creditsSignedIn, { sunra: { available: 120, quota: 500 } });
      const old = await read(
        teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).filter((capability) => capability !== WORKFLOWS_SUNRA_CAPABILITY),
      );
      assert.equal(old.status, 400, JSON.stringify(old.body));
      assert.ok(JSON.stringify(old.body).includes(sourceText("error.workflow.serverTooOld")), JSON.stringify(old.body));
      return {
        signedOut: signedOut.body,
        signedIn: signedIn.body,
        creditsSignedOut,
        creditsSignedIn,
        old: old.status,
      };
    },
  );

  await step(
    "higgsfield: a member reads whether the host has a Higgsfield sign-in and its credits; each media route answers only its own field; an old client is refused",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_HIGGSFIELD_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V7)).includes(WORKFLOWS_HIGGSFIELD_CAPABILITY));
      const codec = WORKFLOWS_HIGGSFIELD_CODECS.get(WORKFLOWS_HIGGSFIELD_ROUTES.providers);
      assert.ok(codec, "No workflows-higgsfield-v1 codec for providers.");
      const creditsCodec = WORKFLOWS_HIGGSFIELD_CODECS.get(WORKFLOWS_HIGGSFIELD_ROUTES.credits);
      assert.ok(creditsCodec, "No workflows-higgsfield-v1 codec for credits.");
      const raw = async (route: string, capabilities = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)) =>
        call("POST", route, { token: member, body: {}, protocol: TEAM_PROTOCOL_V9, capabilities });
      const read = async () => {
        codec.request({});
        const response = await raw(WORKFLOWS_HIGGSFIELD_ROUTES.providers);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        codec.response(response.status, response.body);
        return response.body;
      };
      const credits = async () => {
        creditsCodec.request({});
        const response = await raw(WORKFLOWS_HIGGSFIELD_ROUTES.credits);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        creditsCodec.response(response.status, response.body);
        return response.body;
      };
      assert.equal(sunraSignedIn, true);
      higgsfieldSignedIn = false;
      const signedOut = await read();
      assert.deepEqual(signedOut, { higgsfield: false });
      const creditsSignedOut = await credits();
      assert.deepEqual(creditsSignedOut, { higgsfield: null });
      higgsfieldSignedIn = true;
      const signedIn = await read();
      assert.deepEqual(signedIn, { higgsfield: true });
      const creditsSignedIn = await credits();
      assert.deepEqual(creditsSignedIn, { higgsfield: { available: 42, quota: null } });
      const sunraProviders = await raw(WORKFLOWS_SUNRA_ROUTES.providers);
      assert.deepEqual(sunraProviders.body, { sunra: true });
      const sunraCredits = await raw(WORKFLOWS_SUNRA_ROUTES.credits);
      assert.deepEqual(sunraCredits.body, { sunra: { available: 120, quota: 500 } });
      const old = await raw(
        WORKFLOWS_HIGGSFIELD_ROUTES.providers,
        teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).filter(
          (capability) => capability !== WORKFLOWS_HIGGSFIELD_CAPABILITY,
        ),
      );
      assert.equal(old.status, 400, JSON.stringify(old.body));
      assert.ok(JSON.stringify(old.body).includes(sourceText("error.workflow.serverTooOld")), JSON.stringify(old.body));
      higgsfieldSignedIn = false;
      return {
        signedOut,
        signedIn,
        creditsSignedOut,
        creditsSignedIn,
        sunraProviders: sunraProviders.body,
        sunraCredits: sunraCredits.body,
        old: old.status,
      };
    },
  );

  await step(
    "media account: the host advertises workflows-media-account-v1; an unknown account fails and never falls back",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V7)).includes(WORKFLOWS_MEDIA_ACCOUNT_CAPABILITY));
      const imageGraph = (account: string): WorkflowGraph => ({
        nodes: [promptNode, { id: "image", kind: "image", at: at(300), fields: { model: "gpt-image", account } }],
        edges: [{ id: "edge", from: "prompt", to: "image", type: "text" }],
        strokes: [],
      });
      const run = async (account: string) => {
        const workflow = await hostWorkflow(`Image ${account || "own"}`, imageGraph(account));
        const detail = await ok(WORKFLOWS_ROUTES.get, ownerToken, { workflowId: workflow.id });
        const image = list(record(detail.graph, "graph").nodes, "nodes")
          .map((node) => record(node, "node"))
          .find((node) => node.id === "image");
        assert.equal(record(image?.fields, "fields").account, account);
        const started = await ok(WORKFLOWS_ROUTES.startRun, ownerToken, {
          workflowId: workflow.id,
          requestId: requestId(),
        });
        return settled(text(record(started.run, "run").id, "run id"), "image");
      };
      const missing = await run("acct-not-on-this-host");
      assert.equal(missing.status, "failed");
      assert.equal(
        missing.error,
        sourceText("error.provider.accountNotFound", { provider: providerLabel("codex") }),
        JSON.stringify(missing.error),
      );
      const own = await run("");
      assert.equal(own.status, "done", JSON.stringify(own.error));
      const fallback = await run("default");
      assert.equal(fallback.status, "done", JSON.stringify(fallback.error));
      assert.deepEqual(mediaAccounts, ["acct-not-on-this-host", null, null]);
      return { missing: missing.error, own: own.status, default: fallback.status, accounts: mediaAccounts };
    },
  );

  await step(
    "transparent image: the host advertises workflows-media-transparent-v1; GPT Image and Grok Imagine get a transparent request",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V7)).includes(WORKFLOWS_MEDIA_TRANSPARENT_CAPABILITY));
      const run = async (fields: WorkflowNode["fields"]) => {
        const before = mediaRequests.length;
        const workflow = await hostWorkflow(`Transparent ${String(fields.model)}`, {
          nodes: [promptNode, { id: "image", kind: "image", at: at(300), fields }],
          edges: [{ id: "edge", from: "prompt", to: "image", type: "text" }],
          strokes: [],
        });
        const started = await ok(WORKFLOWS_ROUTES.startRun, ownerToken, {
          workflowId: workflow.id,
          requestId: requestId(),
        });
        const done = await settled(text(record(started.run, "run").id, "run id"), "image");
        assert.equal(done.status, "done", JSON.stringify(done.error));
        const request = mediaRequests[before];
        assert.ok(request, "the step reached the media maker");
        return request;
      };
      const gpt = await run({ model: "gpt-image", background: "transparent" });
      assert.equal(gpt.transparent, true);
      assert.match(gpt.prompt, /transparent background/);
      const grok = await run({ model: "grok-imagine", background: "transparent" });
      assert.equal(grok.transparent, true);
      assert.match(grok.prompt, /#00FF00/);
      const video = await run({ model: "grok-imagine", media: "video", background: "transparent" });
      assert.equal(video.transparent, false);
      assert.doesNotMatch(video.prompt, /#00FF00/);
      const solid = await run({ model: "gpt-image" });
      assert.equal(solid.transparent, false);
      assert.doesNotMatch(solid.prompt, /transparent background/);
      return { gpt: gpt.transparent, grok: grok.transparent, video: video.transparent, solid: solid.transparent };
    },
  );

  await step(
    "custom size, 4:5 and 5:4: the host advertises workflows-media-size-v1; the model gets the nearest aspect and the step keeps the cropped file",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_MEDIA_SIZE_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V7)).includes(WORKFLOWS_MEDIA_SIZE_CAPABILITY));
      const run = async (fields: WorkflowNode["fields"]) => {
        const before = { media: mediaRequests.length, size: sizeRequests.length };
        const workflow = await hostWorkflow(`Size ${JSON.stringify(fields)}`, {
          nodes: [promptNode, { id: "image", kind: "image", at: at(300), fields }],
          edges: [{ id: "edge", from: "prompt", to: "image", type: "text" }],
          strokes: [],
        });
        const started = await ok(WORKFLOWS_ROUTES.startRun, ownerToken, {
          workflowId: workflow.id,
          requestId: requestId(),
        });
        const done = await settled(text(record(started.run, "run").id, "run id"), "image");
        assert.equal(done.status, "done", JSON.stringify(done.error));
        const request = mediaRequests[before.media];
        assert.ok(request, "the step reached the media maker");
        return { output: done.output, aspect: request.aspect, sizes: sizeRequests.slice(before.size) };
      };
      const wide = await run({ model: "gpt-image", aspect: "custom", width: 1600, height: 900 });
      assert.equal(wide.aspect, "16:9");
      assert.deepEqual(wide.sizes, [{ attachmentId: "e2e-media-file", width: 1600, height: 900 }]);
      assert.equal(wide.output, "e2e-media-file-1600x900");
      const tall = await run({ model: "grok-imagine", aspect: "custom", width: 700, height: 1300 });
      assert.equal(tall.aspect, "9:16");
      assert.equal(tall.output, "e2e-media-file-700x1300");
      sizeFails = true;
      const failed = await run({ model: "gpt-image", aspect: "custom", width: 800, height: 800 }).finally(() => {
        sizeFails = false;
      });
      assert.equal(failed.sizes.length, 1);
      assert.equal(failed.output, "e2e-media-file");
      const video = await run({ model: "grok-imagine", media: "video", aspect: "custom", width: 1600, height: 900 });
      assert.deepEqual(video.sizes, []);
      assert.equal(video.output, "e2e-media-file");
      const tooLarge = await run({ model: "gpt-image", aspect: "custom", width: 5000, height: 900 });
      assert.deepEqual(tooLarge.sizes, []);
      assert.equal(tooLarge.output, "e2e-media-file");
      const post = await run({ model: "gpt-image", aspect: "4:5" });
      assert.equal(post.aspect, "4:5");
      assert.deepEqual(post.sizes, []);
      const postVideo = await run({ model: "grok-imagine", media: "video", aspect: "4:5" });
      assert.equal(postVideo.aspect, "1:1");
      const postSize = await run({ model: "gpt-image", aspect: "custom", width: 1080, height: 1350 });
      assert.equal(postSize.aspect, "4:5");
      assert.equal(postSize.output, "e2e-media-file-1080x1350");
      const print = await run({ model: "grok-imagine", aspect: "5:4" });
      assert.equal(print.aspect, "5:4");
      const printVideo = await run({ model: "grok-imagine", media: "video", aspect: "5:4" });
      assert.equal(printVideo.aspect, "1:1");
      const printSize = await run({ model: "gpt-image", aspect: "custom", width: 1350, height: 1080 });
      assert.equal(printSize.aspect, "5:4");
      assert.equal(printSize.output, "e2e-media-file-1350x1080");
      return { wide, tall, failed, video, tooLarge, post, postVideo, postSize, print, printVideo, printSize };
    },
  );

  await step(
    "empty media request: a step with no description runs from its input, and fails with no input",
    async () => {
      const run = async (title: string, input: string) => {
        const before = mediaRequests.length;
        const workflow = await hostWorkflow(title, {
          nodes: [
            { ...promptNode, fields: { text: input } },
            { id: "image", kind: "image", at: at(300), fields: { model: "gpt-image" } },
          ],
          edges: [{ id: "edge", from: "prompt", to: "image", type: "text" }],
          strokes: [],
        });
        const started = await ok(WORKFLOWS_ROUTES.startRun, ownerToken, {
          workflowId: workflow.id,
          requestId: requestId(),
        });
        const done = await settled(text(record(started.run, "run").id, "run id"), "image");
        return { done, requests: mediaRequests.slice(before) };
      };
      const fromInput = await run("No description, text input", "A red kite over a beach.");
      assert.equal(fromInput.done.status, "done", JSON.stringify(fromInput.done.error));
      assert.equal(fromInput.requests.length, 1);
      assert.match(fromInput.requests[0]?.prompt ?? "", /A red kite over a beach\./);
      const empty = await run("No description, empty input", "");
      assert.equal(empty.done.status, "failed");
      assert.equal(empty.done.error, sourceText("error.workflow.mediaEmptyRequest"), JSON.stringify(empty.done.error));
      assert.equal(empty.requests.length, 0, "an empty request never reaches the media maker");
      return { fromInput: fromInput.done.status, empty: empty.done.error };
    },
  );

  await step(
    "media catalog: the host advertises workflows-media-catalog-v1; a member reads the live models and a price, and a step runs a model that only the live list has",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_MEDIA_CATALOG_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V7)).includes(WORKFLOWS_MEDIA_CATALOG_CAPABILITY));
      const catalogCodec = WORKFLOWS_MEDIA_CATALOG_CODECS.get(WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog);
      assert.ok(catalogCodec, "No workflows-media-catalog-v1 codec for catalog.");
      const priceCodec = WORKFLOWS_MEDIA_CATALOG_CODECS.get(WORKFLOWS_MEDIA_CATALOG_ROUTES.price);
      assert.ok(priceCodec, "No workflows-media-catalog-v1 codec for price.");
      const raw = async (route: string, body: unknown, capabilities = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9)) =>
        call("POST", route, { token: member, body, protocol: TEAM_PROTOCOL_V9, capabilities });
      const catalog = async () => {
        catalogCodec.request({});
        const response = await raw(WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog, {});
        assert.equal(response.status, 200, JSON.stringify(response.body));
        catalogCodec.response(response.status, response.body);
        return response.body;
      };
      const ask: WorkflowMediaPriceRequest = {
        model: LIVE_MODEL.id,
        kind: "video",
        aspect: "16:9",
        duration: 10,
        resolution: "1080p",
        transparent: false,
      };
      const price = async (request: WorkflowMediaPriceRequest) => {
        priceCodec.request(request);
        const response = await raw(WORKFLOWS_MEDIA_CATALOG_ROUTES.price, request);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        priceCodec.response(response.status, response.body);
        return response.body;
      };
      higgsfieldSignedIn = false;
      const signedOut = await catalog();
      assert.deepEqual(signedOut, { models: [] });
      const priceSignedOut = await price(ask);
      assert.deepEqual(priceSignedOut, { credits: null });
      higgsfieldSignedIn = true;
      try {
        const signedIn = await catalog();
        assert.deepEqual(signedIn, { models: [LIVE_MODEL] });
        const before = priceRequests.length;
        const priceSignedIn = await price(ask);
        assert.deepEqual(priceSignedIn, { credits: LIVE_PRICE });
        assert.deepEqual(priceRequests.slice(before), [ask], "the request reached the host's price read unchanged");
        const badPrice = await raw(WORKFLOWS_MEDIA_CATALOG_ROUTES.price, { ...ask, duration: -1 });
        assert.equal(badPrice.status, 400, JSON.stringify(badPrice.body));
        assert.equal(priceRequests.length, before + 1);
        assert.ok(!workflowVideoLengthChoices(LIVE_MODEL.durations).includes(7), "7 s is a custom length");
        const beforeModels = mediaModels.length;
        const workflow = await hostWorkflow("Live Higgsfield model", {
          nodes: [
            promptNode,
            {
              id: "image",
              kind: "image",
              at: at(300),
              fields: { model: LIVE_MODEL.id, media: "video", aspect: "16:9", duration: 7, resolution: "1080p" },
            },
          ],
          edges: [{ id: "edge", from: "prompt", to: "image", type: "text" }],
          strokes: [],
        });
        const started = await ok(WORKFLOWS_ROUTES.startRun, ownerToken, {
          workflowId: workflow.id,
          requestId: requestId(),
        });
        const done = await settled(text(record(started.run, "run").id, "run id"), "image");
        assert.equal(done.status, "done", JSON.stringify(done.error));
        assert.deepEqual(mediaModels.slice(beforeModels), [
          { model: LIVE_MODEL.providerModel, catalogId: LIVE_MODEL.id },
        ]);
        assert.deepEqual(mediaDurations.slice(beforeModels), [7], "the step asks for the custom length");
        const old = await raw(
          WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog,
          {},
          teamCapabilitiesForProtocol(TEAM_PROTOCOL_V9).filter(
            (capability) => capability !== WORKFLOWS_MEDIA_CATALOG_CAPABILITY,
          ),
        );
        assert.equal(old.status, 400, JSON.stringify(old.body));
        assert.ok(
          JSON.stringify(old.body).includes(sourceText("error.workflow.serverTooOld")),
          JSON.stringify(old.body),
        );
        return {
          signedOut,
          signedIn,
          priceSignedOut,
          priceSignedIn,
          badPrice: badPrice.status,
          step: done.status,
          old: old.status,
        };
      } finally {
        higgsfieldSignedIn = false;
      }
    },
  );

  await step(
    "media catalog v2: the host advertises workflows-media-catalog-v2 to protocol 10; its catalog and price carry settings and 21:9, the v1 routes do not, and a step sends only the settings of its model",
    async () => {
      const capabilities = async (protocol: number) =>
        decodeTeamProtocolSupportExpanded((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body)
          .capabilities;
      assert.ok((await capabilities(TEAM_PROTOCOL_V10)).includes(WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY));
      const codec = (route: string) => {
        const found = WORKFLOWS_MEDIA_CATALOG_V2_CODECS.get(route) ?? WORKFLOWS_MEDIA_CATALOG_CODECS.get(route);
        assert.ok(found, `No codec for ${route}.`);
        return found;
      };
      const raw = async (route: string, body: unknown, capabilities: readonly string[] = TEAM_CURRENT_CAPABILITIES) =>
        call("POST", route, { token: member, body, protocol: TEAM_PROTOCOL_V10, capabilities });
      const read = async (route: string, body: unknown) => {
        codec(route).request(body);
        const response = await raw(route, body);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        return codec(route).response(response.status, response.body);
      };
      higgsfieldSignedIn = true;
      liveModels = [LIVE_MODEL, OPTIONS_MODEL, CINEMA_MODEL];
      try {
        const catalogV2 = await read(WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.catalog, {});
        assert.deepEqual(catalogV2, { models: [LIVE_MODEL, OPTIONS_MODEL, CINEMA_MODEL] });
        const catalogV1 = await read(WORKFLOWS_MEDIA_CATALOG_ROUTES.catalog, {});
        const { options: _options, inputs: _inputs, modes: _modes, ...withoutOptions } = OPTIONS_MODEL;
        assert.deepEqual(catalogV1, { models: [LIVE_MODEL, { ...withoutOptions, aspects: ["16:9"] }] });
        const ask: WorkflowMediaPriceRequest = {
          model: OPTIONS_MODEL.id,
          kind: "video",
          aspect: "21:9",
          duration: 5,
          resolution: "720p",
          transparent: false,
          options: [{ name: "generate_audio", value: "off" }],
        };
        const before = priceRequests.length;
        const priceV2 = await read(WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.price, ask);
        assert.deepEqual(priceV2, { credits: null });
        assert.deepEqual(priceRequests.slice(before), [ask], "the settings reached the host's price read unchanged");
        const { options: _asked, ...askV1 } = ask;
        const priceV1 = await raw(WORKFLOWS_MEDIA_CATALOG_ROUTES.price, askV1);
        assert.equal(priceV1.status, 400, JSON.stringify(priceV1.body));
        assert.equal(priceRequests.length, before + 1);
        const beforeMedia = {
          options: mediaOptions.length,
          requests: mediaRequests.length,
          images: mediaImages.length,
        };
        const workflow = await hostWorkflow("Higgsfield settings", {
          nodes: [
            promptNode,
            { id: "clip", kind: "asset", at: { x: 0, y: 200 }, fields: { fileId: "e2e-reference-video" } },
            {
              id: "image",
              kind: "image",
              at: at(300),
              fields: {
                model: OPTIONS_MODEL.id,
                media: "video",
                aspect: "21:9",
                duration: 5,
                resolution: "720p",
                options: JSON.stringify({
                  mode: "omni_reference",
                  generate_audio: "off",
                  bitrate_mode: "turbo",
                  seed: "7",
                }),
              },
            },
          ],
          edges: [
            { id: "edge", from: "prompt", to: "image", type: "text" },
            { id: "clip-edge", from: "clip", to: "image", type: "file" },
          ],
          strokes: [],
        });
        const started = await ok(WORKFLOWS_ROUTES.startRun, ownerToken, {
          workflowId: workflow.id,
          requestId: requestId(),
        });
        const done = await settled(text(record(started.run, "run").id, "run id"), "image");
        assert.equal(done.status, "done", JSON.stringify(done.error));
        assert.deepEqual(mediaOptions.slice(beforeMedia.options), [
          [
            { name: "mode", value: "omni_reference" },
            { name: "generate_audio", value: "off" },
          ],
        ]);
        assert.deepEqual(mediaImages.slice(beforeMedia.images), [
          [{ role: "file", attachmentId: "e2e-reference-video" }],
        ]);
        assert.equal(mediaRequests[beforeMedia.requests]?.aspect, "21:9");
        const old = await raw(
          WORKFLOWS_MEDIA_CATALOG_V2_ROUTES.catalog,
          {},
          TEAM_CURRENT_CAPABILITIES.filter((capability) => capability !== WORKFLOWS_MEDIA_CATALOG_V2_CAPABILITY),
        );
        assert.equal(old.status, 400, JSON.stringify(old.body));
        assert.ok(
          JSON.stringify(old.body).includes(sourceText("error.workflow.serverTooOld")),
          JSON.stringify(old.body),
        );
        return {
          catalogV2,
          catalogV1,
          priceV2,
          priceV1: priceV1.status,
          stepOptions: mediaOptions.slice(beforeMedia.options),
          stepImages: mediaImages.slice(beforeMedia.images),
          old: old.status,
        };
      } finally {
        higgsfieldSignedIn = false;
        liveModels = [LIVE_MODEL];
      }
    },
  );

  await step(
    "service accounts: the host advertises workflows-media-service-account-v1 to a protocol 10 peer; a member reads each account and its credits; a step on a missing account fails and never falls back",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V10)).includes(WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY));
      const raw = async (route: string, capabilities = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10)) =>
        call("POST", route, { token: member, body: {}, protocol: TEAM_PROTOCOL_V10, capabilities });
      const read = async (route: string) => {
        const codec = WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CODECS.get(route);
        assert.ok(codec, `No workflows-media-service-account-v1 codec for ${route}.`);
        codec.request({});
        const response = await raw(route);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        codec.response(response.status, response.body);
        return response.body;
      };
      const imageGraph = (account: string): WorkflowGraph => ({
        nodes: [
          promptNode,
          {
            id: "image",
            kind: "image",
            at: at(300),
            fields: { model: LIVE_MODEL.id, media: "video", aspect: "16:9", duration: 5, resolution: "720p", account },
          },
        ],
        edges: [{ id: "edge", from: "prompt", to: "image", type: "text" }],
        strokes: [],
      });
      const run = async (account: string) => {
        const workflow = await hostWorkflow(`Higgsfield ${account || "first"}`, imageGraph(account));
        const started = await ok(WORKFLOWS_ROUTES.startRun, ownerToken, {
          workflowId: workflow.id,
          requestId: requestId(),
        });
        return settled(text(record(started.run, "run").id, "run id"), "image");
      };
      higgsfieldSignedIn = true;
      try {
        serviceAccounts = [];
        const none = { accounts: await read(WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.accounts) };
        assert.deepEqual(none.accounts, { accounts: [] });
        serviceAccounts = [
          { provider: "sunra", id: "sunra-row", name: null, credits: { available: 120, quota: 500 } },
          { provider: "higgsfield", id: "higgsfield-row", name: null, credits: { available: 42, quota: null } },
          { provider: "higgsfield", id: "higgsfield-row-2", name: "Higgsfield 2", credits: null },
        ];
        const accounts = await read(WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.accounts);
        assert.deepEqual(accounts, {
          accounts: serviceAccounts.map(({ provider, id, name }) => ({ provider, id, name })),
        });
        const credits = await read(WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.credits);
        assert.deepEqual(credits, { accounts: serviceAccounts });
        const legacy = await raw(WORKFLOWS_HIGGSFIELD_ROUTES.credits);
        assert.deepEqual(legacy.body, { higgsfield: { available: 42, quota: null } });
        const old = await raw(
          WORKFLOWS_MEDIA_SERVICE_ACCOUNT_ROUTES.accounts,
          teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10).filter(
            (capability) => capability !== WORKFLOWS_MEDIA_SERVICE_ACCOUNT_CAPABILITY,
          ),
        );
        assert.equal(old.status, 400, JSON.stringify(old.body));
        assert.ok(
          JSON.stringify(old.body).includes(sourceText("error.workflow.serverTooOld")),
          JSON.stringify(old.body),
        );
        const before = mediaAccounts.length;
        const missing = await run("higgsfield-row-2");
        assert.equal(missing.status, "failed");
        assert.equal(
          missing.error,
          sourceText("error.provider.accountNotFound", { provider: "Higgsfield" }),
          JSON.stringify(missing.error),
        );
        const first = await run("");
        assert.equal(first.status, "done", JSON.stringify(first.error));
        assert.deepEqual(mediaAccounts.slice(before), ["higgsfield-row-2", null]);
        return {
          none: none.accounts,
          accounts,
          credits,
          legacy: legacy.body,
          old: old.status,
          missing: missing.error,
          first: first.status,
        };
      } finally {
        serviceAccounts = [];
        higgsfieldSignedIn = false;
      }
    },
  );

  await step(
    "agent files: the host advertises workflows-agent-files-v1 and workflows-answers-v1 to a protocol 10 peer; an agent step gets each connected picture and a note to use them together; a missing file fails the step",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V10)).includes(WORKFLOWS_AGENT_FILES_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_AGENT_FILES_CAPABILITY));
      assert.ok((await capabilities(TEAM_PROTOCOL_V10)).includes(WORKFLOWS_ANSWERS_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_ANSWERS_CAPABILITY));
      const run = async (fileIds: readonly string[]) => {
        const title = ["Agent files", fileIds.length, ...fileIds].join(" ");
        const workflow = await hostWorkflow(title, {
          nodes: [
            promptNode,
            ...fileIds.map((fileId, index) => ({
              id: `asset-${index}`,
              kind: "asset" as const,
              at: { x: 0, y: 200 * (index + 1) },
              fields: { fileId },
            })),
            {
              id: "agent",
              kind: "agent",
              at: at(300),
              fields: { agentId: open, task: "Put the person on the beach." },
            },
          ],
          edges: [
            { id: "edge", from: "prompt", to: "agent", type: "text" },
            ...fileIds.map((_, index) => ({
              id: `edge-${index}`,
              from: `asset-${index}`,
              to: "agent",
              type: "image" as const,
            })),
          ],
          strokes: [],
        });
        const started = await ok(WORKFLOWS_ROUTES.startRun, ownerToken, {
          workflowId: workflow.id,
          requestId: requestId(),
        });
        const done = await settled(text(record(started.run, "run").id, "run id"), "agent");
        return { done, handoff: handoffs.find((handoff) => handoff.text.includes(`"${title}"`)) };
      };
      const pair = await run(["e2e-person", "e2e-beach"]);
      assert.equal(pair.done.status, "done", JSON.stringify(pair.done.error));
      assert.ok(pair.handoff, "the agent step reached the agent");
      assert.deepEqual(pair.handoff.sourcePaths, [
        join(userData, "e2e-files", "e2e-person"),
        join(userData, "e2e-files", "e2e-beach"),
      ]);
      assert.ok(pair.handoff.text.includes("Put the person on the beach."));
      const note =
        "The 2 attached files come from the steps before this one. Use them together as given: keep what they show, and do not invent a substitute.";
      assert.ok(pair.handoff.text.includes(note), pair.handoff.text);
      assert.ok(pair.handoff.text.indexOf(note) < pair.handoff.text.indexOf("--- input ---"), pair.handoff.text);
      const one = await run(["e2e-person"]);
      assert.ok(one.handoff?.text.includes("The attached file comes from a step before this one."), one.handoff?.text);
      const none = await run([]);
      assert.ok(none.handoff && !none.handoff.text.includes("attached file"), none.handoff?.text);
      const missing = await run(["e2e-person", MISSING_FILE]);
      assert.equal(missing.done.status, "failed");
      assert.equal(missing.handoff, undefined);
      return {
        capability: WORKFLOWS_AGENT_FILES_CAPABILITY,
        files: pair.handoff.sourcePaths.length,
        missing: missing.done.status,
      };
    },
  );

  await step(
    "step settings: the host advertises workflows-step-settings-v1 to a protocol 10 peer; a member reads the settings and inputs of each attempt, and not those of a hidden agent",
    async () => {
      const capabilities = async (protocol: number) =>
        list(
          record((await call("GET", TEAM_API_ROUTES.compatibility, { protocol })).body, "compatibility").capabilities,
          "capabilities",
        );
      assert.ok((await capabilities(TEAM_PROTOCOL_V10)).includes(WORKFLOWS_STEP_SETTINGS_CAPABILITY));
      assert.ok(!(await capabilities(TEAM_PROTOCOL_V9)).includes(WORKFLOWS_STEP_SETTINGS_CAPABILITY));
      const codec = WORKFLOWS_STEP_SETTINGS_CODECS.get(WORKFLOWS_STEP_SETTINGS_ROUTES.read);
      assert.ok(codec, "No workflows-step-settings-v1 codec for read.");
      const raw = (token: string, stepId: string, capabilities = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10)) => {
        codec.request({ stepId });
        return call("POST", WORKFLOWS_STEP_SETTINGS_ROUTES.read, {
          token,
          body: { stepId },
          protocol: TEAM_PROTOCOL_V10,
          capabilities,
        });
      };
      const read = async (token: string, stepId: string) => {
        const response = await raw(token, stepId);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        return record(codec.response(response.status, response.body), "step settings");
      };
      const refusal = async (
        response: { status: number; body: unknown },
        status: number,
        key: "error.workflow.stepMissing" | "error.workflow.serverTooOld" | "error.workflow.missing",
      ) => {
        assert.equal(response.status, status, JSON.stringify(response.body));
        assert.ok(JSON.stringify(response.body).includes(sourceText(key)), JSON.stringify(response.body));
        return response.status;
      };
      const runOnce = async (workflowId: string) => {
        const started = await ok(WORKFLOWS_ROUTES.startRun, member, { workflowId, requestId: requestId() });
        const runId = text(record(started.run, "run").id, "run id");
        const agent = await settled(runId, "agent");
        const prompt = await settled(runId, "prompt");
        return { agent, prompt };
      };

      const workflow = await hostWorkflow("Settings", agentGraph(open));
      const first = await runOnce(workflow.id);
      const firstRead = await read(member, first.agent.id);
      assert.deepEqual(firstRead, {
        settings: { agentId: open },
        sources: [{ from: "prompt", type: "text", stepId: first.prompt.id, attachmentId: null }],
      });
      assert.deepEqual(await read(member, first.prompt.id), { settings: { text: "Start." }, sources: [] });

      const edited = agentGraph(open);
      const saved = await runCauseEffect(
        current().workflows.saveGraph({
          workflowId: workflow.id,
          baseRevision: workflow.revision,
          graph: {
            ...edited,
            nodes: edited.nodes.map((node) =>
              node.id === "agent" ? { ...node, fields: { ...node.fields, task: "Say goodbye." } } : node,
            ),
          },
        }),
      );
      assert.ok(saved.ok, "The edit did not save.");
      const second = await runOnce(workflow.id);
      const secondRead = await read(member, second.agent.id);
      assert.deepEqual(secondRead.settings, { agentId: open, task: "Say goodbye." });
      assert.deepEqual(await read(member, first.agent.id), firstRead, "The edit changed the earlier attempt.");
      assert.deepEqual(await read(ownerToken, second.agent.id), secondRead);

      const old = await refusal(
        await raw(
          member,
          first.agent.id,
          teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10).filter(
            (capability) => capability !== WORKFLOWS_STEP_SETTINGS_CAPABILITY,
          ),
        ),
        400,
        "error.workflow.serverTooOld",
      );

      const hiddenWorkflow = await hostWorkflow("Hidden settings", agentGraph(later));
      const { run: hiddenRun } = await runCauseEffect(
        current().workflows.startRun({ workflowId: hiddenWorkflow.id, requestId: requestId() }),
      );
      const hiddenStep = await settled(hiddenRun.id, "agent");
      const hiddenWorkflowRead = await refusal(await raw(member, hiddenStep.id), 404, "error.workflow.missing");
      const withoutAgent = await runCauseEffect(
        current().workflows.saveGraph({
          workflowId: hiddenWorkflow.id,
          baseRevision: hiddenWorkflow.revision,
          graph: { nodes: [promptNode], edges: [], strokes: [] },
        }),
      );
      assert.ok(withoutAgent.ok, "The graph without the agent did not save.");
      const hidden = await refusal(await raw(member, hiddenStep.id), 404, "error.workflow.stepMissing");
      const ownerHidden = await read(ownerToken, hiddenStep.id);
      assert.deepEqual(ownerHidden.settings, { agentId: later });
      const missing = await refusal(await raw(member, "step-missing-e2e"), 404, "error.workflow.stepMissing");

      current()
        .database.connection.prepare(
          "UPDATE workflow_steps SET settings_json = NULL, sources_json = NULL WHERE step_id = ?",
        )
        .run(first.agent.id);
      const older = await read(member, first.agent.id);
      assert.deepEqual(older, { settings: null, sources: null });

      return { first: firstRead, second: secondRead, old, hiddenWorkflowRead, hidden, missing, older };
    },
  );

  await step(
    "library: workflow media files carry their workflow and folder; a member gets only the files of workflows they can see, and not one in a thread of a closed or removed agent; a peer without storage-workflow-files-v1 gets no tag",
    async () => {
      const imageGraph: WorkflowGraph = {
        nodes: [promptNode, { id: "image", kind: "image", at: at(300), fields: { model: "gpt-image" } }],
        edges: [{ id: "edge", from: "prompt", to: "image", type: "text" }],
        strokes: [],
      };
      const produce = async (title: string, fileId: string) => {
        const workflow = await hostWorkflow(title, imageGraph);
        mediaFileId = fileId;
        const { run } = await runCauseEffect(
          current().workflows.startRun({ workflowId: workflow.id, requestId: requestId() }),
        );
        const image = await settled(run.id, "image");
        mediaFileId = "e2e-media-file";
        assert.equal(image.status, "done", JSON.stringify(image.error));
        return workflow;
      };
      const shots = await produce("Library shots", "e2e-library-shots");
      const loose = await produce("Library loose", "e2e-library-loose");
      const hidden = await produce("Library hidden", "e2e-library-hidden");
      const withClosed = await runCauseEffect(
        current().workflows.saveGraph({
          workflowId: hidden.id,
          baseRevision: hidden.revision,
          graph: { ...imageGraph, nodes: [...imageGraph.nodes, agentNode("agent", closed)] },
        }),
      );
      assert.ok(withClosed.ok, "The graph with the closed agent did not save.");
      const known = new Set(
        current()
          .workflowStore.list()
          .map((summary) => summary.id),
      );
      await runCauseEffect(
        current().workflowFolders.mutate(
          { type: "create", id: "folder-library-e2e", name: "Campaign", workflowIds: [shots.id] },
          { workflowIds: known },
        ),
      );

      const usage = async (token: string, capabilities: readonly string[]) => {
        const response = await call("POST", STORAGE_ROUTES.usage, {
          token,
          body: { scope: "host" },
          protocol: TEAM_PROTOCOL_V10,
          capabilities,
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        const decoded = teamSideRouteCodec(STORAGE_ROUTES.usage)?.response(
          STORAGE_ROUTES.usage,
          response.status,
          response.body,
          { storageWorkflowFiles: true },
        );
        return list(record(decoded, "usage").files, "files")
          .map((file) => record(file, "file"))
          .filter((file) => text(file.id, "file id").startsWith("e2e-library-"))
          .map((file) => ({ id: file.id, workflow: file.workflow ?? null }));
      };
      const current10 = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10);
      assert.ok(current10.includes(STORAGE_WORKFLOW_FILES_CAPABILITY), "Protocol 10 does not list the capability.");
      const older = current10.filter((capability) => capability !== STORAGE_WORKFLOW_FILES_CAPABILITY);
      const campaign = { id: "folder-library-e2e", name: "Campaign" };
      const shotsRow = { id: "e2e-library-shots", workflow: { id: shots.id, name: "Library shots", folder: campaign } };
      const looseRow = { id: "e2e-library-loose", workflow: { id: loose.id, name: "Library loose", folder: null } };
      const hiddenRow = { id: "e2e-library-hidden", workflow: { id: hidden.id, name: "Library hidden", folder: null } };

      const owner = await usage(ownerToken, current10);
      assert.deepEqual(owner, [shotsRow, looseRow, hiddenRow]);
      const memberRows = await usage(member, current10);
      assert.deepEqual(memberRows, [shotsRow, looseRow]);
      const memberShared: { agentId: string; rows: Awaited<ReturnType<typeof usage>> }[] = [];
      for (const agentId of [closed, "agent-e2e-removed"]) {
        sharedFileAgents.set("e2e-library-loose", agentId);
        assert.deepEqual(await usage(ownerToken, current10), [shotsRow, looseRow, hiddenRow]);
        const rows = await usage(member, current10);
        memberShared.push({ agentId, rows });
        assert.deepEqual(rows, [shotsRow], `The member got a workflow file of a thread of ${agentId}.`);
      }
      sharedFileAgents.delete("e2e-library-loose");
      const olderOwner = await usage(ownerToken, older);
      assert.deepEqual(
        olderOwner,
        [shotsRow, looseRow, hiddenRow].map((row) => ({ id: row.id, workflow: null })),
      );
      const olderMember = await usage(member, older);
      assert.deepEqual(
        olderMember,
        [shotsRow, looseRow].map((row) => ({ id: row.id, workflow: null })),
      );
      return { owner, member: memberRows, memberShared, olderOwner, olderMember };
    },
  );

  await step(
    "library: a workflow file moves into any agent's folder, out again and is deleted; a member cannot place a file of a hidden workflow",
    async () => {
      const capabilities = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10);
      const folders = async (token: string, body: unknown) =>
        call("POST", body === undefined ? LIBRARY_FOLDERS_ROUTES.read : LIBRARY_FOLDERS_ROUTES.actions, {
          token,
          body: body ?? {},
          protocol: TEAM_PROTOCOL_V10,
          capabilities,
        });
      const placementOf = (response: { status: number; body: unknown }) => {
        assert.equal(response.status, 200, JSON.stringify(response.body));
        const placement = record(record(response.body, "folders").placement, "placement");
        return Object.fromEntries(Object.entries(placement).filter(([fileId]) => fileId.startsWith("e2e-library-")));
      };
      const create = async (id: string, agentId: string, name: string) =>
        placementOf(await folders(ownerToken, { type: "create", id, agentId, name }));
      await create("library-open", open, "Open shots");
      await create("library-chatter", chatter, "Chatter shots");
      await create("library-viewer", viewer, "Viewer shots");
      const place = (token: string, fileId: string, folderId: string | null) =>
        folders(token, { type: "place", fileIds: [fileId], folderId });

      const placed = placementOf(await place(ownerToken, "e2e-library-shots", "library-open"));
      assert.deepEqual(placed, { "e2e-library-shots": "library-open" });
      const moved = placementOf(await place(ownerToken, "e2e-library-shots", "library-chatter"));
      assert.deepEqual(moved, { "e2e-library-shots": "library-chatter" });

      const memberPlaced = placementOf(await place(member, "e2e-library-loose", "library-chatter"));
      assert.deepEqual(memberPlaced, {
        "e2e-library-shots": "library-chatter",
        "e2e-library-loose": "library-chatter",
      });
      const hiddenFile = await place(member, "e2e-library-hidden", "library-chatter");
      assert.equal(hiddenFile.status, 404, JSON.stringify(hiddenFile.body));
      const viewOnly = await place(member, "e2e-library-loose", "library-viewer");
      assert.equal(viewOnly.status, 403, JSON.stringify(viewOnly.body));
      placementOf(await place(ownerToken, "e2e-library-loose", "library-viewer"));
      const outOfViewer = await place(member, "e2e-library-loose", "library-chatter");
      assert.equal(outOfViewer.status, 403, JSON.stringify(outOfViewer.body));
      placementOf(await place(ownerToken, "e2e-library-loose", "library-chatter"));
      const unknownFile = await place(ownerToken, "e2e-no-such-file", "library-open");
      assert.equal(unknownFile.status, 404, JSON.stringify(unknownFile.body));
      const ownerHidden = placementOf(await place(ownerToken, "e2e-library-hidden", "library-open"));
      assert.equal(ownerHidden["e2e-library-hidden"], "library-open");

      const hiddenUnfile = await place(member, "e2e-library-hidden", null);
      assert.equal(hiddenUnfile.status, 404, JSON.stringify(hiddenUnfile.body));
      const unfiled = placementOf(await place(member, "e2e-library-loose", null));
      assert.deepEqual(unfiled, { "e2e-library-shots": "library-chatter" });
      const memberRead = placementOf(await folders(member, undefined));
      assert.deepEqual(memberRead, { "e2e-library-shots": "library-chatter" });

      const remove = (token: string, fileId: string) =>
        call("POST", STORAGE_ROUTES.deleteFile, { token, body: { fileId }, protocol: TEAM_PROTOCOL_V10, capabilities });
      const memberDelete = await remove(member, "e2e-library-shots");
      assert.equal(memberDelete.status, 403, JSON.stringify(memberDelete.body));
      const ownerDelete = await remove(ownerToken, "e2e-library-shots");
      assert.equal(ownerDelete.status, 200, JSON.stringify(ownerDelete.body));
      assert.ok(current().deletedFiles.has("e2e-library-shots"));
      const afterDelete = placementOf(await folders(ownerToken, undefined));
      assert.deepEqual(afterDelete, { "e2e-library-hidden": "library-open" });
      const listed = await call("POST", STORAGE_ROUTES.usage, {
        token: ownerToken,
        body: { scope: "host" },
        protocol: TEAM_PROTOCOL_V10,
        capabilities,
      });
      const ids = list(record(listed.body, "usage").files, "files").map((file) => text(record(file, "file").id, "id"));
      assert.ok(!ids.includes("e2e-library-shots"), JSON.stringify(ids));
      return { placed, moved, memberPlaced, unfiled, memberRead, afterDelete };
    },
  );

  report.passed = true;
} finally {
  for (const socket of sockets) socket.close();
  await stopHost();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await rm(root, { recursive: true, force: true });
  process.stdout.write(`${report.passed ? "passed" : "FAILED"}: ${join(OUT, "report.json")}\n`);
}
