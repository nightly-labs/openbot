import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT,
  type AgentAccessLevel,
  type AgentEvent,
  type AgentSummary,
  AnalyticsInputError,
  canAdministerServer,
  type DirectConversationPage,
  type DirectConversationPageAnchor,
  type DirectConversationSnapshot,
  type DirectMessage,
  type DirectMessageRealtimeEvent,
  type DirectThreadSummary,
  type DirectTypingRealtimeEvent,
  type DuplicateAgentResult,
  isAgentEvent,
  isTeamRealtimeEvent,
  ROUTINE_QUIET_ANSWER_ITEM_TYPE,
  type SidebarLayoutSnapshot,
  type TeamMemberSummary,
  type TeamPresenceSnapshot,
  type TeamRealtimeEvent,
} from "@openbot/contracts/ipc";
import { isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { ACP_REGISTRY_CAPABILITY } from "@openbot/contracts/team-protocol/acp-registry-v1";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_BACKUP_MODELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { AGENT_SESSION_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-session-settings-v1";
import { AGENT_TASK_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { AGENT_TASK_UI_BLOCKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-task-ui-blocks-v1";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { AGENT_THREAD_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import { AGENT_THREAD_READS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { BROWSER_PAGE_STATE_CAPABILITY } from "@openbot/contracts/team-protocol/browser-page-state-v1";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { BROWSER_USER_CONTROL_CAPABILITY } from "@openbot/contracts/team-protocol/browser-user-control-v1";
import { CLAUDE_API_KEY_CAPABILITY } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import {
  AGENT_ADMIN_CAPABILITY,
  AGENT_HOST_SETTINGS_CAPABILITY,
  AGENT_IMPORT_CAPABILITY,
  AGENT_INSTALL_CAPABILITY,
  AGENT_MEMORY_LIMIT_CAPABILITY,
  AGENT_PUBLISH_CAPABILITY,
  AGENT_UPDATE_CAPABILITY,
  ANDROID_PUSH_NOTIFICATIONS_CAPABILITY,
  BITWARDEN_CONNECTOR_CAPABILITY,
  BROWSER_SECRET_VAULT_CAPABILITY,
  BROWSER_SIGN_IN_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  CONNECTORS_CAPABILITY,
  DISCORD_ACCESS_CAPABILITY,
  EVENTS_CAPABILITY,
  FOCUS_USE_CAPABILITY,
  HOST_ADMIN_CAPABILITY,
  HOST_MEMBER_UPDATE_CAPABILITY,
  HOST_RELEASE_CAPABILITY,
  HOST_TIMEZONE_CAPABILITY,
  HOST_UPDATE_CAPABILITY,
  HOSTED_SITES_CAPABILITY,
  INSTANCE_TRANSFER_CAPABILITY,
  isTeamCurrentCapability,
  LIVE_ACTIVITY_PUSH_CAPABILITY,
  legacyTeamCapabilities,
  MCP_SERVERS_CAPABILITY,
  MCP_SIGN_IN_APP_CAPABILITY,
  MCP_SIGN_IN_CAPABILITY,
  MEMORY_REVIEW_CAPABILITY,
  ONEPASSWORD_CONNECTOR_CAPABILITY,
  PROMPT_CACHE_TTL_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_CAPABILITY,
  PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY,
  PROVIDER_ACCOUNTS_CAPABILITY,
  PROVIDER_DEFAULT_CAPABILITY,
  PROVIDER_HOST_SIGN_IN_CAPABILITY,
  PROVIDER_SIGN_OUT_CAPABILITY,
  PROVIDER_USAGE_RESET_CAPABILITY,
  PROVIDERS_ADMIN_CAPABILITY,
  PROVIDERS_RUNTIMES_V2_CAPABILITY,
  PROVIDERS_SIGN_IN_V3_CAPABILITY,
  PROVIDERS_V4_CAPABILITY,
  PROVIDERS_V5_CAPABILITY,
  PUSH_NOTIFICATIONS_CAPABILITY,
  QUIET_TURN_CAPABILITY,
  ROUTINE_FLOWS_CAPABILITY,
  ROUTINE_RECOVERY_CAPABILITY,
  ROUTINE_RESULTS_CAPABILITY,
  SHARED_TABLES_CAPABILITY,
  SIGN_IN_RELAY_CAPABILITY,
  SKILLS_ADMIN_CAPABILITY,
  SKILLS_EVENTS_CAPABILITY,
  STORAGE_CAPABILITY,
  supportsTeamSemanticTags,
  TEAM_AGENT_ACTIVITY_CAPABILITY,
  TEAM_CHANNEL_ATTENTION_CAPABILITY,
  TEAM_CONTEXT_USAGE_CAPABILITY,
  TEAM_CURRENT_CAPABILITIES,
  TEAM_HISTORY_EXTENT_CAPABILITY,
  TEAM_PROMPT_MULTI_SELECT_CAPABILITY,
  TEAM_SUBAGENTS_CAPABILITY,
  TEAM_UI_BLOCKS_CAPABILITY,
  type TeamCurrentCapability,
  teamCapabilitiesVisibleToProtocol,
  VAULT_CAPABILITY,
  VAULT_IMPORT_CAPABILITY,
  VAULT_V2_CAPABILITY,
  WEBHOOK_TESTS_CAPABILITY,
  WORKFLOWS_CAPABILITY,
} from "@openbot/contracts/team-protocol/current";
import { CUSTOM_PROVIDER_HARNESS_CAPABILITY } from "@openbot/contracts/team-protocol/custom-provider-harness-v1";
import { FOCUS_USE_INTERVAL_MS } from "@openbot/contracts/team-protocol/focus-use-v1";
import {
  HOST_RESTART_EVENT,
  type HostRestartEvent,
  type HostRestartState,
} from "@openbot/contracts/team-protocol/host-update-v1";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import {
  MACHINE_RESOURCES_CAPABILITY,
  type MachineAlertEvent,
} from "@openbot/contracts/team-protocol/machine-resources-v1";
import { type OptionalTeamEvent, optionalTeamEvent } from "@openbot/contracts/team-protocol/optional-events";
import { PROVIDERS_V8_CAPABILITY } from "@openbot/contracts/team-protocol/providers-v8";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { STORAGE_DISK_CAPABILITY } from "@openbot/contracts/team-protocol/storage-disk-v1";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_PROTOCOL_V1,
  TEAM_PROTOCOL_V1_CAPABILITIES,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
  type TeamProtocolSupportV1,
} from "@openbot/contracts/team-protocol/v1";
import {
  decodeTeamProtocolV1CurrentClientEvent,
  encodeTeamProtocolV1CurrentEvent,
} from "@openbot/contracts/team-protocol/v1-adapter";
import { encodeTeamProtocolV4BaseCurrentEvent } from "@openbot/contracts/team-protocol/v4-base-adapter";
import { TEAM_LOCAL_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v5";
import { encodeTeamProtocolV5BaseCurrentEvent } from "@openbot/contracts/team-protocol/v5-base-adapter";
import { TEAM_CURSOR_CLINE_CAPABILITY } from "@openbot/contracts/team-protocol/v6";
import { encodeTeamProtocolV6BaseCurrentEvent } from "@openbot/contracts/team-protocol/v6-base-adapter";
import { TEAM_PI_MUSE_CAPABILITY } from "@openbot/contracts/team-protocol/v7";
import { encodeTeamProtocolV7BaseCurrentEvent } from "@openbot/contracts/team-protocol/v7-base-adapter";
import { TEAM_OPEN_PROVIDERS_CAPABILITY } from "@openbot/contracts/team-protocol/v8";
import { encodeTeamProtocolV8BaseCurrentEvent } from "@openbot/contracts/team-protocol/v8-base-adapter";
import { TEAM_PROTOCOL_V9 } from "@openbot/contracts/team-protocol/v9";
import { isFixedSourceText, sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Exit, Scope } from "effect";
import type * as Ws from "ws";
import { AgentDuplicationFailed, duplicateAgentIntoLayout } from "../backend/agent/duplication-gate";
import { AgentMemorySelectionError } from "../backend/agent-memory-store";
import { runCauseEffect } from "../backend/effect-boundary";
import { McpServerError } from "../backend/mcp-server-store";
import { StoredStateFailure } from "../backend/stored-state-effects";
import type { TeamChatStore } from "../backend/team-chat-store";
import { agentAccessLevel } from "./agent-access-store";
import { LifecycleGate } from "./lifecycle-gate";
import { listenLoopback } from "./listen-loopback";
import { RemoteScreenError } from "./remote-screen-gateway";
import { RemoteWorkflowError, remoteCall, toRemoteWorkflowError } from "./remote-service-effects";
import { isClientUse } from "./team-api/client-use";
import type { TeamApiOptions, TeamApiSidebarLayout } from "./team-api/dependencies";
import { HttpError } from "./team-api/http-error";
import {
  hiddenAgentView,
  hiddenProviderAgentIds,
  isPeerHiddenProvider,
  legacyProviderView,
} from "./team-api/provider-visibility";
import type { RouteOutcome, TeamApiRequestContext } from "./team-api/request-context";
import {
  bearerToken,
  conversationSnapshotForCapabilities,
  firstHeaderValue,
  JSON_LIMIT,
  pathIdentifier,
  readJson,
  requestCapabilities,
  requestProtocol,
  stringField,
} from "./team-api/request-helpers";
import { routeAcpRegistry } from "./team-api/route-acp-registry";
import { routeAgentAccess } from "./team-api/route-agent-access";
import {
  routeAgentAdmin,
  routeAgentBackupModels,
  routeAgentHostSettings,
  routeAgentTaskLimit,
} from "./team-api/route-agent-admin";
import { routeAgentHidden, visibleSnapshot } from "./team-api/route-agent-hidden";
import { routeAgentImport } from "./team-api/route-agent-import";
import { routeAgentInstall } from "./team-api/route-agent-install";
import { routeAgentMemoryPage } from "./team-api/route-agent-memories";
import { routeAgentMemoryLimit } from "./team-api/route-agent-memory-limit";
import { routeAgentNotificationLevels } from "./team-api/route-agent-notification-levels";
import { routeAgentPublish } from "./team-api/route-agent-publish";
import { routeAgentSessionSettings } from "./team-api/route-agent-session-settings";
import { routeAgentTasks } from "./team-api/route-agent-tasks";
import { routeAgentThreadFiles, routeAgentThreadReads, routeAgentThreads } from "./team-api/route-agent-threads";
import { routeAgents } from "./team-api/route-agents";
import { routeBitwardenConnector } from "./team-api/route-bitwarden-connector";
import { routeBrowser } from "./team-api/route-browser";
import { routeBrowserProfiles } from "./team-api/route-browser-profiles";
import { routeChannels } from "./team-api/route-channels";
import { routeConnectors } from "./team-api/route-connectors";
import { routeContextReset } from "./team-api/route-context-reset";
import { routeConversationFiles } from "./team-api/route-conversation-files";
import { routeDirect } from "./team-api/route-direct";
import { routeDiscordAccess } from "./team-api/route-discord-access";
import { routeEvents } from "./team-api/route-events";
import { routeFiles } from "./team-api/route-files";
import { routeFocusUse } from "./team-api/route-focus-use";
import { routeHostAdmin } from "./team-api/route-host-admin";
import { routeHostTimezone } from "./team-api/route-host-timezone";
import { routeHostUpdate } from "./team-api/route-host-update";
import { routeHostedSites } from "./team-api/route-hosted-sites";
import { routeInstanceTransfer } from "./team-api/route-instance-transfer";
import { routeLiveActivityPush } from "./team-api/route-live-activity-push";
import { routeMachineResources } from "./team-api/route-machine-resources";
import { routeMcpServers } from "./team-api/route-mcp";
import { routeMcpSignIn } from "./team-api/route-mcp-sign-in";
import { routeMcpSignInApp } from "./team-api/route-mcp-sign-in-app";
import { routeMemoryReview } from "./team-api/route-memory-review";
import { routeOnePasswordConnector } from "./team-api/route-onepassword-connector";
import { routePromptCacheTtl } from "./team-api/route-prompt-cache-ttl";
import { routeProviderAccounts } from "./team-api/route-provider-accounts";
import { routeProviderDefault } from "./team-api/route-provider-default";
import { routeProviderHostSignIn } from "./team-api/route-provider-host-sign-in";
import { routeProviderSignOut } from "./team-api/route-provider-sign-out";
import { routeProviderUsageReset } from "./team-api/route-provider-usage-reset";
import { routeProviders } from "./team-api/route-providers";
import { routePushNotifications } from "./team-api/route-push-notifications";
import { routeRemoteScreen } from "./team-api/route-remote-screen";
import { routeRoutineFlows } from "./team-api/route-routine-flows";
import { routeRoutineResults } from "./team-api/route-routine-results";
import { routeSharedTables } from "./team-api/route-shared-tables";
import { routeSideQuestion } from "./team-api/route-side-question";
import { routeSignInRelay } from "./team-api/route-sign-in-relay";
import { routeSkillsAdmin } from "./team-api/route-skills-admin";
import { routeStorage } from "./team-api/route-storage";
import { routeTeam } from "./team-api/route-team";
import { routeVault } from "./team-api/route-vault";
import { routeVaultImport } from "./team-api/route-vault-import";
import { routeWorkflows } from "./team-api/route-workflows";
import { routeWorkspaceDirectory } from "./team-api/route-workspace-directory";
import { TeamStoreError } from "./team-store";

const EVENT_PAYLOAD_LIMIT = 256 * 1_024;
const TYPING_TIMEOUT_MS = 5_000;
/** Past this many sessions, the user actions older than the age below are dropped. */
const SESSION_USE_LIMIT = 200;
const SESSION_USE_MAX_AGE_MS = 60 * 60 * 1000;
/** A focused app counts as use for at most this long after the last user action of its session. */
const FOCUS_USE_LIMIT_MS = 30 * 60_000;
/** A focus ping after a longer gap starts a new focus period: the app lost focus or its connection. */
const FOCUS_GAP_MS = 2 * FOCUS_USE_INTERVAL_MS;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const RATE_LIMIT_SWEEP_MS = 60_000;
const RATE_LIMIT_ATTEMPTS = 5;
const RATE_LIMIT_CAPACITY = 10_000;
const RUNTIME_SNAPSHOT_REQUEST_INTERVAL_MS = 1_000;
const TEST_LEGACY_EVENT_PROTOCOL = "openbot-events";
const TEST_LEGACY_SNAPSHOT_PROTOCOL = "openbot-events-v2";
const requireModule = createRequire(import.meta.url);
const webSockets: typeof Ws = requireModule(join(dirname(requireModule.resolve("ws/package.json")), "index.js"));

const logger = createOpenBotLogger("team-api-server");

type AccessMember = Pick<TeamMemberSummary, "id" | "role">;

interface EventClientState {
  token: string;
  memberId: string;
  /** The session of the connection, which records its member's actions. */
  sessionId: string | null;
  capabilities: Set<string>;
  includeConversationEvents: boolean;
  typingAgentId: string | null;
  typingTimer: ReturnType<typeof setTimeout> | null;
  directTypingRecipientId: string | null;
  directTypingTimer: ReturnType<typeof setTimeout> | null;
  snapshotResponsePending: boolean;
  snapshotRequestQueued: boolean;
  nextSnapshotRequestAt: number;
}

type ConversationEventAudience = "all" | "modern" | "legacy";

interface PendingLegacyConversationRead {
  event: Extract<AgentEvent, { type: "conversation" }>;
  retries: number;
}

interface RateEntry {
  attempts: number;
  resetAt: number;
}

interface TeamProtocolIssue {
  status: 400 | 426;
  body: {
    error: string;
    code: "client_update_required" | "host_update_required" | "protocol_error";
    host: TeamProtocolSupportV1;
    client?: { appVersion: string; protocol: number };
  };
}

export class TeamApiServer {
  readonly #options: Omit<TeamApiOptions, "sidebarLayout"> & { sidebarLayout: TeamApiSidebarLayout };
  readonly #rateLimits = new Map<string, RateEntry>();
  readonly #eventClients = new Map<Ws.WebSocket, EventClientState>();
  readonly #pendingLegacyConversationReads = new Map<string, PendingLegacyConversationRead>();
  #legacyConversationScope = Scope.makeUnsafe();
  #hostRestart: HostRestartEvent = { type: HOST_RESTART_EVENT, state: "none", version: null };
  readonly #responseRoutes = new WeakMap<
    ServerResponse,
    { method: string; path: string; protocol: number; capabilities: Set<string>; hiddenAgentIds?: ReadonlySet<string> }
  >();
  readonly #duplicateRequests = new Map<
    string,
    { sourceAgentId: string; result: Deferred.Deferred<DuplicateAgentResult, AgentDuplicationFailed> }
  >();
  readonly #webSockets = new webSockets.WebSocketServer({
    noServer: true,
    maxPayload: EVENT_PAYLOAD_LIMIT,
    handleProtocols: (protocols) =>
      protocols.has(TEAM_PROTOCOL_V1_WEBSOCKET)
        ? TEAM_PROTOCOL_V1_WEBSOCKET
        : protocols.has(TEST_LEGACY_SNAPSHOT_PROTOCOL)
          ? TEST_LEGACY_SNAPSHOT_PROTOCOL
          : protocols.has(TEST_LEGACY_EVENT_PROTOCOL)
            ? TEST_LEGACY_EVENT_PROTOCOL
            : false,
  });
  readonly #rateLimitCapacity: number;
  readonly #now: () => number;
  #server: Server | null = null;
  readonly #lifecycle = new LifecycleGate<number, RemoteWorkflowError>();
  #port: number | null = null;
  #heartbeat: ReturnType<typeof setInterval> | null = null;
  #lastClientUseAt: number | null = null;
  /** The last user action of each session, so a phone can stay quiet while its member uses another app. */
  readonly #sessionUse = new Map<string, { memberId: string; at: number }>();
  /** When the focus period of each session started, and its last focus ping. Push notifications do not read it. */
  readonly #sessionFocus = new Map<string, { since: number; at: number }>();
  #agentListener: ((event: AgentEvent) => void) | null = null;
  #sidebarLayoutListener: ((layout: SidebarLayoutSnapshot) => void) | null = null;
  #stopAgentAccessListener: (() => void) | null = null;
  #stopMachineAlertListener: (() => void) | null = null;
  #stopNotificationLevelsListener: (() => void) | null = null;
  #localTypingAgentId: string | null = null;
  readonly #reportedUnrepresentableAgents = new Set<string>();
  #nextRateLimitSweepAt = 0;

  constructor(options: TeamApiOptions) {
    this.#options = { ...options, sidebarLayout: options.sidebarLayout ?? unavailableSidebarLayout() };
    this.#rateLimitCapacity = options.rateLimitCapacity ?? RATE_LIMIT_CAPACITY;
    this.#now = options.now ?? Date.now;
  }

  get port(): number | null {
    return this.#port;
  }

  // Without the gate, two starts at once open two listeners and lose one, and a stop during a start
  // runs before the listener exists. A listener lost that way stays open for the previous account.
  start(): Effect.Effect<number, RemoteWorkflowError> {
    // A dependency that throws while the listener starts is a failed start, so the host stops it.
    return this.#lifecycle.start(() =>
      this.#start().pipe(Effect.catchDefect((cause) => Effect.fail(new RemoteWorkflowError({ cause })))),
    );
  }

  stop(): Effect.Effect<void, RemoteWorkflowError> {
    return this.#lifecycle.stop(() => this.#stop());
  }

  readonly #start = Effect.fn("TeamApiServer.start")(function* (this: TeamApiServer) {
    if (this.#server && this.#port) return this.#port;
    if (this.#legacyConversationScope.state._tag === "Closed") this.#legacyConversationScope = Scope.makeUnsafe();
    const server = createServer((request, response) => void this.#handle(request, response));
    this.#server = server;
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (this.#options.remoteScreen?.handlesUpgrade(url)) {
        this.#options.remoteScreen.handleUpgrade(request, socket, head, url);
        return;
      }
      // Like the remote screen, and above the token check for the same reason: a tunneled view
      // socket carries the WebRTC session this host opened it for rather than a member's token.
      if (this.#options.browserView?.handlesUpgrade(url)) {
        this.#options.browserView.handleUpgrade(request, socket, head, url);
        return;
      }
      const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(",").map((value) => value.trim());
      if (
        this.#options.appVersion &&
        url.pathname === TEAM_API_ROUTES.events &&
        !protocols.includes(TEAM_PROTOCOL_V1_WEBSOCKET)
      ) {
        socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      const encodedToken = protocols.find((value) => value.startsWith("openbot-token."));
      const token = encodedToken?.slice("openbot-token.".length) ?? "";
      const member = token.length <= 512 ? this.#options.store.authenticate(token) : null;
      if (!member) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      if (
        url.pathname === TEAM_API_ROUTES.events &&
        (protocols.includes(TEAM_PROTOCOL_V1_WEBSOCKET) ||
          (!this.#options.appVersion &&
            (protocols.includes(TEST_LEGACY_SNAPSHOT_PROTOCOL) || protocols.includes(TEST_LEGACY_EVENT_PROTOCOL))))
      ) {
        this.#webSockets.handleUpgrade(request, socket, head, (client) => {
          this.#connectEvents(
            client,
            token,
            member.id,
            client.protocol === TEAM_PROTOCOL_V1_WEBSOCKET || client.protocol === TEST_LEGACY_SNAPSHOT_PROTOCOL,
            client.protocol === TEAM_PROTOCOL_V1_WEBSOCKET,
          );
        });
        return;
      }
      if (url.pathname === TEAM_API_ROUTES.remoteDesktopUpgrade) {
        socket.write("HTTP/1.1 426 Upgrade Required\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });
    const port = yield* remoteCall(() => listenLoopback(server, () => new Error(sourceText("error.team.bindFailed"))));
    this.#port = port;
    this.#agentListener = (event) => this.#broadcastAgentEvent(event);
    this.#options.agents.on("event", this.#agentListener);
    this.#sidebarLayoutListener = (layout) => this.#broadcastAgentEvent({ type: "sidebar-layout-changed", layout });
    this.#options.sidebarLayout.on("changed", this.#sidebarLayoutListener);
    // A change from Settings on this computer and one from a joined admin both arrive here.
    this.#stopAgentAccessListener = this.#options.agentAccess?.subscribe(() => this.agentAccessChanged()) ?? null;
    this.#stopMachineAlertListener =
      this.#options.machine?.subscribe((memberId, event) => {
        if (memberId) this.#sendMachineAlert(memberId, event);
      }) ?? null;
    // A change on one device of a member shows at once on their other devices.
    this.#stopNotificationLevelsListener =
      this.#options.agentNotificationLevels?.subscribe((memberId) => this.#sendNotificationLevels(memberId)) ?? null;
    this.#heartbeat = setInterval(() => {
      for (const [client, connection] of this.#eventClients) {
        if (!this.#options.store.authenticate(connection.token)) {
          client.close(1008, "Team access was revoked");
        } else if (client.readyState === webSockets.WebSocket.OPEN) client.ping();
      }
    }, 15_000);
    this.#heartbeat.unref?.();
    this.#publishPresence();
    return port;
  }).bind(this);

  readonly #stop = Effect.fn("TeamApiServer.stop")(function* (this: TeamApiServer) {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
    if (this.#agentListener) this.#options.agents.off("event", this.#agentListener);
    this.#agentListener = null;
    if (this.#sidebarLayoutListener) this.#options.sidebarLayout.off("changed", this.#sidebarLayoutListener);
    this.#sidebarLayoutListener = null;
    this.#stopAgentAccessListener?.();
    this.#stopAgentAccessListener = null;
    this.#stopMachineAlertListener?.();
    this.#stopMachineAlertListener = null;
    this.#stopNotificationLevelsListener?.();
    this.#stopNotificationLevelsListener = null;
    yield* Scope.close(this.#legacyConversationScope, Exit.void);
    this.#legacyConversationScope = Scope.makeUnsafe();
    for (const [client, connection] of this.#eventClients) {
      if (connection.typingTimer) clearTimeout(connection.typingTimer);
      if (connection.directTypingTimer) clearTimeout(connection.directTypingTimer);
      client.close(1001, "Server stopped");
    }
    this.#eventClients.clear();
    this.#pendingLegacyConversationReads.clear();
    this.#localTypingAgentId = null;
    const { remoteScreen, browserView } = this.#options;
    yield* Effect.gen(function* () {
      if (remoteScreen) yield* remoteScreen.stop();
      if (browserView) yield* browserView.stop();
    }).pipe(
      toRemoteWorkflowError,
      Effect.ensuring(
        Effect.gen({ self: this }, function* () {
          // The heartbeat and the event listeners are already gone. Leaving the socket open
          // would let the next `start()` hand back its port unchanged, so the previous account
          // keeps a listener that no longer checks a revoked session or delivers an event.
          const server = this.#server;
          this.#server = null;
          this.#port = null;
          if (server) {
            yield* Effect.callback<void>((resume) => {
              server.close(() => resume(Effect.void));
            });
          }
          this.#publishPresence();
        }),
      ),
    );
  }).bind(this);

  getPresence(): TeamPresenceSnapshot {
    const identity = this.#options.store.getIdentity();
    if (!identity) {
      return { serverId: null, members: [], updatedAt: new Date().toISOString() };
    }
    const connections = [...this.#eventClients.values()];
    const owner = this.#options.store.listMembers().find((member) => member.role === "owner");
    return {
      serverId: identity.serverId,
      members: this.#options.store.listMembers().map((member) => {
        const memberConnections = connections.filter((connection) => connection.memberId === member.id);
        return {
          ...member,
          online: memberConnections.length > 0 || (member.id === owner?.id && this.#server !== null),
          typingAgentId:
            (member.id === owner?.id ? this.#localTypingAgentId : null) ??
            memberConnections.find((connection) => connection.typingAgentId)?.typingAgentId ??
            null,
        };
      }),
      updatedAt: new Date().toISOString(),
    };
  }

  /** Remote clients with an open event stream. Each WebRTC client opens one after it signs in. */
  connectedClientCount(): number {
    return this.#eventClients.size;
  }

  /**
   * The last user action from a client - a send, a change, or a typing event - or null for none. A focus
   * ping (`focus-use-v1`) also counts, for at most 30 minutes after the last user action of its session or
   * after the app got focus again.
   * Reads, polls and mark-read do not count: a client that is only open does not keep a hosted server running.
   */
  lastClientUseAt(): number | null {
    return this.#lastClientUseAt;
  }

  /** The last user action of a member from a session other than `sessionId`, as `lastClientUseAt` counts them. */
  lastMemberUseElsewhere(memberId: string, sessionId: string): number | null {
    let last: number | null = null;
    for (const [other, use] of this.#sessionUse) {
      if (other !== sessionId && use.memberId === memberId && (last === null || use.at > last)) last = use.at;
    }
    return last;
  }

  #recordClientUse(sessionId: string | null, memberId: string): void {
    const now = Date.now();
    this.#lastClientUseAt = now;
    if (!sessionId) return;
    this.#sessionUse.set(sessionId, { memberId, at: now });
    pruneSessions(this.#sessionUse, now);
  }

  #recordFocusUse(sessionId: string): void {
    const now = Date.now();
    const previous = this.#sessionFocus.get(sessionId);
    const start = previous && now - previous.at <= FOCUS_GAP_MS ? previous.since : now;
    // A send, a change or a typing event of the session starts the limit again.
    const since = Math.max(start, this.#sessionUse.get(sessionId)?.at ?? 0);
    this.#sessionFocus.set(sessionId, { since, at: now });
    pruneSessions(this.#sessionFocus, now);
    if (now - since < FOCUS_USE_LIMIT_MS) this.#lastClientUseAt = now;
  }

  setLocalTyping(agentId: string | null, typing: boolean): void {
    const next = typing && this.#server ? agentId : null;
    if (next === this.#localTypingAgentId) return;
    this.#localTypingAgentId = next;
    this.#publishPresence();
  }

  refreshPresence(): void {
    for (const [client, connection] of this.#eventClients) {
      if (!this.#options.store.authenticate(connection.token)) {
        client.close(1008, "Team access was revoked");
      }
    }
    this.#publishPresence();
  }

  refreshIdentity(): void {
    const identity = this.#options.store.getIdentity();
    if (!identity) return;
    const event: TeamRealtimeEvent = {
      type: "team-identity",
      serverId: identity.serverId,
      serverName: identity.serverName,
      logoVersion: identity.logoVersion,
    };
    for (const [client, connection] of this.#eventClients) {
      const payload = this.#encodeProviderEvent(event, connection.capabilities);
      if (payload && client.readyState === webSockets.WebSocket.OPEN) client.send(payload);
    }
  }

  /**
   * Tells every member with `host-update-v1` that this host restarts into an update. It is outside the
   * frozen event vocabulary, so it bypasses the encoders like a channel event does.
   */
  announceHostRestart(state: HostRestartState, version: string | null): void {
    this.#hostRestart = { type: HOST_RESTART_EVENT, state, version };
    for (const [client, connection] of this.#eventClients) this.#sendHostRestart(client, connection);
  }

  #sendHostRestart(client: Ws.WebSocket, connection: EventClientState): void {
    if (
      !connection.capabilities.has(HOST_UPDATE_CAPABILITY) &&
      !connection.capabilities.has(HOST_MEMBER_UPDATE_CAPABILITY)
    )
      return;
    if (client.readyState === webSockets.WebSocket.OPEN) client.send(JSON.stringify(this.#hostRestart));
  }

  /**
   * Sends a machine alert to each device of the member who gets it. It is outside the frozen event
   * vocabulary, so it bypasses the encoders like `host-restart` does. A device that connects later
   * gets the alerts still in force (`#sendPendingMachineAlerts`).
   */
  #sendMachineAlert(memberId: string, event: MachineAlertEvent): void {
    for (const [client, connection] of this.#eventClients) {
      if (
        connection.memberId === memberId &&
        connection.capabilities.has(MACHINE_RESOURCES_CAPABILITY) &&
        client.readyState === webSockets.WebSocket.OPEN
      )
        client.send(JSON.stringify(event));
    }
  }

  /**
   * Sends a member's own notification levels to each connection of that member, and to no other member.
   * The list leaves out the agents that the connection cannot see, as `/v1/agent-notification-levels` does.
   */
  #sendNotificationLevels(memberId: string): void {
    const levels = this.#options.agentNotificationLevels;
    if (!levels) return;
    for (const [client, connection] of this.#eventClients) {
      if (
        connection.memberId !== memberId ||
        !connection.capabilities.has(AGENT_NOTIFICATION_LEVELS_CAPABILITY) ||
        client.readyState !== webSockets.WebSocket.OPEN
      )
        continue;
      const member = this.#connectionMember(connection);
      const hidden = this.hiddenAgentIds(eventProtocol(connection.capabilities), connection.capabilities, member);
      client.send(JSON.stringify({ type: "agent-notification-levels-changed", ...levels.snapshot(memberId, hidden) }));
    }
  }

  #sendPendingMachineAlerts(client: Ws.WebSocket, connection: EventClientState): void {
    const machine = this.#options.machine;
    if (!machine || !connection.capabilities.has(MACHINE_RESOURCES_CAPABILITY)) return;
    if (client.readyState !== webSockets.WebSocket.OPEN) return;
    for (const event of machine.pending(connection.memberId)) client.send(JSON.stringify(event));
  }

  #sendBrowserUserControl(client: Ws.WebSocket, connection: EventClientState): void {
    const tabIds = this.#options.browser
      .listTabs()
      .filter((tab) => tab.userControl)
      .map((tab) => tab.id);
    // An empty list is sent too: it clears the holds that a reconnecting client still shows.
    if (client.readyState !== webSockets.WebSocket.OPEN) return;
    client.send(JSON.stringify(this.#eventFor(connection, { type: "browser-user-control-changed", tabIds })));
  }

  listDirectThreads(memberId: string): DirectThreadSummary[] {
    return this.#requireChat().listThreads(memberId);
  }

  readDirectConversation(memberId: string, otherMemberId: string): DirectConversationSnapshot {
    this.#requireDirectRecipient(memberId, otherMemberId);
    return this.#requireChat().readConversation(memberId, otherMemberId);
  }

  readDirectConversationPage(
    memberId: string,
    otherMemberId: string,
    anchor: DirectConversationPageAnchor,
    limit: number,
  ): DirectConversationPage {
    this.#requireDirectRecipient(memberId, otherMemberId);
    return this.#requireChat().readConversationPage(memberId, otherMemberId, anchor, limit);
  }

  sendDirectMessage(
    senderMemberId: string,
    input: { memberId: string; text: string; clientMessageId: string },
  ): DirectMessage {
    this.#requireDirectRecipient(senderMemberId, input.memberId);
    const message = this.#requireChat().sendMessage({
      clientMessageId: input.clientMessageId,
      senderMemberId,
      recipientMemberId: input.memberId,
      text: input.text,
    });
    this.#publishDirectMessage(message);
    return message;
  }

  markDirectRead(memberId: string, otherMemberId: string, throughSequence: number) {
    this.#requireDirectRecipient(memberId, otherMemberId);
    return this.#requireChat().markRead(memberId, otherMemberId, throughSequence);
  }

  setLocalDirectTyping(senderMemberId: string, recipientMemberId: string, typing: boolean): void {
    this.#requireDirectRecipient(senderMemberId, recipientMemberId);
    this.#publishDirectTyping(senderMemberId, recipientMemberId, typing);
  }

  async #handle(request: IncomingMessage, response: ServerResponse) {
    const method = request.method ?? "GET";
    // The route is recorded before the target is parsed, because `#json` cannot answer without it and
    // this is the first thing below that can throw. Node's HTTP parser accepts request targets the
    // WHATWG URL parser rejects - `GET //[ HTTP/1.1` arrives as `//[` - and with the record written
    // afterwards that throw reached the catch below, made `#json` throw "route is unavailable", and
    // surfaced as an unhandled rejection over a socket nothing ever ended.
    //
    // The placeholder is `/` and not the raw target, because the record is not a log line: the
    // frozen adapters classify the route by parsing this string again, from inside the encoder the
    // catch is calling. Handing them the target that just failed to parse throws the same
    // `Invalid URL` back out of `#json`, past the only catch there is, and hangs the socket exactly
    // as before - on every protocol above v1, where classification starts. `/` is the honest answer
    // to "which route is this": there is none, and both adapters encode it as the unclassified route
    // it is. `url.pathname` replaces it the moment there is one.
    this.#responseRoutes.set(response, {
      method,
      path: "/",
      protocol: requestProtocol(request),
      capabilities: requestCapabilities(request),
    });
    try {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      this.#responseRoutes.set(response, {
        method,
        path: url.pathname,
        protocol: requestProtocol(request),
        capabilities: requestCapabilities(request),
      });

      // Three gates, in this order, and the order is the whole point of writing them out.
      //
      // `compatibility` is above the protocol gate because it is the endpoint that tells an
      // out-of-date client to update. Behind the gate it would answer 426 as well, and the client
      // would have no way to read the instruction it was being given: a 426 loop with no exit.
      //
      // The remote-screen delegation sits between them, above the protocol gate for the same reason:
      // a browser fetching the viewer sends neither protocol headers nor a bearer token. It is not a
      // route in the table; the gateway decides for itself which paths are its own.
      if (method === "GET" && url.pathname === TEAM_API_ROUTES.compatibility) {
        return this.#json(response, 200, this.#protocolSupport(requestProtocol(request)));
      }

      if (this.#options.remoteScreen?.handlesHttp(url)) {
        await runCauseEffect(this.#options.remoteScreen.handleHttp(request, response, url));
        return;
      }

      const protocolIssue = this.#protocolIssue(request);
      if (protocolIssue) return this.#json(response, protocolIssue.status, protocolIssue.body);

      // The six unauthenticated routes stay here rather than moving to a module of their own. They
      // sit astride the auth gate below, so a module holding them would need a context without a
      // member while every other module needs one with a member - two shapes of the same type, to
      // save sixty lines that have not changed in the life of the file.
      if (method === "GET" && url.pathname === TEAM_API_ROUTES.identity) {
        const challenge = url.searchParams.get("challenge");
        return this.#json(
          response,
          200,
          challenge ? this.#options.store.getIdentityProof(challenge) : this.#options.store.getIdentity(),
        );
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.join.invitationPreview) {
        const body = await readJson(request);
        return this.#json(
          response,
          200,
          this.#options.store.previewInvite(stringField(body, "inviteToken", false, INPUT_LIMITS.identifier)),
        );
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.join.server) {
        const body = await readJson(request);
        this.#checkRate(request, stringField(body, "username", false, 64));
        const result = await runCauseEffect(
          this.#options.store.acceptInvite(
            stringField(body, "inviteToken", false, INPUT_LIMITS.identifier),
            stringField(body, "username", false, 64),
            stringField(body, "password", false, 256),
          ),
        );
        return this.#json(response, 201, result);
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.join.account) {
        const body = await readJson(request);
        const identity = this.#options.store.getIdentity();
        const user = identity
          ? await (this.#options.redeemCentralTicket
              ? runCauseEffect(
                  this.#options.redeemCentralTicket(
                    stringField(body, "accountTicket", false, INPUT_LIMITS.identifier),
                    identity.serverId,
                  ),
                )
              : undefined)
          : null;
        if (!user) return this.#json(response, 401, { error: sourceText("error.team.signInRequired") });
        this.#checkRate(request, user.email);
        const result = await runCauseEffect(
          this.#options.store.acceptInviteWithAccount(
            stringField(body, "inviteToken", false, INPUT_LIMITS.identifier),
            user,
          ),
        );
        return this.#json(response, 201, result);
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.auth.login) {
        const body = await readJson(request);
        this.#checkRate(request, stringField(body, "username", false, 64));
        const result = await runCauseEffect(
          this.#options.store.login(
            stringField(body, "username", false, 64),
            stringField(body, "password", false, 256),
          ),
        );
        return this.#json(response, 200, result);
      }
      if (method === "POST" && url.pathname === TEAM_API_ROUTES.auth.account) {
        const body = await readJson(request);
        const identity = this.#options.store.getIdentity();
        const user = identity
          ? await (this.#options.redeemCentralTicket
              ? runCauseEffect(
                  this.#options.redeemCentralTicket(
                    stringField(body, "accountTicket", false, INPUT_LIMITS.identifier),
                    identity.serverId,
                  ),
                )
              : undefined)
          : null;
        if (!user) return this.#json(response, 401, { error: sourceText("error.team.signInRequired") });
        this.#checkRate(request, user.email);
        return this.#json(response, 200, await runCauseEffect(this.#options.store.loginWithAccount(user)));
      }

      // The auth gate does not look at the path. An unknown route without a token is 401, not 404,
      // and that is deliberate: answering 404 would let anyone map which endpoints this host has.
      const token = bearerToken(request.headers.authorization);
      const authenticated = token ? this.#options.store.authenticateSession(token) : null;
      if (!authenticated || !token) {
        return this.#json(response, 401, { error: sourceText("error.team.authenticationRequired") });
      }
      if (isClientUse(method, url.pathname)) this.#recordClientUse(authenticated.sessionId, authenticated.member.id);
      const context = this.#requestContext(request, response, url, token, authenticated);
      // Before `hidden`: the response projection must see the agents that the roster sends.
      if (method === "GET" && url.pathname === TEAM_API_ROUTES.agents.all && this.#options.agentsReady) {
        await runCauseEffect(this.#options.agentsReady());
      }
      // A member also gets the agents that the roles close to them as hidden.
      const hidden = this.hiddenAgentIds(context.protocol, context.capabilities, context.member);
      // Every protocol gets the projection, also with no hidden agent: a provider status row, a
      // model or an auth state of a local-only provider can be in the response.
      const responseRoute = this.#responseRoutes.get(response);
      if (responseRoute) responseRoute.hiddenAgentIds = hidden;
      const agentId = url.pathname.match(/^\/v1\/agents\/([^/]+)/u)?.[1];
      if (
        (agentId && hidden.has(pathIdentifier(agentId, "agentId"))) ||
        [url.searchParams.get("agentId"), url.searchParams.get("botId")].some((id) => id !== null && hidden.has(id))
      ) {
        throw new HttpError(404, sourceText("error.team.agentNotFound"));
      }
      // A template, a marketplace agent and an imported one start where a new agent does.
      const newAgentHidden = () => {
        const provider = this.#options.agents.newAgentProvider();
        return provider !== null && isPeerHiddenProvider(provider, context.protocol);
      };

      // First module that does not say "unmatched" wins, and the dispatcher then does nothing at
      // all - work after a `writeHead` is an `ERR_HTTP_HEADERS_SENT` thrown into the catch below,
      // over a response that has already been sent.
      //
      // Sequence is safe because the six prefixes are disjoint, so a request that falls out of one
      // module could not have matched a later one in the single chain this replaced. What that
      // relies on is each module answering "unmatched" for a method it does not serve rather than
      // 404 on its own: the 404 below is the only one in the Team API, which is what keeps a wrong
      // method on a known path answering 404 - never 405 - exactly as the released clients expect.
      if ((await this.#routeTeam(context)) === "handled") return;
      if ((await this.#routeRemoteScreen(context)) === "handled") return;
      if ((await this.#routeDirect(context)) === "handled") return;
      if ((await this.#routeBrowser(context)) === "handled") return;
      if ((await this.#routeFiles(context)) === "handled") return;
      if ((await routeChannels(context, this.#options.channels, this.#options.agents, hidden)) === "handled") return;
      if (
        (await routeMcpServers(context, this.#options.mcpServers, this.#options.mcpToolRuntimePreparation)) ===
        "handled"
      )
        return;
      if ((await routeMcpSignIn(context, this.#options.mcpServers && this.#options.mcpSignIns)) === "handled") return;
      if ((await routeMcpSignInApp(context, this.#options.mcpServers && this.#options.mcpSignIns)) === "handled")
        return;
      if ((await routeSignInRelay(context, this.#options.mcpServers && this.#options.signInRelay)) === "handled")
        return;
      if ((await routeConnectors(context, this.#options.connectors)) === "handled") return;
      if ((await routeDiscordAccess(context, this.#options.connectors)) === "handled") return;
      if ((await routeOnePasswordConnector(context, this.#options.onePasswordConnector)) === "handled") return;
      if ((await routeBitwardenConnector(context, this.#options.bitwardenConnector)) === "handled") return;
      if ((await routeVault(context, this.#options.vault)) === "handled") return;
      if ((await routeVaultImport(context, this.#options.vault)) === "handled") return;
      if ((await routeProviderHostSignIn(context, this.#options.providerHostSignIns)) === "handled") return;
      if ((await routeProviderAccounts(context, this.#options.providerAccounts)) === "handled") return;
      if ((await routeProviderUsageReset(context, this.#options.providerUsageResets)) === "handled") return;
      if ((await routeProviderSignOut(context, this.#options.providerSignOut)) === "handled") return;
      if ((await routeStorage(context, this.#options.storage)) === "handled") return;
      if ((await routeMachineResources(context, this.#options.machine)) === "handled") return;
      if ((await routeHostedSites(context, this.#options.hostedSites)) === "handled") return;
      if ((await routeAgentAdmin(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentHostSettings(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentBackupModels(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentTaskLimit(context, this.#options.admin, hidden)) === "handled") return;
      if (
        (await routeBrowserProfiles(context, this.#options.browserProfiles, this.#options.browser, hidden)) ===
        "handled"
      )
        return;
      if ((await routeRoutineResults(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentSessionSettings(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAgentHidden(context, this.#options.hiddenAgents, hidden)) === "handled") return;
      if (
        (await routeAgentNotificationLevels(
          context,
          this.#options.agentNotificationLevels,
          this.#options.agents,
          hidden,
        )) === "handled"
      )
        return;
      if ((await routeAgentTasks(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentThreads(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentThreadReads(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeAgentThreadFiles(context, this.#options.agentTasks, hidden)) === "handled") return;
      if ((await routeSkillsAdmin(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeSharedTables(context, this.#options.admin)) === "handled") return;
      if ((await routeAgentInstall(context, this.#options.admin, hidden, newAgentHidden)) === "handled") return;
      if ((await routeAgentPublish(context, this.#options.admin, hidden)) === "handled") return;
      if ((await routeAcpRegistry(context, this.#options.admin)) === "handled") return;
      if ((await routeProviders(context, this.#options.admin)) === "handled") return;
      if ((await routeHostAdmin(context, this.#options.admin)) === "handled") return;
      if ((await routeHostUpdate(context, this.#options.admin)) === "handled") return;
      if ((await routeHostTimezone(context, this.#options.admin)) === "handled") return;
      if ((await routeAgentMemoryLimit(context, this.#options.admin)) === "handled") return;
      if ((await routeMemoryReview(context, this.#options.admin)) === "handled") return;
      if ((await routePromptCacheTtl(context, this.#options.admin)) === "handled") return;
      if ((await routeProviderDefault(context, this.#options.admin)) === "handled") return;
      if (
        (await routeAgentAccess(
          context,
          this.#options.agentAccess,
          this.#options.agents,
          this.#options.store.getIdentity()?.serverId,
          hidden,
        )) === "handled"
      )
        return;
      if ((await routeContextReset(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeAgentMemoryPage(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeWorkspaceDirectory(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeConversationFiles(context, this.#options.agents)) === "handled") return;
      if ((await routeSideQuestion(context, this.#options.agents, hidden)) === "handled") return;
      if ((await routeRoutineFlows(context, this.#options.routineFlows, this.#options.agents, hidden)) === "handled")
        return;
      if ((await routeWorkflows(context, this.#options.workflows, this.#options.agents, hidden)) === "handled") return;
      if ((await this.#routeEvents(context)) === "handled") return;
      if ((await routeAgentImport(context, this.#options.agentImport, newAgentHidden)) === "handled") return;
      if ((await routeInstanceTransfer(context, this.#options.instanceTransfer, newAgentHidden)) === "handled") return;
      if (
        // The ID, not the member: the registration outlives a role change.
        (await routeLiveActivityPush(context, this.#options.liveActivityPush, () =>
          this.hiddenAgentIds(context.protocol, context.capabilities, context.member.id),
        )) === "handled"
      )
        return;
      if ((await routePushNotifications(context, this.#options.pushNotifications)) === "handled") return;
      if (
        (await routeFocusUse(context, this.#options.focusUse ? (id) => this.#recordFocusUse(id) : undefined)) ===
        "handled"
      )
        return;
      if ((await this.#routeAgents(context)) === "handled") return;

      // The only 404 in the Team API.
      return this.#json(response, 404, { error: sourceText("error.team.routeNotFound") });
    } catch (error) {
      // The only catch, too. A module with its own would cut an unexpected error off from the
      // logger below and answer 400 where the failure was a 500 nobody would then ever see.
      const expected =
        error instanceof HttpError ||
        error instanceof RemoteScreenError ||
        error instanceof TeamStoreError ||
        error instanceof McpServerError ||
        error instanceof AnalyticsInputError ||
        error instanceof AgentMemorySelectionError;
      const status =
        error instanceof HttpError || error instanceof RemoteScreenError ? error.status : expected ? 400 : 500;
      // Catalog text with no placeholder is safe to show, and the user can act on it. Any other
      // unexpected text stays private.
      const message =
        expected || (error instanceof Error && isFixedSourceText(error.message))
          ? error.message
          : sourceText("error.team.requestFailed");
      const code = error instanceof RemoteScreenError ? error.code : undefined;
      if (!expected) (this.#options.logger ?? logger).error("Team API request failed:", toLogValue(error));
      // A streamed file can fail after its head is on the wire. A second head is not possible, so
      // the socket closes and the client sees an incomplete download.
      if (response.headersSent) {
        response.destroy();
        return;
      }
      return this.#json(response, status, { error: message, ...(code ? { code } : {}) });
    }
  }

  // One method per module, so the dispatcher above reads as a list of domains and the wiring of
  // each narrow `*RouteDependencies` sits next to nothing else.
  #routeTeam(context: TeamApiRequestContext): Promise<RouteOutcome> {
    const { remoteScreen, browserView, createInvite, updateMember, removeMember, onSessionRevoked } = this.#options;
    return routeTeam(context, {
      store: this.#options.store,
      browser: this.#options.browser,
      ...(remoteScreen === undefined ? {} : { remoteScreen }),
      ...(browserView === undefined ? {} : { browserView }),
      ...(createInvite === undefined ? {} : { createInvite }),
      ...(updateMember === undefined ? {} : { updateMember }),
      ...(removeMember === undefined ? {} : { removeMember }),
      ...(onSessionRevoked === undefined ? {} : { onSessionRevoked }),
      getPresence: () => this.getPresence(),
      refreshPresence: () => this.refreshPresence(),
    });
  }

  #routeRemoteScreen(context: TeamApiRequestContext): Promise<RouteOutcome> {
    const remoteScreen = this.#options.remoteScreen;
    return routeRemoteScreen(context, {
      store: this.#options.store,
      ...(remoteScreen === undefined ? {} : { remoteScreen }),
    });
  }

  #routeDirect(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeDirect(context, {
      listDirectThreads: (memberId) => this.listDirectThreads(memberId),
      readDirectConversation: (memberId, otherMemberId) => this.readDirectConversation(memberId, otherMemberId),
      readDirectConversationPage: (memberId, otherMemberId, anchor, limit) =>
        this.readDirectConversationPage(memberId, otherMemberId, anchor, limit),
      sendDirectMessage: (senderMemberId, input) => this.sendDirectMessage(senderMemberId, input),
      markDirectRead: (memberId, otherMemberId, throughSequence) =>
        this.markDirectRead(memberId, otherMemberId, throughSequence),
    });
  }

  #routeBrowser(context: TeamApiRequestContext): Promise<RouteOutcome> {
    const browserView = this.#options.browserView;
    return routeBrowser(context, {
      browser: this.#options.browser,
      ...(browserView === undefined ? {} : { browserView }),
    });
  }

  #routeFiles(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeFiles(context, { agents: this.#options.agents, mailbox: this.#options.mailbox });
  }

  #routeAgents(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeAgents(context, {
      agents: this.#options.agents,
      skills: this.#options.skills,
      sidebarLayout: this.#options.sidebarLayout,
      duplicateAgent: (agentId, operationId) => this.#duplicateAgent(agentId, operationId),
    });
  }

  #routeEvents(context: TeamApiRequestContext): Promise<RouteOutcome> {
    return routeEvents(context, { events: this.#options.events });
  }

  #checkRate(request: IncomingMessage, username: string): void {
    // The same form of the name as the team store compares, so spaces around it do not start a new count.
    const key = `${this.#rateLimitSource(request)}:${username.trim().toLowerCase()}`;
    const now = this.#now();
    this.#pruneRateLimits(now, this.#rateLimits.size >= this.#rateLimitCapacity);
    const current = this.#rateLimits.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.#rateLimits.size >= this.#rateLimitCapacity) {
        throw new HttpError(429, sourceText("error.team.tooManySignInAttempts"));
      }
      this.#rateLimits.set(key, { attempts: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return;
    }
    current.attempts += 1;
    if (current.attempts > RATE_LIMIT_ATTEMPTS) {
      throw new HttpError(429, sourceText("error.team.tooManySignInAttempts"));
    }
  }

  /**
   * The caller that the sign-in limit counts. The WebRTC host peer sends the requests of all its
   * peers from this computer, so the address is the same for each peer, and one peer could use
   * all the attempts for a user name. A forwarded request has the session token of its peer and
   * the session ID in a header; both must agree, so a header alone does not select a new count.
   */
  #rateLimitSource(request: IncomingMessage): string {
    const address = request.socket.remoteAddress ?? "local";
    const webRtcSession = request.headers["x-openbot-webrtc-session"];
    const token = bearerToken(request.headers.authorization);
    if (!isString(webRtcSession) || !token) return address;
    const authenticated = this.#options.store.authenticateSession(token);
    return authenticated?.sessionId === webRtcSession ? `webrtc:${webRtcSession}` : address;
  }

  #pruneRateLimits(now: number, force: boolean): void {
    if (!force && now < this.#nextRateLimitSweepAt) return;
    for (const [key, entry] of this.#rateLimits) {
      if (entry.resetAt <= now) this.#rateLimits.delete(key);
    }
    this.#nextRateLimitSweepAt = now + RATE_LIMIT_SWEEP_MS;
  }

  #encodeProviderEvent(
    event: AgentEvent | TeamRealtimeEvent,
    capabilities: ReadonlySet<string>,
    options: { preserveSemanticTags?: boolean } = {},
    blocked: ReadonlySet<string> = new Set(),
  ): string | null {
    const protocol = eventProtocol(capabilities);
    const hidden = hiddenProviderAgentIds(this.#options.agents.listAgents(), protocol);
    for (const id of blocked) hidden.add(id);
    const visible = protocol === 1 ? legacyProviderView(event, hidden) : hiddenAgentView(event, hidden, protocol);
    if (!isAgentEvent(visible) && !isTeamRealtimeEvent(visible)) return null;
    if (protocol !== 1)
      return (
        protocol === 8
          ? encodeTeamProtocolV8BaseCurrentEvent
          : protocol === 7
            ? encodeTeamProtocolV7BaseCurrentEvent
            : protocol === 6
              ? encodeTeamProtocolV6BaseCurrentEvent
              : protocol === 5
                ? encodeTeamProtocolV5BaseCurrentEvent
                : encodeTeamProtocolV4BaseCurrentEvent
      )(visible, {
        ...options,
        preserveBrowserSecrets: capabilities.has("browser-secret-handoff"),
        // Only the V8 encoder reads them.
        browserSignIn: capabilities.has(BROWSER_SIGN_IN_CAPABILITY),
        contextUsage: capabilities.has(TEAM_CONTEXT_USAGE_CAPABILITY),
        // Only the V7 and V8 encoders read them.
        uiBlocks: capabilities.has(TEAM_UI_BLOCKS_CAPABILITY),
        subagents: capabilities.has(TEAM_SUBAGENTS_CAPABILITY),
        promptMultiSelect: capabilities.has(TEAM_PROMPT_MULTI_SELECT_CAPABILITY),
      });
    return encodeTeamProtocolV1CurrentEvent(visible, options);
  }

  #broadcastAgentEvent(event: AgentEvent): void {
    if (event.type !== "conversation") {
      this.#broadcastAgentEventToClients(event);
      return;
    }

    // A bounded runtime snapshot is enough for modern clients: they fetch the page they need after
    // this invalidation. The released event clients have no invalidation path, so they keep the old
    // full snapshot contract. Read that snapshot only when such a client is connected, and keep the
    // read out of the synchronous event path used by modern clients.
    const primaryAgent = this.#options.agents.listAgents().find((agent) => agent.id === event.snapshot.agentId);
    if (!primaryAgent || primaryAgent.threadId !== event.snapshot.threadId) {
      // Execution and channel threads are consumed by their owners before this listener. A stale
      // event for a deleted agent must also never enter readConversation, which fails for an
      // agent that is gone.
      this.#broadcastAgentEventToClients(event, "modern");
      return;
    }
    const hasLegacyClient = [...this.#eventClients.values()].some(isLegacyConversationClient);
    this.#broadcastAgentEventToClients(event, hasLegacyClient ? "modern" : "all");
    if (hasLegacyClient) this.#queueLegacyConversationEvent(event);
  }

  #queueLegacyConversationEvent(event: Extract<AgentEvent, { type: "conversation" }>, retries = 0): void {
    const agentId = event.snapshot.agentId;
    const pending = this.#pendingLegacyConversationReads.get(agentId);
    if (pending) {
      // One full SQLite materialization is enough for a burst. The newest event is the state that
      // the legacy client needs, so an older read never gets replayed after a newer event arrives.
      pending.event = event;
      return;
    }

    const next: PendingLegacyConversationRead = { event, retries };
    this.#pendingLegacyConversationReads.set(agentId, next);
    const materialize = Effect.gen({ self: this }, function* () {
      // `readConversation` fails for an agent that is gone. Skip a delayed event read for an agent
      // that was deleted after the event was emitted.
      if (!this.#options.agents.listAgents().some((agent) => agent.id === agentId)) {
        this.#pendingLegacyConversationReads.delete(agentId);
        return;
      }
      if (![...this.#eventClients.values()].some(isLegacyConversationClient)) {
        this.#pendingLegacyConversationReads.delete(agentId);
        return;
      }
      const snapshot = yield* this.#options.agents.readConversation(agentId);
      if (this.#pendingLegacyConversationReads.get(agentId) !== next) return;
      if (!this.#options.agents.listAgents().some((agent) => agent.id === agentId)) {
        this.#pendingLegacyConversationReads.delete(agentId);
        return;
      }
      if (![...this.#eventClients.values()].some(isLegacyConversationClient)) {
        this.#pendingLegacyConversationReads.delete(agentId);
        return;
      }
      const latest = next.event;
      if (snapshot.revision < latest.snapshot.revision && next.retries === 0) {
        // The event can be emitted while the read is still catching up with its transaction.
        // Retry once the newest revision is the durable one instead of sending a stale snapshot.
        this.#pendingLegacyConversationReads.delete(agentId);
        this.#queueLegacyConversationEvent(latest, 1);
        return;
      }
      if (snapshot.revision < latest.snapshot.revision) {
        this.#pendingLegacyConversationReads.delete(agentId);
        (this.#options.logger ?? logger).warn("Legacy conversation event read is behind its revision.");
        return;
      }
      this.#pendingLegacyConversationReads.delete(agentId);
      this.#broadcastAgentEventToClients({ type: "conversation", snapshot }, "legacy");
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (this.#pendingLegacyConversationReads.get(agentId) === next) {
            this.#pendingLegacyConversationReads.delete(agentId);
          }
          (this.#options.logger ?? logger).warn(
            "Legacy conversation event could not be materialized:",
            toLogValue(error.cause),
          );
        }),
      ),
      Effect.forkIn(this.#legacyConversationScope, { startImmediately: true }),
    );
    Effect.runFork(materialize);
  }

  #broadcastAgentEventToClients(broadcast: AgentEvent, audience: ConversationEventAudience = "all"): void {
    const filteredConversationPayloads = new Map<string, string>();
    // The roles give each connection of one member the same agents: read them once for each member.
    const access = new Map<string, { member: AccessMember; blocked: Set<string>; key: string }>();
    const accessFor = (connection: EventClientState) => {
      const known = access.get(connection.memberId);
      if (known) return known;
      const member = this.#connectionMember(connection);
      const blocked = this.#blockedAgentIds(member);
      const resolved = { member, blocked, key: [...blocked].sort().join(",") };
      access.set(connection.memberId, resolved);
      return resolved;
    };

    for (const [client, connection] of this.#eventClients) {
      const event = this.#eventFor(connection, broadcast);
      // Only accounts after the first: a client reads an empty reading as no provider reporting.
      if (event !== broadcast && event.type === "usage-changed" && event.usage.limits.length === 0) continue;
      if (event.type === "conversation") {
        const legacy = isLegacyConversationClient(connection);
        if ((audience === "legacy" && !legacy) || (audience === "modern" && legacy)) continue;
      }
      const encodingOptions = { preserveSemanticTags: supportsTeamSemanticTags(connection.capabilities) };
      const supportsRuntimeSnapshots = connection.capabilities.has("agent-runtime-snapshots");
      const requiredCapability = eventCapability(event);
      if (requiredCapability && !connection.capabilities.has(requiredCapability)) continue;
      // A task conversation follows the conversation scope too: a desktop asks for it only for its active server.
      if (
        (event.type === "conversation" ||
          event.type === "agent-task-conversation" ||
          event.type === "agent-task-conversation-delta") &&
        !connection.includeConversationEvents
      ) {
        continue;
      }
      if (event.type === "queue-changed" && supportsRuntimeSnapshots && !connection.includeConversationEvents) {
        continue;
      }
      const { member, blocked, key: blockedKey } = accessFor(connection);
      // An event this client's protocol cannot describe is skipped for this client only. Thrown
      // out of the loop, it would stop the event for every client after this one.
      const encodeEvent = (event: AgentEvent, options = {}) => {
        try {
          return this.#encodeProviderEvent(event, connection.capabilities, options, blocked);
        } catch (error) {
          (this.#options.logger ?? logger).warn("Team API event could not be encoded:", toLogValue(error));
          return null;
        }
      };
      let conversationInvalidation: string | undefined;
      let queueInvalidation: string | undefined;
      let outgoing: string;
      // `eventCapability` above has already kept an optional event from a client without its capability.
      // Completion must still reach a peer without quiet-turn-v1 through its frozen adapter.
      let optional: OptionalTeamEvent | null;
      try {
        optional =
          event.type === "turn-completed" && event.quiet && connection.capabilities.has(QUIET_TURN_CAPABILITY)
            ? {
                type: "quiet-turn-completed" as const,
                agentId: event.agentId,
                threadId: event.threadId,
                turnId: event.turnId,
                status: event.status,
                ...(event.origin === undefined ? {} : { origin: event.origin }),
              }
            : optionalTeamEvent(
                event.type === "agent-task-conversation"
                  ? { ...event, snapshot: conversationSnapshotForCapabilities(event.snapshot, connection.capabilities) }
                  : event,
                { agentTaskUiBlocks: connection.capabilities.has(AGENT_TASK_UI_BLOCKS_CAPABILITY) },
              );
      } catch (error) {
        // As for `encodeEvent`: a malformed optional event is skipped for this client only.
        (this.#options.logger ?? logger).warn("Team API event could not be encoded:", toLogValue(error));
        continue;
      }
      if (optional) {
        // The base events go through the provider view; an optional event that names a hidden agent is left out.
        // A task event uses the hidden agents of the task routes, so a task of an agent that answers 404 does not arrive.
        const agentId = optionalEventAgentId(optional);
        const protocol = eventProtocol(connection.capabilities);
        if (
          agentId !== null &&
          (blocked.has(agentId) ||
            (requiredCapability === AGENT_TASKS_CAPABILITY
              ? this.hiddenAgentIds(protocol, connection.capabilities)
              : hiddenProviderAgentIds(this.#options.agents.listAgents(), protocol)
            ).has(agentId))
        )
          continue;
        // The list of hidden agents does not name an agent that this peer cannot see, as `/v1/hidden-agents` does.
        outgoing = JSON.stringify(
          optional.type === "hidden-agents-changed"
            ? {
                type: optional.type,
                ...visibleSnapshot(
                  optional,
                  this.hiddenAgentIds(eventProtocol(connection.capabilities), connection.capabilities, member),
                ),
              }
            : optional,
        );
      } else if (event.type === "conversation" && supportsRuntimeSnapshots) {
        conversationInvalidation ??=
          encodeEvent({
            type: "conversation-invalidated",
            agentId: event.snapshot.agentId,
            revision: event.snapshot.revision,
          }) ?? undefined;
        if (!conversationInvalidation) continue;
        outgoing = conversationInvalidation;
      } else if (event.type === "queue-changed" && supportsRuntimeSnapshots) {
        queueInvalidation ??= encodeEvent({ type: "queue-invalidated", agentId: event.snapshot.agentId }) ?? undefined;
        if (!queueInvalidation) continue;
        outgoing = queueInvalidation;
      } else if (
        event.type === "conversation" &&
        (!connection.capabilities.has("routine-event-markers") ||
          !connection.capabilities.has("routine-run-event-markers") ||
          !connection.capabilities.has("hosted-site-event-markers") ||
          event.snapshot.messages.some((message) => message.itemType === ROUTINE_QUIET_ANSWER_ITEM_TYPE))
      ) {
        // The payloads are shared between clients, so the key holds what the roles allow too.
        const key = `${blockedKey}:${eventProtocol(connection.capabilities)}:${connection.capabilities.has("opencode")}:${connection.capabilities.has("routine-event-markers")}:${connection.capabilities.has("routine-run-event-markers")}:${connection.capabilities.has("hosted-site-event-markers")}:${connection.capabilities.has(TEAM_PROMPT_MULTI_SELECT_CAPABILITY)}:${encodingOptions.preserveSemanticTags}`;
        let filtered = filteredConversationPayloads.get(key);
        if (!filtered) {
          filtered =
            encodeEvent(
              {
                ...event,
                snapshot: conversationSnapshotForCapabilities(event.snapshot, connection.capabilities),
              },
              encodingOptions,
            ) ?? undefined;
          if (filtered) filteredConversationPayloads.set(key, filtered);
        }
        if (!filtered) continue;
        outgoing = filtered;
      } else {
        const payload = encodeEvent(event, encodingOptions) ?? undefined;
        if (!payload) continue;
        outgoing = payload;
      }
      const limit = event.type === "runtime-snapshot" ? AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT : JSON_LIMIT;
      if (Buffer.byteLength(outgoing) > limit) continue;
      if (client.readyState !== webSockets.WebSocket.OPEN) continue;
      client.send(outgoing);
      if (event.type !== "turn-completed" || !supportsRuntimeSnapshots || connection.includeConversationEvents) {
        continue;
      }
      const completionSnapshot =
        encodeEvent(
          {
            type: "runtime-snapshot",
            snapshot: this.#options.agents.getRuntimeSnapshot(),
          },
          encodingOptions,
        ) ?? undefined;
      if (!completionSnapshot) continue;
      // The snapshot is this client's own. It does not fit, so this client loses the snapshot and
      // keeps the turn, and the clients after it in the loop still get the turn.
      if (Buffer.byteLength(completionSnapshot) > AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) continue;
      client.send(completionSnapshot);
    }
  }

  #sendBrowserPageState(client: Ws.WebSocket, connection: EventClientState): void {
    const tabs = this.#options.browser.listTabs().map((tab) => ({
      tabId: tab.id,
      canGoBack: tab.canGoBack === true,
      canGoForward: tab.canGoForward === true,
    }));
    if (client.readyState !== webSockets.WebSocket.OPEN) return;
    client.send(JSON.stringify(this.#eventFor(connection, { type: "browser-page-state-changed", tabs })));
  }

  /**
   * A member does not see an administrator's private MCP sign-in tab, the same as on the browser
   * routes. A usage reading keeps the provider's own sign-in only, as `GET /v1/agents/usage` does: a
   * released client reads one limit per provider.
   */
  #eventFor(connection: EventClientState, event: AgentEvent): AgentEvent {
    if (event.type === "usage-changed" && event.usage.limits.some((limit) => limit.accountId !== undefined))
      return {
        ...event,
        usage: { ...event.usage, limits: event.usage.limits.filter((limit) => limit.accountId === undefined) },
      };
    if (event.type === "browser-user-control-changed") {
      const { browser, store } = this.#options;
      if (!event.tabIds.some((tabId) => browser.isPrivate(tabId))) return event;
      if (canAdministerServer(store.authenticate(connection.token)?.role)) return event;
      return { ...event, tabIds: event.tabIds.filter((tabId) => !browser.isPrivate(tabId)) };
    }
    if (event.type === "browser-page-state-changed") {
      const { browser, store } = this.#options;
      if (!event.tabs.some((tab) => browser.isPrivate(tab.tabId))) return event;
      if (canAdministerServer(store.authenticate(connection.token)?.role)) return event;
      return { ...event, tabs: event.tabs.filter((tab) => !browser.isPrivate(tab.tabId)) };
    }
    if (event.type !== "browser-changed") return event;
    const { browser, store } = this.#options;
    if (!event.tabs.some((tab) => browser.isPrivate(tab.id))) return event;
    const role = store.authenticate(connection.token)?.role;
    if (canAdministerServer(role)) return event;
    const tabs = event.tabs.filter((tab) => !browser.isPrivate(tab.id));
    return { ...event, tabs, activeTabId: tabs.some((tab) => tab.id === event.activeTabId) ? event.activeTabId : null };
  }

  #connectEvents(
    client: Ws.WebSocket,
    token: string,
    memberId: string,
    supportsSnapshotTransport: boolean,
    acceptsCapabilityDeclaration: boolean,
  ): void {
    const sessionId = this.#options.store.authenticateSession(token)?.sessionId ?? null;
    const connection: EventClientState = {
      token,
      memberId,
      sessionId,
      capabilities: new Set(
        acceptsCapabilityDeclaration
          ? []
          : TEAM_PROTOCOL_V1_CAPABILITIES.filter(
              (capability) =>
                capability !== "routine-event-markers" &&
                capability !== "routine-run-event-markers" &&
                capability !== "hosted-site-event-markers" &&
                (supportsSnapshotTransport || capability !== "agent-runtime-snapshots"),
            ),
      ),
      includeConversationEvents: !supportsSnapshotTransport,
      typingAgentId: null,
      typingTimer: null,
      directTypingRecipientId: null,
      directTypingTimer: null,
      snapshotResponsePending: false,
      snapshotRequestQueued: false,
      nextSnapshotRequestAt: 0,
    };
    this.#eventClients.set(client, connection);
    client.on("error", () => {
      // Protocol errors, including maxPayload violations, also close the socket.
      // Consume the emitted error so malformed input cannot become an uncaught exception.
    });
    if (connection.capabilities.has("agent-runtime-snapshots")) {
      this.#sendRuntimeSnapshot(client, connection, false);
    }
    client.on("message", (data, isBinary) => {
      if (isBinary) {
        client.close(1003, "Text events are required");
        return;
      }
      try {
        const text = Buffer.isBuffer(data)
          ? data.toString("utf8")
          : Array.isArray(data)
            ? Buffer.concat(data).toString("utf8")
            : Buffer.from(data).toString("utf8");
        if (text.length > EVENT_PAYLOAD_LIMIT) throw new Error("Event payload is too large.");
        const event = decodeTeamProtocolV1CurrentClientEvent(JSON.parse(text));
        if (event.type === "runtime-snapshot-request" && connection.capabilities.has("agent-runtime-snapshots")) {
          this.#sendRuntimeSnapshot(client, connection, true);
          return;
        }
        if (event.type === "agent-event-scope" && supportsSnapshotTransport) {
          if (acceptsCapabilityDeclaration) {
            if (!event.capabilities) throw new Error("Invalid client capabilities.");
            const snapshotsWereEnabled = connection.capabilities.has("agent-runtime-snapshots");
            const restartWasSent =
              connection.capabilities.has(HOST_UPDATE_CAPABILITY) ||
              connection.capabilities.has(HOST_MEMBER_UPDATE_CAPABILITY);
            const userControlWasSent = connection.capabilities.has(BROWSER_USER_CONTROL_CAPABILITY);
            const pageStateWasSent = connection.capabilities.has(BROWSER_PAGE_STATE_CAPABILITY);
            const machineAlertsWereSent = connection.capabilities.has(MACHINE_RESOURCES_CAPABILITY);
            connection.capabilities = new Set(event.capabilities.filter(isTeamCurrentCapability));
            if (connection.capabilities.has("agent-runtime-snapshots") && !snapshotsWereEnabled) {
              this.#sendRuntimeSnapshot(client, connection, false);
            }
            // A member that connects while a restart waits learns about it here, not at the next change.
            if (!restartWasSent && this.#hostRestart.state !== "none") this.#sendHostRestart(client, connection);
            // The same for the tabs that a person controls now.
            if (!userControlWasSent && connection.capabilities.has(BROWSER_USER_CONTROL_CAPABILITY))
              this.#sendBrowserUserControl(client, connection);
            if (!pageStateWasSent && connection.capabilities.has(BROWSER_PAGE_STATE_CAPABILITY))
              this.#sendBrowserPageState(client, connection);
            // An alert that came while the member had no device online.
            if (!machineAlertsWereSent) this.#sendPendingMachineAlerts(client, connection);
          }
          connection.includeConversationEvents = event.includeConversations;
          return;
        }
        if (event.type === "team-direct-typing") {
          if (!connection.capabilities.has("direct-messages")) {
            throw new Error("Direct messages are not enabled for this client.");
          }
          const typing = event.typing;
          const recipientMemberId = event.recipientMemberId;
          if (recipientMemberId.length > INPUT_LIMITS.identifier) {
            throw new Error("Invalid direct typing recipient.");
          }
          this.#requireDirectRecipient(memberId, recipientMemberId);
          this.#setClientDirectTyping(connection, typing ? recipientMemberId : null);
          return;
        }
        if (event.type !== "team-typing") throw new Error("Unsupported team event.");
        const typing = event.typing;
        const agentId = event.agentId;
        if (typing && (!agentId || agentId.length > INPUT_LIMITS.identifier)) {
          throw new Error("A valid agent is required for typing state.");
        }
        // Typing to an agent that the roles close to the member says nothing to the others.
        const open = !!agentId && this.agentLevel(this.#connectionMember(connection), agentId) !== "none";
        this.#setClientTyping(connection, typing && open ? agentId : null);
      } catch {
        client.close(1003, "Invalid team event payload");
      }
    });
    client.once("close", () => {
      if (connection.typingTimer) clearTimeout(connection.typingTimer);
      if (connection.directTypingTimer) clearTimeout(connection.directTypingTimer);
      const directTypingRecipientId = connection.directTypingRecipientId;
      connection.directTypingRecipientId = null;
      this.#eventClients.delete(client);
      // A client that closes, crashes or loses the network keeps its session, so its last socket gives back
      // the pages that the session controls. Otherwise the agent waits for a person who is not there.
      if (sessionId && ![...this.#eventClients.values()].some((other) => other.sessionId === sessionId)) {
        // iOS can suspend a phone before it says that it goes away. Its last closed connection says so.
        // Another open connection of the session is still the app on screen.
        this.#options.liveActivityPush?.disconnected(sessionId);
        this.#options.pushNotifications?.disconnected(sessionId);
        this.#options.browser.releaseUserControlHeldBy({ kind: "session", sessionId });
      }
      if (directTypingRecipientId && !this.#hasDirectTyping(connection.memberId, directTypingRecipientId)) {
        this.#publishDirectTyping(connection.memberId, directTypingRecipientId, false);
      }
      this.#publishPresence();
    });
    this.#publishPresence();
  }

  #sendRuntimeSnapshot(client: Ws.WebSocket, connection: EventClientState, rateLimited: boolean): void {
    const now = this.#now();
    if (connection.snapshotResponsePending) {
      if (rateLimited) connection.snapshotRequestQueued = true;
      return;
    }
    if (
      client.readyState !== webSockets.WebSocket.OPEN ||
      client.bufferedAmount > EVENT_PAYLOAD_LIMIT ||
      (rateLimited && now < connection.nextSnapshotRequestAt)
    ) {
      return;
    }
    connection.snapshotResponsePending = true;
    if (rateLimited) connection.nextSnapshotRequestAt = now + RUNTIME_SNAPSHOT_REQUEST_INTERVAL_MS;
    try {
      const payload = this.#encodeProviderEvent(
        {
          type: "runtime-snapshot",
          snapshot: this.#options.agents.getRuntimeSnapshot(),
        },
        connection.capabilities,
        {},
        this.#blockedAgentIds(this.#connectionMember(connection)),
      );
      if (!payload) throw new Error("Runtime snapshot is not supported by Team protocol v1.");
      if (Buffer.byteLength(payload) > AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) {
        throw new Error("Runtime snapshot exceeds its transport budget.");
      }
      client.send(payload, (error) => {
        connection.snapshotResponsePending = false;
        if (error && client.readyState === webSockets.WebSocket.OPEN) {
          client.close(1011, "Runtime snapshot could not be sent");
          return;
        }
        if (connection.snapshotRequestQueued) {
          connection.snapshotRequestQueued = false;
          this.#sendRuntimeSnapshot(client, connection, true);
        }
      });
    } catch {
      connection.snapshotResponsePending = false;
      client.close(1011, "Runtime snapshot could not be created");
    }
  }

  #setClientTyping(connection: EventClientState, agentId: string | null): void {
    this.#recordClientUse(connection.sessionId, connection.memberId);
    const changed = connection.typingAgentId !== agentId;
    connection.typingAgentId = agentId;
    if (connection.typingTimer) clearTimeout(connection.typingTimer);
    connection.typingTimer = agentId
      ? setTimeout(() => {
          connection.typingTimer = null;
          if (!connection.typingAgentId) return;
          connection.typingAgentId = null;
          this.#publishPresence();
        }, TYPING_TIMEOUT_MS)
      : null;
    connection.typingTimer?.unref?.();
    if (changed) this.#publishPresence();
  }

  #setClientDirectTyping(connection: EventClientState, recipientMemberId: string | null): void {
    this.#recordClientUse(connection.sessionId, connection.memberId);
    const previousRecipientId = connection.directTypingRecipientId;
    const changed = previousRecipientId !== recipientMemberId;
    const recipientAlreadyActive = recipientMemberId
      ? this.#hasDirectTyping(connection.memberId, recipientMemberId)
      : false;
    connection.directTypingRecipientId = recipientMemberId;
    if (changed && previousRecipientId && !this.#hasDirectTyping(connection.memberId, previousRecipientId)) {
      this.#publishDirectTyping(connection.memberId, previousRecipientId, false);
    }
    if (connection.directTypingTimer) clearTimeout(connection.directTypingTimer);
    connection.directTypingTimer = recipientMemberId
      ? setTimeout(() => {
          connection.directTypingTimer = null;
          const expiredRecipientId = connection.directTypingRecipientId;
          if (!expiredRecipientId) return;
          connection.directTypingRecipientId = null;
          if (!this.#hasDirectTyping(connection.memberId, expiredRecipientId)) {
            this.#publishDirectTyping(connection.memberId, expiredRecipientId, false);
          }
        }, TYPING_TIMEOUT_MS)
      : null;
    connection.directTypingTimer?.unref?.();
    if (changed && recipientMemberId && !recipientAlreadyActive) {
      this.#publishDirectTyping(connection.memberId, recipientMemberId, true);
    }
  }

  #hasDirectTyping(senderMemberId: string, recipientMemberId: string): boolean {
    return [...this.#eventClients.values()].some(
      (connection) =>
        connection.memberId === senderMemberId && connection.directTypingRecipientId === recipientMemberId,
    );
  }

  #publishPresence(): void {
    const snapshot = this.getPresence();
    this.#options.onPresence?.(snapshot);
    const event: TeamRealtimeEvent = { type: "team-presence", snapshot };
    for (const [client, connection] of this.#eventClients) {
      const payload = this.#encodeProviderEvent(
        event,
        connection.capabilities,
        {},
        this.#blockedAgentIds(this.#connectionMember(connection)),
      );
      if (payload && client.readyState === webSockets.WebSocket.OPEN) client.send(payload);
    }
  }

  #publishDirectMessage(message: DirectMessage): void {
    const memberIds: [string, string] = [message.senderMemberId, message.recipientMemberId];
    const event: DirectMessageRealtimeEvent = {
      type: "team-direct-message",
      message,
      memberIds,
    };
    this.#sendToMembers(memberIds, event);
    const owner = this.#options.store.listMembers().find((member) => member.role === "owner");
    if (owner && memberIds.includes(owner.id)) this.#options.onDirectMessage?.(event);
  }

  #publishDirectTyping(senderMemberId: string, recipientMemberId: string, typing: boolean): void {
    const event: DirectTypingRealtimeEvent = {
      type: "team-direct-typing",
      senderMemberId,
      recipientMemberId,
      typing,
    };
    this.#sendToMembers([senderMemberId, recipientMemberId], event);
    const owner = this.#options.store.listMembers().find((member) => member.role === "owner");
    if (owner && (owner.id === senderMemberId || owner.id === recipientMemberId)) {
      this.#options.onDirectTyping?.(event);
    }
  }

  #sendToMembers(memberIds: string[], event: TeamRealtimeEvent): void {
    const payload = encodeTeamProtocolV1CurrentEvent(event);
    if (!payload) return;
    for (const [client, connection] of this.#eventClients) {
      if (
        connection.capabilities.has("direct-messages") &&
        memberIds.includes(connection.memberId) &&
        client.readyState === webSockets.WebSocket.OPEN
      ) {
        client.send(payload);
      }
    }
  }

  #requireChat(): TeamChatStore {
    if (!this.#options.chat) throw new Error("Direct messages are unavailable.");
    return this.#options.chat;
  }

  /** Concurrent requests with one operation id share one duplication. */
  #duplicateAgent(
    sourceAgentId: string,
    operationId: string,
  ): Effect.Effect<DuplicateAgentResult, AgentDuplicationFailed> {
    return Effect.suspend(() => {
      const committed = this.#options.agents.committedAgentDuplication(operationId, sourceAgentId);
      if (committed) {
        return Effect.succeed({ agent: committed.agent, layout: this.#options.sidebarLayout.getSnapshot() });
      }
      const pending = this.#duplicateRequests.get(operationId);
      if (pending) {
        if (pending.sourceAgentId !== sourceAgentId) {
          return Effect.fail(
            new AgentDuplicationFailed({
              cause: new Error("This agent duplication operation belongs to another source agent."),
            }),
          );
        }
        return Deferred.await(pending.result);
      }
      const result = Deferred.makeUnsafe<DuplicateAgentResult, AgentDuplicationFailed>();
      this.#duplicateRequests.set(operationId, { sourceAgentId, result });
      return duplicateAgentIntoLayout(
        this.#options.agents,
        this.#options.sidebarLayout,
        sourceAgentId,
        operationId,
        (agentId) => this.copyAgentAccess(sourceAgentId, agentId),
      ).pipe(
        Effect.onExit((exit) => {
          this.#duplicateRequests.delete(operationId);
          return Deferred.done(result, exit);
        }),
        // The first request owns the operation; the requests that share it wait for its end.
        Effect.uninterruptible,
      );
    });
  }

  // A refusal here is the client's error, so it is an `HttpError`: the dispatcher answers its status
  // and does not log it. The English of each message is the text that hosts sent before, byte for byte.
  #requireDirectRecipient(senderMemberId: string, recipientMemberId: string): TeamMemberSummary {
    if (senderMemberId === recipientMemberId) {
      throw new HttpError(400, sourceText("error.team.directMessageSelf"));
    }
    const sender = this.#options.store.getMember(senderMemberId);
    const recipient = this.#options.store.getMember(recipientMemberId);
    if (!sender || sender.disabled) throw new HttpError(403, sourceText("error.host.teamAccessUnavailable"));
    if (!recipient || recipient.disabled) {
      throw new HttpError(404, sourceText("error.team.directRecipientUnavailable"));
    }
    return recipient;
  }

  #json(response: ServerResponse, status: number, value: object | null): RouteOutcome {
    const route = this.#responseRoutes.get(response);
    if (!route) throw new Error("Team API response route is unavailable.");
    const options = {
      preserveSemanticTags: supportsTeamSemanticTags(route.capabilities),
      historyExtent: route.capabilities.has(TEAM_HISTORY_EXTENT_CAPABILITY),
      channelAttention: route.capabilities.has(TEAM_CHANNEL_ATTENTION_CAPABILITY),
      agentTaskUiBlocks: route.capabilities.has(AGENT_TASK_UI_BLOCKS_CAPABILITY),
      uiBlocks: route.capabilities.has(TEAM_UI_BLOCKS_CAPABILITY),
      subagents: route.capabilities.has(TEAM_SUBAGENTS_CAPABILITY),
      promptMultiSelect: route.capabilities.has(TEAM_PROMPT_MULTI_SELECT_CAPABILITY),
    };
    // The body is encoded before the head is written. A response the negotiated protocol cannot
    // represent - a route its frozen adapter does not classify - makes the encoder throw, and with
    // the headers already sent that throw could neither answer the caller nor end the request: it
    // surfaced as a hung socket and an `ERR_HTTP_HEADERS_SENT` rejection out of `#handle`'s own
    // error path. Encoding first lets that failure become the 500 the caller can read.
    const visibleValue =
      status < 400 && route.hiddenAgentIds
        ? route.protocol < 4
          ? legacyProviderView(value, route.hiddenAgentIds)
          : hiddenAgentView(
              value,
              route.hiddenAgentIds,
              route.protocol < 5 ? 4 : route.protocol < 6 ? 5 : route.protocol < 7 ? 6 : route.protocol < 8 ? 7 : 8,
            )
        : value;
    const sideRoute = teamSideRouteCodec(route.path);
    const body = sideRoute
      ? JSON.stringify(sideRoute.response(route.path, status, visibleValue, options))
      : teamHttpCodec(route.protocol).encodeResponse(route.method, route.path, status, visibleValue, options);
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(`${body}\n`);
    return "handled";
  }

  /**
   * Agents the negotiated protocol cannot describe, such as a model id a frozen codec does not
   * accept. They are hidden like a provider an old client does not know: one such agent must not
   * turn the whole agent list into a 500, because a remote client then cannot load the server.
   */
  #unrepresentableAgentIds(
    agents: readonly AgentSummary[],
    protocol: number,
    capabilities: ReadonlySet<string>,
  ): Set<string> {
    const codec = teamHttpCodec(protocol);
    const options = { preserveSemanticTags: supportsTeamSemanticTags(capabilities) };
    const hidden = new Set<string>();
    for (const agent of agents) {
      try {
        codec.encodeResponse("GET", TEAM_API_ROUTES.agents.all, 200, [agent], options);
      } catch {
        hidden.add(agent.id);
        const key = `${protocol}:${agent.id}`;
        if (this.#reportedUnrepresentableAgents.has(key)) continue;
        this.#reportedUnrepresentableAgents.add(key);
        (this.#options.logger ?? logger).warn(
          `Team API protocol ${protocol} cannot describe agent ${agent.id}; it is hidden from these clients.`,
        );
      }
    }
    return hidden;
  }

  /**
   * The agents this client cannot see: a provider its protocol does not know, or one it cannot describe.
   * With a member, also the agents that the roles close to that member.
   */
  hiddenAgentIds(protocol: number, capabilities: ReadonlySet<string>, member?: AccessMember | string): Set<string> {
    const agents = this.#options.agents.listAgents();
    const hidden = hiddenProviderAgentIds(agents, protocol);
    for (const id of this.#unrepresentableAgentIds(
      agents.filter((agent) => !hidden.has(agent.id)),
      protocol,
      capabilities,
    ))
      hidden.add(id);
    if (member !== undefined) for (const id of this.#blockedAgentIds(member)) hidden.add(id);
    return hidden;
  }

  /** Gives a duplicated agent the levels of its source. The copy exists either way, so a failed write only logs. */
  copyAgentAccess(sourceAgentId: string, agentId: string): Effect.Effect<void> {
    const access = this.#options.agentAccess;
    const serverId = this.#options.store.getIdentity()?.serverId;
    if (!access || !serverId) return Effect.void;
    return access
      .copyAgent(serverId, sourceAgentId, agentId)
      .pipe(
        Effect.catch((error) =>
          Effect.sync(() => logger.warn("The duplicated agent's roles did not save.", toLogValue(error))),
        ),
      );
  }

  /** The level of `member` for `agentId` under the roles of this host. Without roles, `manage`. */
  agentLevel(member: AccessMember | string, agentId: string): AgentAccessLevel {
    const access = this.#options.agentAccess;
    const serverId = this.#options.store.getIdentity()?.serverId;
    if (!access || !serverId) return "manage";
    return agentAccessLevel(access.levels(serverId), this.#accessMember(member), agentId);
  }

  /** The agents at `none` for `member`. */
  #blockedAgentIds(member: AccessMember | string): Set<string> {
    const blocked = new Set<string>();
    const resolved = this.#accessMember(member);
    const access = this.#options.agentAccess;
    const serverId = this.#options.store.getIdentity()?.serverId;
    if (!access || !serverId || canAdministerServer(resolved.role)) return blocked;
    const levels = access.levels(serverId);
    for (const agent of this.#options.agents.listAgents())
      if (agentAccessLevel(levels, resolved, agent.id) === "none") blocked.add(agent.id);
    return blocked;
  }

  // A push or a socket has only a member ID. A member that the store does not know gets the
  // levels of a plain member, so an unknown ID does not get more than the roles give.
  #accessMember(member: AccessMember | string): AccessMember {
    if (typeof member !== "string") return member;
    const { store } = this.#options;
    const known = store.getMember(member) ?? store.listMembers().find((candidate) => candidate.id === member);
    return known ?? { id: member, role: "member" };
  }

  #connectionMember(connection: EventClientState): AccessMember {
    return this.#options.store.authenticate(connection.token) ?? { id: connection.memberId, role: "member" };
  }

  /**
   * Tells each client that the roles changed, then sends again what the roles filter: the agent list,
   * the runtime and the presence. A client of an older build gets only the agent list.
   */
  agentAccessChanged(): void {
    const serverId = this.#options.store.getIdentity()?.serverId;
    if (!this.#options.agentAccess || !serverId) return;
    const revision = this.#options.agentAccess.get(serverId).revision;
    this.#broadcastAgentEventToClients({ type: "agent-access-changed", revision });
    this.#broadcastAgentEventToClients({ type: "agents-changed", agents: this.#options.agents.listAgents() });
    for (const [client, connection] of this.#eventClients)
      if (connection.capabilities.has("agent-runtime-snapshots")) this.#sendRuntimeSnapshot(client, connection, false);
    this.#publishPresence();
  }

  /**
   * What this host serves, as a peer of `protocol` reads it. Protocol 7 and newer get the full list,
   * older peers the legacy one. Below protocol 9 the list leaves out the protocol 9 capabilities, so it
   * stays within the 128 that protocols 7 and 8 read.
   */
  #protocolSupport(protocol: number | null = null): TeamProtocolSupportV1 {
    const expanded = protocol !== null && protocol >= 7;
    return {
      appVersion: this.#options.appVersion ?? "0.0.0",
      protocol: { minimum: TEAM_PROTOCOL_V1, maximum: TEAM_PROTOCOL_V9 },
      capabilities: teamCapabilitiesVisibleToProtocol(TEAM_CURRENT_CAPABILITIES, protocol ?? TEAM_PROTOCOL_V1).filter(
        (capability) => {
          if (!expanded && !legacyTeamCapabilities([capability]).length) return false;
          if (capability === "channel-chats-v1" || capability === CHANNEL_DELETE_CAPABILITY)
            return this.#options.channels !== undefined;
          // Advertised only when this host can serve it: a client that negotiated it gets a route,
          // and one that did not never shows the panel.
          if (capability === "remote-desktop-setup")
            return (
              this.#options.remoteScreen?.checkSetup !== undefined && this.#options.remoteScreen?.test !== undefined
            );
          if (capability === MCP_SERVERS_CAPABILITY) return this.#options.mcpServers !== undefined;
          if (capability === MCP_SIGN_IN_CAPABILITY)
            return this.#options.mcpServers !== undefined && this.#options.mcpSignIns !== undefined;
          if (capability === MCP_SIGN_IN_APP_CAPABILITY)
            return this.#options.mcpServers !== undefined && this.#options.mcpSignIns !== undefined;
          if (capability === SIGN_IN_RELAY_CAPABILITY)
            return this.#options.mcpServers !== undefined && this.#options.signInRelay !== undefined;
          if (capability === PROVIDER_ACCOUNT_RELAY_CAPABILITY || capability === PROVIDER_ACCOUNT_RELAY_V2_CAPABILITY)
            return (
              this.#options.mcpServers !== undefined &&
              this.#options.signInRelay !== undefined &&
              this.#options.providerAccounts !== undefined
            );
          if (capability === CONNECTORS_CAPABILITY) return this.#options.connectors !== undefined;
          if (capability === DISCORD_ACCESS_CAPABILITY) return this.#options.connectors !== undefined;
          if (capability === ONEPASSWORD_CONNECTOR_CAPABILITY) return this.#options.onePasswordConnector !== undefined;
          if (capability === BITWARDEN_CONNECTOR_CAPABILITY) return this.#options.bitwardenConnector !== undefined;
          if (capability === VAULT_CAPABILITY) return this.#options.vault !== undefined;
          if (capability === BROWSER_SECRET_VAULT_CAPABILITY) return this.#options.vault !== undefined;
          if (capability === VAULT_IMPORT_CAPABILITY) return this.#options.vault !== undefined;
          if (capability === VAULT_V2_CAPABILITY) return this.#options.vault !== undefined;
          if (capability === PROVIDER_HOST_SIGN_IN_CAPABILITY) return this.#options.providerHostSignIns !== undefined;
          if (capability === PROVIDER_ACCOUNTS_CAPABILITY) return this.#options.providerAccounts !== undefined;
          if (capability === PROVIDER_USAGE_RESET_CAPABILITY) return this.#options.providerUsageResets !== undefined;
          if (capability === PROVIDER_SIGN_OUT_CAPABILITY) return this.#options.providerSignOut !== undefined;
          if (capability === STORAGE_CAPABILITY) return this.#options.storage !== undefined;
          if (capability === STORAGE_DISK_CAPABILITY) return this.#options.storage !== undefined;
          if (capability === MACHINE_RESOURCES_CAPABILITY) return this.#options.machine !== undefined;
          if (capability === HOSTED_SITES_CAPABILITY) return this.#options.hostedSites !== undefined;
          if (capability === AGENT_ADMIN_CAPABILITY) return this.#options.admin?.agents !== undefined;
          if (capability === ACP_REGISTRY_CAPABILITY) return this.#options.admin?.acpRegistry !== undefined;
          if (capability === AGENT_SESSION_SETTINGS_CAPABILITY)
            return this.#options.admin?.sessionSettings !== undefined;
          if (capability === AGENT_HIDDEN_CAPABILITY) return this.#options.hiddenAgents !== undefined;
          if (capability === AGENT_TASKS_CAPABILITY) return this.#options.agentTasks !== undefined;
          if (capability === AGENT_THREADS_CAPABILITY) return this.#options.agentTasks !== undefined;
          if (capability === AGENT_TASK_UI_BLOCKS_CAPABILITY) return this.#options.agentTasks !== undefined;
          if (capability === AGENT_THREAD_READS_CAPABILITY) return this.#options.agentTasks !== undefined;
          if (capability === AGENT_THREAD_FILES_CAPABILITY) return this.#options.agentTasks !== undefined;
          if (capability === AGENT_HOST_SETTINGS_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
          if (capability === AGENT_BACKUP_MODELS_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
          if (capability === AGENT_TASK_LIMIT_CAPABILITY) return this.#options.admin?.agentHost !== undefined;
          if (capability === BROWSER_PROFILES_CAPABILITY) return this.#options.browserProfiles !== undefined;
          if (capability === SKILLS_ADMIN_CAPABILITY) return this.#options.admin?.skills !== undefined;
          if (capability === SKILLS_EVENTS_CAPABILITY) return this.#options.skills !== undefined;
          if (capability === SHARED_TABLES_CAPABILITY) return this.#options.admin?.sharedTables !== undefined;
          if (capability === AGENT_INSTALL_CAPABILITY)
            return (
              this.#options.admin?.marketplaceAgents !== undefined && this.#options.admin?.agentTemplates !== undefined
            );
          if (capability === AGENT_UPDATE_CAPABILITY) return this.#options.admin?.marketplaceAgents !== undefined;
          if (capability === AGENT_PUBLISH_CAPABILITY) return this.#options.admin?.agentTemplates !== undefined;
          if (
            capability === PROVIDERS_ADMIN_CAPABILITY ||
            capability === PROVIDERS_RUNTIMES_V2_CAPABILITY ||
            capability === PROVIDERS_V4_CAPABILITY ||
            capability === PROVIDERS_V5_CAPABILITY ||
            capability === PROVIDERS_V8_CAPABILITY ||
            capability === CUSTOM_PROVIDER_HARNESS_CAPABILITY
          )
            return this.#options.admin?.providers !== undefined;
          if (capability === CLAUDE_API_KEY_CAPABILITY) return this.#options.admin?.providers !== undefined;
          if (capability === PROVIDERS_SIGN_IN_V3_CAPABILITY)
            return this.#options.admin?.providers?.pasteSignIn === true;
          if (capability === HOST_ADMIN_CAPABILITY) return this.#options.admin?.identity !== undefined;
          if (capability === HOST_RELEASE_CAPABILITY) return this.#options.admin?.release !== undefined;
          if (capability === HOST_TIMEZONE_CAPABILITY) return this.#options.admin?.timezone !== undefined;
          if (capability === AGENT_MEMORY_LIMIT_CAPABILITY) return this.#options.admin?.memoryLimit !== undefined;
          if (capability === MEMORY_REVIEW_CAPABILITY) return this.#options.admin?.memoryReview !== undefined;
          if (capability === PROMPT_CACHE_TTL_CAPABILITY) return this.#options.admin?.promptCacheTtl !== undefined;
          if (capability === PROVIDER_DEFAULT_CAPABILITY) return this.#options.admin?.defaultProvider !== undefined;
          if (capability === AGENT_ACCESS_CAPABILITY) return this.#options.agentAccess !== undefined;
          if (capability === HOST_UPDATE_CAPABILITY || capability === HOST_MEMBER_UPDATE_CAPABILITY)
            return this.#options.admin?.update !== undefined;
          if (capability === EVENTS_CAPABILITY) return this.#options.events !== undefined;
          if (capability === ROUTINE_RECOVERY_CAPABILITY) return this.#options.events !== undefined;
          if (capability === ROUTINE_RESULTS_CAPABILITY) return this.#options.admin?.routineResults !== undefined;
          if (capability === WEBHOOK_TESTS_CAPABILITY) return this.#options.events !== undefined;
          if (capability === AGENT_IMPORT_CAPABILITY) return this.#options.agentImport !== undefined;
          if (capability === INSTANCE_TRANSFER_CAPABILITY) return this.#options.instanceTransfer !== undefined;
          if (capability === LIVE_ACTIVITY_PUSH_CAPABILITY) return this.#options.liveActivityPush !== undefined;
          if (capability === ROUTINE_FLOWS_CAPABILITY) return this.#options.routineFlows !== undefined;
          if (capability === WORKFLOWS_CAPABILITY) return this.#options.workflows !== undefined;
          if (capability === PUSH_NOTIFICATIONS_CAPABILITY || capability === ANDROID_PUSH_NOTIFICATIONS_CAPABILITY)
            return this.#options.pushNotifications !== undefined;
          if (capability === FOCUS_USE_CAPABILITY) return this.#options.focusUse === true;
          if (capability === AGENT_NOTIFICATION_LEVELS_CAPABILITY)
            return this.#options.agentNotificationLevels !== undefined;
          return true;
        },
      ),
    };
  }

  #protocolIssue(request: IncomingMessage): TeamProtocolIssue | null {
    if (!this.#options.appVersion) return null;
    const rawProtocol = firstHeaderValue(request.headers[TEAM_PROTOCOL_VERSION_HEADER.toLowerCase()]);
    const clientAppVersion = firstHeaderValue(request.headers[TEAM_APP_VERSION_HEADER.toLowerCase()]);
    const protocol = rawProtocol ? Number(rawProtocol) : null;
    const host = this.#protocolSupport();
    if (!rawProtocol || !clientAppVersion) {
      return {
        status: 426,
        body: {
          error: sourceText("error.team.clientUpdateRequired"),
          code: "client_update_required",
          host,
        },
      };
    }
    if (
      !Number.isSafeInteger(protocol) ||
      protocol === null ||
      protocol < 1 ||
      protocol > 65_535 ||
      clientAppVersion.length > 64
    ) {
      return {
        status: 400,
        body: { error: "Invalid Team API protocol headers.", code: "protocol_error", host },
      };
    }
    if (protocol >= TEAM_PROTOCOL_V1 && protocol <= TEAM_PROTOCOL_V9) return null;
    const clientIsOlder = protocol < TEAM_PROTOCOL_V1;
    return {
      status: 426,
      body: {
        error: clientIsOlder
          ? sourceText("error.team.clientUpdateRequired")
          : sourceText("error.team.hostUpdateRequired"),
        code: clientIsOlder ? "client_update_required" : "host_update_required",
        host,
        client: { appVersion: clientAppVersion, protocol },
      },
    };
  }

  #empty(response: ServerResponse, status: number): RouteOutcome {
    response.writeHead(status);
    response.end();
    return "handled";
  }

  // The context is assembled here rather than in `request-context.ts` because `json` and `empty`
  // have to close over the per-response route record, which only this class holds.
  #requestContext(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    token: string,
    authenticated: { member: TeamMemberSummary; sessionId: string; sessionExpiresAt: string },
  ): TeamApiRequestContext {
    return {
      request,
      response,
      method: request.method ?? "GET",
      url,
      protocol: requestProtocol(request),
      capabilities: requestCapabilities(request),
      member: authenticated.member,
      token,
      sessionId: authenticated.sessionId,
      sessionExpiresAt: authenticated.sessionExpiresAt,
      agentLevel: (agentId) => this.agentLevel(authenticated.member, agentId),
      json: (status, value) => this.#json(response, status, value),
      empty: (status) => this.#empty(response, status),
    };
  }
}

/** A session that has ended stays until it is old, so the map keeps one entry for each recent session. */
function pruneSessions(sessions: Map<string, { at: number }>, now: number): void {
  if (sessions.size <= SESSION_USE_LIMIT) return;
  for (const [sessionId, use] of sessions) if (now - use.at > SESSION_USE_MAX_AGE_MS) sessions.delete(sessionId);
}

function unavailableSidebarLayout(): TeamApiSidebarLayout {
  return {
    getSnapshot: () => ({
      revision: 0,
      sections: [],
      order: ["people", "unassigned"],
      agentAssignments: {},
      agentOrder: [],
    }),
    mutate: () =>
      Effect.fail(
        new StoredStateFailure({ cause: new HttpError(503, sourceText("error.team.sidebarLayoutUnavailable")) }),
      ),
    withProfileAssignment: () =>
      Effect.fail(new StoredStateFailure({ cause: new Error(sourceText("error.team.sidebarLayoutUnavailable")) })),
    placeDuplicateAfter: () =>
      Effect.fail(
        new StoredStateFailure({ cause: new HttpError(503, sourceText("error.team.sidebarLayoutUnavailable")) }),
      ),
    removeAgent: () =>
      Effect.succeed({
        revision: 0,
        sections: [],
        order: ["people", "unassigned"],
        agentAssignments: {},
        agentOrder: [],
      }),
    on: () => undefined,
    off: () => undefined,
  };
}

/** The protocol that an event connection's capabilities describe, as `#encodeProviderEvent` encodes it. */
function eventProtocol(capabilities: ReadonlySet<string>): 1 | 4 | 5 | 6 | 7 | 8 {
  if (capabilities.has(TEAM_OPEN_PROVIDERS_CAPABILITY)) return 8;
  if (capabilities.has(TEAM_PI_MUSE_CAPABILITY)) return 7;
  if (capabilities.has(TEAM_CURSOR_CLINE_CAPABILITY)) return 6;
  return capabilities.has(TEAM_LOCAL_PROVIDERS_CAPABILITY) ? 5 : capabilities.has("opencode") ? 4 : 1;
}

function isLegacyConversationClient(connection: EventClientState): boolean {
  return connection.includeConversationEvents && !connection.capabilities.has("agent-runtime-snapshots");
}

/** The agent that an optional event names. The task list and a task conversation name it in their snapshot. */
function optionalEventAgentId(event: OptionalTeamEvent): string | null {
  if (event.type === "agent-tasks-changed" || event.type === "agent-task-conversation") return event.snapshot.agentId;
  return "agentId" in event ? event.agentId : null;
}

function eventCapability(event: AgentEvent): TeamCurrentCapability | null {
  if (
    event.type === "channels-changed" ||
    event.type === "channel-memories-changed" ||
    event.type === "channel-routines-changed"
  )
    return "channel-chats-v1";
  if (event.type === "agent-session-settings-changed") return AGENT_SESSION_SETTINGS_CAPABILITY;
  if (event.type === "hidden-agents-changed") return AGENT_HIDDEN_CAPABILITY;
  if (event.type === "agent-access-changed") return AGENT_ACCESS_CAPABILITY;
  if (event.type === "browser-user-control-changed") return BROWSER_USER_CONTROL_CAPABILITY;
  if (event.type === "browser-page-state-changed") return BROWSER_PAGE_STATE_CAPABILITY;
  if (
    event.type === "agent-tasks-changed" ||
    event.type === "agent-task-conversation" ||
    event.type === "agent-task-conversation-delta"
  )
    return AGENT_TASKS_CAPABILITY;
  if (event.type === "skills-changed") return SKILLS_EVENTS_CAPABILITY;
  if (event.type === "routine-flows-changed") return ROUTINE_FLOWS_CAPABILITY;
  if (event.type === "workflows-changed") return WORKFLOWS_CAPABILITY;
  if (event.type === "vault-changed") return VAULT_CAPABILITY;
  if (event.type === "turn-progress") return TEAM_AGENT_ACTIVITY_CAPABILITY;
  if (event.type === "runtime-snapshot") return "agent-runtime-snapshots";
  if (event.type === "sidebar-layout-changed") return "sidebar-layout";
  if (event.type === "browser-changed" || event.type === "browser-control-changed") return "browser-control";
  if (event.type === "conversation-page") return "conversation-pagination";
  return null;
}
