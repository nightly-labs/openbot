import {
  type AgentPendingRuntime,
  type AvatarColor,
  canAdministerServer,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  type HostRemoteChatContent,
  isAgentModel,
  isAgentProvider,
  isQueuedMessageReceipt,
  isReasoningEffort,
  MCP_SERVERS_CAPABILITY,
  type RespondToApprovalInput,
  type SidebarLayoutSnapshot,
  type SidebarPin,
  type UpdateAgentInput,
  type WorkflowSummary,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-access-v1";
import { AGENT_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-admin-v1";
import { AGENT_BACKUP_MODELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-backup-models-v1";
import { AGENT_BUILTIN_MEMORY_CAPABILITY } from "@openbot/contracts/team-protocol/agent-builtin-memory-v1";
import { agentColorsEvent } from "@openbot/contracts/team-protocol/agent-colors-v1";
import { AGENT_CREATE_OPERATION_CAPABILITY } from "@openbot/contracts/team-protocol/agent-create-operation-v1";
import { AGENT_DEFAULTS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-defaults-v1";
import { AGENT_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-folders-v1";
import { AGENT_HIDDEN_CAPABILITY } from "@openbot/contracts/team-protocol/agent-hidden-v1";
import { AGENT_HOST_SETTINGS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-host-settings-v1";
import { AGENT_IMPORT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-import-v1";
import { AGENT_INSTALL_CAPABILITY } from "@openbot/contracts/team-protocol/agent-install-v1";
import { AGENT_INSTRUCTIONS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-instructions-v1";
import { AGENT_MEMORY_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-memory-limit-v1";
import { AGENT_NEW_CHAT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-new-chat-v1";
import {
  AGENT_PENDING_RUNTIME_CAPABILITY,
  AGENT_PENDING_RUNTIME_ROUTES,
  pendingRuntimeUpdateBody,
} from "@openbot/contracts/team-protocol/agent-pending-runtime-v1";
import { AGENT_PLAN_CARD_CAPABILITY } from "@openbot/contracts/team-protocol/agent-plan-card-v1";
import { AGENT_PUBLISH_CAPABILITY } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { AGENT_TASK_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/agent-task-limit-v1";
import { AGENT_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/agent-update-v1";
import { BACKGROUND_PROCESSES_CAPABILITY } from "@openbot/contracts/team-protocol/background-processes-v1";
import { BITWARDEN_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/bitwarden-connector-v1";
import {
  BROWSER_HTTP_SIGN_IN_CAPABILITY,
  BROWSER_HTTP_SIGN_IN_ROUTES,
  decodeBrowserHttpSignInSnapshot,
} from "@openbot/contracts/team-protocol/browser-http-sign-in-v1";
import {
  BROWSER_PERMISSIONS_CAPABILITY,
  BROWSER_PERMISSIONS_ROUTES,
  decodeBrowserPermissionsSnapshot,
} from "@openbot/contracts/team-protocol/browser-permissions-v1";
import { BROWSER_PROFILES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-profiles-v1";
import { BROWSER_PROXIES_CAPABILITY } from "@openbot/contracts/team-protocol/browser-proxies-v1";
import { BROWSING_MEMORY_CAPABILITY } from "@openbot/contracts/team-protocol/browsing-memory-v1";
import { CHANNEL_FOLDERS_CAPABILITY } from "@openbot/contracts/team-protocol/channel-folders-v1";
import { CONNECTORS_CAPABILITY } from "@openbot/contracts/team-protocol/connectors-v1";
import {
  AGENT_HIDDEN_WORK_CAPABILITY,
  AGENT_WELCOME_CAPABILITY,
  MCP_MEMBER_ACCESS_CAPABILITY,
  readTeamHostCompatibility,
  TEAM_AGENT_CREATE_MODEL_CAPABILITY,
  TEAM_WEB_CLIENT_PROTOCOL,
} from "@openbot/contracts/team-protocol/current";
import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { FOCUS_USE_CAPABILITY, FOCUS_USE_ROUTES } from "@openbot/contracts/team-protocol/focus-use-v1";
import { HOST_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/host-admin-v1";
import { HOST_APPEARANCE_CAPABILITY } from "@openbot/contracts/team-protocol/host-appearance-v1";
import { HOST_KEY_ROTATION_CAPABILITY } from "@openbot/contracts/team-protocol/host-key-rotation-v1";
import { HOST_MEMBER_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-member-update-v1";
import { HOST_PERSONALITY_CAPABILITY } from "@openbot/contracts/team-protocol/host-personality-v1";
import { HOST_RELEASE_CAPABILITY } from "@openbot/contracts/team-protocol/host-release-v1";
import { HOST_RESTART_CAPABILITY } from "@openbot/contracts/team-protocol/host-restart-v1";
import { HOST_SIGNAL_HOME_CAPABILITY } from "@openbot/contracts/team-protocol/host-signal-home-v1";
import { HOST_TIMEZONE_CAPABILITY } from "@openbot/contracts/team-protocol/host-timezone-v1";
import { HOST_TURN_LIMITS_CAPABILITY } from "@openbot/contracts/team-protocol/host-turn-limits-v1";
import { HOST_UPDATE_CAPABILITY } from "@openbot/contracts/team-protocol/host-update-v1";
import { HOST_VOICE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/host-voice-model-v1";
import { HOSTED_SITES_CAPABILITY } from "@openbot/contracts/team-protocol/hosted-sites-v1";
import { INSTANCE_TRANSFER_CAPABILITY } from "@openbot/contracts/team-protocol/instance-transfer-v1";
import { LIVE_ACTIVITY_PUSH_CAPABILITY } from "@openbot/contracts/team-protocol/live-activity-push-v1";
import { LIVE_VOICE_EVENT } from "@openbot/contracts/team-protocol/live-voice-v1";
import { LOCAL_SERVERS_CAPABILITY } from "@openbot/contracts/team-protocol/local-servers-v1";
import { MAC_APPS_LIMIT_CAPABILITY } from "@openbot/contracts/team-protocol/mac-apps-limit-v1";
import { MACHINE_RESOURCES_CAPABILITY } from "@openbot/contracts/team-protocol/machine-resources-v1";
import { MCP_ACCESS_CAPABILITY } from "@openbot/contracts/team-protocol/mcp-access-v1";
import { MEDIA_APPROVAL_CREDITS_CAPABILITY } from "@openbot/contracts/team-protocol/media-approval-credits-v1";
import { MEMORY_REVIEW_CAPABILITY } from "@openbot/contracts/team-protocol/memory-review-v1";
import { ONEPASSWORD_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/onepassword-connector-v1";
import { OWNER_TRANSFER_CAPABILITY } from "@openbot/contracts/team-protocol/owner-transfer-v1";
import { PASSWORD_MANAGERS_CAPABILITY } from "@openbot/contracts/team-protocol/password-managers-v1";
import { PENDING_APPROVAL_CAPABILITY } from "@openbot/contracts/team-protocol/pending-approval-v1";
import { PHONE_FEEDBACK_CAPABILITY } from "@openbot/contracts/team-protocol/phone-feedback-v1";
import { PLUGIN_CATALOG_CAPABILITY } from "@openbot/contracts/team-protocol/plugin-catalog-v1";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import { PROVIDERS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/providers-v1";
import { PUSH_NOTIFICATION_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/push-notification-threads-v1";
import { ANDROID_PUSH_NOTIFICATIONS_CAPABILITY } from "@openbot/contracts/team-protocol/push-notifications-android-v1";
import { PUSH_NOTIFICATIONS_CAPABILITY } from "@openbot/contracts/team-protocol/push-notifications-v1";
import {
  REMOTE_CHAT_CONTENT_CAPABILITY,
  remoteChatContentEvent,
} from "@openbot/contracts/team-protocol/remote-chat-content-v1";
import { ROUTINE_RECOVERY_CAPABILITY } from "@openbot/contracts/team-protocol/routine-recovery-v1";
import { ROUTINE_RESULTS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-results-v1";
import { ROUTINES_ONCE_CAPABILITY } from "@openbot/contracts/team-protocol/routines-once-v1";
import { SERVER_AUDIT_CAPABILITY } from "@openbot/contracts/team-protocol/server-audit-v1";
import {
  decodeServerSafeModeReason,
  SERVER_SAFE_MODE_CAPABILITY,
  SERVER_SAFE_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/server-safe-mode-v1";
import { SHARED_TABLES_CAPABILITY } from "@openbot/contracts/team-protocol/shared-tables-v1";
import {
  SIDEBAR_FOLDERS_CAPABILITY,
  SIDEBAR_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { SIDEBAR_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import { SIGN_IN_RELAY_CAPABILITY } from "@openbot/contracts/team-protocol/sign-in-relay-v1";
import { SKILL_LEARNING_CAPABILITY } from "@openbot/contracts/team-protocol/skill-learning-v1";
import { SKILLS_ADMIN_CAPABILITY } from "@openbot/contracts/team-protocol/skills-admin-v1";
import { UI_BLOCK_PREVIEW_EDIT_CAPABILITY } from "@openbot/contracts/team-protocol/ui-block-preview-edit-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { VAULT_IMPORT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-import-v1";
import { VAULT_MEMBER_SAVE_CAPABILITY } from "@openbot/contracts/team-protocol/vault-member-save-v1";
import { VAULT_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v1";
import { VAULT_V2_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v2";
import { VAULT_V3_CAPABILITY } from "@openbot/contracts/team-protocol/vault-v3";
import { WEBHOOK_AGENT_SECRET_CAPABILITY } from "@openbot/contracts/team-protocol/webhook-agent-secret-v1";
import { WHATSAPP_CONNECTOR_CAPABILITY } from "@openbot/contracts/team-protocol/whatsapp-connector-v1";
import { sourceText } from "@openbot/i18n/source";
import {
  createRemoteAccountRefresh,
  createRemoteReadRefresh,
  createWorkspacePreferences,
  type RemoteConnectionFailure,
  type RemoteConnectionStage,
  type RemoteRecoveryStatus,
  RemoteTeamDirectoryClient,
  type RemoteTeamHost,
  type RemoteWorkspacePreferences,
  readAgentAnalytics,
  remoteRecoveryMessage,
  runTeamEffect,
} from "@openbot/team-client";
import { verifyEd25519Base64Url } from "@openbot/team-client/ed25519";
import { feedbackApproval } from "@openbot/team-client/feedback-approval";
import { createFocusUsePing } from "@openbot/team-client/focus-use";
import { createHostedServerWake, WAKE_RECONNECT_DELAY_MS } from "@openbot/team-client/hosted-server-wake";
import type {
  RemoteDownloadWatch,
  RemoteFileUpload,
  RemoteLargeDownload,
  RemoteTeamEvent,
} from "@openbot/team-client/remote-peer";
import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
import { withWholeApproval } from "@openbot/team-client/runtime-attention";
import {
  createHostLocalServer,
  deleteHostLocalServer,
  type HostLocalServerList,
  listHostLocalServers,
  readSidebarPins,
  rotateHostKey,
  seedSidebarPins,
  setHostAppearance,
  setSidebarPins,
  updateHostIdentity,
} from "@openbot/team-client/team-admin-requests";
import {
  deleteAgent,
  discardAttachmentDraft,
  interruptAgentTurn,
  readPendingApproval,
  respondToApproval,
  respondToBrowserSecret,
  respondToBrowserTakeover,
  sendPhoneFeedback,
  type TeamApiRequest,
  uploadAttachmentDraft,
} from "@openbot/team-client/team-api-requests";
import { replaceEqualDeep, useQueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import * as Crypto from "expo-crypto";
import { type PropsWithChildren, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { View } from "react-native";
import { agentInitialMessage, type NewAgentInput } from "@/features/agents/model/agent-initial-message";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { mobileAnalytics } from "@/features/analytics/mobile-analytics";
import { trackWorkspaceActions } from "@/features/analytics/workspace-actions";
import { fetchMobileAccount } from "@/features/auth/api/account-fetch";
import { useMobileSession } from "@/features/auth/context/mobile-session-context";
import { decodeMobileBrowserTabs, mobileHttpSignIns } from "@/features/browser/model/browser-tabs";
import { MobileChannelStore } from "@/features/channels/model/channel-store";
import { deleteServerDrafts } from "@/features/chat/model/composer-drafts";
import {
  forgetLocationAlwaysAllowed,
  retainLocationAlwaysAllowed,
} from "@/features/chat/model/location-always-allowed";
import { deleteServerSideQuestions } from "@/features/chat/model/side-questions";
import { useLiveActivity } from "@/features/live-activity/use-live-activity";
import { NotificationAvatarSync } from "@/features/push-notifications/notification-avatar-sync";
import { usePushNotifications } from "@/features/push-notifications/use-push-notifications";
import { useSyncedNotificationLevelsLoader } from "@/features/push-notifications/use-synced-notification-levels";
import { QuickActionsSync } from "@/features/quick-actions/quick-actions-sync";
import { forgetAgentBackdrops, retainAgentBackdrops } from "@/features/settings/model/chat-backdrop";
import { setSyncedNotificationLevels } from "@/features/settings/model/notification-levels";
import { ShareExtensionSync } from "@/features/share/share-extension-sync";
import { ShortcutsSync } from "@/features/shortcuts/shortcuts-sync";
import { supportLog } from "@/features/support/model/support-log";
import { forgetPhoneFeedback, shownPhoneFeedback } from "@/features/support/model/support-log-capture";
import { useWatchAwake } from "@/features/watch/model/watch-awake";
import { WatchSync } from "@/features/watch/watch-sync";
import { OwnerTransferPrompts } from "@/features/workspace/components/owner-transfer-prompts";
import type { RemoteTeamTransportRef } from "@/features/workspace/components/remote-team-transport";
import {
  ServerConnection,
  type ServerConnectionHandle,
  type ServerLoadContext,
} from "@/features/workspace/components/server-connection";
import { createBrowserActions } from "@/features/workspace/context/browser-actions";
import {
  createHostRequestActions,
  createHostRequestChecks,
  hostKeepsAgentColors,
  hostOwnsHide,
  readHostAgentColors,
  readHostHiddenAgents,
  requestAgentAvatar,
  writeHostAgentColor,
  writeHostAgentHidden,
} from "@/features/workspace/context/host-request-actions";
import {
  createRecoveryCountdowns,
  RecoveryCountdownContext,
} from "@/features/workspace/context/server-recovery-countdown";
import { useBackgroundRefresh } from "@/features/workspace/context/use-background-refresh";
import { useConversationReads } from "@/features/workspace/context/use-conversation-reads";
import { useServerOrder } from "@/features/workspace/context/use-server-order";
import { createWorkflowActions } from "@/features/workspace/context/workflow-actions";
import { WorkspaceContexts } from "@/features/workspace/context/workspace-store";
import { reduceAgentActivity } from "@/features/workspace/model/agent-activity";
import {
  agentAvatarDataUrl,
  deleteServerAvatars,
  saveAgentAvatar,
  savedAgentAvatarCount,
  subscribeSavedAgentAvatars,
} from "@/features/workspace/model/agent-avatar-cache";
import {
  canToggleChatPin,
  phoneSidebarPins,
  reconcileAgentPins,
  reconcileChannelPins,
  setChannelHidden,
  sidebarPinsChanged,
  withHostSidebarPins,
  withPhoneSidebarPins,
} from "@/features/workspace/model/agent-pins";
import {
  ConnectionUnavailableError,
  ConnectionWaits,
  isConnectionStop,
} from "@/features/workspace/model/connection-waits";
import { NO_CONTEXT_STATES, reduceContextStates } from "@/features/workspace/model/context-states";
import { conversationMessageId, decodeConversationPage } from "@/features/workspace/model/conversation";
import { MobileConversationStore } from "@/features/workspace/model/conversation-store";
import { keepDirectoryAgents } from "@/features/workspace/model/directory-agents";
import {
  drawerSnapshot,
  forgetDrawerSnapshots,
  rememberDrawerValues,
  restoreDrawerSnapshot,
  startDrawerSnapshots,
} from "@/features/workspace/model/drawer-snapshot";
import { publishLiveVoiceEvent } from "@/features/workspace/model/live-voice-events";
import { LiveWorkspaceStore } from "@/features/workspace/model/live-workspace-store";
import {
  dropApproval,
  InactiveRequestError,
  type PendingApproval,
  reducePendingApprovals,
} from "@/features/workspace/model/pending-approvals";
import { type QueryScope, queryKeys } from "@/features/workspace/model/query-keys";
import { createDownloadQueue } from "@/features/workspace/model/request-lanes";
import {
  hasCapability,
  requireCapability,
  requireSidebarLayout,
  type ServerCapabilities,
  SIDEBAR_LAYOUT_CAPABILITY,
  supportsBrowserView,
} from "@/features/workspace/model/server-capabilities";
import { serverAccent } from "@/features/workspace/model/server-order";
import {
  applyServerRecovery,
  hostWithHidden,
  sameServerRecovery,
  serverFromHost,
  serverKind,
  serverWithHidden,
  showsOnline,
} from "@/features/workspace/model/server-status";
import { moveSidebarChat } from "@/features/workspace/model/sidebar-layout";
import {
  taskThreadCheck,
  taskThreadMessages,
  taskTurnThread,
  withoutTaskTurns,
} from "@/features/workspace/model/task-cache";
import {
  applyBrowserEvent,
  invalidateAgentsChangedQueries,
  syncEventQueries,
} from "@/features/workspace/model/team-events";
import { runTeamRequest } from "@/features/workspace/model/team-request";
import { hostAwaitsQuestion, reduceThreadWaits } from "@/features/workspace/model/thread-waits";
import { trustedHostKeys } from "@/features/workspace/model/trusted-host-keys";
import { appendTurnStepLine, latestThoughtId } from "@/features/workspace/model/turn-step-lines";
import { type CachedPages, createWorkspaceCache } from "@/features/workspace/model/workspace-cache";
import {
  decodeAgent,
  decodeAgentSummaries,
  decodeConversationReads,
  decodeSidebarLayout,
  ignoreResponse,
  type MobileConversationRead,
  projectAgent,
  type RemoteAgent,
  remoteAgentOf,
  updateAgentPayload,
} from "@/features/workspace/model/workspace-records";
import type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceActions,
  MobileWorkspaceContextValue,
  MobileWorkspaceState,
  ServerChecks,
} from "@/features/workspace/model/workspace-types";
import { MobileServerSync } from "@/features/workspace/sync/server-sync";
import { conversationReadsOf } from "@/features/workspace/sync/synced-collections";
import {
  createWorkspaceSyncCollections,
  orderSyncedAgents,
  retainServerCollections,
  syncedSnapshot,
  type WorkspaceSyncCollections,
  type WorkspaceSyncHandlers,
} from "@/features/workspace/sync/workspace-sync";
import * as LockedKeychain from "@/shared/lib/locked-keychain";
import { isAndroid } from "@/shared/lib/platform";
import { currentText } from "@/shared/lib/text";
import { useAppForeground } from "@/shared/lib/use-app-foreground";

export {
  useMobileWorkspace,
  useMobileWorkspaceActions,
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/workspace-store";
export type {
  MobileAgent,
  MobileServer,
  MobileServerDirectoryState,
  MobileWorkspaceActions,
  MobileWorkspaceContextValue,
  MobileWorkspaceState,
} from "@/features/workspace/model/workspace-types";

const NO_IDS: string[] = [];
const createOperationId = retryOperationIds(() => Crypto.randomUUID());
const NO_AGENTS: MobileAgent[] = [];
const OTHER_SERVERS_RETURN_DELAY_MS = 3_000;
const STARTUP_SERVER_WAIT_MS = 4_000;
const FIRST_CONNECTION_WAIT_MS = 5_000;
const STREAM_FLUSH_MS = 100;
const LATEST_PAGE_SIZE = 50;
const READ_LATEST_PAGE_SIZE = 24;
const EMPTY_SERVER: MobileServer = {
  id: "unavailable",
  name: "OpenBot",
  logoKey: null,
  kind: "local",
  state: "connecting",
  initialConnectionPending: true,
  connectionMessage: null,
  address: null,
  accent: serverAccent("unavailable"),
  publicKey: "",
  membershipId: "",
  role: "member",
};

function startWorkspaceReads(
  client: RemoteTeamTransportRef,
  capabilities: readonly string[],
  serverId: string,
  synced: WorkspaceSyncCollections,
) {
  const readLayout = capabilities.includes(SIDEBAR_FOLDERS_CAPABILITY)
    ? () => client.request("POST", SIDEBAR_FOLDERS_ROUTES.read, decodeSidebarLayout, {})
    : capabilities.includes(SIDEBAR_LAYOUT_CAPABILITY)
      ? () => client.request("GET", TEAM_API_ROUTES.sidebarLayout.state, decodeSidebarLayout)
      : null;
  const sections = readLayout ? synced.sidebarLayout.read(serverId, null, syncedSnapshot, readLayout) : null;
  const agents = synced.agents.read(
    serverId,
    null,
    (handle) => [...handle.values()],
    () => client.request("GET", TEAM_API_ROUTES.agents.all, decodeAgentSummaries),
  );
  const hidden = synced.hiddenAgents
    .read(
      serverId,
      null,
      (handle) => (capabilities.includes(AGENT_HIDDEN_CAPABILITY) ? syncedSnapshot(handle)?.agents : undefined),
      () =>
        readHostHiddenAgents((method, path, decode, body) => client.request(method, path, decode, body), capabilities),
    )
    .catch(() => undefined);
  const colors = readHostAgentColors(
    (method, path, decode, body) => client.request(method, path, decode, body),
    capabilities,
  ).catch(() => undefined);
  sections?.catch(() => undefined);
  agents.catch(() => undefined);
  return { sections, agents, hidden, colors };
}

function sameCapabilities(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((capability) => b.includes(capability));
}

function colorList(colors: Readonly<Record<string, AvatarColor>> | undefined) {
  return colors ? Object.entries(colors).map(([agentId, color]) => ({ agentId, color })) : null;
}

function showPreferencesFailure(error: unknown): void {
  showFailureAlert(
    error,
    "settings",
    currentText().t("mobile.workspace.alert.preferencesTitle"),
    currentText().t("mobile.workspace.alert.preferencesBody"),
  );
}

function trackUntilSettled(pending: Set<Promise<void>>, work: Promise<unknown>): void {
  const settled = work.then(
    () => undefined,
    () => undefined,
  );
  pending.add(settled);
  void settled.then(() => pending.delete(settled));
}

function allSettled(pending: ReadonlySet<Promise<void>>): Promise<void> {
  return Promise.allSettled([...pending]).then(() => undefined);
}

function withoutKeys<T>(record: Record<string, T>, keys: ReadonlySet<string>): Record<string, T> {
  return Object.keys(record).some((key) => keys.has(key))
    ? Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)))
    : record;
}

export function MobileWorkspaceProvider({ children }: PropsWithChildren) {
  const { session, sessionScope } = useMobileSession();
  const queryClient = useQueryClient();
  useEffect(() => () => queryClient.removeQueries({ queryKey: queryKeys.chatQueue() }), [queryClient]);
  const presenceSignatures = useRef(new Map<string, string>());
  const [memberCountByServer, setMemberCountByServer] = useState<Readonly<Record<string, number>>>({});
  if (!session) throw new Error("MobileWorkspaceProvider requires a signed-in mobile session.");
  const queryScope = useMemo<QueryScope>(
    () => [session.apiUrl, session.user.id, sessionScope],
    [session.apiUrl, session.user.id, sessionScope],
  );

  const directory = useMemo(
    () =>
      new RemoteTeamDirectoryClient({
        apiUrl: session.apiUrl,
        token: session.sessionToken,
        fetch,
        hostKeys: trustedHostKeys(session.apiUrl, session.user.id),
        pairedHost: session.host,
        verifyHostKeySignature: verifyEd25519Base64Url,
      }),
    [session.apiUrl, session.sessionToken, session.user.id, session.host],
  );
  const connections = useRef(new Map<string, ServerConnectionHandle>());
  const [connectionWaits] = useState(() => new ConnectionWaits());
  const loadGeneration = useRef(0);
  const directoryGeneration = useRef(0);
  const foreground = useAppForeground();
  const watchAwake = useWatchAwake();
  const [servers, setServers] = useState<MobileServer[]>([]);
  const [serverDirectoryState, setServerDirectoryState] = useState<MobileServerDirectoryState>("loading");
  const [serverDirectoryError, setServerDirectoryError] = useState<string | null>(null);
  const [directoryLoads, setDirectoryLoads] = useState(0);
  const serversRef = useRef(servers);
  serversRef.current = servers;
  const cacheWrites = useRef(new Set<Promise<void>>());
  const serverLoads = useRef(new Set<Promise<void>>());
  const { refreshing: backgroundRefreshing, connectionStatus: backgroundRefreshStatus } = useBackgroundRefresh({
    foreground,
    serverIds: () => serversRef.current.map((server) => server.id),
    loaded: () => allSettled(serverLoads.current),
    saved: () => allSettled(cacheWrites.current),
  });
  const live = foreground || backgroundRefreshing || watchAwake;
  const firstConnectionTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [sidebarByServer, setSidebarByServer] = useState<
    Record<string, { layout: SidebarLayoutSnapshot | null; error: string | null }>
  >({});
  const sidebarByServerRef = useRef(sidebarByServer);
  sidebarByServerRef.current = sidebarByServer;
  const applySidebarLayout = useCallback((serverId: string, layout: SidebarLayoutSnapshot) => {
    if (removedServers.current.has(serverId)) return;
    setSidebarByServer((current) => {
      const previous = current[serverId]?.layout;
      if (previous && previous.revision > layout.revision) return current;
      return { ...current, [serverId]: { layout, error: null } };
    });
  }, []);
  const [agents, setAgents] = useState<MobileAgent[]>([]);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const savedAvatars = useSyncExternalStore(subscribeSavedAgentAvatars, savedAgentAvatarCount);
  const directoryAgentsRef = useRef<{ agents: readonly MobileAgent[]; savedAvatars: number }>({
    agents,
    savedAvatars,
  });
  if (directoryAgentsRef.current.savedAvatars !== savedAvatars)
    directoryAgentsRef.current = { agents: [...agents], savedAvatars };
  else if (directoryAgentsRef.current.agents !== agents)
    directoryAgentsRef.current = {
      agents: keepDirectoryAgents(directoryAgentsRef.current.agents, agents),
      savedAvatars,
    };
  const directoryAgents = directoryAgentsRef.current.agents;
  const serverAgentIds = useRef(new Map<string, Set<string>>());
  const removedServers = useRef(new Set<string>());
  const readRefresh = useMemo(() => createRemoteReadRefresh(), []);
  const serverCapabilities = useRef(new Map<string, readonly string[]>());
  const { serverOrder, defaultServerId, orderedServers, sortByPreference, reorderServers } = useServerOrder(
    session.apiUrl,
    session.user.id,
    session.host?.hostId,
    servers,
  );
  const [activeServerId, setActiveServerId] = useState<string | null>(() => defaultServerId ?? serverOrder[0] ?? null);
  const activeServerIdRef = useRef(activeServerId);
  activeServerIdRef.current = activeServerId;
  const conversationStore = useMemo(
    () =>
      new MobileConversationStore((flush) => {
        const timer = setTimeout(flush, STREAM_FLUSH_MS);
        return () => clearTimeout(timer);
      }),
    [],
  );
  useEffect(() => () => conversationStore.dispose(), [conversationStore]);
  const workspaceCache = useMemo(() => {
    startDrawerSnapshots(`${session.apiUrl}:${session.user.id}`);
    return createWorkspaceCache(`${session.apiUrl}:${session.user.id}`);
  }, [session.apiUrl, session.user.id]);
  useEffect(() => {
    startDrawerSnapshots(`${session.apiUrl}:${session.user.id}`);
    return () => startDrawerSnapshots(null);
  }, [session.apiUrl, session.user.id]);
  const cachedSummaries = useRef(new Map<string, RemoteAgent[]>());
  const restoredServers = useRef(new Set<string>());
  const pageRestores = useRef(new Map<string, { persistLater: boolean }>());
  const persistedInputs = useRef(new Map<string, readonly unknown[]>());
  const quietStarts = useRef(new Set<string>());
  const keptCapabilities = useRef(new Map<string, readonly string[]>());
  const keptHosts = useRef<readonly RemoteTeamHost[] | null>(null);
  const pendingHidden = useRef(new Map<string, boolean>());
  const directoryLoaded = useRef(false);
  const keepHosts = useCallback(
    (hosts: readonly RemoteTeamHost[]) => {
      if (keptHosts.current && JSON.stringify(keptHosts.current) === JSON.stringify(hosts)) return;
      keptHosts.current = hosts;
      void workspaceCache?.writeHosts(hosts).catch(() => undefined);
    },
    [workspaceCache],
  );
  const [liveState] = useState(() => new LiveWorkspaceStore());
  const preferenceStore = useMemo(
    () =>
      createWorkspacePreferences(session.apiUrl, session.user.id, {
        get: (key) => LockedKeychain.getItem(key),
        set: (key, value) => LockedKeychain.setItem(key, value),
      }),
    [session.apiUrl, session.user.id],
  );
  const [preferences, setPreferences] = useState<Record<string, RemoteWorkspacePreferences>>({});
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [hostHidden, setHostHidden] = useState<Record<string, string[]>>({});
  const hostColors = useRef<Record<string, Readonly<Record<string, AvatarColor>>>>({});
  const hostHiddenRef = useRef(hostHidden);
  hostHiddenRef.current = hostHidden;
  const localHiddenIds = (activeServerId ? preferences[activeServerId]?.hidden : null) ?? NO_IDS;
  const hostHiddenIds = (activeServerId ? hostHidden[activeServerId] : null) ?? NO_IDS;
  const hiddenAgentIds = useMemo(
    () =>
      hostHiddenIds.length === 0
        ? localHiddenIds
        : localHiddenIds.length === 0
          ? hostHiddenIds
          : [...new Set([...localHiddenIds, ...hostHiddenIds])],
    [localHiddenIds, hostHiddenIds],
  );
  const visiblePreferences = useMemo(() => {
    let next = preferences;
    for (const [serverId, ids] of Object.entries(hostHidden)) {
      const current = preferences[serverId];
      if (!current || ids.length === 0) continue;
      if (next === preferences) next = { ...preferences };
      next[serverId] = { ...current, hidden: [...new Set([...current.hidden, ...ids])] };
    }
    return next;
  }, [preferences, hostHidden]);
  const applyHostHidden = useCallback((serverId: string, hidden: readonly { agentId: string }[] | null) => {
    if (removedServers.current.has(serverId)) return;
    setHostHidden((current) => {
      if (hidden === null) {
        if (!(serverId in current)) return current;
        const next = { ...current };
        delete next[serverId];
        return next;
      }
      const ids = replaceEqualDeep(
        current[serverId],
        hidden.map((agent) => agent.agentId),
      );
      return ids === current[serverId] ? current : { ...current, [serverId]: ids };
    });
  }, []);
  const applyHostColors = useCallback(
    (serverId: string, colors: readonly { agentId: string; color: AvatarColor }[] | null) => {
      if (removedServers.current.has(serverId)) return;
      const byAgent: Record<string, AvatarColor> = {};
      for (const entry of colors ?? []) byAgent[entry.agentId] = entry.color;
      if (colors === null) hostColors.current = withoutKeys(hostColors.current, new Set([serverId]));
      else hostColors.current = { ...hostColors.current, [serverId]: byAgent };
      setAgents((current) => {
        let changed = false;
        const next = current.map((agent) => {
          if (agent.serverId !== serverId) return agent;
          const avatarColor = byAgent[agent.id] ?? null;
          if (agent.avatarColor === avatarColor) return agent;
          changed = true;
          return { ...agent, avatarColor };
        });
        return changed ? next : current;
      });
    },
    [],
  );
  const pinnedAgentIds = (activeServerId ? preferences[activeServerId]?.pinned : null) ?? NO_IDS;
  const hiddenChannelIds = (activeServerId ? preferences[activeServerId]?.hiddenChannels : null) ?? NO_IDS;
  const pinnedChannelIds = (activeServerId ? preferences[activeServerId]?.pinnedChannels : null) ?? NO_IDS;
  const savedCollapsedSections = (activeServerId ? preferences[activeServerId]?.collapsedSections : null) ?? NO_IDS;
  const collapsedSectionIds = useMemo(() => new Set(savedCollapsedSections), [savedCollapsedSections]);
  const pinnedWorkflowIds = useMemo(() => {
    const pins: Record<string, readonly string[]> = {};
    for (const [serverId, saved] of Object.entries(preferences))
      if (saved.pinnedWorkflows?.length) pins[serverId] = saved.pinnedWorkflows;
    return pins;
  }, [preferences]);

  const dropServerState = useCallback(
    (serverIds: ReadonlySet<string>) => {
      if (!serverIds.size) return;
      deleteServerDrafts(serverIds);
      deleteServerSideQuestions(serverIds);
      const removedAgentIds = new Set<string>();
      for (const serverId of serverIds) {
        removedServers.current.add(serverId);
        clearTimeout(firstConnectionTimers.current.get(serverId));
        firstConnectionTimers.current.delete(serverId);
        deleteServerAvatars(serverId);
        connectionWaits.drop(
          serverId,
          new ConnectionUnavailableError(currentText().t("mobile.workspace.error.transportNotReady")),
        );
        readRefresh.invalidate(serverId);
        for (const id of serverAgentIds.current.get(serverId) ?? []) removedAgentIds.add(id);
        serverAgentIds.current.delete(serverId);
        cachedSummaries.current.delete(serverId);
        keptCapabilities.current.delete(serverId);
        void workspaceCache?.remove(serverId).catch(() => undefined);
        persistedInputs.current.delete(serverId);
        presenceSignatures.current.delete(serverId);
        for (const queryKey of [
          queryKeys.chatQueue(serverId),
          queryKeys.agentUsageLimits(queryScope, serverId),
          queryKeys.serverMembers(queryScope, serverId),
          queryKeys.serverInvites(queryScope, serverId),
          queryKeys.agentAvatar(queryScope, serverId),
          queryKeys.channelImage(queryScope, serverId),
          queryKeys.serverLogo(queryScope, serverId),
        ])
          queryClient.removeQueries({ queryKey });
      }
      forgetDrawerSnapshots(serverIds);
      forgetAgentBackdrops(serverIds);
      forgetLocationAlwaysAllowed(serverIds);
      setSidebarByServer((current) => withoutKeys(current, serverIds));
      setHostHidden((current) => withoutKeys(current, serverIds));
      hostColors.current = withoutKeys(hostColors.current, serverIds);
      setAgents((current) => current.filter((agent) => !serverIds.has(agent.serverId)));
      for (const id of removedAgentIds) conversationStore.remove(id);
      liveState.update("unreadAgentIds", (current) => current.filter((id) => !removedAgentIds.has(id)));
      liveState.update("unreadCounts", (current) => withoutKeys(current, removedAgentIds));
      liveState.update("firstUnreadMessageIds", (current) => withoutKeys(current, removedAgentIds));
      liveState.update("activityByServer", (current) => withoutKeys(current, serverIds));
      liveState.update("contextByServer", (current) => withoutKeys(current, serverIds));
      liveState.update("threadWaitsByServer", (current) => withoutKeys(current, serverIds));
      liveState.update("turnLinesByServer", (current) => withoutKeys(current, serverIds));
      liveState.update("approvalRequests", (current) => withoutKeys(current, serverIds));
      liveState.update("browserRequests", (current) => withoutKeys(current, serverIds));
      liveState.update("browserTabs", (current) => withoutKeys(current, serverIds));
      liveState.update("browserPermissions", (current) => withoutKeys(current, serverIds));
      liveState.update("browserHttpSignIns", (current) => withoutKeys(current, serverIds));
      const kept = keptHosts.current;
      if (kept?.some((host) => serverIds.has(host.hostId)))
        keepHosts(kept.filter((host) => !serverIds.has(host.hostId)));
    },
    [connectionWaits, readRefresh, queryClient, queryScope, conversationStore, liveState, workspaceCache, keepHosts],
  );

  const installHosts = useCallback(
    (listed: readonly RemoteTeamHost[], confirmed = true) => {
      const hosts = listed.map((host) => {
        const hidden = pendingHidden.current.get(host.hostId);
        return hidden === undefined ? host : hostWithHidden(host, hidden);
      });
      const available = new Set(hosts.map((host) => host.hostId));
      if (confirmed) {
        dropServerState(new Set(serversRef.current.filter((server) => !available.has(server.id)).map(({ id }) => id)));
        void workspaceCache?.retain([...available]).catch(() => undefined);
        retainAgentBackdrops([...available]);
        retainLocationAlwaysAllowed([...available]);
        for (const host of hosts) removedServers.current.delete(host.hostId);
        keepHosts(listed);
      }
      setServers((current) => {
        const previousServers = new Map(current.map((server) => [server.id, server]));
        return hosts.map((host) =>
          serverFromHost(host, serverKind(host.hostId, session.host?.hostId), previousServers.get(host.hostId)),
        );
      });
      const shown = hosts.filter((host) => !host.hidden);
      setActiveServerId((current) =>
        shown.some((host) => host.hostId === current)
          ? current
          : (sortByPreference(shown.map((host) => ({ id: host.hostId })))[0]?.id ?? null),
      );
    },
    [dropServerState, session.host?.hostId, sortByPreference, workspaceCache, keepHosts],
  );

  const directoryRefresh = useMemo(
    () =>
      createRemoteAccountRefresh(() =>
        Effect.gen(function* () {
          const generation = ++directoryGeneration.current;
          setServerDirectoryState("loading");
          setServerDirectoryError(null);
          const hosts = yield* directory.listHosts().pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                if (generation !== directoryGeneration.current) return;
                setServerDirectoryState("error");
                const text = currentText();
                setServerDirectoryError(
                  text.errorMessage(error, text.t("mobile.workspace.error.directoryUnavailable")),
                );
              }),
            ),
          );
          if (generation !== directoryGeneration.current) return;
          directoryLoaded.current = true;
          installHosts(hosts);
          setServerDirectoryState("ready");
          setDirectoryLoads((count) => count + 1);
        }),
      ),
    [directory, installHosts],
  );
  useEffect(() => {
    if (!workspaceCache) return;
    let current = true;
    const hostKeys = trustedHostKeys(session.apiUrl, session.user.id);
    void workspaceCache
      .readHosts()
      .then(async (cached) => {
        if (!cached?.length) return;
        const checked = await Promise.all(
          cached.map(async (host) => ((await hostKeys.get(host.hostId)) === host.devicePublicKey ? host : null)),
        );
        if (!current || directoryLoaded.current || serversRef.current.length > 0) return;
        keptHosts.current ??= cached;
        const trusted = checked.filter(
          (host): host is RemoteTeamHost => host !== null && !removedServers.current.has(host.hostId),
        );
        if (trusted.length > 0) installHosts(trusted, false);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [workspaceCache, session.apiUrl, session.user.id, installHosts]);
  const refreshHosts = useCallback(() => runTeamEffect(directoryRefresh.refresh(true)), [directoryRefresh]);
  const refreshMemberships = useCallback(() => {
    directoryGeneration.current += 1;
    directoryRefresh.invalidate();
    return runTeamEffect(directoryRefresh.refresh(true));
  }, [directoryRefresh]);

  useEffect(() => {
    return () => {
      directoryGeneration.current += 1;
      directoryRefresh.setActive(false);
    };
  }, [directoryRefresh]);

  const [attachmentDownloads] = useState(createDownloadQueue);
  const [largeAttachmentDownloads] = useState(createDownloadQueue);
  const syncWrites = useRef<MobileServerSync | null>(null);
  const request = useCallback(
    async <T,>(
      method: string,
      path: string,
      decode: (value: unknown) => T,
      body?: TeamProtocolV2Json,
      serverId = activeServerIdRef.current,
      upload?: RemoteFileUpload,
      onUploadProgress?: (fraction: number) => void,
      largeDownload?: RemoteLargeDownload,
      download?: RemoteDownloadWatch,
    ): Promise<T> => {
      if (serverId) await connectionWaits.whenConnected(serverId);
      const client = serverId ? connections.current.get(serverId)?.client : null;
      if (!client) throw new ConnectionUnavailableError(currentText().t("mobile.workspace.error.transportNotReady"));
      if (method === "GET")
        return client.request(method, path, decode, body, upload, onUploadProgress, largeDownload, download);
      try {
        return await client.request(method, path, decode, body, upload, onUploadProgress, largeDownload, download);
      } finally {
        if (serverId) syncWrites.current?.noteWrite(serverId);
      }
    },
    [connectionWaits],
  );
  const loadAgentAvatar = useCallback(
    (agentId: string, avatarUrl: string, serverId: string) =>
      queryClient
        .fetchQuery({
          queryKey: queryKeys.agentAvatar(queryScope, serverId, agentId, avatarUrl),
          queryFn: () => requestAgentAvatar(request, agentId, avatarUrl, serverId),
          staleTime: Infinity,
        })
        .then(agentAvatarDataUrl),
    [request, queryClient, queryScope],
  );
  const postLiveActivityAction = useCallback(
    (serverId: string, path: string, body: TeamProtocolV2Json) => request("POST", path, ignoreResponse, body, serverId),
    [request],
  );
  const supportsLiveActivityPush = useCallback(
    (serverId: string) => hasCapability(serverCapabilities.current, serverId, LIVE_ACTIVITY_PUSH_CAPABILITY),
    [],
  );
  const sideThreadOfTurn = useCallback(
    (serverId: string, agentId: string, turnId: string) =>
      taskTurnThread(queryClient, queryScope, serverId, agentId, turnId),
    [queryClient, queryScope],
  );
  const applyLiveActivityEvent = useLiveActivity({
    servers,
    activeServerId,
    agents: directoryAgents,
    liveState,
    foreground,
    post: postLiveActivityAction,
    loadAgentAvatar,
    supportsPush: supportsLiveActivityPush,
    sideThreadOfTurn,
  });
  const supportsPushNotifications = useCallback(
    (serverId: string) =>
      hasCapability(
        serverCapabilities.current,
        serverId,
        isAndroid ? ANDROID_PUSH_NOTIFICATIONS_CAPABILITY : PUSH_NOTIFICATIONS_CAPABILITY,
      ),
    [],
  );
  const supportsThreadNotifications = useCallback(
    (serverId: string) => hasCapability(serverCapabilities.current, serverId, PUSH_NOTIFICATION_THREADS_CAPABILITY),
    [],
  );
  usePushNotifications({
    servers,
    serversReady: serverDirectoryState === "ready",
    foreground,
    post: postLiveActivityAction,
    supportsPush: supportsPushNotifications,
    supportsThreads: supportsThreadNotifications,
  });
  const teamApi = useCallback(
    (serverId?: string, onUploadProgress?: (fraction: number) => void): TeamApiRequest =>
      (method, path, decode, body, upload) =>
        request(method, path, decode, body, serverId, upload, onUploadProgress),
    [request],
  );

  const [localServerLinks, setLocalServerLinks] = useState<{
    computers: ReadonlySet<string>;
    parents: ReadonlyMap<string, string>;
  }>(() => ({ computers: new Set(), parents: new Map() }));
  const localServerLinksRef = useRef(localServerLinks);
  localServerLinksRef.current = localServerLinks;
  const linkLocalServers = useCallback((computerId: string, list: HostLocalServerList) => {
    setLocalServerLinks((current) => {
      const parents = new Map([...current.parents].filter(([, parentId]) => parentId !== computerId));
      for (const server of list.servers) parents.set(server.serverId, computerId);
      return { computers: new Set([...current.computers, computerId]), parents };
    });
  }, []);
  const onlineComputerIds = servers
    .filter(
      (server) =>
        server.role === "owner" &&
        showsOnline(server) &&
        hasCapability(serverCapabilities.current, server.id, LOCAL_SERVERS_CAPABILITY),
    )
    .map((server) => server.id)
    .join("\n");
  useEffect(() => {
    if (!onlineComputerIds) return;
    let active = true;
    for (const computerId of onlineComputerIds.split("\n"))
      void runTeamRequest(listHostLocalServers(teamApi(computerId))).then(
        (list) => {
          if (active) linkLocalServers(computerId, list);
        },
        () => undefined,
      );
    return () => {
      active = false;
    };
  }, [onlineComputerIds, teamApi, linkLocalServers]);

  const [serverSync] = useState(
    () =>
      new MobileServerSync(async (serverId) => {
        const { support, negotiated } = await readTeamHostCompatibility(
          () => request("GET", TEAM_API_ROUTES.compatibility, (value) => value, undefined, serverId),
          TEAM_WEB_CLIENT_PROTOCOL,
        );
        if (negotiated.update === "client_update_required")
          throw new Error(sourceText("error.remote.mobileUpdateRequired"));
        if (negotiated.update === "host_update_required") throw new Error(sourceText("error.team.hostUpdateRequired"));
        if (support.capabilities.includes(SERVER_SAFE_MODE_CAPABILITY))
          throw new Error(sourceText("error.team.serverSafeMode"));
        return support.capabilities;
      }),
  );
  useEffect(() => {
    syncWrites.current = serverSync;
    return () => {
      syncWrites.current = null;
      serverSync.dispose();
    };
  }, [serverSync]);
  useEffect(() => {
    serverSync.retainServers(servers.map((server) => server.id));
  }, [servers, serverSync]);
  const syncHandlers = useRef<WorkspaceSyncHandlers | null>(null);
  const [syncCollections] = useState(() => createWorkspaceSyncCollections(serverSync, () => syncHandlers.current));
  const syncRetained = useRef(new Map<string, () => void>());
  useEffect(() => {
    const kept = new Set(servers.map((server) => server.id));
    for (const [serverId, release] of syncRetained.current) {
      if (kept.has(serverId)) continue;
      syncRetained.current.delete(serverId);
      release();
    }
    for (const serverId of kept)
      if (!syncRetained.current.has(serverId))
        syncRetained.current.set(serverId, retainServerCollections(syncCollections, serverId));
  }, [servers, syncCollections]);
  useEffect(() => {
    const retained = syncRetained.current;
    return () => {
      for (const release of retained.values()) release();
      retained.clear();
    };
  }, []);
  const calendarChannels = useRef(new Map<string, string>());
  const channelStore = useMemo(
    () =>
      new MobileChannelStore(
        request,
        (serverId, channels) => {
          const open = channels
            .filter((channel) => !channel.archived)
            .map((channel) => channel.id)
            .sort()
            .join("\n");
          const previous = calendarChannels.current.get(serverId);
          calendarChannels.current.set(serverId, open);
          if (previous !== undefined && previous !== open)
            void queryClient.invalidateQueries({ queryKey: queryKeys.serverRoutines(queryScope, serverId) });
          const pinned = preferencesRef.current[serverId]?.pinnedChannels;
          if (!pinned?.length) return;
          const available = new Set(channels.map((channel) => channel.id));
          if (pinned.every((id) => available.has(id))) return;
          try {
            const saved = reconcileChannelPins(preferenceStore, serverId, channels);
            setPreferences((current) => ({ ...current, [serverId]: saved }));
          } catch (error) {
            showPreferencesFailure(error);
          }
        },
        serverSync,
      ),
    [request, preferenceStore, queryClient, queryScope, serverSync],
  );
  useEffect(() => () => channelStore.dispose(), [channelStore]);
  useEffect(() => channelStore.setActive(live), [channelStore, live]);
  useEffect(() => {
    channelStore.retainServers(servers.map((server) => server.id));
  }, [servers, channelStore]);

  const replaceServerAgents = useCallback(
    (serverId: string, summaries: RemoteAgent[]) => {
      try {
        const saved = reconcileAgentPins(preferenceStore, serverId, summaries);
        setPreferences((current) => {
          const next = replaceEqualDeep(current[serverId], saved);
          return next === current[serverId] ? current : { ...current, [serverId]: next };
        });
      } catch (error) {
        showPreferencesFailure(error);
      }
      const knownIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
      for (const agent of summaries) knownIds.add(agent.id);
      serverAgentIds.current.set(serverId, knownIds);
      cachedSummaries.current.set(serverId, replaceEqualDeep(cachedSummaries.current.get(serverId), summaries));
      setAgents((current) => {
        const previous = new Map(
          current.filter((agent) => agent.serverId === serverId).map((agent) => [agent.id, agent]),
        );
        const next = [
          ...current.filter((agent) => agent.serverId !== serverId),
          ...summaries.map((agent) =>
            replaceEqualDeep(
              previous.get(agent.id),
              projectAgent(serverId, agent, hostColors.current[serverId]?.[agent.id] ?? null),
            ),
          ),
        ];
        return next.length === current.length && next.every((agent, index) => agent === current[index])
          ? current
          : next;
      });
    },
    [preferenceStore],
  );

  const pinChanges = useRef(new Map<string, number>());
  const applyHostSidebarPins = useCallback(
    (serverId: string, items: readonly SidebarPin[], change = pinChanges.current.get(serverId) ?? 0) => {
      if ((pinChanges.current.get(serverId) ?? 0) !== change) return;
      try {
        const saved = preferenceStore.read(serverId);
        const next = withHostSidebarPins(saved, items);
        if (replaceEqualDeep(saved, next) !== saved) preferenceStore.write(serverId, next);
        setPreferences((current) => {
          const value = replaceEqualDeep(current[serverId], next);
          return value === current[serverId] ? current : { ...current, [serverId]: value };
        });
      } catch {}
    },
    [preferenceStore],
  );
  const pushSidebarPins = useCallback(
    (serverId: string) => {
      const current = preferenceStore.read(serverId);
      if (!current.pinOrder) return;
      const change = (pinChanges.current.get(serverId) ?? 0) + 1;
      pinChanges.current.set(serverId, change);
      if (!current.pinsPending) {
        const pending = { ...current, pinsPending: true };
        preferenceStore.write(serverId, pending);
        setPreferences((saved) => ({ ...saved, [serverId]: pending }));
      }
      if (!hasCapability(serverCapabilities.current, serverId, SIDEBAR_PINS_CAPABILITY)) return;
      void runTeamEffect(setSidebarPins(teamApi(serverId), phoneSidebarPins(current)))
        .then((snapshot) => applyHostSidebarPins(serverId, snapshot.items, change))
        .catch(() => undefined);
    },
    [preferenceStore, teamApi, applyHostSidebarPins],
  );
  const syncSidebarPins = useCallback(
    async (serverId: string, request: TeamApiRequest) => {
      const current = preferenceStore.read(serverId);
      if (current.pinsPending && current.pinOrder) {
        pushSidebarPins(serverId);
        return;
      }
      const change = pinChanges.current.get(serverId) ?? 0;
      const snapshot = await syncCollections.sidebarPins.read(serverId, null, syncedSnapshot, () =>
        runTeamEffect(readSidebarPins(request)),
      );
      const local = phoneSidebarPins(current);
      const kept =
        snapshot.updatedAt === null && local.length > 0
          ? await runTeamEffect(seedSidebarPins(request, local))
          : snapshot;
      applyHostSidebarPins(serverId, kept.items, change);
    },
    [preferenceStore, pushSidebarPins, applyHostSidebarPins, syncCollections],
  );

  const persistServer = useCallback(
    (serverId: string) => {
      const agents = cachedSummaries.current.get(serverId);
      if (!workspaceCache || !agents || removedServers.current.has(serverId)) return;
      const pendingPages = pageRestores.current.get(serverId);
      if (pendingPages) {
        pendingPages.persistLater = true;
        return;
      }
      const capabilities = serverCapabilities.current.get(serverId) ?? keptCapabilities.current.get(serverId) ?? null;
      const inputs = [
        agents,
        hostHiddenRef.current[serverId],
        hostColors.current[serverId],
        sidebarByServerRef.current[serverId]?.layout,
        capabilities,
        drawerSnapshot(serverId),
        channelStore.peek(serverId),
        ...agents.map((agent) => conversationStore.get(agent.id)),
      ];
      const previous = persistedInputs.current.get(serverId);
      if (previous?.length === inputs.length && previous.every((input, index) => input === inputs[index])) return;
      persistedInputs.current.set(serverId, inputs);
      const write = workspaceCache
        .write(serverId, {
          agents,
          hidden: hostHiddenRef.current[serverId] ?? null,
          colors: colorList(hostColors.current[serverId]),
          sidebar: sidebarByServerRef.current[serverId]?.layout ?? null,
          conversations: agents.flatMap((agent) => conversationStore.cachedPage(agent.id) ?? []),
          capabilities,
          drawer: drawerSnapshot(serverId),
          channels: channelStore.cachedChannels(serverId),
        })
        .catch(() => false)
        .then((written) => {
          if (!written && persistedInputs.current.get(serverId) === inputs) persistedInputs.current.delete(serverId);
        });
      trackUntilSettled(cacheWrites.current, write);
    },
    [workspaceCache, conversationStore, channelStore],
  );
  useEffect(() => {
    if (!workspaceCache) return;
    const activeId = activeServerIdRef.current;
    const pending = servers
      .map(({ id }) => id)
      .filter((id) => !restoredServers.current.has(id))
      .sort((a, b) => Number(b === activeId) - Number(a === activeId));
    const restored: { id: string; readPages: () => Promise<CachedPages | null> }[] = [];
    let previousRead: Promise<unknown> = Promise.resolve();
    for (const id of pending) {
      restoredServers.current.add(id);
      previousRead = previousRead
        .then(() => workspaceCache.read(id))
        .then((cached) => {
          if (!cached || removedServers.current.has(id)) return;
          if (cached.capabilities) keptCapabilities.current.set(id, cached.capabilities);
          if (cached.drawer) restoreDrawerSnapshot(id, cached.drawer);
          if (cachedSummaries.current.has(id)) return;
          if (cached.hidden)
            applyHostHidden(
              id,
              cached.hidden.map((agentId) => ({ agentId })),
            );
          if (cached.colors) applyHostColors(id, cached.colors);
          if (cached.sidebar) applySidebarLayout(id, cached.sidebar);
          pageRestores.current.set(id, { persistLater: false });
          restored.push({ id, readPages: cached.readPages });
          replaceServerAgents(id, cached.agents);
          if (cached.channels && cached.capabilities)
            channelStore.restore(id, cached.capabilities, cached.channels, []);
          const connection = connections.current.get(id);
          if (connection) connection.quietStart();
          else quietStarts.current.add(id);
        })
        .catch(() => undefined);
    }
    void previousRead.then(async () => {
      for (const { id, readPages } of restored) {
        const pages = await readPages().catch(() => null);
        const restore = pageRestores.current.get(id);
        pageRestores.current.delete(id);
        if (pages && !removedServers.current.has(id)) {
          for (const page of pages.conversations) conversationStore.restore(page);
          channelStore.restorePages(id, pages.channelPages);
        }
        if (restore?.persistLater) persistServer(id);
      }
    });
  }, [
    servers,
    workspaceCache,
    applyHostHidden,
    applyHostColors,
    applySidebarLayout,
    replaceServerAgents,
    conversationStore,
    channelStore,
    persistServer,
  ]);

  const openExchangeReads = useRef(new Map<string, { again: boolean }>());
  const refreshOpenExchanges = useCallback(
    (agentId: string, serverId = activeServerIdRef.current) => {
      for (const messageId of conversationStore.openExchangesBeforeLatest(agentId)) {
        const key = `${agentId}\0${messageId}`;
        const running = openExchangeReads.current.get(key);
        if (running) {
          running.again = true;
          continue;
        }
        const read = { again: true };
        openExchangeReads.current.set(key, read);
        const generation = loadGeneration.current;
        const isCurrent = () =>
          generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? "");
        void (async () => {
          try {
            while (read.again && isCurrent()) {
              read.again = false;
              const page = await request(
                "GET",
                `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=1&around=${encodeURIComponent(messageId)}`,
                decodeConversationPage,
                undefined,
                serverId,
              );
              if (isCurrent() && page.agentId === agentId) conversationStore.replaceMessage(page, messageId);
            }
          } finally {
            openExchangeReads.current.delete(key);
          }
        })().catch(() => undefined);
      }
    },
    [request, conversationStore],
  );
  const latestPageSize = useCallback(
    (agentId: string) => {
      const live = liveState.get();
      const unread = live.unreadAgentIds.includes(agentId) || (live.unreadCounts[agentId] ?? 0) > 0;
      return unread ? LATEST_PAGE_SIZE : READ_LATEST_PAGE_SIZE;
    },
    [liveState],
  );
  const loadConversation = useCallback(
    async (agentId: string, serverId = activeServerIdRef.current, refresh = false, attach = false) => {
      const generation = loadGeneration.current;
      const page = await conversationStore.loadLatest(
        agentId,
        async () =>
          (serverId ? await syncCollections.conversationLogs.read(serverId, agentId) : null) ??
          request(
            "GET",
            `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=${latestPageSize(agentId)}`,
            decodeConversationPage,
            undefined,
            serverId,
          ),
        () => generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? ""),
        refresh,
        attach,
      );
      refreshOpenExchanges(agentId, serverId);
      return page;
    },
    [request, conversationStore, refreshOpenExchanges, syncCollections, latestPageSize],
  );
  const loadLatestMessages = useCallback(
    async (agentId: string, serverId?: string) => {
      await loadConversation(agentId, serverId, true, true);
    },
    [loadConversation],
  );
  const loadConversationAround = useCallback(
    async (agentId: string, messageId: string, serverId = activeServerIdRef.current) => {
      const generation = loadGeneration.current;
      const page = await request(
        "GET",
        `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=50&around=${encodeURIComponent(messageId)}`,
        decodeConversationPage,
        undefined,
        serverId,
      );
      if (page.agentId !== agentId) throw new Error("The server returned a page for another conversation.");
      const current =
        generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? "");
      if (!current || !page.messages.some((message) => message.id === messageId)) return false;
      conversationStore.applyAround(page);
      return true;
    },
    [request, conversationStore],
  );
  const loadOlderMessages = useCallback(
    async (agentId: string, serverId = activeServerIdRef.current) => {
      const generation = loadGeneration.current;
      await conversationStore.loadOlder(
        agentId,
        (cursor) =>
          request(
            "GET",
            `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=50&before=${encodeURIComponent(cursor ?? "")}`,
            decodeConversationPage,
            undefined,
            serverId,
          ),
        () => generation === loadGeneration.current && Boolean(serverId) && !removedServers.current.has(serverId ?? ""),
      );
    },
    [request, conversationStore],
  );

  const readSyncedConversationReads = useCallback(
    (serverId: string, fallback: () => Promise<Record<string, MobileConversationRead>>) =>
      syncCollections.conversationReads.read(
        serverId,
        null,
        (handle) => conversationReadsOf(handle.values()),
        fallback,
      ),
    [syncCollections],
  );
  const { applyConversationReads, refreshConversationReads, markAgentRead, markAgentUnreadFrom, markAllRead } =
    useConversationReads({
      liveState,
      readRefresh,
      request,
      loadConversation,
      conversationStore,
      loadGeneration,
      removedServers,
      capabilities: serverCapabilities.current,
      activeServerId: activeServerIdRef,
      agents: agentsRef,
      readSynced: readSyncedConversationReads,
    });

  const loadOpenChats = useCallback(
    (serverId: string, agentIds: string[], client: RemoteTeamTransportRef, context: ServerLoadContext) => {
      const open = agentIds.filter((agentId) => conversationStore.isObserved(agentId));
      const loads = (async () => {
        for (const agentId of open) {
          if (!context.isCurrent()) return;
          if (!conversationStore.get(agentId) || !conversationStore.isObserved(agentId)) continue;
          await conversationStore
            .loadLatest(
              agentId,
              () =>
                client.request(
                  "GET",
                  `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=${latestPageSize(agentId)}`,
                  decodeConversationPage,
                ),
              context.isCurrent,
              true,
            )
            .catch(() => undefined);
        }
        if (context.isCurrent()) persistServer(serverId);
      })();
      trackUntilSettled(serverLoads.current, loads);
    },
    [conversationStore, persistServer, latestPageSize],
  );

  const loadServer = useCallback(
    async (serverId: string, publicKey: string, client: RemoteTeamTransportRef, context: ServerLoadContext) => {
      context.stage = "preferences";
      const saved = preferenceStore.read(serverId);
      setPreferences((current) => {
        const value = replaceEqualDeep(current[serverId], saved);
        return value === current[serverId] ? current : { ...current, [serverId]: value };
      });
      context.stage = "connection";
      const { kept } = await client.connect(serverId, publicKey);
      if (!context.isCurrent()) return;
      context.stage = "compatibility";
      const compatibilityRead = readTeamHostCompatibility(
        () => client.request("GET", TEAM_API_ROUTES.compatibility, (value) => value),
        TEAM_WEB_CLIENT_PROTOCOL,
      );
      if (context.check && kept) {
        const { support } = await compatibilityRead;
        if (!context.isCurrent()) return;
        serverSync.configure(serverId, support.capabilities, (message) => client.sendSync(message));
        void queryClient.invalidateQueries({ queryKey: [...queryKeys.serverTasks(queryScope, serverId), "task"] });
        loadOpenChats(
          serverId,
          agentsRef.current
            .filter((agent) => agent.serverId === serverId && conversationStore.missedLatest(agent.id))
            .map((agent) => agent.id),
          client,
          context,
        );
        return;
      }
      conversationStore.markStale();
      const known = serverCapabilities.current.get(serverId) ?? keptCapabilities.current.get(serverId);
      const loadReads = () =>
        runTeamEffect(
          readRefresh.refresh(
            serverId,
            () =>
              Effect.tryPromise(() =>
                syncCollections.conversationReads.read(
                  serverId,
                  null,
                  (handle) => conversationReadsOf(handle.values()),
                  () => client.request("GET", TEAM_API_ROUTES.agents.conversationReads, decodeConversationReads),
                ),
              ),
            applyConversationReads,
            () => context.isCurrent() && !removedServers.current.has(serverId),
          ),
        );
      const early = known
        ? {
            capabilities: known,
            reads: startWorkspaceReads(client, known, serverId, syncCollections),
            conversationReads: loadReads(),
          }
        : null;
      early?.conversationReads.catch(() => undefined);
      const { support: compatibility, negotiated } = await compatibilityRead;
      if (!context.isCurrent()) return;
      supportLog.add(
        "info",
        "connection",
        `${serverId} host OpenBot ${compatibility.appVersion}, protocol ${compatibility.protocol.minimum}-${compatibility.protocol.maximum}, capabilities: ${compatibility.capabilities.join(" ")}`,
      );
      if (negotiated.update === "client_update_required") {
        throw new Error(sourceText("error.remote.mobileUpdateRequired"));
      }
      if (negotiated.update === "host_update_required") {
        throw new Error(sourceText("error.team.hostUpdateRequired"));
      }
      if (compatibility.capabilities.includes(SERVER_SAFE_MODE_CAPABILITY)) {
        const reason = await client
          .request("GET", SERVER_SAFE_MODE_ROUTES.reason, decodeServerSafeModeReason)
          .catch(() => null);
        throw new Error(
          reason === null
            ? sourceText("error.team.serverSafeMode")
            : sourceText(
                reason.reason === "newer_database"
                  ? "error.team.serverSafeModeNewerDatabase"
                  : "error.team.serverSafeModeStartFailed",
                { version: reason.appVersion },
              ),
        );
      }
      serverCapabilities.current.set(serverId, compatibility.capabilities);
      channelStore.configure(serverId, compatibility.capabilities);
      serverSync.configure(serverId, compatibility.capabilities, (message) => client.sendSync(message));
      void queryClient.invalidateQueries({ queryKey: [...queryKeys.serverTasks(queryScope, serverId), "task"] });
      if (compatibility.capabilities.includes(SIDEBAR_PINS_CAPABILITY))
        trackUntilSettled(
          serverLoads.current,
          syncSidebarPins(serverId, (method, path, decode, body) => client.request(method, path, decode, body)),
        );
      trackUntilSettled(serverLoads.current, channelStore.refresh(serverId));
      if (supportsBrowserView(compatibility.capabilities)) {
        void client
          .request("GET", TEAM_API_ROUTES.browser.tabs, decodeMobileBrowserTabs)
          .then((tabs) => {
            if (!context.isCurrent()) return;
            liveState.update("browserTabs", (current) => ({
              ...current,
              [serverId]: { tabs, activeTabId: current[serverId]?.activeTabId ?? null },
            }));
          })
          .catch(() => undefined);
        if (compatibility.capabilities.includes(BROWSER_HTTP_SIGN_IN_CAPABILITY))
          void client
            .request("POST", BROWSER_HTTP_SIGN_IN_ROUTES.state, decodeBrowserHttpSignInSnapshot, {})
            .then((snapshot) => {
              if (!context.isCurrent()) return;
              liveState.update("browserHttpSignIns", (current) => ({
                ...current,
                [serverId]: mobileHttpSignIns(snapshot.tabs),
              }));
            })
            .catch(() => undefined);
      }
      if (compatibility.capabilities.includes(BROWSER_PERMISSIONS_CAPABILITY)) {
        void client
          .request("POST", BROWSER_PERMISSIONS_ROUTES.state, decodeBrowserPermissionsSnapshot, {})
          .then(({ requests }) => {
            if (!context.isCurrent()) return;
            liveState.update("browserPermissions", (current) => ({ ...current, [serverId]: requests }));
          })
          .catch(() => undefined);
      }
      const reads =
        early && sameCapabilities(early.capabilities, compatibility.capabilities)
          ? early.reads
          : startWorkspaceReads(client, compatibility.capabilities, serverId, syncCollections);
      const conversationReads = early?.conversationReads ?? loadReads();
      let failed = false;
      const step = <T,>(stage: RemoteConnectionStage, read: Promise<T>) =>
        read.catch((error: unknown) => {
          if (!failed) context.stage = stage;
          failed = true;
          throw error;
        });
      const sections = reads.sections
        ? reads.sections.then(
            (layout) => {
              if (context.isCurrent()) applySidebarLayout(serverId, layout);
            },
            (error: unknown) => {
              if (!context.isCurrent()) return;
              const text = currentText();
              const message = text.errorMessage(error, text.t("mobile.workspace.error.sectionsLoadFailed"));
              setSidebarByServer((current) => ({
                ...current,
                [serverId]: {
                  layout: current[serverId]?.layout ?? null,
                  error: message,
                },
              }));
            },
          )
        : setSidebarByServer((current) => ({ ...current, [serverId]: { layout: null, error: null } }));
      const [summaries] = await Promise.all([
        step(
          "agents",
          Promise.all([reads.agents, reads.hidden, reads.colors]).then(([summaries, hiddenAgents, colors]) => {
            if (context.isCurrent()) {
              if (hiddenAgents !== undefined) applyHostHidden(serverId, hiddenAgents);
              if (colors !== undefined) applyHostColors(serverId, colors);
              replaceServerAgents(serverId, summaries);
            }
            return summaries;
          }),
        ),
        step("reads", conversationReads),
        sections,
      ]);
      if (!context.isCurrent()) return;
      loadOpenChats(
        serverId,
        summaries.map((agent) => agent.id),
        client,
        context,
      );
      context.stage = "connection";
    },
    [
      replaceServerAgents,
      applyHostHidden,
      applyHostColors,
      preferenceStore,
      readRefresh,
      conversationStore,
      channelStore,
      applySidebarLayout,
      applyConversationReads,
      liveState,
      syncSidebarPins,
      loadOpenChats,
      queryClient,
      queryScope,
      serverSync,
      syncCollections,
    ],
  );

  const registerConnection = useCallback((hostId: string, handle: ServerConnectionHandle | null) => {
    if (handle) connections.current.set(hostId, handle);
    else connections.current.delete(hostId);
    if (handle && quietStarts.current.delete(hostId)) handle.quietStart();
  }, []);
  const wakeHostedServer = useMemo(
    () =>
      createHostedServerWake((hostId) =>
        Effect.tryPromise((signal) =>
          fetchMobileAccount(
            { apiUrl: session.apiUrl, sessionToken: session.sessionToken },
            `/v2/hosting/servers/${encodeURIComponent(hostId)}/wake`,
            {
              method: "POST",
              signal,
            },
          ),
        ),
      ),
    [session.apiUrl, session.sessionToken],
  );
  const foregroundRef = useRef(foreground);
  foregroundRef.current = foreground;
  const sendApproval = useCallback(
    async (serverId: string, input: RespondToApprovalInput, approval: PendingApproval) => {
      const phone =
        input.decision === "accept" &&
        feedbackApproval(approval)?.phone === true &&
        hasCapability(serverCapabilities.current, serverId, PHONE_FEEDBACK_CAPABILITY)
          ? shownPhoneFeedback(approval)
          : null;
      try {
        await runTeamRequest(
          phone
            ? sendPhoneFeedback(teamApi(serverId), { requestId: input.requestId, phone })
            : respondToApproval(teamApi(serverId), input),
        );
        forgetPhoneFeedback(approval);
      } catch (error) {
        if (error instanceof InactiveRequestError)
          liveState.update("approvalRequests", (current) => dropApproval(current, serverId, input.requestId));
        throw error;
      }
      liveState.update("approvalRequests", (current) => dropApproval(current, serverId, input.requestId));
    },
    [teamApi, liveState],
  );
  const [hold, setHold] = useState<{ serverId: string | null } | null>(null);
  const othersHeld = hold !== null && hold.serverId === activeServerId;
  const handleServerUnavailable = useCallback((hostId: string) => {
    if (hostId === activeServerIdRef.current) setHold(null);
  }, []);
  const wakeReconnect = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(wakeReconnect.current), []);
  const limitFirstConnection = useCallback((hostId: string) => {
    if (
      !foregroundRef.current ||
      firstConnectionTimers.current.has(hostId) ||
      !serversRef.current.some((server) => server.id === hostId && server.initialConnectionPending)
    )
      return;
    firstConnectionTimers.current.set(
      hostId,
      setTimeout(() => {
        firstConnectionTimers.current.delete(hostId);
        setServers((current) =>
          current.some((server) => server.id === hostId && server.initialConnectionPending)
            ? current.map((server) =>
                server.id === hostId && server.initialConnectionPending
                  ? { ...server, initialConnectionPending: false }
                  : server,
              )
            : current,
        );
      }, FIRST_CONNECTION_WAIT_MS),
    );
  }, []);
  useEffect(() => {
    const timers = firstConnectionTimers.current;
    if (foreground) {
      for (const server of serversRef.current) {
        if (server.state === "connecting") limitFirstConnection(server.id);
      }
    }
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [foreground, limitFirstConnection]);
  const hostedServerStarting = useCallback((hostId: string) => {
    clearTimeout(wakeReconnect.current);
    wakeReconnect.current = setTimeout(() => connections.current.get(hostId)?.refresh(), WAKE_RECONNECT_DELAY_MS);
  }, []);
  const wakeSelectedServer = useCallback(
    (hostId: string) => {
      if (!foregroundRef.current || hostId !== activeServerIdRef.current) return;
      if (serversRef.current.find((server) => server.id === hostId)?.hosted !== true) return;
      void runTeamEffect(wakeHostedServer(hostId)).then((waking) => {
        if (!waking || hostId !== activeServerIdRef.current) return;
        hostedServerStarting(hostId);
      });
    },
    [wakeHostedServer, hostedServerStarting],
  );
  const wakeAttempts = useRef(new Map<string, number>());
  const [recoveryCountdowns] = useState(createRecoveryCountdowns);
  const handleConnectionStatus = useCallback(
    (hostId: string, status: RemoteRecoveryStatus, failure: RemoteConnectionFailure | null, resuming: boolean) => {
      recoveryCountdowns.publish(hostId, { status, message: remoteRecoveryMessage(status, failure?.message ?? null) });
      backgroundRefreshStatus(hostId, status);
      if (status.phase === "connecting") limitFirstConnection(hostId);
      setServers((current) => {
        const index = current.findIndex((server) => server.id === hostId);
        const server = current[index];
        if (!server) return current;
        const next = applyServerRecovery(server, status, failure?.message ?? null, failure, resuming);
        return sameServerRecovery(server, next) ? current : current.map((item, at) => (at === index ? next : item));
      });
      connectionWaits.setResuming(hostId, resuming && status.phase !== "online");
      if (status.phase === "online") {
        connectionWaits.settle(hostId, null);
        void queryClient.refetchQueries(
          {
            queryKey: queryKeys.chatMediaFiles(hostId),
            type: "active",
            predicate: (query) => query.state.status === "error" && isConnectionStop(query.state.error),
          },
          { cancelRefetch: false },
        );
      } else if (!resuming && status.phase !== "connecting")
        connectionWaits.settle(
          hostId,
          new ConnectionUnavailableError(sourceText("error.remote.selectedServerOffline")),
        );
      if (status.phase === "online" && hostId === activeServerIdRef.current) setHold(null);
      if (status.phase === "online") wakeAttempts.current.delete(hostId);
      if (status.phase !== "waiting" && status.phase !== "cooldown") return;
      if (!foregroundRef.current) return;
      if (wakeAttempts.current.get(hostId) === status.attempt) return;
      wakeAttempts.current.set(hostId, status.attempt);
      wakeSelectedServer(hostId);
    },
    [
      recoveryCountdowns,
      wakeSelectedServer,
      connectionWaits,
      limitFirstConnection,
      backgroundRefreshStatus,
      queryClient,
    ],
  );
  useEffect(() => {
    if (!foreground || !activeServerId) return;
    if (serversRef.current.find((server) => server.id === activeServerId)?.state === "offline") {
      wakeSelectedServer(activeServerId);
    }
  }, [foreground, activeServerId, wakeSelectedServer]);
  const focusUse = useMemo(
    () =>
      createFocusUsePing(
        (serverId) => void request("POST", FOCUS_USE_ROUTES.ping, ignoreResponse, {}, serverId).catch(() => undefined),
      ),
    [request],
  );
  const activeServerOnline = servers.some((server) => server.id === activeServerId && server.state === "online");
  useEffect(() => {
    const supported = hasCapability(serverCapabilities.current, activeServerId, FOCUS_USE_CAPABILITY);
    focusUse.setTarget(foreground && activeServerOnline && supported ? activeServerId : null);
  }, [focusUse, foreground, activeServerOnline, activeServerId]);
  useEffect(() => () => focusUse.dispose(), [focusUse]);

  useEffect(() => {
    if (!live) {
      loadGeneration.current += 1;
      conversationStore.cancelRequests();
      conversationStore.flush();
      for (const { id } of serversRef.current) persistServer(id);
      connectionWaits.dropAll(new ConnectionUnavailableError(sourceText("error.remote.appInBackground")));
    }
    directoryRefresh.setActive(live);
  }, [live, directoryRefresh, conversationStore, connectionWaits, persistServer]);

  useEffect(() => {
    if (!live) {
      setHold({ serverId: activeServerIdRef.current });
      return;
    }
    if (!activeServerIdRef.current) {
      setHold(null);
      return;
    }
    const timer = setTimeout(() => setHold(null), OTHER_SERVERS_RETURN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [live]);
  useEffect(() => {
    if (hold && hold.serverId !== activeServerId) setHold(null);
  }, [hold, activeServerId]);

  const startupFallback = useRef(true);
  const [startupWaitOver, setStartupWaitOver] = useState(false);
  const startServerListed = servers.some((server) => server.id === activeServerId);
  useEffect(() => {
    if (!startServerListed) return;
    const timer = setTimeout(() => setStartupWaitOver(true), STARTUP_SERVER_WAIT_MS);
    return () => clearTimeout(timer);
  }, [startServerListed]);
  useEffect(() => {
    if (!startupFallback.current) return;
    const active = servers.find((server) => server.id === activeServerId);
    if (active?.state === "online" || active?.hosted === true) {
      startupFallback.current = false;
      return;
    }
    if (active?.resuming === true) return;
    const activeFailed = active?.state === "offline" || active?.state === "error";
    if (!startupWaitOver && !activeFailed) return;
    const online = sortByPreference(servers).find((server) => !server.hidden && server.state === "online");
    if (!online) return;
    startupFallback.current = false;
    loadGeneration.current += 1;
    conversationStore.cancelRequests();
    setActiveServerId(online.id);
  }, [servers, activeServerId, startupWaitOver, sortByPreference, conversationStore]);

  const finishedChatLoads = useRef({ queues: new Map<string, Promise<void>>(), waiting: new Set<string>() });
  const loadFinishedChat = useCallback(
    (agentId: string, serverId: string) => {
      const loads = finishedChatLoads.current;
      if (loads.waiting.has(agentId)) return;
      loads.waiting.add(agentId);
      const queue = (loads.queues.get(serverId) ?? Promise.resolve())
        .then(() => {
          loads.waiting.delete(agentId);
          if (!foregroundRef.current || !conversationStore.get(agentId) || conversationStore.isUpToDate(agentId))
            return;
          return loadConversation(agentId, serverId).then(() => undefined);
        })
        .catch(() => undefined);
      loads.queues.set(serverId, queue);
    },
    [conversationStore, loadConversation],
  );

  const handleTeamEvent = useCallback(
    (serverId: string, event: RemoteTeamEvent) => {
      if (removedServers.current.has(serverId)) return;
      if (event.type === LIVE_VOICE_EVENT) {
        publishLiveVoiceEvent(serverId, event);
        return;
      }
      applyLiveActivityEvent(serverId, event);
      liveState.update("approvalRequests", (current) => {
        const previous = current[serverId] ?? [];
        const next = reducePendingApprovals(previous, event);
        return next === previous ? current : { ...current, [serverId]: next };
      });
      applyBrowserEvent(liveState, serverId, event);
      if (event.type === "sidebar-layout-changed") {
        applySidebarLayout(serverId, event.layout);
        return;
      }
      if (event.type === "hidden-agents-changed") {
        applyHostHidden(serverId, event.agents);
        return;
      }
      const chatContent = remoteChatContentEvent(event);
      if (chatContent) {
        queryClient.setQueryData<HostRemoteChatContent>(queryKeys.remoteChatContent(queryScope, serverId), {
          enabled: chatContent.enabled,
        });
        return;
      }
      const colors = agentColorsEvent(event);
      if (colors) {
        applyHostColors(serverId, colors.agents);
        return;
      }
      if (event.type === "sidebar-pins-changed") {
        if (!preferencesRef.current[serverId]?.pinsPending) applyHostSidebarPins(serverId, event.items);
        return;
      }
      if (event.type === "agent-notification-levels-changed") {
        setSyncedNotificationLevels(serverId, { server: event.server, agents: event.agents });
        return;
      }
      syncEventQueries(queryClient, queryScope, serverId, event);
      if (event.type === "channels-changed") channelStore.changed(serverId, event.channelId);
      if (
        event.type === "channels-changed" ||
        event.type === "channel-memories-changed" ||
        event.type === "channel-routines-changed"
      )
        return;
      if (event.type === "team-presence") {
        const signature = JSON.stringify(
          event.snapshot.members.map((member) => [member.id, member.role, member.disabled, member.online]),
        );
        if (presenceSignatures.current.get(serverId) !== signature) {
          presenceSignatures.current.set(serverId, signature);
          const members = event.snapshot.members.filter((member) => !member.disabled).length;
          setMemberCountByServer((current) =>
            current[serverId] === members ? current : { ...current, [serverId]: members },
          );
          rememberDrawerValues(serverId, { memberCount: members });
          void queryClient.invalidateQueries({ queryKey: queryKeys.serverMembers(queryScope, serverId) });
          void queryClient.invalidateQueries({ queryKey: queryKeys.serverInvites(queryScope, serverId) });
        }
        return;
      }
      const chatEvent = withoutTaskTurns(queryClient, queryScope, serverId, event);
      if (
        chatEvent &&
        (chatEvent.type !== "conversation" ||
          chatEvent.snapshot.revision >= (conversationStore.get(chatEvent.snapshot.agentId)?.revision ?? 0))
      ) {
        liveState.update("activityByServer", (current) => {
          const previous = current[serverId] ?? {};
          const next = reduceAgentActivity(previous, chatEvent);
          return next === previous ? current : { ...current, [serverId]: next };
        });
      }
      liveState.update("contextByServer", (current) => {
        const previous = current[serverId] ?? NO_CONTEXT_STATES;
        const next = reduceContextStates(previous, event);
        return next === previous ? current : { ...current, [serverId]: next };
      });
      liveState.update("threadWaitsByServer", (current) => {
        const previous = current[serverId] ?? [];
        const next = reduceThreadWaits(previous, event, taskThreadCheck(queryClient, queryScope, serverId));
        return next === previous ? current : { ...current, [serverId]: next };
      });
      if (event.type === "turn-progress") {
        const { agentId, threadId, turnId, detail } = event;
        const messages =
          taskThreadMessages(queryClient, queryScope, serverId, agentId, threadId) ??
          conversationStore.get(agentId)?.messages ??
          [];
        const after = latestThoughtId(messages, turnId);
        liveState.update("turnLinesByServer", (current) => {
          const previous = current[serverId] ?? {};
          const next = appendTurnStepLine(previous, turnId, detail, after);
          return next === previous ? current : { ...current, [serverId]: next };
        });
      }
      if (
        event.type === "conversation" ||
        event.type === "conversation-invalidated" ||
        event.type === "turn-completed"
      ) {
        void refreshConversationReads(serverId).catch(() => undefined);
      }
      if (event.type === "agents-changed") {
        replaceServerAgents(serverId, event.agents.map(remoteAgentOf));
      } else if (event.type === "conversation") {
        const knownIds = serverAgentIds.current.get(serverId) ?? new Set<string>();
        knownIds.add(event.snapshot.agentId);
        serverAgentIds.current.set(serverId, knownIds);
        const { agentId, revision, threadId } = event.snapshot;
        if (
          conversationStore.get(agentId) &&
          !conversationStore.holdsRevision(agentId, revision, threadId) &&
          conversationStore.invalidate(agentId)
        )
          void loadConversation(agentId, serverId, true).catch(() => undefined);
      } else if (event.type === "conversation-delta") {
        conversationStore.enqueue(event);
      } else if (event.type === "conversation-page") {
        const readState = event.page.readState;
        if (readState) {
          readRefresh.invalidate(serverId);
          applyConversationReads({ [event.page.agentId]: readState });
        } else void refreshConversationReads(serverId).catch(() => undefined);
        if (conversationStore.get(event.page.agentId)) {
          conversationStore.applyPage(event.page);
          refreshOpenExchanges(event.page.agentId, serverId);
        }
      } else if (event.type === "conversation-invalidated") {
        if (
          conversationStore.get(event.agentId) &&
          !conversationStore.holdsRevision(event.agentId, event.revision) &&
          conversationStore.invalidate(event.agentId)
        )
          void loadConversation(event.agentId, serverId, true).catch(() => undefined);
      } else if (event.type === "turn-completed") {
        if (conversationStore.get(event.agentId)) {
          if (conversationStore.invalidate(event.agentId))
            void loadConversation(event.agentId, serverId).catch(() => undefined);
          else if (!event.quiet && !event.continues) loadFinishedChat(event.agentId, serverId);
        }
      } else if (event.type === "team-identity") {
        setServers((current) =>
          current.map((server) =>
            server.id === serverId ? { ...server, name: event.serverName, logoKey: event.logoVersion } : server,
          ),
        );
      } else if (event.type === "host-appearance") {
        const { appearance } = event;
        setServers((current) => current.map((server) => (server.id === serverId ? { ...server, appearance } : server)));
      }
    },
    [
      liveState,
      applyLiveActivityEvent,
      channelStore,
      applySidebarLayout,
      applyHostHidden,
      applyHostColors,
      loadConversation,
      loadFinishedChat,
      refreshOpenExchanges,
      replaceServerAgents,
      conversationStore,
      refreshConversationReads,
      readRefresh,
      queryClient,
      queryScope,
      applyConversationReads,
      applyHostSidebarPins,
    ],
  );
  const syncedWorkflows = useRef(new Map<string, ReadonlyMap<string, WorkflowSummary>>());
  useEffect(() => {
    const kept = (serverId: string) => !removedServers.current.has(serverId);
    syncHandlers.current = {
      agents: (serverId, summaries) => {
        if (!kept(serverId)) return;
        const layout = syncCollections.sidebarLayout.synced(serverId);
        const previousIds = agentsRef.current.filter((agent) => agent.serverId === serverId).map((agent) => agent.id);
        replaceServerAgents(
          serverId,
          orderSyncedAgents(summaries, previousIds, layout ? syncedSnapshot(layout) : undefined),
        );
        invalidateAgentsChangedQueries(queryClient, queryScope, serverId);
      },
      hiddenAgents: (serverId, snapshot) => {
        if (kept(serverId)) applyHostHidden(serverId, snapshot.agents);
      },
      sidebarPins: (serverId, snapshot) => {
        if (kept(serverId) && !preferencesRef.current[serverId]?.pinsPending)
          applyHostSidebarPins(serverId, snapshot.items);
      },
      sidebarLayout: (serverId, snapshot) => {
        if (kept(serverId)) applySidebarLayout(serverId, snapshot);
      },
      notificationLevels: (serverId, snapshot) => {
        if (kept(serverId)) setSyncedNotificationLevels(serverId, snapshot);
      },
      conversationReads: (serverId) => {
        if (kept(serverId)) void refreshConversationReads(serverId).catch(() => undefined);
      },
      routines: (serverId, agentId, routines) => {
        if (kept(serverId))
          queryClient.setQueryData(queryKeys.agentRecord(queryScope, serverId, agentId, "routines"), [...routines]);
      },
      workflows: (serverId, list) => {
        if (!kept(serverId)) {
          syncedWorkflows.current.delete(serverId);
          return;
        }
        const queryKey = queryKeys.workflowList(queryScope, serverId);
        if (queryClient.getQueryData(queryKey) !== undefined) queryClient.setQueryData(queryKey, [...list]);
        const previous = syncedWorkflows.current.get(serverId);
        const next = new Map(list.map((workflow) => [workflow.id, workflow]));
        syncedWorkflows.current.set(serverId, next);
        const changed = previous
          ? [...new Set([...previous.keys(), ...next.keys()])].filter((id) => previous.get(id) !== next.get(id))
          : [...next.keys()];
        for (const workflowId of changed)
          void queryClient.invalidateQueries({ queryKey: queryKeys.workflow(queryScope, serverId, workflowId) });
      },
      queue: (serverId, agentId, snapshot) => {
        if (!kept(serverId)) return;
        const queryKey = queryKeys.chatQueue(serverId, agentId);
        void queryClient.cancelQueries({ queryKey }).then(() => queryClient.setQueryData(queryKey, snapshot));
      },
      conversationLog: (serverId, agentId) => {
        if (kept(serverId) && conversationStore.get(agentId) && conversationStore.invalidate(agentId))
          void loadConversation(agentId, serverId, true).catch(() => undefined);
      },
    };
    return () => {
      syncHandlers.current = null;
    };
  }, [
    replaceServerAgents,
    applyHostHidden,
    applyHostSidebarPins,
    applySidebarLayout,
    refreshConversationReads,
    queryClient,
    queryScope,
    syncCollections,
    conversationStore,
    loadConversation,
  ]);

  const updatePreferences = useCallback(
    (serverId: string, change: (current: RemoteWorkspacePreferences) => RemoteWorkspacePreferences) => {
      try {
        const previous = preferenceStore.read(serverId);
        const next = change(previous);
        preferenceStore.write(serverId, next);
        setPreferences((current) => ({ ...current, [serverId]: next }));
        if (sidebarPinsChanged(next, previous)) pushSidebarPins(serverId);
        return next;
      } catch (error) {
        showPreferencesFailure(error);
        return null;
      }
    },
    [preferenceStore, pushSidebarPins],
  );
  const changeHostHidden = useCallback(
    (serverId: string, agentId: string, hidden: boolean) => {
      const change = (current: Record<string, string[]>, hide: boolean) => {
        const ids = current[serverId] ?? NO_IDS;
        if (ids.includes(agentId) === hide) return current;
        return { ...current, [serverId]: hide ? [...ids, agentId] : ids.filter((id) => id !== agentId) };
      };
      setHostHidden((current) => change(current, hidden));
      const action = hidden ? "hide" : "unhide";
      void writeHostAgentHidden(teamApi(serverId), { agentId, hidden }).then(
        (agents) => {
          applyHostHidden(serverId, agents);
          mobileAnalytics.track("conversation_action", { action, result: "succeeded" });
        },
        (error: unknown) => {
          if (!removedServers.current.has(serverId)) setHostHidden((current) => change(current, !hidden));
          mobileAnalytics.track("conversation_action", { action, result: "failed" });
          const text = currentText();
          showFailureAlert(
            error,
            "agent",
            text.t(hidden ? "mobile.agent.menu.hideFailed" : "mobile.agent.hidden.showFailed"),
            text.errorMessage(error, text.t("mobile.agent.menu.actionFailed")),
          );
        },
      );
    },
    [teamApi, applyHostHidden],
  );

  const forgetServer = useCallback(
    (serverId: string) => {
      dropServerState(new Set([serverId]));
      directoryGeneration.current += 1;
      directoryRefresh.invalidate();
      setServerDirectoryState("ready");
      setServerDirectoryError(null);
      if (activeServerIdRef.current === serverId) {
        loadGeneration.current += 1;
        const remaining = serversRef.current.filter((candidate) => candidate.id !== serverId && !candidate.hidden);
        setActiveServerId(sortByPreference(remaining)[0]?.id ?? null);
      }
      setServers((current) => current.filter((candidate) => candidate.id !== serverId));
      updatePreferences(serverId, () => ({ hidden: [], pinned: [] }));
    },
    [dropServerState, directoryRefresh, sortByPreference, updatePreferences],
  );

  const hostRequests = useMemo(
    () =>
      createHostRequestActions({
        request,
        teamApi,
        queryClient,
        queryScope,
        capabilities: serverCapabilities.current,
        attachmentDownloads,
        largeAttachmentDownloads,
        synced: syncCollections,
      }),
    [request, teamApi, queryClient, queryScope, attachmentDownloads, largeAttachmentDownloads, syncCollections],
  );
  useSyncedNotificationLevelsLoader({
    servers,
    foreground,
    supports: hostRequests.checks.canSetAgentNotificationLevel,
    load: hostRequests.actions.loadAgentNotificationLevels,
  });
  const workflows = useMemo(
    () =>
      createWorkflowActions({
        request,
        capabilities: serverCapabilities.current,
        loadAgentModels: hostRequests.actions.loadAgentModels,
        synced: syncCollections,
      }),
    [request, hostRequests, syncCollections],
  );
  const browser = useMemo(
    () =>
      createBrowserActions({
        request,
        liveState,
        client: (serverId) => connections.current.get(serverId)?.client,
        capabilities: serverCapabilities.current,
      }),
    [request, liveState],
  );

  const actions = useMemo<MobileWorkspaceActions>(() => {
    const currentActiveServer = () =>
      serversRef.current.find((server) => server.id === activeServerIdRef.current) ?? EMPTY_SERVER;
    const currentPinnedAgentIds = () =>
      (activeServerIdRef.current ? preferencesRef.current[activeServerIdRef.current]?.pinned : null) ?? NO_IDS;
    const agentServerId = (agentId: string, targetServerId: string | undefined) => {
      const serverId = targetServerId ?? agentsRef.current.find((candidate) => candidate.id === agentId)?.serverId;
      if (!serverId) throw new Error(currentText().t("mobile.workspace.error.agentUnavailable"));
      return serverId;
    };
    const putAgent = (serverId: string, updated: RemoteAgent) =>
      setAgents((current) =>
        current.map((agent) =>
          agent.id === updated.id && agent.serverId === serverId
            ? projectAgent(
                serverId,
                { ...updated, pendingRuntime: updated.pendingRuntime ?? agent.pendingRuntime },
                hostColors.current[serverId]?.[updated.id] ?? null,
              )
            : agent,
        ),
      );
    const showAgentRuntime = (serverId: string, { agentId, provider, model, reasoningEffort }: UpdateAgentInput) => {
      const previous = agentsRef.current.find((agent) => agent.id === agentId && agent.serverId === serverId);
      if (!previous || (provider === undefined && model === undefined && reasoningEffort === undefined))
        return () => undefined;
      const shown = {
        provider: provider ?? previous.provider,
        foreignProvider: provider === undefined ? previous.foreignProvider : undefined,
        model: model ?? previous.model,
        reasoningEffort: reasoningEffort ?? previous.reasoningEffort,
      };
      const kept = {
        provider: previous.provider,
        foreignProvider: previous.foreignProvider,
        model: previous.model,
        reasoningEffort: previous.reasoningEffort,
      };
      const target = (agent: MobileAgent) => agent.id === agentId && agent.serverId === serverId;
      setAgents((current) => current.map((agent) => (target(agent) ? { ...agent, ...shown } : agent)));
      return () =>
        setAgents((current) =>
          current.map((agent) =>
            target(agent) &&
            agent.provider === shown.provider &&
            agent.foreignProvider === shown.foreignProvider &&
            agent.model === shown.model &&
            agent.reasoningEffort === shown.reasoningEffort
              ? { ...agent, ...kept }
              : agent,
          ),
        );
    };
    const showQueuedRuntime = (serverId: string, change: Record<string, string>) => {
      const target = (agent: MobileAgent) => agent.id === change.agentId && agent.serverId === serverId;
      const previous = agentsRef.current.find(target);
      const next = previous?.pendingRuntime ?? previous;
      const provider = change.provider ?? next?.provider;
      const model = change.model ?? next?.model;
      const reasoningEffort = change.reasoningEffort ?? next?.reasoningEffort;
      if (!previous || !isAgentProvider(provider) || !isAgentModel(model) || !isReasoningEffort(reasoningEffort))
        return () => undefined;
      const accountId =
        change.providerAccountId ??
        (provider === next?.provider ? previous.pendingRuntime?.providerAccountId : undefined);
      const shown: AgentPendingRuntime = {
        provider,
        model,
        reasoningEffort,
        ...(accountId === undefined || accountId === DEFAULT_PROVIDER_ACCOUNT_ID
          ? {}
          : { providerAccountId: accountId }),
      };
      setAgents((current) => current.map((agent) => (target(agent) ? { ...agent, pendingRuntime: shown } : agent)));
      return () =>
        setAgents((current) =>
          current.map((agent) =>
            target(agent) && agent.pendingRuntime === shown
              ? { ...agent, pendingRuntime: previous.pendingRuntime }
              : agent,
          ),
        );
    };
    const workspace: MobileWorkspaceActions = {
      ...workflows,
      openBrowserView: browser.openBrowserView,
      remoteDesktopConnection: (serverId) => connections.current.get(serverId)?.client ?? null,
      controlBrowserTab: browser.controlBrowserTab,
      answerBrowserPermission: browser.answerBrowserPermission,
      answerBrowserHttpSignIn: browser.answerBrowserHttpSignIn,
      mutateSidebarLayout: async (serverId, action) => {
        requireSidebarLayout(
          serverCapabilities.current,
          serverId,
          serversRef.current.find((server) => server.id === serverId),
        );
        const layout = await request(
          "POST",
          hasCapability(serverCapabilities.current, serverId, SIDEBAR_FOLDERS_CAPABILITY)
            ? SIDEBAR_FOLDERS_ROUTES.actions
            : TEAM_API_ROUTES.sidebarLayout.actions,
          decodeSidebarLayout,
          action,
          serverId,
        );
        applySidebarLayout(serverId, layout);
      },
      moveSidebarChat: async (serverId, action) => {
        requireSidebarLayout(
          serverCapabilities.current,
          serverId,
          serversRef.current.find((server) => server.id === serverId),
        );
        const previous = sidebarByServerRef.current[serverId]?.layout;
        const moved = previous ? moveSidebarChat(previous, action) : null;
        if (moved) setSidebarByServer((current) => ({ ...current, [serverId]: { layout: moved, error: null } }));
        try {
          const layout = await request(
            "POST",
            action.type === "assign" && hasCapability(serverCapabilities.current, serverId, SIDEBAR_FOLDERS_CAPABILITY)
              ? SIDEBAR_FOLDERS_ROUTES.actions
              : TEAM_API_ROUTES.sidebarLayout.actions,
            decodeSidebarLayout,
            action,
            serverId,
          );
          applySidebarLayout(serverId, layout);
        } catch (error) {
          if (previous && moved)
            setSidebarByServer((current) =>
              current[serverId]?.layout === moved
                ? { ...current, [serverId]: { layout: previous, error: null } }
                : current,
            );
          throw error;
        }
      },
      reorderServers,
      channelStore,
      syncCollections,
      teamDirectory: directory,
      conversationStore,
      liveState,
      respondToApproval: async (serverId, input) => {
        const pending = liveState
          .get()
          .approvalRequests[serverId]?.find((item) => String(item.requestId) === String(input.requestId));
        if (!pending) throw new InactiveRequestError(currentText().t("mobile.workspace.error.approvalInactive"));
        if (!showsOnline(serversRef.current.find((server) => server.id === serverId)))
          throw new Error(currentText().t("mobile.workspace.error.approvalOffline"));
        await sendApproval(serverId, input, pending);
      },
      readsWholeApprovals: (serverId) =>
        hasCapability(serverCapabilities.current, serverId, PENDING_APPROVAL_CAPABILITY),
      readWholeApproval: async (serverId, approval) => {
        if (!hasCapability(serverCapabilities.current, serverId, PENDING_APPROVAL_CAPABILITY)) return;
        const read = () =>
          runTeamRequest(
            readPendingApproval(teamApi(serverId), { agentId: approval.agentId, requestId: approval.requestId }),
          );
        const whole = await read()
          .catch(async (error: unknown) => {
            if (!(error instanceof Error) || !isConnectionStop(error)) throw error;
            await connectionWaits.whenOnlineAgain(serverId);
            return read();
          })
          .catch((error: unknown) => {
            if (error instanceof InactiveRequestError)
              liveState.update("approvalRequests", (current) => dropApproval(current, serverId, approval.requestId));
            throw error;
          });
        liveState.update("approvalRequests", (current) => {
          const previous = current[serverId];
          if (!previous) return current;
          const next = withWholeApproval(previous, whole);
          return next === previous ? current : { ...current, [serverId]: next };
        });
      },
      respondToBrowserTakeover: (serverId, input) => runTeamRequest(respondToBrowserTakeover(teamApi(serverId), input)),
      respondToBrowserSecret: (serverId, input) => runTeamRequest(respondToBrowserSecret(teamApi(serverId), input)),
      selectServer: (id) => {
        startupFallback.current = false;
        loadGeneration.current += 1;
        conversationStore.cancelRequests();
        setActiveServerId(id);
      },
      leaveServer: async (serverId) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || server.role === "owner")
          throw new Error(currentText().t("mobile.workspace.error.leaveOwnServer"));
        await runTeamEffect(directory.leaveHost(server.id, server.membershipId));
        forgetServer(serverId);
      },
      removeServer: async (serverId) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (server?.role !== "owner") throw new Error(currentText().t("mobile.workspace.error.removeOwnedServerOnly"));
        await runTeamEffect(directory.removeOwnedHost(server.id));
        setLocalServerLinks((current) =>
          current.computers.has(serverId)
            ? { computers: new Set([...current.computers].filter((id) => id !== serverId)), parents: current.parents }
            : current,
        );
        forgetServer(serverId);
      },
      setServerHidden: async (serverId, hidden) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || (server.hidden === true) === hidden) return;
        const others = sortByPreference(
          serversRef.current.filter((candidate) => candidate.id !== serverId && !candidate.hidden),
        );
        if (hidden && others.length === 0) return;
        const apply = (value: boolean) =>
          setServers((current) =>
            current.map((candidate) => (candidate.id === serverId ? serverWithHidden(candidate, value) : candidate)),
          );
        pendingHidden.current.set(serverId, hidden);
        apply(hidden);
        const previousActive = activeServerIdRef.current;
        const activeShown = others.some((candidate) => candidate.id === previousActive);
        const nextActive = hidden ? (others[0]?.id ?? null) : serverId;
        const switches = hidden ? previousActive === serverId : !activeShown;
        const select = (id: string | null) => {
          startupFallback.current = false;
          loadGeneration.current += 1;
          conversationStore.cancelRequests();
          setActiveServerId(id);
        };
        if (switches) select(nextActive);
        try {
          await runTeamEffect(directory.setHostHidden(serverId, hidden));
        } catch (error) {
          pendingHidden.current.delete(serverId);
          apply(!hidden);
          if (switches && activeServerIdRef.current === nextActive) select(previousActive);
          throw error;
        }
        const kept = keptHosts.current;
        if (kept) keepHosts(kept.map((host) => (host.hostId === serverId ? hostWithHidden(host, hidden) : host)));
        await refreshMemberships().catch(() => undefined);
        pendingHidden.current.delete(serverId);
      },
      refreshServer: async (serverId) => {
        connections.current.get(serverId)?.refresh();
        await refreshHosts();
      },
      reconnectServer: async (serverId) => {
        connections.current.get(serverId)?.reconnect();
        await refreshHosts();
      },
      hostedServerStarting,
      updateServerIdentity: async (serverId, input) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || !canAdministerServer(server.role))
          throw new Error(currentText().t("mobile.server.settings.identityNotAllowed"));
        requireCapability(
          serverCapabilities.current,
          serverId,
          HOST_ADMIN_CAPABILITY,
          "mobile.server.settings.identityUnsupported",
        );
        await runTeamRequest(updateHostIdentity(teamApi(serverId), input));
        if (input.serverName !== undefined) {
          const serverName = input.serverName;
          setServers((current) =>
            current.map((candidate) => (candidate.id === serverId ? { ...candidate, name: serverName } : candidate)),
          );
        }
        await refreshMemberships().catch(() => undefined);
      },
      setServerAppearance: async (serverId, appearance) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (!server || !canAdministerServer(server.role))
          throw new Error(currentText().t("mobile.server.settings.identityNotAllowed"));
        requireCapability(
          serverCapabilities.current,
          serverId,
          HOST_APPEARANCE_CAPABILITY,
          "mobile.server.settings.identityUnsupported",
        );
        await runTeamRequest(setHostAppearance(teamApi(serverId), appearance));
        setServers((current) =>
          current.map((candidate) => (candidate.id === serverId ? { ...candidate, appearance } : candidate)),
        );
      },
      rotateServerKey: async (serverId) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (server?.role !== "owner") throw new Error(currentText().t("mobile.server.settings.keyOwnerOnly"));
        requireCapability(
          serverCapabilities.current,
          serverId,
          HOST_KEY_ROTATION_CAPABILITY,
          "mobile.server.settings.keyUnsupported",
        );
        const rotated = await runTeamRequest(rotateHostKey(teamApi(serverId)));
        await refreshMemberships().catch(() => undefined);
        return rotated;
      },
      reloadServerList: () => refreshHosts(),
      listLocalServers: async (serverId) => {
        requireCapability(
          serverCapabilities.current,
          serverId,
          LOCAL_SERVERS_CAPABILITY,
          "mobile.server.local.unsupported",
        );
        const list = await runTeamRequest(listHostLocalServers(teamApi(serverId)));
        linkLocalServers(serverId, list);
        return list;
      },
      createLocalServer: async (serverId, name) => {
        const server = serversRef.current.find((candidate) => candidate.id === serverId);
        if (server?.role !== "owner") throw new Error(currentText().t("mobile.server.local.ownerOnly"));
        requireCapability(
          serverCapabilities.current,
          serverId,
          LOCAL_SERVERS_CAPABILITY,
          "mobile.server.local.unsupported",
        );
        const created = await runTeamRequest(createHostLocalServer(teamApi(serverId), name));
        setLocalServerLinks((current) => ({
          computers: current.computers,
          parents: new Map(current.parents).set(created.serverId, serverId),
        }));
        await refreshMemberships().catch(() => undefined);
        return created;
      },
      deleteLocalServer: async (serverId) => {
        const computerId = localServerLinksRef.current.parents.get(serverId);
        const computer = serversRef.current.find((candidate) => candidate.id === computerId);
        if (!computerId || !computer || !showsOnline(computer))
          throw new Error(currentText().t("mobile.server.local.deleteOffline"));
        await runTeamRequest(deleteHostLocalServer(teamApi(computerId), serverId));
        setLocalServerLinks((current) => {
          const parents = new Map(current.parents);
          parents.delete(serverId);
          return { computers: current.computers, parents };
        });
        forgetServer(serverId);
        await refreshMemberships().catch(() => undefined);
      },
      refreshServers: async () => {
        for (const connection of connections.current.values()) connection.refresh();
        await refreshHosts();
      },
      addRemoteServer: async ({ inviteUrl }) => {
        const host = await runTeamEffect(directory.acceptInvite(inviteUrl));
        directoryGeneration.current += 1;
        directoryRefresh.invalidate();
        removedServers.current.delete(host.hostId);
        setServers((current) => [
          ...current.filter((server) => server.id !== host.hostId),
          serverFromHost(host, "remote"),
        ]);
        startupFallback.current = false;
        setActiveServerId(host.hostId);
        void refreshHosts().catch(() => undefined);
        return host.hostId;
      },
      ...hostRequests.actions,
      loadAgentAnalytics: async (input, serverId) => {
        if (!agentsRef.current.some((agent) => agent.id === input.agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentNotOnHost"));
        return runTeamRequest(
          readAgentAnalytics(
            (method, path, decode) => request(method, path, decode, undefined, serverId),
            serverCapabilities.current.get(serverId) ?? [],
            input,
          ),
        );
      },
      createAgent: async (input: NewAgentInput) => {
        const serverId = currentActiveServer().id;
        const firstTask = input.firstTask?.trim() ?? "";
        const welcome = hasCapability(serverCapabilities.current, serverId, AGENT_WELCOME_CAPABILITY);
        const body = {
          name: input.name,
          description: input.description,
          avatarSeed: input.avatarSeed,
          avatarHue: input.avatarHue,
          initialMessage: agentInitialMessage(
            input.description,
            firstTask,
            welcome ? { locale: currentText().locale } : null,
          ),
          ...(input.provider &&
          input.model &&
          hasCapability(serverCapabilities.current, serverId, TEAM_AGENT_CREATE_MODEL_CAPABILITY)
            ? {
                provider: input.provider,
                model: input.model,
                ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
              }
            : {}),
        };
        const operation = hasCapability(serverCapabilities.current, serverId, AGENT_CREATE_OPERATION_CAPABILITY)
          ? createOperationId([serverId, body])
          : null;
        const created = await request(
          "POST",
          TEAM_API_ROUTES.agents.all,
          decodeAgent,
          operation ? { ...body, operationId: operation.id } : body,
        ).catch((error: unknown) => {
          operation?.failed();
          throw error;
        });
        setAgents((current) => [
          ...current.filter((agent) => agent.id !== created.id),
          projectAgent(serverId, created, null),
        ]);
        if (input.avatarColor && hostKeepsAgentColors(serverCapabilities.current.get(serverId))) {
          await writeHostAgentColor(teamApi(serverId), created.id, input.avatarColor).then(
            (colors) => applyHostColors(serverId, colors),
            () => supportLog.add("warn", "app", "The new agent's colour was not saved."),
          );
        }
        if (welcome && firstTask)
          await request(
            "POST",
            TEAM_API_ROUTES.agent.messages(created.id),
            (value) => {
              if (!isQueuedMessageReceipt(value)) throw new Error("The host returned an invalid message receipt.");
              return value;
            },
            {
              text: firstTask,
              attachmentDraftIds: [],
              replyToMessageId: null,
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              clientMessageId: Crypto.randomUUID(),
            },
            serverId,
          ).catch((error: unknown) => {
            supportLog.add("warn", "app", "The new agent's first task was not sent.");
            const text = currentText();
            showFailureAlert(
              error,
              "agent",
              text.t("mobile.chat.outbox.failed"),
              text.errorMessage(error, text.t("mobile.onboarding.task.sendFailed")),
            );
          });
        return created.id;
      },
      updateAgent: async (input: UpdateAgentInput, serverId = activeServerIdRef.current ?? undefined) => {
        if (!serverId || !agentsRef.current.some((agent) => agent.id === input.agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentUnavailableOnHost"));
        const { avatarColor, avatarHue, providerAccountId, ...other } = input;
        const runtimeFieldChanged =
          providerAccountId !== undefined ||
          other.provider !== undefined ||
          other.model !== undefined ||
          other.reasoningEffort !== undefined;
        const runtimeChange =
          runtimeFieldChanged && hasCapability(serverCapabilities.current, serverId, AGENT_PENDING_RUNTIME_CAPABILITY)
            ? pendingRuntimeUpdateBody({
                agentId: input.agentId,
                provider: input.provider,
                model: input.model,
                reasoningEffort: input.reasoningEffort,
                providerAccountId,
              })
            : null;
        const { provider: _provider, model: _model, reasoningEffort: _reasoningEffort, ...profile } = other;
        const fields = runtimeChange ? profile : other;
        const color = avatarColor !== undefined ? avatarColor : avatarHue === undefined ? undefined : null;
        const colorRoute = color !== undefined && hostKeepsAgentColors(serverCapabilities.current.get(serverId));
        const payload = updateAgentPayload(
          colorRoute && color !== null ? fields : { ...fields, ...(avatarHue === undefined ? {} : { avatarHue }) },
        );
        let undoRuntime = runtimeChange ? () => undefined : showAgentRuntime(serverId, input);
        try {
          if (Object.keys(payload).length > 1 || (!colorRoute && !runtimeChange && providerAccountId === undefined)) {
            const updated = await request(
              "PATCH",
              TEAM_API_ROUTES.agent.one(input.agentId),
              decodeAgent,
              payload,
              serverId,
            );
            putAgent(serverId, updated);
            undoRuntime = () => undefined;
          }
          if (colorRoute && color !== undefined && (color !== null || hostColors.current[serverId]?.[input.agentId]))
            applyHostColors(serverId, await writeHostAgentColor(teamApi(serverId), input.agentId, color));
          if (runtimeChange) {
            undoRuntime = showQueuedRuntime(serverId, runtimeChange);
            await request("POST", AGENT_PENDING_RUNTIME_ROUTES.update, ignoreResponse, runtimeChange, serverId);
          } else if (providerAccountId !== undefined)
            await hostRequests.actions.setAgentProviderAccount(
              { agentId: input.agentId, accountId: providerAccountId },
              serverId,
            );
        } catch (error) {
          undoRuntime();
          throw error;
        }
      },
      setAgentAvatar: async (agentId, image, serverId) => {
        if (!agentsRef.current.some((agent) => agent.id === agentId && agent.serverId === serverId))
          throw new Error(currentText().t("mobile.workspace.error.agentUnavailableOnHost"));
        const updated = await request(
          image ? "PUT" : "DELETE",
          TEAM_API_ROUTES.agent.avatar(agentId),
          decodeAgent,
          undefined,
          serverId,
          image ?? undefined,
        );
        if (image && updated.avatarUrl) {
          queryClient.setQueryData(
            queryKeys.agentAvatar(queryScope, serverId, agentId, updated.avatarUrl),
            saveAgentAvatar(serverId, agentId, updated.avatarUrl, `data:${image.mimeType};base64,${image.base64}`),
          );
        }
        putAgent(serverId, updated);
      },
      deleteAgent: (agentId, serverId) => runTeamRequest(deleteAgent(teamApi(serverId), agentId)),
      interruptTurn: (agentId, turnId, serverId) =>
        runTeamRequest(interruptAgentTurn(teamApi(serverId), agentId, turnId)),
      loadConversation,
      loadConversationAround,
      loadLatestMessages,
      loadOlderMessages,
      uploadAttachment: async (agentId, input, targetServerId, onProgress) => {
        const serverId = agentServerId(agentId, targetServerId);
        return runTeamRequest(uploadAttachmentDraft(teamApi(serverId, onProgress), input));
      },
      discardAttachment: async (agentId, attachmentId, targetServerId) => {
        const serverId = agentServerId(agentId, targetServerId);
        await runTeamRequest(discardAttachmentDraft(teamApi(serverId), attachmentId));
      },
      sendMessage: async (
        agentId,
        text,
        attachmentDraftIds = [],
        replyToMessageId = null,
        targetServerId,
        clientMessageId,
      ) => {
        const serverId = agentServerId(agentId, targetServerId);
        const receipt = await request(
          "POST",
          TEAM_API_ROUTES.agent.messages(agentId),
          (value) => {
            if (!isQueuedMessageReceipt(value)) throw new Error("The host returned an invalid message receipt.");
            return value;
          },
          {
            text,
            attachmentDraftIds,
            replyToMessageId,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(clientMessageId ? { clientMessageId } : {}),
          },
          serverId,
        );
        return conversationMessageId(receipt, agentId);
      },
      respondToPrompt: async (agentId, input) => {
        const agent = agentsRef.current.find((candidate) => candidate.id === agentId);
        const agentServer = serversRef.current.find((server) => server.id === agent?.serverId);
        const snapshot = conversationStore.get(agentId);
        const waits = (agentServer ? liveState.get().threadWaitsByServer[agentServer.id] : undefined) ?? [];
        const message = snapshot?.messages.find(
          (item) =>
            item.questionPrompt?.requestId === input.requestId &&
            item.questionPrompt.resolution === null &&
            ((Boolean(snapshot.activeTurnId) && item.turnId === snapshot.activeTurnId) ||
              hostAwaitsQuestion(waits, agentId, item.turnId, input.requestId)),
        );
        const hostWaits = waits.some(
          (wait) =>
            wait.reason === "question" &&
            wait.agentId === agentId &&
            String(wait.requestId) === String(input.requestId),
        );
        if (!agentServer || !showsOnline(agentServer) || (!message?.questionPrompt && !hostWaits)) {
          throw new Error(currentText().t("mobile.workspace.error.formUnavailable"));
        }
        await request(
          "POST",
          TEAM_API_ROUTES.respond.prompt,
          ignoreResponse,
          { requestId: input.requestId, answers: input.answers },
          agentServer.id,
        );
        void loadConversation(agentId, agentServer.id).catch(() => undefined);
      },
      hideAgent: (agentId) => {
        const server = currentActiveServer();
        const serverId = server.id;
        if (hostOwnsHide(serverCapabilities.current.get(serverId), server.role)) {
          if (preferencesRef.current[serverId]?.pinned.includes(agentId))
            updatePreferences(serverId, (current) => ({
              ...current,
              pinned: current.pinned.filter((id) => id !== agentId),
            }));
          if (!hostHiddenRef.current[serverId]?.includes(agentId)) changeHostHidden(serverId, agentId, true);
          return;
        }
        const saved = updatePreferences(serverId, (current) => ({
          ...current,
          hidden: [...new Set([...current.hidden, agentId])],
          pinned: current.pinned.filter((id) => id !== agentId),
        }));
        mobileAnalytics.track("conversation_action", { action: "hide", result: saved ? "succeeded" : "failed" });
      },
      unhideAgent: (agentId) => {
        const serverId = currentActiveServer().id;
        const saved = updatePreferences(serverId, (current) => ({
          ...current,
          hidden: current.hidden.filter((id) => id !== agentId),
        }));
        if (
          hostOwnsHide(serverCapabilities.current.get(serverId), currentActiveServer().role) &&
          hostHiddenRef.current[serverId]?.includes(agentId)
        ) {
          changeHostHidden(serverId, agentId, false);
          return;
        }
        mobileAnalytics.track("conversation_action", { action: "unhide", result: saved ? "succeeded" : "failed" });
      },
      markAgentRead,
      markAllRead: async () => {
        const serverId = activeServerIdRef.current;
        const results = await Promise.allSettled([
          markAllRead(),
          serverId ? channelStore.markAllRead(serverId, Crypto.randomUUID) : undefined,
        ]);
        const failure = results.find((result) => result.status === "rejected");
        if (failure) throw failure.reason;
      },
      markAgentUnread: (agentId) => {
        markAgentRead(agentId, null);
      },
      markAgentUnreadFrom,
      hideChannel: (id, serverId) =>
        Boolean(updatePreferences(serverId, (current) => setChannelHidden(current, id, true))),
      unhideChannel: (id, serverId) =>
        Boolean(updatePreferences(serverId, (current) => setChannelHidden(current, id, false))),
      toggleChannelPin: (channelId, serverId) => {
        let result: "pinned" | "unpinned" = "pinned";
        const saved = updatePreferences(serverId, (current) => {
          const pinned = current.pinnedChannels ?? [];
          if (!canToggleChatPin(pinned, current.pinned, channelId)) return current;
          result = pinned.includes(channelId) ? "unpinned" : "pinned";
          return {
            ...current,
            pinnedChannels: result === "unpinned" ? pinned.filter((id) => id !== channelId) : [...pinned, channelId],
          };
        });
        if (!saved || (result === "pinned" && !saved.pinnedChannels?.includes(channelId))) return "error";
        return result;
      },
      setChatPins: (serverId, items) => {
        const saved = updatePreferences(serverId, (current) => withPhoneSidebarPins(current, items));
        if (saved?.pinOrder) pushSidebarPins(serverId);
        return saved !== null;
      },
      readChatPins: (serverId) => phoneSidebarPins(preferencesRef.current[serverId] ?? preferenceStore.read(serverId)),
      toggleWorkflowPin: (workflowId, serverId) => {
        let result: "pinned" | "unpinned" = "pinned";
        const saved = updatePreferences(serverId, (current) => {
          const pinned = current.pinnedWorkflows ?? [];
          result = pinned.includes(workflowId) ? "unpinned" : "pinned";
          return {
            ...current,
            pinnedWorkflows: result === "unpinned" ? pinned.filter((id) => id !== workflowId) : [...pinned, workflowId],
          };
        });
        return saved ? result : "error";
      },
      reconcileWorkflowPins: (serverId, workflowIds) => {
        const pinned = preferencesRef.current[serverId]?.pinnedWorkflows;
        if (!pinned?.some((id) => !workflowIds.includes(id))) return;
        updatePreferences(serverId, (current) => ({
          ...current,
          pinnedWorkflows: (current.pinnedWorkflows ?? []).filter((id) => workflowIds.includes(id)),
        }));
      },
      toggleSectionCollapsed: (serverId, sectionId, sectionIds) => {
        updatePreferences(serverId, (current) => {
          const collapsed = (current.collapsedSections ?? []).filter((id) => sectionIds.includes(id));
          return {
            ...current,
            collapsedSections: collapsed.includes(sectionId)
              ? collapsed.filter((id) => id !== sectionId)
              : [...collapsed, sectionId],
          };
        });
      },
      toggleAgentPin: (agentId) => {
        const pinned = currentPinnedAgentIds();
        const serverId = currentActiveServer().id;
        const pinnedChannels = preferencesRef.current[serverId]?.pinnedChannels ?? NO_IDS;
        if (!canToggleChatPin(pinned, pinnedChannels, agentId)) return "error";
        if (pinned.includes(agentId)) {
          return updatePreferences(serverId, (current) => ({
            ...current,
            pinned: current.pinned.filter((id) => id !== agentId),
          }))
            ? "unpinned"
            : "error";
        }
        return updatePreferences(serverId, (current) => ({
          ...current,
          pinned: [...new Set([...current.pinned, agentId])],
        }))
          ? "pinned"
          : "error";
      },
    };
    return trackWorkspaceActions(workspace, () => ({
      agents: agentsRef.current,
      pinnedAgentIds: currentPinnedAgentIds(),
    }));
  }, [
    linkLocalServers,
    browser,
    workflows,
    hostRequests,
    request,
    teamApi,
    queryClient,
    queryScope,
    directory,
    directoryRefresh,
    refreshHosts,
    refreshMemberships,
    reorderServers,
    sortByPreference,
    keepHosts,
    applySidebarLayout,
    channelStore,
    syncCollections,
    conversationStore,
    liveState,
    sendApproval,
    hostedServerStarting,
    forgetServer,
    loadConversation,
    loadConversationAround,
    loadLatestMessages,
    loadOlderMessages,
    markAgentRead,
    markAgentUnreadFrom,
    markAllRead,
    updatePreferences,
    changeHostHidden,
    applyHostColors,
    pushSidebarPins,
    preferenceStore,
    connectionWaits,
  ]);

  const activeServer = useMemo(
    () => servers.find((server) => server.id === activeServerId) ?? EMPTY_SERVER,
    [servers, activeServerId],
  );
  const activeServerHasPreferences = Boolean(preferences[activeServer.id]);
  const activeAgents = useMemo(
    () =>
      activeServerHasPreferences
        ? agents.filter((agent) => agent.serverId === activeServer.id && !hiddenAgentIds.includes(agent.id))
        : NO_AGENTS,
    [activeServerHasPreferences, agents, activeServer.id, hiddenAgentIds],
  );
  const hiddenAgents = useMemo(
    () => agents.filter((agent) => agent.serverId === activeServer.id && hiddenAgentIds.includes(agent.id)),
    [agents, activeServer.id, hiddenAgentIds],
  );
  const state = useMemo<MobileWorkspaceState>(() => {
    const serverChecks = (
      capabilities: ServerCapabilities,
      online: (server: MobileServer) => boolean,
    ): ServerChecks => {
      const administers = (serverId: string, capability: string) => {
        const server = servers.find((candidate) => candidate.id === serverId);
        return Boolean(
          server &&
            online(server) &&
            canAdministerServer(server.role) &&
            hasCapability(capabilities, serverId, capability),
        );
      };
      const managesMcp = (serverId: string) =>
        administers(serverId, MCP_SERVERS_CAPABILITY) ||
        Boolean(
          servers.some((server) => server.id === serverId && online(server)) &&
            hasCapability(capabilities, serverId, MCP_SERVERS_CAPABILITY) &&
            hasCapability(capabilities, serverId, MCP_MEMBER_ACCESS_CAPABILITY),
        );
      return {
        ...createHostRequestChecks(capabilities),
        canEditServerIdentity: (serverId) => administers(serverId, HOST_ADMIN_CAPABILITY),
        canEditServerAppearance: (serverId) => administers(serverId, HOST_APPEARANCE_CAPABILITY),
        canRotateServerKey: (serverId) =>
          servers.find((candidate) => candidate.id === serverId)?.role === "owner" &&
          administers(serverId, HOST_KEY_ROTATION_CAPABILITY),
        canTransferOwnership: (serverId) => {
          const server = servers.find((candidate) => candidate.id === serverId);
          return server?.role === "owner" && server.hosted !== true && administers(serverId, OWNER_TRANSFER_CAPABILITY);
        },
        canCreateLocalServers: (serverId) =>
          servers.find((candidate) => candidate.id === serverId)?.role === "owner" &&
          administers(serverId, LOCAL_SERVERS_CAPABILITY),
        canRestartServerItself: (serverId) => administers(serverId, HOST_RESTART_CAPABILITY),
        canManageServerTimezone: (serverId) => administers(serverId, HOST_TIMEZONE_CAPABILITY),
        canManageServerTurnLimits: (serverId) => administers(serverId, HOST_TURN_LIMITS_CAPABILITY),
        canManageServerVoiceModel: (serverId) => administers(serverId, HOST_VOICE_MODEL_CAPABILITY),
        canManageServerSignalHome: (serverId) => administers(serverId, HOST_SIGNAL_HOME_CAPABILITY),
        servesServerSignalHome: (serverId) => {
          const server = servers.find((candidate) => candidate.id === serverId);
          return Boolean(
            server && online(server) && hasCapability(capabilities, serverId, HOST_SIGNAL_HOME_CAPABILITY),
          );
        },
        canReadMachineMetrics: (serverId) => administers(serverId, MACHINE_RESOURCES_CAPABILITY),
        canManageAgentMemoryLimit: (serverId) => administers(serverId, AGENT_MEMORY_LIMIT_CAPABILITY),
        canManageMediaApprovalCredits: (serverId) => administers(serverId, MEDIA_APPROVAL_CREDITS_CAPABILITY),
        canManageMemoryReview: (serverId) => administers(serverId, MEMORY_REVIEW_CAPABILITY),
        canManageSkillLearning: (serverId) => administers(serverId, SKILL_LEARNING_CAPABILITY),
        canManageBrowsingMemory: (serverId) => administers(serverId, BROWSING_MEMORY_CAPABILITY),
        canManageRemoteChatContent: (serverId) => administers(serverId, REMOTE_CHAT_CONTENT_CAPABILITY),
        servesRemoteChatContent: (serverId) => {
          const server = servers.find((candidate) => candidate.id === serverId);
          return Boolean(
            server && online(server) && hasCapability(capabilities, serverId, REMOTE_CHAT_CONTENT_CAPABILITY),
          );
        },
        canManageServerPersonality: (serverId) => administers(serverId, HOST_PERSONALITY_CAPABILITY),
        servesServerPersonality: (serverId) => {
          const server = servers.find((candidate) => candidate.id === serverId);
          return Boolean(
            server && online(server) && hasCapability(capabilities, serverId, HOST_PERSONALITY_CAPABILITY),
          );
        },
        canManageServerRoles: (serverId) => administers(serverId, AGENT_ACCESS_CAPABILITY),
        canReadServerAudit: (serverId) => administers(serverId, SERVER_AUDIT_CAPABILITY),
        hasAgentAccessLimits: (serverId) => {
          const server = servers.find((candidate) => candidate.id === serverId);
          return Boolean(
            server &&
              online(server) &&
              !canAdministerServer(server.role) &&
              hasCapability(capabilities, serverId, AGENT_ACCESS_CAPABILITY),
          );
        },
        canManageConnectors: (serverId) => administers(serverId, CONNECTORS_CAPABILITY),
        canManageOnePasswordConnector: (serverId) => administers(serverId, ONEPASSWORD_CONNECTOR_CAPABILITY),
        canManageBitwardenConnector: (serverId) => administers(serverId, BITWARDEN_CONNECTOR_CAPABILITY),
        canManageWhatsAppConnector: (serverId) => administers(serverId, WHATSAPP_CONNECTOR_CAPABILITY),
        canManagePasswordManagers: (serverId) => administers(serverId, PASSWORD_MANAGERS_CAPABILITY),
        canManageVault: (serverId) => administers(serverId, VAULT_CAPABILITY),
        canSaveVaultRequest: (serverId) => {
          if (administers(serverId, VAULT_CAPABILITY)) return true;
          const server = servers.find((candidate) => candidate.id === serverId);
          return Boolean(
            server && online(server) && hasCapability(capabilities, serverId, VAULT_MEMBER_SAVE_CAPABILITY),
          );
        },
        canImportVault: (serverId) => administers(serverId, VAULT_IMPORT_CAPABILITY),
        canImportAgents: (serverId) =>
          servers.some((server) => server.id === serverId && online(server)) &&
          hasCapability(capabilities, serverId, AGENT_IMPORT_CAPABILITY),
        canTransferServer: (serverId) => administers(serverId, INSTANCE_TRANSFER_CAPABILITY),
        canManageVaultApiKeys: (serverId) => administers(serverId, VAULT_V2_CAPABILITY),
        canManageVaultTwoStep: (serverId) => administers(serverId, VAULT_V3_CAPABILITY),
        canManageBrowserProfiles: (serverId) => administers(serverId, BROWSER_PROFILES_CAPABILITY),
        canManageBrowserProxies: (serverId) => administers(serverId, BROWSER_PROXIES_CAPABILITY),
        serverUpdateAccess: (serverId) => {
          if (administers(serverId, HOST_UPDATE_CAPABILITY)) return "admin";
          const server = servers.find((candidate) => candidate.id === serverId);
          return server &&
            online(server) &&
            !canAdministerServer(server.role) &&
            hasCapability(capabilities, serverId, HOST_MEMBER_UPDATE_CAPABILITY)
            ? "member"
            : null;
        },
        canReadServerRelease: (serverId) => hasCapability(capabilities, serverId, HOST_RELEASE_CAPABILITY),
        canViewHostedSites: (serverId) =>
          servers.some((server) => server.id === serverId && online(server)) &&
          hasCapability(capabilities, serverId, HOSTED_SITES_CAPABILITY),
        canDeleteHostedSites: (serverId) => administers(serverId, HOSTED_SITES_CAPABILITY),
        canManageProviders: (serverId) => administers(serverId, PROVIDERS_ADMIN_CAPABILITY),
        canManageMcpServers: managesMcp,
        canRelayMcpSignIn: (serverId) =>
          managesMcp(serverId) && hasCapability(capabilities, serverId, SIGN_IN_RELAY_CAPABILITY),
        macAppsUnavailable: (serverId) => hasCapability(capabilities, serverId, MAC_APPS_LIMIT_CAPABILITY),
        hostLoadsPluginCatalog: (serverId) => hasCapability(capabilities, serverId, PLUGIN_CATALOG_CAPABILITY),
        canEditUiBlockPreview: (serverId) => hasCapability(capabilities, serverId, UI_BLOCK_PREVIEW_EDIT_CAPABILITY),
        canManageMcpAccess: (serverId) => administers(serverId, MCP_ACCESS_CAPABILITY),
        canAddMarketplaceAgents: (serverId) => administers(serverId, AGENT_INSTALL_CAPABILITY),
        canUpdateMarketplaceAgents: (serverId) => administers(serverId, AGENT_UPDATE_CAPABILITY),
        canManageEvents: (serverId) => administers(serverId, EVENTS_CAPABILITY),
        canManageMissedRuns: (serverId) =>
          administers(serverId, EVENTS_CAPABILITY) && administers(serverId, ROUTINE_RECOVERY_CAPABILITY),
        canUseOnceRoutines: (serverId) => hasCapability(capabilities, serverId, ROUTINES_ONCE_CAPABILITY),
        canManageRoutineResults: (serverId) => administers(serverId, ROUTINE_RESULTS_CAPABILITY),
        canGiveWebhookSecretToAgent: (serverId) => administers(serverId, WEBHOOK_AGENT_SECRET_CAPABILITY),
        canManageAgentSkills: (serverId) => administers(serverId, SKILLS_ADMIN_CAPABILITY),
        canManageSharedTables: (serverId) => administers(serverId, SHARED_TABLES_CAPABILITY),
        canManageAgentFolders: (serverId) => administers(serverId, AGENT_FOLDERS_CAPABILITY),
        canManageChannelFolders: (serverId) => administers(serverId, CHANNEL_FOLDERS_CAPABILITY),
        canNestSidebarFolders: (serverId) => hasCapability(capabilities, serverId, SIDEBAR_FOLDERS_CAPABILITY),
        canManageAgentAccess: (serverId) => administers(serverId, AGENT_ADMIN_CAPABILITY),
        canManageAgentHostSettings: (serverId) => administers(serverId, AGENT_HOST_SETTINGS_CAPABILITY),
        canManageAgentBackupModels: (serverId) => administers(serverId, AGENT_BACKUP_MODELS_CAPABILITY),
        canManageAgentTaskLimit: (serverId) => administers(serverId, AGENT_TASK_LIMIT_CAPABILITY),
        canManageAgentNewChat: (serverId) => administers(serverId, AGENT_NEW_CHAT_CAPABILITY),
        canManageAgentPlanCard: (serverId) => administers(serverId, AGENT_PLAN_CARD_CAPABILITY),
        canManageAgentBuiltinMemory: (serverId) => administers(serverId, AGENT_BUILTIN_MEMORY_CAPABILITY),
        canManageAgentDefaults: (serverId) => administers(serverId, AGENT_DEFAULTS_CAPABILITY),
        canManageBackgroundProcesses: (serverId) => administers(serverId, BACKGROUND_PROCESSES_CAPABILITY),
        canManageAgentInstructions: (serverId) => administers(serverId, AGENT_INSTRUCTIONS_CAPABILITY),
        canPublishAgent: (serverId) => administers(serverId, AGENT_PUBLISH_CAPABILITY),
        canManageProviderAccounts: (serverId) => administers(serverId, PROVIDER_ACCOUNTS_CAPABILITY),
      };
    };
    return {
      ...serverChecks(serverCapabilities.current, showsOnline),
      knownServerChecks: (serverId) => {
        const known = serverCapabilities.current.get(serverId) ?? keptCapabilities.current.get(serverId);
        return known ? serverChecks(new Map([[serverId, known]]), () => true) : null;
      },
      browserViewSupport: browser.browserViewSupport,
      sidebarByServer,
      servers: orderedServers,
      memberCountByServer,
      serverDirectoryState,
      serverDirectoryError,
      agents,
      activeServer,
      activeAgents,
      hiddenAgents,
      pinnedAgentIds,
      pinnedChannelIds,
      pinnedWorkflowIds,
      collapsedSectionIds,
      hiddenChannelIds,
      hidesAgentsOnServer: (serverId) =>
        hostOwnsHide(serverCapabilities.current.get(serverId), servers.find((server) => server.id === serverId)?.role),
      hiddenAgentsWorkOnServer: (serverId) =>
        hasCapability(serverCapabilities.current, serverId, AGENT_HIDDEN_WORK_CAPABILITY),
      canUnhideAgent: (agentId) =>
        !hostHiddenIds.includes(agentId) ||
        hostOwnsHide(serverCapabilities.current.get(activeServer.id), activeServer.role),
      localServerKind: (serverId) =>
        localServerLinks.computers.has(serverId)
          ? "computer"
          : localServerLinks.parents.has(serverId)
            ? "onComputer"
            : null,
      canSendNotifications: (serverId) =>
        servers.some((server) => server.id === serverId && showsOnline(server)) && supportsPushNotifications(serverId),
    };
  }, [
    localServerLinks,
    browser,
    sidebarByServer,
    orderedServers,
    memberCountByServer,
    serverDirectoryState,
    serverDirectoryError,
    agents,
    servers,
    activeServer,
    activeAgents,
    hiddenAgents,
    pinnedAgentIds,
    pinnedChannelIds,
    pinnedWorkflowIds,
    collapsedSectionIds,
    hiddenChannelIds,
    hostHiddenIds,
    supportsPushNotifications,
  ]);
  const value = useMemo<MobileWorkspaceContextValue>(() => ({ ...state, ...actions }), [state, actions]);

  return (
    <WorkspaceContexts value={value} actions={actions}>
      <RecoveryCountdownContext.Provider value={recoveryCountdowns}>
        <View className="flex-1">
          {children}
          <QuickActionsSync
            apiUrl={session.apiUrl}
            userId={session.user.id}
            servers={servers}
            serversReady={serverDirectoryState === "ready"}
            activeServerId={activeServerId}
            agents={directoryAgents}
            preferences={visiblePreferences}
          />
          <ShareExtensionSync
            apiUrl={session.apiUrl}
            userId={session.user.id}
            sessionToken={session.sessionToken}
            servers={orderedServers}
            serversReady={serverDirectoryState === "ready"}
            agents={directoryAgents}
          />
          <ShortcutsSync
            apiUrl={session.apiUrl}
            userId={session.user.id}
            servers={orderedServers}
            serversReady={serverDirectoryState === "ready"}
            agents={directoryAgents}
            preferences={visiblePreferences}
          />
          <OwnerTransferPrompts
            directory={directory}
            revision={directoryLoads}
            active={foreground}
            onAccepted={refreshMemberships}
          />
          <WatchSync
            servers={orderedServers}
            serversReady={serverDirectoryState === "ready"}
            agents={directoryAgents}
            preferences={visiblePreferences}
            capabilities={serverCapabilities.current}
            teamApi={teamApi}
          />
          <NotificationAvatarSync
            servers={servers}
            serversReady={serverDirectoryState === "ready"}
            agents={directoryAgents}
          />
          {servers.map((server) => (
            <ServerConnection
              key={server.id}
              hostId={server.id}
              publicKey={server.publicKey}
              active={
                (foreground && (!othersHeld || server.id === activeServerId)) || backgroundRefreshing || watchAwake
              }
              background={!foreground}
              directory={directory}
              sync={serverSync}
              register={registerConnection}
              load={loadServer}
              onStatus={handleConnectionStatus}
              onMembershipChanged={refreshMemberships}
              onTeamEvent={handleTeamEvent}
              onUnavailable={handleServerUnavailable}
            />
          ))}
        </View>
      </RecoveryCountdownContext.Provider>
    </WorkspaceContexts>
  );
}
