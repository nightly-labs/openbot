import {
  assertSupportedAttachmentName,
  isSupportedAttachmentNameFor,
  rasterImageMimeType,
} from "@openbot/contracts/attachment-files";
import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import type {
  AccountUsage,
  AgentApproval,
  AgentColors,
  AgentEvent,
  AgentNotificationLevelsSnapshot,
  AgentStatus,
  AgentWaitsSnapshot,
  AttachmentSummary,
  AvatarImageInput,
  BrowserLiveViewEvent,
  BrowserNavigateInput,
  BrowserOpenInput,
  BrowserPreview,
  BrowserTab,
  BrowserTeachStep,
  BrowserTeachStopInput,
  CancelQueuedMessageInput,
  Channel,
  ChatColors,
  ClientAgentModelOption,
  ClientAgentSummary,
  ConversationFileSearchPage,
  ConversationPage,
  ConversationReadState,
  ConversationSearchPage,
  CreateAgentInput,
  DuplicateAgentResult,
  EditQueuedMessageInput,
  HiddenAgentsSnapshot,
  InvitePreview,
  LocalBrowserSecretResponse,
  PinnedMessagesSnapshot,
  QueueSnapshot,
  ReadPendingApprovalInput,
  ReorderQueueInput,
  RespondToApprovalInput,
  RespondToBrowserTakeoverInput,
  RespondToPromptInput,
  Routine,
  RoutineRun,
  ServerNotificationLevel,
  SetAgentHiddenInput,
  SetAgentNotificationLevelInput,
  SetChannelImageInput,
  SetMessagePinnedInput,
  SetMessageReactionInput,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  SidebarPin,
  SidebarPinsSnapshot,
  SteerQueuedMessageInput,
  TeamInviteSummary,
  TeamMemberSummary,
  TeamRealtimeEvent,
  TestRoutineInput,
  UpdateAgentInput,
  UpdateQueuedMessageInput,
  UpdateRoutineInput,
  WorkspaceDirectory,
} from "@openbot/contracts/ipc";
import {
  canAdministerServer,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  decodeAgentFastModels,
  decodeAgentModelListings,
  decodeUsageCredits,
  decodeWorkspaceDirectory,
  isAccountUsage,
  isAgentStatus,
  isChannel,
  isClientAgentModelOption,
  isClientAgentSummary,
  isConversationMessage,
  isConversationReadState,
  isConversationWithReadState,
  isQueuedMessageReceipt,
  isQueueSnapshot,
  isSidebarLayoutSnapshot,
  isTeamPresenceSnapshot,
  withFastServiceTiers,
  withModelListings,
  withUsageCredits,
} from "@openbot/contracts/ipc";
import { guardedListDecoder, optionalHistoryExtent, requiredString } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { AGENT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-colors-v1";
import {
  AGENT_FAST_MODE_CAPABILITY,
  AGENT_FAST_MODE_ROUTES,
} from "@openbot/contracts/team-protocol/agent-fast-mode-v1";
import { AGENT_NOTIFICATION_LEVELS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-notification-levels-v1";
import { AGENT_SPEED_CAPABILITY, AGENT_SPEED_ROUTES } from "@openbot/contracts/team-protocol/agent-speed-v1";
import {
  AGENT_USAGE_LIMIT_CAPABILITY,
  AGENT_USAGE_LIMIT_ROUTES,
} from "@openbot/contracts/team-protocol/agent-usage-limit-v1";
import {
  AGENT_WAITS_CAPABILITY,
  AGENT_WAITS_ROUTES,
  decodeAgentWaitsResponse,
} from "@openbot/contracts/team-protocol/agent-waits-v1";
import {
  BROWSER_PAGE_STATE_CAPABILITY,
  BROWSER_PAGE_STATE_ROUTES,
  decodeBrowserPageStateSnapshot,
} from "@openbot/contracts/team-protocol/browser-page-state-v1";
import {
  BROWSER_TEACH_CAPABILITY,
  BROWSER_TEACH_ROUTES,
  decodeBrowserTeachSteps,
} from "@openbot/contracts/team-protocol/browser-teach-v1";
import {
  BROWSER_USER_CONTROL_CAPABILITY,
  BROWSER_USER_CONTROL_ROUTES,
  decodeBrowserUserControlSnapshot,
} from "@openbot/contracts/team-protocol/browser-user-control-v1";
import {
  decodeBrowserViewInputValue,
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import {
  CHANNEL_PICTURE_CAPABILITY,
  CHANNEL_PICTURE_ROUTES,
} from "@openbot/contracts/team-protocol/channel-picture-v1";
import { CHAT_COLORS_CAPABILITY } from "@openbot/contracts/team-protocol/chat-colors-v1";
import { CHAT_HISTORY_CAPABILITY, CHAT_HISTORY_ROUTES } from "@openbot/contracts/team-protocol/chat-history-v1";
import {
  CONTEXT_COMPACT_CAPABILITY,
  CONTEXT_COMPACT_ROUTES,
} from "@openbot/contracts/team-protocol/context-compact-v1";
import {
  CONVERSATION_FILE_SEARCH_CAPABILITY,
  CONVERSATION_FILE_SEARCH_PAGE_LIMIT,
  CONVERSATION_FILE_SEARCH_ROUTES,
  decodeConversationFileSearchResponse,
} from "@openbot/contracts/team-protocol/conversation-file-search-v1";
import {
  CONVERSATION_UNREAD_FROM_CAPABILITY,
  CONVERSATION_UNREAD_FROM_ROUTE,
} from "@openbot/contracts/team-protocol/conversation-unread-from-v1";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { FOCUS_USE_ROUTES } from "@openbot/contracts/team-protocol/focus-use-v1";
import { MESSAGE_DELETE_CAPABILITY, MESSAGE_DELETE_ROUTES } from "@openbot/contracts/team-protocol/message-delete-v1";
import {
  decodeMessagePinsResponse,
  MESSAGE_PINS_CAPABILITY,
  MESSAGE_PINS_ROUTES,
} from "@openbot/contracts/team-protocol/message-pins-v1";
import {
  MODEL_VISIBILITY_CAPABILITY,
  MODEL_VISIBILITY_ROUTES,
} from "@openbot/contracts/team-protocol/model-visibility-v1";
import {
  decodePendingApprovalResponse,
  PENDING_APPROVAL_CAPABILITY,
  PENDING_APPROVAL_ROUTES,
} from "@openbot/contracts/team-protocol/pending-approval-v1";
import { PROVIDER_ACCOUNTS_CAPABILITY } from "@openbot/contracts/team-protocol/provider-accounts-v1";
import {
  ROUTINE_FLOW_STOP_CAPABILITY,
  ROUTINE_FLOW_STOP_ROUTES,
} from "@openbot/contracts/team-protocol/routine-flow-stop-v1";
import { ROUTINE_FLOWS_CAPABILITY } from "@openbot/contracts/team-protocol/routine-flows-v1";
import { ROUTINES_ONCE_CAPABILITY } from "@openbot/contracts/team-protocol/routines-once-v1";
import {
  SIDEBAR_FOLDERS_CAPABILITY,
  SIDEBAR_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import {
  decodeThreadMessageSearchResponse,
  THREAD_MESSAGE_SEARCH_CAPABILITY,
  THREAD_MESSAGE_SEARCH_PAGE_LIMIT,
  THREAD_MESSAGE_SEARCH_ROUTES,
} from "@openbot/contracts/team-protocol/thread-message-search-v1";
import { USAGE_CREDITS_CAPABILITY, USAGE_CREDITS_ROUTES } from "@openbot/contracts/team-protocol/usage-credits-v1";
import { type TeamProtocolSupportV1, teamProtocolUpdateDirection } from "@openbot/contracts/team-protocol/v1";
import { TEAM_PROTOCOL_V2_MAX_FILE_BYTES, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import { decodeTeamProtocolSupportV9 } from "@openbot/contracts/team-protocol/v9";
import {
  WORKSPACE_DIRECTORY_CAPABILITY,
  WORKSPACE_DIRECTORY_ROUTES,
} from "@openbot/contracts/team-protocol/workspace-directory-v1";
import { runTeamEffect } from "@openbot/team-client";
import { bytesToBase64 } from "@openbot/team-client/base64";
import { createRemoteBrowserView, type RemoteBrowserView } from "@openbot/team-client/browser-view";
import { verifyEd25519Base64Url } from "@openbot/team-client/ed25519";
import {
  RemoteDirectoryError,
  RemoteTeamDirectoryClient,
  type RemoteTeamHost,
  type RemoteTeamInvite,
  type RemoteTeamMember,
} from "@openbot/team-client/remote-directory";
import {
  createRemoteTeamPeer,
  type RemoteFileUpload,
  type RemoteLargeDownload,
  type RemoteTeamCommandResult,
  type RemoteTeamConnectionUpdate,
  type RemoteTeamPeerActions,
} from "@openbot/team-client/remote-peer";
import { remoteWorkspaceReadTimeout } from "@openbot/team-client/remote-recovery";
import {
  listAgentNotificationLevels,
  listHiddenAgents,
  readAgentColors,
  readChatColors,
  readSidebarPins,
  seedSidebarPins,
  setAgentChatColor,
  setAgentColor,
  setAgentHidden,
  setAgentNotificationLevel,
  setAgentProviderAccount,
  setOwnServerNotificationLevel,
  setSidebarPins,
} from "@openbot/team-client/team-admin-requests";
import {
  cancelQueuedMessage,
  deleteAgent,
  discardAttachmentDraft,
  interruptAgentTurn,
  reorderQueue,
  respondToBrowserSecret,
  respondToBrowserTakeover,
  steerQueuedMessage,
  type TeamApiRequest,
  type TeamChannelsApi,
  type TeamRoutineFlowsApi,
  teamAgentRoutinesApi,
  teamChannelsApi,
  teamRoutineFlowsApi,
  updateQueuedMessage,
  uploadAttachmentDraft,
} from "@openbot/team-client/team-api-requests";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import { currentText } from "@openbot/ui/text";
import { referenceFrom } from "@openbot/user-errors";
import { Effect } from "effect";
import type { ServerAdminPort } from "../servers/servers-port";
import {
  createWebHostConnections,
  type WebHostConnections,
  type WebHostNotice,
  type WebHostNotificationSettings,
  WebHostRequestError,
} from "./web-host-connections";
import {
  acquireOpenedWebHostLock,
  acquireWebHostLock,
  decodeWebHostTabMessage,
  openWebHostChannel,
  type WebHostState,
  type WebHostTabMessage,
} from "./web-host-lock";

/**
 * The host controls of the connected host. The host answers the Team API routes, and the account
 * service answers the member and invitation routes; both refuse a `member`, so the UI gate is not
 * the only one.
 */
export interface WebAdminRuntime {
  request: TeamApiRequest;
  /** The same requests, with a response of up to one file of the web file limit, such as a transfer file. */
  download: TeamApiRequest;
  team: ServerAdminPort;
}

export interface WebFile {
  name: string;
  mimeType: string;
  base64: string;
}

interface WebEarlyReads {
  start(): void;
  drop(): void;
}

interface WebConnectOptions {
  takeOver?: boolean;
  early?: WebEarlyReads;
}

/** The message that `message-delete-v1` deletes: in the chat of an agent, or in a channel. */
type WebMessageDelete =
  | { kind: "agent"; agentId: string; messageId: string }
  | { kind: "channel"; channelId: string; messageId: string };

/** The chat whose history `chat-history-v1` deletes: the agent's own chat, or a channel. */
type WebHistoryDelete = { kind: "agent"; agentId: string } | { kind: "channel"; channelId: string };

export interface WebWorkspaceRuntime {
  admin?: WebAdminRuntime;
  /** The status connections of the hosts that this tab has not opened. */
  hosts?: WebHostConnections;
  browser: BrowserViewRuntime;
  browserTabs(): Promise<BrowserTab[]>;
  browserPreview?: (tabId: string) => Promise<BrowserPreview>;
  openBrowserTab(input: BrowserOpenInput): Promise<BrowserTab>;
  navigateBrowserTab(input: BrowserNavigateInput): Promise<void>;
  reloadBrowserTab(tabId: string): Promise<void>;
  /** Behind `browser-page-state`. */
  stopBrowserTab(tabId: string): Promise<void>;
  closeBrowserTab(tabId: string): Promise<void>;
  /** Behind `browser-user-control`: the owning agent waits on the tab until the release. */
  takeBrowserControl(tabId: string): Promise<void>;
  releaseBrowserControl(tabId: string): Promise<void>;
  /** Behind `browser-teach-v1`: the host records the steps that this member shows in the tab. */
  startBrowserTeach(tabId: string): Promise<void>;
  stopBrowserTeach(input: BrowserTeachStopInput): Promise<BrowserTeachStep[]>;
  respondToBrowserSecret?: (input: LocalBrowserSecretResponse) => Promise<void>;
  getSidebarLayout?: () => Promise<SidebarLayoutSnapshot>;
  mutateSidebarLayout?: (action: SidebarLayoutAction) => Promise<SidebarLayoutSnapshot>;
  /**
   * The host's channel routes. A channel page arrives without host file URLs, and a channel image
   * arrives as a data URL. `setChannelImage` needs `channel-picture-v1`.
   */
  channels?: TeamChannelsApi & {
    setChannelImage(input: SetChannelImageInput): Promise<Channel>;
    /**
     * Calls `listener` after channel images that a list did not wait for have arrived, so that the
     * caller lists again. Returns the function that removes it. A runtime that gives images at once has none.
     */
    onPictures?(listener: () => void): () => void;
  };
  /** The team member this connection signs in as, which is how the host names this reader's messages. */
  currentMemberId?: () => Promise<string>;
  respondToTakeover(input: RespondToBrowserTakeoverInput): Promise<void>;
  listHosts(): Promise<RemoteTeamHost[]>;
  /** Ends this account's membership of a host. The account service refuses the owner. */
  leaveHost(hostId: string, membershipId: string): Promise<void>;
  removeOwnedHost?: (hostId: string) => Promise<void>;
  previewInvite(url: string): Promise<InvitePreview>;
  acceptInvite(url: string): Promise<RemoteTeamHost>;
  /**
   * Connects and reads the host's compatibility. When the host protocol of an earlier connection is
   * known, `early.start` runs as the data channels open, so the first reads go beside that read.
   * `early.drop` runs when the read gives another protocol: those reads used the wrong capabilities.
   * With `takeOver`, a tab that has the host open closes it, and `hostTaken` tells that tab.
   */
  connect(host: RemoteTeamHost, options?: WebConnectOptions): Promise<string[]>;
  disconnect(): Promise<void>;
  listAgents(): Promise<ClientAgentSummary[]>;
  conversation(agentId: string, before?: string): Promise<ConversationPage>;
  /** The page of an agent's conversation around one message, or the newest page from an older host. */
  conversationAround?: (agentId: string, messageId: string) => Promise<ConversationPage>;
  /** Marks this member's messages from the agent read through `throughMessageId`, or all when it is null. */
  markRead(agentId: string, throughMessageId: string | null): Promise<ConversationReadState>;
  /** With `conversation-unread-from-v1`: marks one message and the messages after it unread, for this member. */
  markUnreadFrom(agentId: string, fromMessageId: string): Promise<ConversationReadState>;
  /** This member's read state for each agent, keyed by agent id. Invalid entries are left out. */
  conversationReads(): Promise<Record<string, ConversationReadState>>;
  /**
   * Deletes one message of an agent's chat or of a channel, with `message-delete-v1`. A host
   * without it refuses before a request goes out.
   */
  deleteMessage?: (input: WebMessageDelete) => Promise<void>;
  /**
   * "Compact now" for an agent's own chat, or for one side thread with `taskId`, with
   * `context-compact-v1`. A host without it refuses before a request goes out.
   */
  compactContext?: (agentId: string, taskId?: string) => Promise<void>;
  /**
   * "Delete history" of an agent's own chat or of a channel, with `chat-history-v1`. A host without
   * it refuses before a request goes out.
   */
  deleteHistory?: (input: WebHistoryDelete) => Promise<void>;
  /** "New conversation" in a channel, with `chat-history-v1`. */
  clearChannelContext?: (channelId: string) => Promise<void>;
  /** "Compact context" of a channel, with `chat-history-v1`. */
  compactChannelContext?: (channelId: string) => Promise<void>;
  /** The open waits of an agent, with `agent-waits-v1`. A host without it refuses before a request goes out. */
  listWaits?: (agentId: string) => Promise<AgentWaitsSnapshot>;
  /** The pinned messages of all chats of an agent, with `message-pins-v1`. A host without it refuses before a request goes out. */
  listPinnedMessages?: (agentId: string) => Promise<PinnedMessagesSnapshot>;
  /** Pin or Unpin on one message, with `message-pins-v1`. Resolves with the new list of the chat. */
  setMessagePinned?: (input: SetMessagePinnedInput) => Promise<PinnedMessagesSnapshot>;
  /** Cancel on one open wait of an agent, with `agent-waits-v1`. */
  cancelWait?: (agentId: string, waitId: string) => Promise<void>;
  /**
   * The whole copy of an approval that a runtime snapshot cut, with `pending-approval-v1`. Null from a
   * host without it: the card then keeps the cut copy and offers only Deny.
   */
  readPendingApproval?: (input: ReadPendingApprovalInput) => Promise<AgentApproval | null>;
  /** Tells a hosted server that this tab has focus. Send it only to a host with `focus-use-v1`. */
  focusUse(): Promise<void>;
  /** Resolves to the conversation message the host stored: the delivery id of the receipt. */
  send(
    agentId: string,
    text: string,
    attachmentDraftIds: string[],
    replyToMessageId?: string | null,
    clientMessageId?: string,
  ): Promise<string>;
  stop(agentId: string, turnId: string): Promise<void>;
  /** Sends which agent this member is writing to, or `null`. It does nothing while the host is offline. */
  setTyping(agentId: string | null, typing: boolean): void;
  queue(agentId: string): Promise<QueueSnapshot>;
  editQueue(input: EditQueuedMessageInput): Promise<QueueSnapshot>;
  cancelQueued(input: CancelQueuedMessageInput): Promise<void>;
  steerQueued(input: SteerQueuedMessageInput): Promise<void>;
  updateQueued(input: UpdateQueuedMessageInput): Promise<void>;
  reorderQueue(input: ReorderQueueInput): Promise<void>;
  approve(input: RespondToApprovalInput): Promise<void>;
  answer(input: RespondToPromptInput): Promise<void>;
  upload(file: File): Promise<AttachmentSummary>;
  cancelUpload(): Promise<void>;
  discard(attachmentId: string): Promise<void>;
  download(attachmentId: string): Promise<WebFile>;
  /** A file under the host's shared folder. */
  sharedFile(path: string): Promise<WebFile>;
  /** A file in one agent's workspace on the host. */
  workspaceFile(agentId: string, path: string): Promise<WebFile>;
  /** A folder in one agent's workspace on the host. */
  workspaceDirectory(agentId: string, path: string): Promise<WorkspaceDirectory>;
  /** The routine canvas routes. Each call refuses while the host does not serve `routine-flows-v1`. */
  routineFlows?: TeamRoutineFlowsApi;
  /** Changes an agent routine, such as its instruction. */
  updateRoutine?: (input: UpdateRoutineInput) => Promise<Routine>;
  /** Runs an agent routine now. */
  testRoutine?: (input: TestRoutineInput) => Promise<RoutineRun>;
  /** The agents that a user hid on the host. Any member can call it on a host with `agent-hidden-v1`. */
  listHiddenAgents?: () => Promise<HiddenAgentsSnapshot>;
  /** Hides or restores an agent, and returns the host's hidden list. Needs `agent-hidden-v1`. */
  setAgentHidden?: (input: SetAgentHiddenInput) => Promise<HiddenAgentsSnapshot>;
  /** The exact colours of the agents on the host. A host without `agent-colors-v1` has none. */
  listAgentColors?: () => Promise<AgentColors>;
  /** The chat colours of the agents and members on the host. A host without `chat-colors-v1` has none. */
  listChatColors?: () => Promise<ChatColors>;
  /** The user's own pinned chats on the open host, for all of their devices. Needs `sidebar-pins-v1`. */
  sidebarPins?: {
    read: () => Promise<SidebarPinsSnapshot>;
    set: (items: SidebarPin[]) => Promise<SidebarPinsSnapshot>;
    /** Saves `items` only when the user has no list on the host yet. */
    seed: (items: SidebarPin[]) => Promise<SidebarPinsSnapshot>;
  };
  /**
   * The user's own level for each agent of a host: the open host, or a host with a status connection.
   * Any member can call it. A host without `agent-notification-levels-v1` has no levels.
   */
  listAgentNotificationLevels?: (hostId: string) => Promise<AgentNotificationLevelsSnapshot>;
  /** Sets the user's own level for one agent of the open host. Needs `agent-notification-levels-v1`. */
  setAgentNotificationLevel?: (input: SetAgentNotificationLevelInput) => Promise<AgentNotificationLevelsSnapshot>;
  /**
   * The agents and the user's own levels of a host, for the notification settings: the open host, or
   * a host with a status connection. `levels` is null on a host without `agent-notification-levels-v1`.
   */
  notificationSettings?: (hostId: string) => Promise<WebHostNotificationSettings>;
  /** Sets the user's own level for one agent of a host. Needs `agent-notification-levels-v1`. */
  setHostAgentNotificationLevel?: (
    hostId: string,
    input: SetAgentNotificationLevelInput,
  ) => Promise<AgentNotificationLevelsSnapshot>;
  /** Sets the user's own level of a host, for all of their devices. Needs `agent-notification-levels-v1`. */
  setOwnServerNotificationLevel?: (
    hostId: string,
    level: ServerNotificationLevel | null,
  ) => Promise<AgentNotificationLevelsSnapshot>;
  react(input: SetMessageReactionInput): Promise<void>;
  setAvatar(agentId: string, image: AvatarImageInput | null): Promise<void>;
  /** The agent image as a data URL. The browser cannot open the host's `openbot-avatar:` URL. */
  agentAvatar(agentId: string, avatarUrl: string): Promise<string>;
  models(): Promise<ClientAgentModelOption[]>;
  status(): Promise<AgentStatus>;
  accountUsage?: () => Promise<AccountUsage>;
  createAgent(input: CreateAgentInput): Promise<ClientAgentSummary>;
  duplicateAgent(agentId: string): Promise<DuplicateAgentResult>;
  updateAgent(input: UpdateAgentInput): Promise<void>;
  deleteAgent(agentId: string): Promise<void>;
  /**
   * Searches one agent's conversation, or every conversation on the host when `agentId` is not set.
   * `includeSideThreads` also searches the side threads when the host serves `thread-message-search-v1`;
   * an older host searches the agents' own chats.
   */
  search(
    agentId: string | undefined,
    query: string,
    cursor?: string,
    includeSideThreads?: boolean,
  ): Promise<ConversationSearchPage>;
  /** Searches the files of the agent chats by name. Needs `conversation-file-search-v1`. */
  searchFiles?: (query: string, cursor?: string) => Promise<ConversationFileSearchPage>;
  /**
   * `sessionsEnded`: the account service already ended this account's remote sessions, as sign-out
   * does. The browser then sends no end request, which the revoked cookie would only have refused.
   */
  dispose(options?: { sessionsEnded?: boolean }): Promise<void>;
}

export interface WebRuntimeEvents {
  connection(update: RemoteTeamConnectionUpdate): void;
  accessDenied?(hostId: string, error: WebHostConnectionError): void;
  event(hostId: string, event: AgentEvent | TeamRealtimeEvent): void;
  accountChanged(): Promise<void>;
  /** The state of a host this tab has not opened. */
  hostState?(hostId: string, state: WebHostState): void;
  /** A host that this tab has not opened revoked its session. */
  hostSessionRevoked?(): void;
  /** Another tab took the host that this tab has open. The runtime closes it after this call. */
  hostTaken?(hostId: string): void;
  /** An event of a host this tab has not opened that a notification can show. */
  hostNotice?(hostId: string, event: WebHostNotice, agents: ClientAgentSummary[]): void;
}

/** The host speaks no Team API protocol that this web build speaks. The workspace shows it in full. */
export class WebHostIncompatibleError extends Error {
  readonly code: "client_update_required" | "host_update_required";
  readonly hostAppVersion: string;
  readonly hostProtocol: TeamProtocolSupportV1["protocol"];

  constructor(support: TeamProtocolSupportV1, code: WebHostIncompatibleError["code"]) {
    super(currentText().t("webClient.error.incompatible"));
    this.code = code;
    this.hostAppVersion = support.appVersion;
    this.hostProtocol = support.protocol;
  }
}

export class WebHostConnectionError extends Error {
  /** The code a user can copy, such as `http/401`. */
  readonly reference: string | null;

  constructor(
    readonly code: "identity_changed" | "authentication_required" | "access_ended",
    reference: string | null = null,
  ) {
    super(
      currentText().t(code === "identity_changed" ? "webClient.error.identityChanged" : "webClient.error.accessEnded"),
    );
    this.reference = reference;
  }
}

interface WebConnectionDependencies {
  createPeer: typeof createRemoteTeamPeer;
  acquireHostLock: typeof acquireWebHostLock;
  /** The channel between the tabs of the account. Without one, this tab keeps no status connections. */
  openHostChannel?: (accountId: string) => BroadcastChannel | null;
}

/** The fields of a move to another model at a usage limit. */
const USAGE_LIMIT_MOVE_FIELDS: ReadonlySet<string> = new Set([
  "agentId",
  "provider",
  "model",
  "reasoningEffort",
  "providerAccountId",
  "leaveUsageLimit",
]);

function hostProtocolKey(accountId: string, hostId: string): string {
  return `openbot.web.host-protocol:${accountId}:${hostId}`;
}

function savedHostProtocol(accountId: string, hostId: string): number | undefined {
  const protocol = Number(localStorage.getItem(hostProtocolKey(accountId, hostId)));
  return Number.isSafeInteger(protocol) && protocol > 0 ? protocol : undefined;
}

/** Pin after directory validation and before connecting. Never silently replace a saved identity. */
function pinWebHostKey(accountId: string, host: RemoteTeamHost): void {
  const key = `openbot.web.host-key:${accountId}:${host.hostId}`;
  const pinned = localStorage.getItem(key);
  if (pinned && pinned !== host.devicePublicKey) throw new WebHostConnectionError("identity_changed");
  localStorage.setItem(key, host.devicePublicKey);
}

export function createWebWorkspaceRuntime(
  accountId: string,
  events: WebRuntimeEvents,
  accountFetch: typeof fetch,
  dependencies: WebConnectionDependencies = {
    createPeer: createRemoteTeamPeer,
    acquireHostLock: acquireWebHostLock,
    openHostChannel: openWebHostChannel,
  },
): WebWorkspaceRuntime {
  const directory = new RemoteTeamDirectoryClient({
    apiUrl: window.location.origin,
    authentication: { kind: "browser" },
    fetch: accountFetch,
    // `bun run dev:api` serves this page and the account service from `http://localhost:<port>`.
    inviteLinks: { allowLocalDevelopmentApiUrl: import.meta.env.DEV },
    verifyHostKeySignature: verifyEd25519Base64Url,
    hostKeys: {
      get: async (id) => localStorage.getItem(`openbot.web.host-key:${accountId}:${id}`),
      set: async (id, key) => localStorage.setItem(`openbot.web.host-key:${accountId}:${id}`, key),
    },
  });
  let sessionsEnded = false;
  const sessionActions = {
    getBootstrap: async (id: string, key: string, sessionId: string | null) => {
      try {
        return await runTeamEffect(directory.createBootstrap(id, key, sessionId));
      } catch (error) {
        // The reference keeps 401 apart from 403 and names the account service code, such as `session_inactive`.
        if (error instanceof RemoteDirectoryError && (error.status === 401 || error.status === 403))
          events.connection({
            hostId: id,
            state: "offline",
            message: null,
            code: "session_revoked",
            ...(error.reference ? { reference: error.reference } : {}),
          });
        throw error;
      }
    },
    endSession: async (id: string) => {
      if (!sessionsEnded) await runTeamEffect(directory.endSession(id));
    },
  };
  /** The host of a connect attempt that Signal holds until the host is online. */
  let waitingHostId: string | null = null;
  const openedActions: RemoteTeamPeerActions = {
    ...sessionActions,
    onConnectionUpdate: async (update) => {
      // A `connecting` update without `hostOffline`, such as a `rate_limited` reply, does not end the hold.
      if (update.hostOffline) waitingHostId = update.hostId;
      else if (update.state !== "connecting") waitingHostId = null;
      if (update.state !== "online") {
        browserView.disconnect(update.message ?? undefined);
        const releaseGeneration = liveViewGeneration + 1;
        void releaseLiveView().finally(() => {
          if (liveViewGeneration === releaseGeneration) browserView.disconnect();
        });
      }
      events.connection(update);
    },
    onHostStreamData: (data) => browserView.receive(data),
    onTeamEvent: async (id, event) => events.event(id, event),
    onAccountProfileChanged: events.accountChanged,
  };
  // A new page sends its first reads with the protocol of the last visit, beside the compatibility
  // read. `connectHost` reads them again when the protocol changed.
  const hostProtocols = {
    get: (id: string) => savedHostProtocol(accountId, id),
    set: (id: string, protocol: number) => localStorage.setItem(hostProtocolKey(accountId, id), String(protocol)),
  };
  function createOpenedPeer() {
    const actions = { current: openedActions };
    return { peer: dependencies.createPeer(actions, { waitForHost: true, hostProtocols }), actions };
  }
  // Each host switch replaces the peer, so the old host's session can end while the new host connects.
  let { peer, actions: peerActions } = createOpenedPeer();
  /** Peers of earlier hosts that are still ending their sessions. */
  const retiring = new Set<Promise<void>>();
  /** Ends the peer's sessions in the background, then releases its host's lock. */
  function retire(previous: typeof peer, actions: typeof peerActions, releaseLock: (() => void) | null): void {
    // The account service gives a new connection to the host the same session while it is active,
    // so the lock waits for the end. The old peer reports nothing more to the workspace.
    actions.current = {
      ...sessionActions,
      onConnectionUpdate: async () => undefined,
      onTeamEvent: async () => undefined,
    };
    const ending = previous
      .dispose()
      .catch(() => undefined)
      .finally(() => releaseLock?.());
    retiring.add(ending);
    void ending.finally(() => retiring.delete(ending));
  }
  let releaseHostLock: (() => void) | null = null;
  let lockedHostId: string | null = null;
  const hostChannel = dependencies.openHostChannel?.(accountId) ?? null;
  const hosts = hostChannel
    ? createWebHostConnections({
        accountId,
        channel: hostChannel,
        actions: sessionActions,
        createPeer: dependencies.createPeer,
        peerOptions: { hostProtocols },
        acquireHostLock: dependencies.acquireHostLock,
        pinHostKey: (host) => pinWebHostKey(accountId, host),
        onState: (hostId, state) => events.hostState?.(hostId, state),
        onSessionRevoked: () => events.hostSessionRevoked?.(),
        // Without a listener, the status connections read no agent list.
        ...(events.hostNotice
          ? {
              onNotice: (hostId: string, event: WebHostNotice, agents: ClientAgentSummary[]) =>
                events.hostNotice?.(hostId, event, agents),
            }
          : {}),
      })
    : undefined;
  // Another tab asks for the host that this tab has open: it stays here, unless the user takes it there.
  hostChannel?.addEventListener("message", (event) => {
    const message = decodeWebHostTabMessage(event.data);
    if (!message || disposed || !("requestId" in message) || message.hostId !== lockedHostId) return;
    if (message.type === "release")
      hostChannel.postMessage({
        type: "busy",
        hostId: message.hostId,
        requestId: message.requestId,
      } satisfies WebHostTabMessage);
    else if (message.type === "take") {
      events.hostTaken?.(message.hostId);
      // The selection stays, so no status connection of this tab asks for the host again.
      hosts?.holdSelected(message.hostId, false);
      void giveUpHost(message.hostId).catch(() => undefined);
    }
  });
  let connecting: Promise<unknown> | null = null;
  let connectingHostId: string | null = null;
  let disposed = false;
  let generation = 0;
  let uploadGeneration = 0;
  let capabilities: string[] = [];
  let connectedHost: RemoteTeamHost | null = null;
  const duplicateOperationIds = new Map<string, string>();
  const completedDraftIdsByHost = new Map<string, Set<string>>();
  const draftCleanupRetryHosts = new Set<string>();
  // The host names a draft's preview with the desktop `openbot-attachment:` scheme, so a draft image
  // shows from its local bytes. A discard revokes the URL. A sent draft keeps it until the runtime ends:
  // the pending row of the message shows it until the host's row comes.
  const localDraftPreviews = new Map<string, string>();
  function localDraftPreview(id: string, file: File): string | null {
    const type = rasterImageMimeType(file.name);
    if (!type) return null;
    const url = URL.createObjectURL(new Blob([file], { type }));
    localDraftPreviews.set(id, url);
    return url;
  }
  function revokeLocalDraftPreviews(ids: Iterable<string>): void {
    for (const id of ids) {
      const url = localDraftPreviews.get(id);
      if (!url) continue;
      URL.revokeObjectURL(url);
      localDraftPreviews.delete(id);
    }
  }
  function trackCompletedDraft(id: string, hostId = lockedHostId): void {
    if (!hostId) return;
    // The released API has no draft listing. A request that commits before returning cannot be
    // recovered if its response is lost, so only returned identifiers enter this cleanup set.
    let ids = completedDraftIdsByHost.get(hostId);
    if (!ids) {
      ids = new Set<string>();
      completedDraftIdsByHost.set(hostId, ids);
    }
    ids.add(id);
  }
  function removeCompletedDrafts(idsToRemove: string[], hostId = lockedHostId): void {
    if (!hostId) return;
    const ids = completedDraftIdsByHost.get(hostId);
    if (!ids) return;
    for (const id of idsToRemove) ids.delete(id);
    if (!ids.size) {
      completedDraftIdsByHost.delete(hostId);
      draftCleanupRetryHosts.delete(hostId);
    }
  }
  async function discardCompletedDrafts(hostId = lockedHostId): Promise<void> {
    if (!hostId || lockedHostId !== hostId) return;
    const ids = completedDraftIdsByHost.get(hostId);
    if (!ids?.size) {
      draftCleanupRetryHosts.delete(hostId);
      return;
    }
    for (const id of [...ids]) {
      if (lockedHostId !== hostId) {
        draftCleanupRetryHosts.add(hostId);
        return;
      }
      try {
        await Effect.runPromise(discardAttachmentDraft(teamApi, id).pipe(Effect.mapError((error) => error.cause)));
        ids.delete(id);
        if (!ids.size) completedDraftIdsByHost.delete(hostId);
      } catch {
        // Cleanup is best effort. Keep an unconfirmed draft for a same-host reconnect;
        // never send its identifier to another host.
        draftCleanupRetryHosts.add(hostId);
      }
    }
    if (!completedDraftIdsByHost.has(hostId)) draftCleanupRetryHosts.delete(hostId);
  }
  /** With `sidebar-folders-v1`, the layout has the parent of each folder. */
  async function readSidebarLayout(): Promise<SidebarLayoutSnapshot> {
    const value = capabilities.includes(SIDEBAR_FOLDERS_CAPABILITY)
      ? await request("POST", SIDEBAR_FOLDERS_ROUTES.read, {})
      : await request("GET", TEAM_API_ROUTES.sidebarLayout.state);
    if (!isSidebarLayoutSnapshot(value)) throw new Error(currentText().t("error.remote.invalidData"));
    return value;
  }
  async function request(
    method: string,
    path: string,
    body: TeamProtocolV2Json = {},
    upload?: RemoteFileUpload,
    largeDownload?: RemoteLargeDownload,
  ) {
    if (disposed) throw new Error(currentText().t("webClient.error.connectionClosed"));
    const current = generation;
    const requestHostId = lockedHostId;
    const timeoutMs =
      method === "GET" && path === TEAM_API_ROUTES.me ? 15_000 : remoteWorkspaceReadTimeout(method, path);
    const result = await peer.execute({
      id: crypto.randomUUID(),
      type: "request",
      method,
      path,
      body,
      ...(upload === undefined ? {} : { upload }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(largeDownload === undefined ? {} : { largeDownload }),
    });
    if (disposed || generation !== current) throw new Error(currentText().t("webClient.error.hostChanged"));
    const membershipRead = method === "GET" && path === TEAM_API_ROUTES.me;
    // An action can be forbidden while membership remains valid. Confirm access before clearing drafts.
    if (result.status === 403 && !membershipRead) {
      await request("GET", TEAM_API_ROUTES.me);
      if (disposed || generation !== current) throw new Error(currentText().t("webClient.error.hostChanged"));
    }
    if (result.status === 401 || (result.status === 403 && membershipRead)) {
      const error = new WebHostConnectionError(
        result.status === 401 ? "authentication_required" : "access_ended",
        referenceFrom("http", result.status),
      );
      if (requestHostId) events.accessDenied?.(requestHostId, error);
      throw error;
    }
    if (!result.ok || (result.status ?? 500) >= 400)
      throw new WebHostRequestError(
        hostRefusal(result) ?? currentText().t("webClient.error.requestIncomplete"),
        result.status === undefined ? (result.reference ?? null) : referenceFrom("http", result.status),
      );
    return result.body;
  }
  // The shared Team API requests decode their own responses. A declaration, like `request`, so the
  // draft cleanup above can reach it.
  async function teamApi<T>(
    method: string,
    path: string,
    decode: (value: unknown) => T,
    body?: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
  ): Promise<T> {
    return decode(await request(method, path, body, upload));
  }
  async function teamApiDownload<T>(
    method: string,
    path: string,
    decode: (value: unknown) => T,
    body?: TeamProtocolV2Json,
    upload?: RemoteFileUpload,
  ): Promise<T> {
    return decode(await request(method, path, body, upload, WEB_FILE_DOWNLOAD));
  }
  function requireHost(): RemoteTeamHost {
    if (!connectedHost) throw new Error(currentText().t("webClient.error.hostNotConnected"));
    return connectedHost;
  }
  /**
   * Puts a new agent on the account that the user chose, as on the desktop. The agent exists, so a
   * failed or unsupported account change does not fail the create: it keeps the provider's own sign-in.
   */
  async function withCreatedAgentAccount(
    agent: ClientAgentSummary,
    accountId: string | undefined,
  ): Promise<ClientAgentSummary> {
    if (
      accountId === undefined ||
      accountId === DEFAULT_PROVIDER_ACCOUNT_ID ||
      !capabilities.includes(PROVIDER_ACCOUNTS_CAPABILITY)
    )
      return agent;
    return runTeamEffect(
      setAgentProviderAccount(teamApi, { agentId: agent.id, accountId }).pipe(Effect.mapError((error) => error.cause)),
    ).then(
      () => ({ ...agent, providerAccountId: accountId }),
      () => agent,
    );
  }
  async function listChatColors(): Promise<ChatColors> {
    if (!capabilities.includes(CHAT_COLORS_CAPABILITY)) return { agents: [], members: [] };
    return runTeamEffect(readChatColors(teamApi).pipe(Effect.mapError((error) => error.cause)));
  }
  async function listMembers(): Promise<TeamMemberSummary[]> {
    // The account service has no chat colours. A failed read from the host gives the members without them.
    const [members, colors] = await Promise.all([
      runTeamEffect(directory.listMembers(requireHost().hostId)),
      listChatColors().catch(() => undefined),
    ]);
    const chatColors = new Map(colors?.members.map((entry) => [entry.memberId, entry.color]));
    return members.map((member) => {
      const summary = toTeamMember(member);
      const chatColor = chatColors.get(summary.id);
      return chatColor ? { ...summary, chatColor } : summary;
    });
  }
  const admin: WebAdminRuntime = {
    request: teamApi,
    download: teamApiDownload,
    team: {
      async getPresence() {
        const value = await request("GET", TEAM_API_ROUTES.team.presence);
        if (!isTeamPresenceSnapshot(value)) throw new Error(currentText().t("error.remote.invalidData"));
        return value;
      },
      listMembers,
      async listInvites() {
        return (await runTeamEffect(directory.listInvites(requireHost().hostId)))
          .filter((invite) => invite.revokedAt === null)
          .map(toTeamInvite);
      },
      async createInvite(input) {
        const host = requireHost();
        const invite = input.email
          ? await runTeamEffect(directory.sendInviteEmail(host, { role: input.role, email: input.email }))
          : await runTeamEffect(directory.createInvite(host, input));
        return {
          id: invite.inviteId,
          role: input.role,
          expiresAt: new Date(invite.expiresAt).toISOString(),
          usedAt: null,
          email: input.email ?? null,
          permanent: input.permanent ?? false,
          useCount: 0,
          inviteUrl: invite.inviteUrl,
        };
      },
      // The account service returns nothing useful, so the member is read back. The read before the
      // change refuses an owner, as the desktop does.
      async updateMember(input) {
        const hostId = requireHost().hostId;
        const current = (await listMembers()).find((member) => member.id === input.memberId);
        if (!current || current.role === "owner") throw new Error(currentText().t("webClient.error.memberNotFound"));
        if (input.disabled) await runTeamEffect(directory.leaveHost(hostId, input.memberId));
        else
          await runTeamEffect(
            directory.updateMember(hostId, input.memberId, input.role ?? current.role, input.disabled === false),
          );
        const updated = (await listMembers()).find((member) => member.id === input.memberId);
        if (!updated) throw new Error(currentText().t("webClient.error.memberNotFound"));
        return updated;
      },
      removeMember: (memberId) => runTeamEffect(directory.leaveHost(requireHost().hostId, memberId)),
      revokeInvite: (inviteId) => runTeamEffect(directory.revokeInvite(inviteId)),
    },
  };
  const routinesOnce = () => capabilities.includes(ROUTINES_ONCE_CAPABILITY);
  const channels = teamChannelsApi(teamApi, routinesOnce, true);
  // The host sends an `openbot-avatar:` URL for a channel image, which only the desktop app can open.
  // The image comes through the host connection, one read for each channel and version, and at most
  // `CHANNEL_PICTURE_READS` reads at the same time. A failed read shows the channel without its image
  // until the image gets a new version. A channel list does not wait for the reads: it shows the images
  // that are already here, and the `onPictures` listeners list again when new ones arrive.
  const channelPictures = new Map<string, ChannelPicture>();
  const pictureListeners = new Set<() => void>();
  let pictureReads = 0;
  const waitingPictureReads: (() => void)[] = [];
  async function pictureSlot<T>(read: () => Promise<T>): Promise<T> {
    if (pictureReads >= CHANNEL_PICTURE_READS) await new Promise<void>((resolve) => waitingPictureReads.push(resolve));
    pictureReads += 1;
    try {
      return await read();
    } finally {
      pictureReads -= 1;
      waitingPictureReads.shift()?.();
    }
  }
  /** The picture of one channel version, and whether this call started its read. Null: no picture to read. */
  function channelPicture(channelId: string, source: string): { picture: ChannelPicture; started: boolean } | null {
    const version = capabilities.includes(CHANNEL_PICTURE_CAPABILITY) ? channelPictureVersion(source, channelId) : null;
    if (!version) return null;
    const known = channelPictures.get(channelId);
    if (known?.source === source) return { picture: known, started: false };
    const path = `${CHANNEL_PICTURE_ROUTES.image}?${new URLSearchParams({ channelId, v: version })}`;
    const picture: ChannelPicture = {
      source,
      url: undefined,
      read: pictureSlot(() => request("GET", path)).then(
        (value) =>
          isDynamicRecord(value) &&
          isString(value.mimeType) &&
          isAvatarMimeType(value.mimeType) &&
          isString(value.base64)
            ? `data:${value.mimeType};base64,${value.base64}`
            : null,
        () => null,
      ),
    };
    void picture.read.then((url) => {
      picture.url = url;
    });
    channelPictures.set(channelId, picture);
    return { picture, started: true };
  }
  function readChannelPicture(channelId: string, source: string): Promise<string | null> {
    return channelPicture(channelId, source)?.picture.read ?? Promise.resolve(null);
  }
  async function withChannelPicture<T extends Channel>(channel: T): Promise<T> {
    const source = channel.imageUrl;
    if (!source?.startsWith("openbot-avatar:")) return channel;
    return { ...channel, imageUrl: await readChannelPicture(channel.id, source) };
  }
  /** The channels with the images that are here now. The reads that this list starts end after it. */
  function withKnownChannelPictures<T extends Channel>(list: T[]): T[] {
    const started: Promise<string | null>[] = [];
    const listed = list.map((channel) => {
      const source = channel.imageUrl;
      if (!source?.startsWith("openbot-avatar:")) return channel;
      const entry = channelPicture(channel.id, source);
      if (entry?.started) started.push(entry.picture.read);
      return { ...channel, imageUrl: entry?.picture.url ?? null };
    });
    if (started.length)
      void Promise.all(started).then((urls) => {
        if (urls.some((url) => url !== null)) for (const listener of pictureListeners) listener();
      });
    return listed;
  }
  /** The routine flow routes, sent only to a host that negotiated them. */
  async function routineFlowsRequest<T>(
    method: string,
    path: string,
    decode: (value: unknown) => T,
    body?: TeamProtocolV2Json,
  ): Promise<T> {
    if (!capabilities.includes(ROUTINE_FLOWS_CAPABILITY))
      throw new Error(currentText().t("error.team.routineFlowsUnsupported"));
    if (path === ROUTINE_FLOW_STOP_ROUTES.stopRun && !capabilities.includes(ROUTINE_FLOW_STOP_CAPABILITY))
      throw new Error(currentText().t("error.team.routineFlowStopUnsupported"));
    return teamApi(method, path, decode, body);
  }
  const routineFlows = teamRoutineFlowsApi(routineFlowsRequest);
  const agentRoutines = teamAgentRoutinesApi(teamApi, undefined, routinesOnce);
  const browserView = createRemoteBrowserView(
    (data) => peer.sendHostStreamData(data),
    request,
    () => capabilities.includes(TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY),
    () => capabilities.includes(TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY),
  );
  let liveView: RemoteBrowserView | null = null;
  let liveViewGeneration = 0;
  async function releaseLiveView(): Promise<void> {
    liveViewGeneration += 1;
    const current = liveView;
    liveView = null;
    if (current) {
      await runTeamEffect(current.close()).catch(() => undefined);
    } else {
      // Also cancel an open request that has not installed its session yet.
      browserView.disconnect();
    }
  }
  const viewListeners = new Set<(event: BrowserLiveViewEvent) => void>();
  const emitView = (event: BrowserLiveViewEvent) => {
    for (const listener of viewListeners) listener(event);
  };
  /** Ends the connection of the opened host and gives up its lock. */
  async function closeOpenedHost(): Promise<void> {
    const hostForCleanup = lockedHostId;
    try {
      await peer.cancelUpload().catch(() => undefined);
      await discardCompletedDrafts(hostForCleanup);
      generation += 1;
      await releaseLiveView();
      browserView.disconnect();
      await peer.execute({ id: crypto.randomUUID(), type: "disconnect" });
    } finally {
      releaseHostLock?.();
      releaseHostLock = null;
      lockedHostId = null;
      connectedHost = null;
    }
  }
  /**
   * Closes a host that another tab takes. An attempt in progress ends first: a reconnect keeps the lock and
   * does not acquire it again, so a close before its `connect` leaves a peer without the lock.
   */
  async function giveUpHost(hostId: string): Promise<void> {
    const attempt = connecting;
    if (attempt) {
      if (connectingHostId === hostId) await peer.execute({ id: crypto.randomUUID(), type: "disconnect" });
      await attempt.catch(() => undefined);
    }
    // An attempt for another host already let this host go.
    if (lockedHostId === hostId) await closeOpenedHost();
  }
  async function connectHost(host: RemoteTeamHost, { takeOver = false, early }: WebConnectOptions): Promise<string[]> {
    try {
      await peer.cancelUpload().catch(() => undefined);
      const switchingHost = lockedHostId !== host.hostId;
      const retryDraftCleanup = switchingHost && draftCleanupRetryHosts.has(host.hostId);
      if (switchingHost) await discardCompletedDrafts();
      await releaseLiveView();
      browserView.disconnect();
      if (switchingHost) {
        const previous = { peer, actions: peerActions, releaseLock: releaseHostLock };
        releaseHostLock = null;
        lockedHostId = null;
        // This tab's online status connection of the host becomes the opened host, with its session,
        // path and lock. Otherwise the status connection gives the host up first.
        const handover = hosts?.handOver(host.hostId) ?? null;
        if (handover) {
          handover.actions.current = openedActions;
          handover.peer.setWaitForHost(true);
          ({ peer, actions: peerActions } = handover);
        } else ({ peer, actions: peerActions } = createOpenedPeer());
        retire(previous.peer, previous.actions, previous.releaseLock);
        await hosts?.select(host.hostId);
        const release =
          handover?.releaseLock ??
          (await acquireOpenedWebHostLock(
            accountId,
            host.hostId,
            hostChannel,
            dependencies.acquireHostLock,
            undefined,
            takeOver,
          ));
        if (disposed) {
          release();
          throw new Error(currentText().t("webClient.error.connectionClosed"));
        }
        releaseHostLock = release;
        lockedHostId = host.hostId;
        hosts?.holdSelected(host.hostId, true);
      }
      const current = ++generation;
      connectedHost = host;
      pinWebHostKey(accountId, host);
      const result = await peer.execute({
        id: crypto.randomUUID(),
        type: "connect",
        hostId: host.hostId,
        hostPublicKey: host.devicePublicKey,
      });
      if (!result.ok || disposed || current !== generation)
        throw new WebHostRequestError(
          currentText().t("webClient.error.connectionUnavailable"),
          result.ok ? null : (result.reference ?? null),
        );
      const knownProtocol = savedHostProtocol(accountId, host.hostId);
      if (knownProtocol !== undefined) early?.start();
      const support = decodeTeamProtocolSupportV9(await request("GET", TEAM_API_ROUTES.compatibility));
      if (knownProtocol !== undefined && support.protocol.maximum !== knownProtocol) early?.drop();
      const updateDirection = teamProtocolUpdateDirection(
        { minimum: TEAM_PROTOCOL_V3, maximum: TEAM_PROTOCOL_V3 },
        support.protocol,
      );
      if (updateDirection) throw new WebHostIncompatibleError(support, updateDirection);
      capabilities = support.capabilities;
      if (retryDraftCleanup) await discardCompletedDrafts(host.hostId);
      return capabilities;
    } catch (error) {
      capabilities = [];
      connectedHost = null;
      try {
        await peer.execute({ id: crypto.randomUUID(), type: "disconnect" });
      } finally {
        releaseHostLock?.();
        releaseHostLock = null;
        lockedHostId = null;
        hosts?.holdSelected(host.hostId, false);
      }
      throw error;
    }
  }
  return {
    admin,
    ...(hosts ? { hosts } : {}),
    browser: {
      async startLiveView(tabId) {
        const currentGeneration = ++liveViewGeneration;
        const next = await runTeamEffect(
          browserView.open(
            tabId,
            (frame) => emitView({ type: "frame", tabId, ...frame }),
            (reason) =>
              emitView({ type: "stopped", tabId, reason: reason || currentText().t("webClient.error.viewEnded") }),
            (copied) => emitView({ ...copied, tabId }),
          ),
        );
        if (currentGeneration !== liveViewGeneration) {
          await runTeamEffect(next.close()).catch(() => undefined);
          throw new Error(currentText().t("webClient.error.viewChanged"));
        }
        liveView = next;
      },
      async stopLiveView() {
        await releaseLiveView();
      },
      async sendLiveViewInput(input) {
        if (liveView) await runTeamEffect(liveView.input(decodeBrowserViewInputValue(input)));
      },
      onLiveViewEvent(listener) {
        viewListeners.add(listener);
        return () => {
          viewListeners.delete(listener);
        };
      },
    },
    async browserTabs() {
      const value = await request("GET", TEAM_API_ROUTES.browser.tabs);
      if (!Array.isArray(value)) throw new Error(currentText().t("error.remote.invalidData"));
      // The frozen tab list has no field for a person's control or the history state, so the host
      // answers on their own routes.
      const held = capabilities.includes(BROWSER_USER_CONTROL_CAPABILITY)
        ? new Set(decodeBrowserUserControlSnapshot(await request("POST", BROWSER_USER_CONTROL_ROUTES.state, {})).tabIds)
        : new Set<string>();
      const pageStates = capabilities.includes(BROWSER_PAGE_STATE_CAPABILITY)
        ? new Map(
            decodeBrowserPageStateSnapshot(await request("POST", BROWSER_PAGE_STATE_ROUTES.state, {})).tabs.map(
              ({ tabId, ...state }) => [tabId, state],
            ),
          )
        : new Map<string, { canGoBack: boolean; canGoForward: boolean }>();
      return value.map(decodeWebBrowserTab).map((tab) => ({
        ...tab,
        ...(held.has(tab.id) ? { userControl: true as const } : {}),
        ...pageStates.get(tab.id),
      }));
    },
    async openBrowserTab(input) {
      return decodeWebBrowserTab(await request("POST", TEAM_API_ROUTES.browser.open, { ...input }));
    },
    async navigateBrowserTab(input) {
      if (!("url" in input)) {
        await request("POST", TEAM_API_ROUTES.browser.navigate, { ...input });
        return;
      }
      // An older host has no route that moves an existing tab to an address; the browser store
      // opens a new tab for it instead.
      if (!capabilities.includes(TEAM_BROWSER_NAVIGATION_CAPABILITY))
        throw new Error(currentText().t("error.backend.browserNavigateUnsupported"));
      await request("POST", TEAM_API_ROUTES.browser.load, { ...input });
    },
    async reloadBrowserTab(tabId) {
      await request("POST", TEAM_API_ROUTES.browser.reload, { tabId });
    },
    async stopBrowserTab(tabId) {
      if (!capabilities.includes(BROWSER_PAGE_STATE_CAPABILITY))
        throw new Error(currentText().t("error.backend.browserStopUnsupported"));
      decodeBrowserPageStateSnapshot(await request("POST", BROWSER_PAGE_STATE_ROUTES.stop, { tabId }));
    },
    async closeBrowserTab(tabId) {
      await request("POST", TEAM_API_ROUTES.browser.close, { tabId });
    },
    async takeBrowserControl(tabId) {
      if (!capabilities.includes(BROWSER_USER_CONTROL_CAPABILITY))
        throw new Error(currentText().t("error.backend.browserUserControlUnsupported"));
      decodeBrowserUserControlSnapshot(await request("POST", BROWSER_USER_CONTROL_ROUTES.take, { tabId }));
    },
    async releaseBrowserControl(tabId) {
      if (!capabilities.includes(BROWSER_USER_CONTROL_CAPABILITY))
        throw new Error(currentText().t("error.backend.browserUserControlUnsupported"));
      decodeBrowserUserControlSnapshot(await request("POST", BROWSER_USER_CONTROL_ROUTES.release, { tabId }));
    },
    async startBrowserTeach(tabId) {
      if (!capabilities.includes(BROWSER_TEACH_CAPABILITY))
        throw new Error(currentText().t("error.backend.browserTeachUnsupported"));
      await request("POST", BROWSER_TEACH_ROUTES.start, { tabId });
    },
    async stopBrowserTeach(input) {
      if (!capabilities.includes(BROWSER_TEACH_CAPABILITY))
        throw new Error(currentText().t("error.backend.browserTeachUnsupported"));
      return decodeBrowserTeachSteps(
        await request("POST", BROWSER_TEACH_ROUTES.stop, { tabId: input.tabId, save: input.save }),
      );
    },
    async browserPreview(tabId) {
      return decodeWebBrowserPreview(await request("POST", TEAM_API_ROUTES.browser.preview, { tabId }));
    },
    getSidebarLayout: readSidebarLayout,
    async mutateSidebarLayout(action) {
      const folders = capabilities.includes(SIDEBAR_FOLDERS_CAPABILITY);
      // The released route has every folder at the top: it refuses `nest`, and would drop a parent.
      if (!folders && (action.type === "nest" || (action.type === "create" && action.parentId !== undefined)))
        throw new Error(currentText().t("error.team.sidebarFoldersUnsupported"));
      const value = await request(
        "POST",
        folders ? SIDEBAR_FOLDERS_ROUTES.actions : TEAM_API_ROUTES.sidebarLayout.actions,
        { ...action },
      );
      if (!isSidebarLayoutSnapshot(value)) throw new Error(currentText().t("error.remote.invalidData"));
      return value;
    },
    channels: {
      ...channels,
      async listChannels() {
        return withKnownChannelPictures(await channels.listChannels());
      },
      onPictures(listener) {
        pictureListeners.add(listener);
        return () => {
          pictureListeners.delete(listener);
        };
      },
      async readChannel(input) {
        const page = await channels.readChannel(input);
        // A host file URL must not reach the browser; attachments are downloaded through the host.
        return {
          ...page,
          channel: await withChannelPicture(page.channel),
          messages: page.messages.map((entry) => {
            const attachments = entry.message.attachments;
            if (!attachments) return entry;
            return {
              ...entry,
              message: {
                ...entry.message,
                attachments: attachments.map((attachment) => ({ ...attachment, previewUrl: null })),
              },
            };
          }),
        };
      },
      async channelCommand(command) {
        const channel = await channels.channelCommand(command);
        if (command.type === "send") removeCompletedDrafts(command.attachmentDraftIds);
        return withChannelPicture(channel);
      },
      async setChannelImage({ channelId, image }) {
        if (!capabilities.includes(CHANNEL_PICTURE_CAPABILITY))
          throw new Error(currentText().t("error.team.channelPictureUnsupported"));
        const path = `${CHANNEL_PICTURE_ROUTES.image}?${new URLSearchParams({ channelId })}`;
        const value = image
          ? await request(
              "PUT",
              path,
              {},
              { name: "channel-image", mimeType: image.mimeType, base64: bytesToBase64(image.bytes) },
            )
          : await request("DELETE", path);
        if (!isChannel(value)) throw new Error(currentText().t("error.remote.invalidData"));
        return withChannelPicture(value);
      },
    },
    async currentMemberId() {
      const value = await request("GET", TEAM_API_ROUTES.me);
      if (!isDynamicRecord(value)) throw new Error(currentText().t("error.remote.invalidData"));
      return requiredString(value, "id");
    },
    respondToBrowserSecret: (input) =>
      Effect.runPromise(respondToBrowserSecret(teamApi, input).pipe(Effect.mapError((error) => error.cause))),
    respondToTakeover: (input) =>
      Effect.runPromise(respondToBrowserTakeover(teamApi, input).pipe(Effect.mapError((error) => error.cause))),
    listHosts: () => runTeamEffect(directory.listHosts()),
    leaveHost: (hostId, membershipId) => runTeamEffect(directory.leaveHost(hostId, membershipId)),
    async removeOwnedHost(hostId) {
      const response = await accountFetch(`/api/browser/v2/remote/hosts/${encodeURIComponent(hostId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "X-OpenBot-Browser": "1", "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(currentText().t("server.settings.actionFailed"));
    },
    async previewInvite(url) {
      const value = await runTeamEffect(directory.previewInvite(url));
      return {
        serverId: value.hostId,
        serverName: value.hostName,
        apiHostname: new URL(url).hostname,
        role: value.role,
        expiresAt: new Date(value.expiresAt).toISOString(),
        emailBound: value.emailBound,
        permanent: value.expiresAt === 0,
      };
    },
    acceptInvite: (url) => runTeamEffect(directory.acceptInvite(url)),
    async connect(host, options) {
      // An attempt that waits for an offline host has no deadline, so another host replaces it.
      if (connecting && waitingHostId !== null && waitingHostId !== host.hostId) {
        const previous = connecting;
        await peer.execute({ id: crypto.randomUUID(), type: "disconnect" });
        await previous.catch(() => undefined);
      }
      if (connecting || disposed) throw new Error(currentText().t("webClient.error.connectionChanging"));
      const attempt = connectHost(host, options ?? {});
      connecting = attempt;
      connectingHostId = host.hostId;
      try {
        return await attempt;
      } finally {
        if (connecting === attempt) {
          connecting = null;
          connectingHostId = null;
          waitingHostId = null;
        }
      }
    },
    async disconnect() {
      try {
        await closeOpenedHost();
      } finally {
        void hosts?.select(null);
      }
    },
    async listAgents() {
      return guardedListDecoder(isClientAgentSummary, "agents")(await request("GET", TEAM_API_ROUTES.agents.all));
    },
    async conversation(id, before) {
      if (!capabilities.includes("conversation-pagination")) {
        return decodeWebConversationSnapshot(await request("GET", TEAM_API_ROUTES.agent.conversation(id)));
      }
      const query = new URLSearchParams({ limit: "50", ...(before ? { before } : {}) });
      return decodeWebConversationPage(await request("GET", `${TEAM_API_ROUTES.agent.conversationPage(id)}?${query}`));
    },
    async conversationAround(id, messageId) {
      if (!capabilities.includes("conversation-pagination"))
        return decodeWebConversationSnapshot(await request("GET", TEAM_API_ROUTES.agent.conversation(id)));
      const query = new URLSearchParams({ limit: "50", around: messageId });
      return decodeWebConversationPage(await request("GET", `${TEAM_API_ROUTES.agent.conversationPage(id)}?${query}`));
    },
    async markRead(id, throughMessageId) {
      const value = await request("POST", TEAM_API_ROUTES.agent.conversationRead(id), { throughMessageId });
      if (!isConversationReadState(value)) throw new Error(currentText().t("error.remote.invalidData"));
      return value;
    },
    async markUnreadFrom(agentId, fromMessageId) {
      if (!capabilities.includes(CONVERSATION_UNREAD_FROM_CAPABILITY))
        throw new Error(currentText().t("error.backend.markUnreadRemoteUnsupported"));
      const value = await request("POST", CONVERSATION_UNREAD_FROM_ROUTE, { agentId, fromMessageId });
      if (!isConversationReadState(value)) throw new Error(currentText().t("error.remote.invalidData"));
      return value;
    },
    async focusUse() {
      await request("POST", FOCUS_USE_ROUTES.ping);
    },
    async deleteMessage(input) {
      if (!capabilities.includes(MESSAGE_DELETE_CAPABILITY))
        throw new Error(currentText().t("error.team.messageDeleteUnsupported"));
      if (input.kind === "agent")
        await request("POST", MESSAGE_DELETE_ROUTES.agent, { agentId: input.agentId, messageId: input.messageId });
      else
        await request("POST", MESSAGE_DELETE_ROUTES.channel, {
          channelId: input.channelId,
          messageId: input.messageId,
        });
    },
    async compactContext(agentId, taskId) {
      if (!capabilities.includes(CONTEXT_COMPACT_CAPABILITY))
        throw new Error(currentText().t("error.team.contextCompactUnsupported"));
      if (taskId === undefined) await request("POST", CONTEXT_COMPACT_ROUTES.compact, { agentId });
      else await request("POST", CONTEXT_COMPACT_ROUTES.compactTask, { agentId, taskId });
    },
    async deleteHistory(input) {
      if (!capabilities.includes(CHAT_HISTORY_CAPABILITY))
        throw new Error(currentText().t("error.team.historyDeleteUnsupported"));
      if (input.kind === "agent") await request("POST", CHAT_HISTORY_ROUTES.agentDelete, { agentId: input.agentId });
      else await request("POST", CHAT_HISTORY_ROUTES.channelDelete, { channelId: input.channelId });
    },
    async clearChannelContext(channelId) {
      if (!capabilities.includes(CHAT_HISTORY_CAPABILITY))
        throw new Error(currentText().t("error.team.channelContextUnsupported"));
      await request("POST", CHAT_HISTORY_ROUTES.channelClear, { channelId });
    },
    async compactChannelContext(channelId) {
      if (!capabilities.includes(CHAT_HISTORY_CAPABILITY))
        throw new Error(currentText().t("error.team.channelContextUnsupported"));
      await request("POST", CHAT_HISTORY_ROUTES.channelCompact, { channelId });
    },
    async listWaits(agentId) {
      if (!capabilities.includes(AGENT_WAITS_CAPABILITY))
        throw new Error(currentText().t("error.team.agentWaitsUnsupported"));
      return decodeAgentWaitsResponse(await request("POST", AGENT_WAITS_ROUTES.list, { agentId }));
    },
    async listPinnedMessages(agentId) {
      if (!capabilities.includes(MESSAGE_PINS_CAPABILITY))
        throw new Error(currentText().t("error.team.messagePinsUnsupported"));
      return decodeMessagePinsResponse(await request("POST", MESSAGE_PINS_ROUTES.list, { agentId }));
    },
    async setMessagePinned(input) {
      if (!capabilities.includes(MESSAGE_PINS_CAPABILITY))
        throw new Error(currentText().t("error.team.messagePinsUnsupported"));
      return decodeMessagePinsResponse(
        await request("POST", MESSAGE_PINS_ROUTES.set, {
          agentId: input.agentId,
          taskId: input.taskId ?? null,
          messageId: input.messageId,
          pinned: input.pinned,
        }),
      );
    },
    async readPendingApproval(input) {
      if (!capabilities.includes(PENDING_APPROVAL_CAPABILITY)) return null;
      return decodePendingApprovalResponse(await request("POST", PENDING_APPROVAL_ROUTES.read, { ...input }));
    },
    async cancelWait(agentId, waitId) {
      if (!capabilities.includes(AGENT_WAITS_CAPABILITY))
        throw new Error(currentText().t("error.team.agentWaitsUnsupported"));
      await request("POST", AGENT_WAITS_ROUTES.cancel, { agentId, waitId });
    },
    async conversationReads() {
      const value = await request("GET", TEAM_API_ROUTES.agents.conversationReads);
      const reads: Record<string, ConversationReadState> = {};
      if (!isDynamicRecord(value)) return reads;
      for (const [agentId, state] of Object.entries(value)) {
        if (isConversationReadState(state)) reads[agentId] = state;
      }
      return reads;
    },
    async react(input) {
      await request("POST", TEAM_API_ROUTES.agent.reactions(input.agentId), {
        messageId: input.messageId,
        emoji: input.emoji,
      });
    },
    async setAvatar(agentId, image) {
      if (!image) {
        await request("DELETE", TEAM_API_ROUTES.agent.avatar(agentId));
        return;
      }
      await request(
        "PUT",
        TEAM_API_ROUTES.agent.avatar(agentId),
        {},
        { name: "avatar", mimeType: image.mimeType, base64: bytesToBase64(image.bytes) },
      );
    },
    async agentAvatar(agentId, avatarUrl) {
      const version = new URL(avatarUrl).searchParams.get("v");
      if (!version) throw new Error(currentText().t("error.remote.invalidData"));
      const value = await request(
        "GET",
        `${TEAM_API_ROUTES.agent.avatar(agentId)}?${new URLSearchParams({ v: version })}`,
      );
      if (
        !isDynamicRecord(value) ||
        !isString(value.mimeType) ||
        !isAvatarMimeType(value.mimeType) ||
        !isString(value.base64)
      )
        throw new Error(currentText().t("error.remote.invalidData"));
      return `data:${value.mimeType};base64,${value.base64}`;
    },
    async send(id, text, attachmentDraftIds, replyToMessageId = null, clientMessageId) {
      const result = await request("POST", TEAM_API_ROUTES.agent.messages(id), {
        text,
        attachmentDraftIds,
        replyToMessageId,
        // The host uses this browser's zone for a routine the agent creates from the message.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        // A host with `message-client-id-v1` answers a retry with the first receipt.
        ...(clientMessageId ? { clientMessageId } : {}),
      });
      if (!isQueuedMessageReceipt(result)) throw new Error(currentText().t("webClient.error.sendUnconfirmed"));
      removeCompletedDrafts(attachmentDraftIds);
      return result.deliveries[0]?.id ?? result.messageId;
    },
    stop: (id, turnId) =>
      Effect.runPromise(interruptAgentTurn(teamApi, id, turnId).pipe(Effect.mapError((error) => error.cause))),
    queue: (id) => teamApi("GET", TEAM_API_ROUTES.agent.queue(id), (value) => queueSnapshot(id, value)),
    editQueue: ({ agentId, ...edit }) =>
      teamApi("POST", TEAM_API_ROUTES.agent.queueEdit(agentId), (value) => queueSnapshot(agentId, value), edit),
    cancelQueued: (input) =>
      Effect.runPromise(cancelQueuedMessage(teamApi, input).pipe(Effect.mapError((error) => error.cause))),
    steerQueued: (input) =>
      Effect.runPromise(steerQueuedMessage(teamApi, input).pipe(Effect.mapError((error) => error.cause))),
    updateQueued: (input) =>
      Effect.runPromise(updateQueuedMessage(teamApi, input).pipe(Effect.mapError((error) => error.cause))),
    reorderQueue: (input) =>
      Effect.runPromise(reorderQueue(teamApi, input).pipe(Effect.mapError((error) => error.cause))),
    async approve(input) {
      await request("POST", TEAM_API_ROUTES.respond.approval, { ...input });
    },
    async answer(input) {
      await request("POST", TEAM_API_ROUTES.respond.prompt, { ...input });
    },
    async upload(file) {
      const uploadHostGeneration = generation;
      const currentUpload = ++uploadGeneration;
      const support = {
        eml: capabilities.includes("eml-attachments"),
        media: capabilities.includes("media-attachments"),
        zip: capabilities.includes("zip-attachments"),
        mp4: capabilities.includes("mp4-attachments"),
        svg: capabilities.includes("svg-attachments"),
        anyFile: capabilities.includes("any-file-attachments"),
      };
      if (!support.anyFile) assertSupportedAttachmentName(file.name);
      if (!isSupportedAttachmentNameFor(file.name, support))
        throw new Error(currentText().t("webClient.error.fileType"));
      if (file.size > WEB_FILE_BYTES) throw new Error(currentText().t("error.remote.fileTooLarge"));
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (currentUpload !== uploadGeneration || uploadHostGeneration !== generation)
        throw new Error(currentText().t("webClient.error.uploadCancelled"));
      const mimeType = file.type || "application/octet-stream";
      const value = await Effect.runPromise(
        uploadAttachmentDraft(teamApi, {
          name: file.name,
          mimeType,
          base64: bytesToBase64(bytes),
          maxBytes: WEB_FILE_BYTES,
        }).pipe(Effect.mapError((error) => error.cause)),
      );
      if (currentUpload !== uploadGeneration) {
        if (uploadHostGeneration === generation)
          await Effect.runPromise(
            discardAttachmentDraft(teamApi, value.id).pipe(Effect.mapError((error) => error.cause)),
          );
        throw new Error(currentText().t("webClient.error.uploadCancelled"));
      }
      trackCompletedDraft(value.id, uploadHostGeneration === generation ? lockedHostId : null);
      return { ...value, previewUrl: value.kind === "image" ? localDraftPreview(value.id, file) : null };
    },
    setTyping(agentId, typing) {
      peer.setTyping(agentId, typing);
    },
    async cancelUpload() {
      uploadGeneration += 1;
      await peer.cancelUpload();
    },
    async discard(id) {
      await Effect.runPromise(discardAttachmentDraft(teamApi, id).pipe(Effect.mapError((error) => error.cause)));
      removeCompletedDrafts([id]);
      revokeLocalDraftPreviews([id]);
    },
    async download(id) {
      return decodeWebFile(await request("GET", TEAM_API_ROUTES.attachment(id), {}, undefined, WEB_FILE_DOWNLOAD));
    },
    async sharedFile(path) {
      const query = new URLSearchParams({ path });
      return decodeWebFile(
        await request("GET", `${TEAM_API_ROUTES.sharedFiles}?${query}`, {}, undefined, WEB_FILE_DOWNLOAD),
      );
    },
    async workspaceFile(agentId, path) {
      // The released URL spells the agent `botId`.
      const query = new URLSearchParams({ botId: agentId, path });
      return decodeWebFile(
        await request("GET", `${TEAM_API_ROUTES.workspaceFiles}?${query}`, {}, undefined, WEB_FILE_DOWNLOAD),
      );
    },
    async workspaceDirectory(agentId, path) {
      if (!capabilities.includes(WORKSPACE_DIRECTORY_CAPABILITY))
        throw new Error(currentText().t("error.team.workspaceDirectoryUnsupported"));
      return decodeWorkspaceDirectory(await request("POST", WORKSPACE_DIRECTORY_ROUTES.list, { agentId, path }));
    },
    routineFlows,
    updateRoutine: agentRoutines.updateRoutine,
    testRoutine: agentRoutines.testRoutine,
    listHiddenAgents: () => runTeamEffect(listHiddenAgents(teamApi).pipe(Effect.mapError((error) => error.cause))),
    setAgentHidden: (input) =>
      runTeamEffect(setAgentHidden(teamApi, input).pipe(Effect.mapError((error) => error.cause))),
    async listAgentColors() {
      if (!capabilities.includes(AGENT_COLORS_CAPABILITY)) return { agents: [] };
      return runTeamEffect(readAgentColors(teamApi).pipe(Effect.mapError((error) => error.cause)));
    },
    listChatColors,
    sidebarPins: {
      read: () => runTeamEffect(readSidebarPins(teamApi).pipe(Effect.mapError((error) => error.cause))),
      set: (items) => runTeamEffect(setSidebarPins(teamApi, items).pipe(Effect.mapError((error) => error.cause))),
      seed: (items) => runTeamEffect(seedSidebarPins(teamApi, items).pipe(Effect.mapError((error) => error.cause))),
    },
    async listAgentNotificationLevels(hostId) {
      if (hostId !== lockedHostId) {
        if (!hosts) throw new Error(currentText().t("webClient.error.hostChanged"));
        return hosts.agentNotificationLevels(hostId);
      }
      if (!capabilities.includes(AGENT_NOTIFICATION_LEVELS_CAPABILITY)) return { server: null, agents: [] };
      return runTeamEffect(listAgentNotificationLevels(teamApi).pipe(Effect.mapError((error) => error.cause)));
    },
    async setAgentNotificationLevel(input) {
      if (!capabilities.includes(AGENT_NOTIFICATION_LEVELS_CAPABILITY))
        throw new Error(currentText().t("error.team.agentNotificationLevelsUnsupported"));
      return runTeamEffect(setAgentNotificationLevel(teamApi, input).pipe(Effect.mapError((error) => error.cause)));
    },
    async notificationSettings(hostId) {
      if (hostId !== lockedHostId) {
        if (!hosts) throw new Error(currentText().t("webClient.error.hostChanged"));
        return hosts.notificationSettings(hostId);
      }
      const [agents, levels] = await Promise.all([
        guardedListDecoder(isClientAgentSummary, "agents")(await request("GET", TEAM_API_ROUTES.agents.all)),
        capabilities.includes(AGENT_NOTIFICATION_LEVELS_CAPABILITY)
          ? runTeamEffect(listAgentNotificationLevels(teamApi).pipe(Effect.mapError((error) => error.cause)))
          : null,
      ]);
      return { agents, levels };
    },
    async setHostAgentNotificationLevel(hostId, input) {
      if (hostId !== lockedHostId) {
        if (!hosts) throw new Error(currentText().t("webClient.error.hostChanged"));
        return hosts.setAgentNotificationLevel(hostId, input);
      }
      if (!capabilities.includes(AGENT_NOTIFICATION_LEVELS_CAPABILITY))
        throw new Error(currentText().t("error.team.agentNotificationLevelsUnsupported"));
      return runTeamEffect(setAgentNotificationLevel(teamApi, input).pipe(Effect.mapError((error) => error.cause)));
    },
    async setOwnServerNotificationLevel(hostId, level) {
      if (hostId !== lockedHostId) {
        if (!hosts) throw new Error(currentText().t("webClient.error.hostChanged"));
        return hosts.setOwnServerNotificationLevel(hostId, level);
      }
      if (!capabilities.includes(AGENT_NOTIFICATION_LEVELS_CAPABILITY))
        throw new Error(currentText().t("error.team.agentNotificationLevelsUnsupported"));
      return runTeamEffect(setOwnServerNotificationLevel(teamApi, level).pipe(Effect.mapError((error) => error.cause)));
    },
    async models() {
      const models = guardedListDecoder(
        isClientAgentModelOption,
        "models",
      )(await request("GET", TEAM_API_ROUTES.agents.models));
      // The fast tiers and the picker listing are optional: when a route fails, the picker gets the
      // models with no Fast switch or listing.
      const [fast, listings] = await Promise.all([
        // Only `agent-speed-v1` lists Ultrafast tiers and Claude models; an older host keeps `agent-fast-mode-v1`.
        capabilities.includes(AGENT_SPEED_CAPABILITY)
          ? request("POST", AGENT_SPEED_ROUTES.models, {}).then(decodeAgentFastModels, () => [])
          : capabilities.includes(AGENT_FAST_MODE_CAPABILITY)
            ? request("POST", AGENT_FAST_MODE_ROUTES.models, {}).then(decodeAgentFastModels, () => [])
            : [],
        capabilities.includes(MODEL_VISIBILITY_CAPABILITY)
          ? request("POST", MODEL_VISIBILITY_ROUTES.listing, {}).then(decodeAgentModelListings, () => [])
          : [],
      ]);
      return withModelListings(withFastServiceTiers(models, fast), listings);
    },
    async status() {
      const value = await request("GET", TEAM_API_ROUTES.agents.status);
      if (!isAgentStatus(value)) throw new Error(currentText().t("error.remote.invalidData"));
      return value;
    },
    async accountUsage() {
      // Whether an account works on credits is optional: when its read fails, the reading shows as before.
      const [value, credits] = await Promise.all([
        request("GET", TEAM_API_ROUTES.agents.usage),
        capabilities.includes(USAGE_CREDITS_CAPABILITY)
          ? request("POST", USAGE_CREDITS_ROUTES.list, {})
              .then((rows) => decodeUsageCredits(isDynamicRecord(rows) ? rows.accounts : null))
              .catch(() => [])
          : [],
      ]);
      if (!isAccountUsage(value)) throw new Error(currentText().t("error.remote.invalidData"));
      return withUsageCredits(value, credits);
    },
    async createAgent(input) {
      // The released route keeps the nearest hue. The exact colour goes on `agent-colors-v1` after it.
      // The released route does not carry the account either, so it goes on `provider-accounts-v1`
      // after it, as on the desktop.
      const { avatarColor, providerAccountId, ...profile } = input;
      const value = await request("POST", TEAM_API_ROUTES.agents.all, { ...profile });
      if (!isClientAgentSummary(value)) throw new Error(currentText().t("error.remote.invalidData"));
      const agent: ClientAgentSummary = await withCreatedAgentAccount(value, providerAccountId);
      if (!avatarColor || !capabilities.includes(AGENT_COLORS_CAPABILITY)) return agent;
      // The agent exists, so a failed colour change does not fail the create: the agent keeps its hue.
      const colored = await runTeamEffect(
        setAgentColor(teamApi, { agentId: agent.id, color: avatarColor }).pipe(Effect.mapError((error) => error.cause)),
      ).then(
        (colors) => colors.agents.some((entry) => entry.agentId === agent.id),
        () => false,
      );
      return colored ? { ...agent, avatarColor } : agent;
    },
    async duplicateAgent(agentId) {
      if (!capabilities.includes("agent-duplication")) throw new Error(currentText().t("webClient.error.duplication"));
      const operationKey = `${lockedHostId ?? ""}\0${agentId}`;
      const operationId = duplicateOperationIds.get(operationKey) ?? crypto.randomUUID();
      duplicateOperationIds.set(operationKey, operationId);
      const value = await request("POST", TEAM_API_ROUTES.agent.duplicate(agentId), { operationId });
      if (!isDynamicRecord(value) || !isClientAgentSummary(value.agent) || !isSidebarLayoutSnapshot(value.layout))
        throw new Error(currentText().t("error.remote.invalidData"));
      duplicateOperationIds.delete(operationKey);
      // The released route answers the layout without the parents of the folders. The copy exists, so a
      // failed read keeps that layout rather than failing the copy; the next layout event has the parents.
      const answered = value.layout;
      const layout = capabilities.includes(SIDEBAR_FOLDERS_CAPABILITY)
        ? await readSidebarLayout().catch(() => answered)
        : answered;
      return { agent: value.agent, layout } satisfies DuplicateAgentResult;
    },
    async updateAgent(input) {
      // A move at a usage limit also sends the held message, so it goes on `agent-usage-limit-v1`. The
      // move carries only the model fields.
      if (input.leaveUsageLimit !== undefined) {
        const { agentId, provider, model, reasoningEffort, providerAccountId } = input;
        if (
          input.leaveUsageLimit !== true ||
          provider === undefined ||
          model === undefined ||
          reasoningEffort === undefined ||
          !capabilities.includes(AGENT_USAGE_LIMIT_CAPABILITY) ||
          Object.entries(input).some(([key, value]) => value !== undefined && !USAGE_LIMIT_MOVE_FIELDS.has(key))
        )
          throw new Error(currentText().t("error.team.usageLimitUnsupported"));
        await request("POST", AGENT_USAGE_LIMIT_ROUTES.switch, {
          agentId,
          provider,
          model,
          reasoningEffort,
          ...(providerAccountId ? { providerAccountId } : {}),
        });
        return;
      }
      // The released agent route ignores the account, so it goes on `provider-accounts-v1` after the
      // profile: a provider change there returns the agent to the new provider's own sign-in.
      // Backup models go on `agent-backup-models-v1` before this call: the agent route does not carry them.
      const {
        providerAccountId,
        backupModels: _backupModels,
        leaveUsageLimit: _leaveUsageLimit,
        avatarColor,
        chatColor,
        ...fields
      } = input;
      if (providerAccountId !== undefined && !capabilities.includes(PROVIDER_ACCOUNTS_CAPABILITY))
        throw new Error(currentText().t("error.team.providersUnsupported"));
      // The released agent route does not carry the chat colour, so it goes on `chat-colors-v1` first.
      // Without the capability, a change of only the chat colour fails. With other fields, they change
      // and the chat colour stays.
      const chatColors = capabilities.includes(CHAT_COLORS_CAPABILITY);
      if (
        chatColor !== undefined &&
        !chatColors &&
        Object.entries(input).every(([key, value]) => key === "agentId" || key === "chatColor" || value === undefined)
      )
        throw new Error(currentText().t("error.team.chatColorsUnsupported"));
      if (chatColors && chatColor !== undefined)
        await runTeamEffect(
          setAgentChatColor(teamApi, { agentId: input.agentId, color: chatColor }).pipe(
            Effect.mapError((error) => error.cause),
          ),
        );
      // The released agent route does not carry the exact colour. With `agent-colors-v1` it goes on its
      // own route first. That route also sets the nearest hue, so the profile change then leaves the hue
      // out: on the released route a hue removes the colour. A removed colour keeps the hue, which then
      // sets the colour that the user chose. The released route removes the colour only when the hue
      // changes, so a removed colour always goes on the colour route. Without the capability, only the
      // hue goes.
      const colors = capabilities.includes(AGENT_COLORS_CAPABILITY);
      const { avatarHue: _avatarHue, ...withoutHue } = fields;
      const profile = colors && avatarColor ? withoutHue : fields;
      if (colors && avatarColor !== undefined)
        await runTeamEffect(
          setAgentColor(teamApi, { agentId: input.agentId, color: avatarColor }).pipe(
            Effect.mapError((error) => error.cause),
          ),
        );
      // The released agent route refuses a change without a profile field. When a colour went on its
      // own route above and nothing else changed, there is nothing to send (#5708).
      const colourRouted = (chatColors && chatColor !== undefined) || (colors && avatarColor !== undefined);
      if (!colourRouted || Object.entries(profile).some(([key, value]) => key !== "agentId" && value !== undefined))
        await request("PATCH", TEAM_API_ROUTES.agent.one(input.agentId), { ...profile });
      if (providerAccountId === undefined) return;
      await runTeamEffect(
        setAgentProviderAccount(teamApi, { agentId: input.agentId, accountId: providerAccountId }).pipe(
          Effect.mapError((error) => error.cause),
        ),
      );
    },
    async deleteAgent(agentId) {
      if (connectedHost && !canAdministerServer(connectedHost.role))
        throw new Error(currentText().t("error.team.membersCannotDeleteAgents"));
      await Effect.runPromise(deleteAgent(teamApi, agentId).pipe(Effect.mapError((error) => error.cause)));
    },
    async search(agentId, query, cursor, includeSideThreads = false) {
      // Only `thread-message-search-v1` names the side thread of a result.
      if (includeSideThreads && capabilities.includes(THREAD_MESSAGE_SEARCH_CAPABILITY))
        return teamApi("POST", THREAD_MESSAGE_SEARCH_ROUTES.search, decodeThreadMessageSearchResponse, {
          query,
          agentId: agentId ?? null,
          cursor: cursor ?? null,
          limit: THREAD_MESSAGE_SEARCH_PAGE_LIMIT,
        });
      const params = new URLSearchParams({
        ...(agentId ? { botId: agentId } : {}),
        q: query,
        limit: "50",
        ...(cursor ? { cursor } : {}),
      });
      const value = await request("GET", `${TEAM_API_ROUTES.messages.search}?${params}`);
      if (
        !isDynamicRecord(value) ||
        !Array.isArray(value.results) ||
        typeof value.total !== "number" ||
        (value.nextCursor !== null && typeof value.nextCursor !== "string")
      )
        throw new Error(currentText().t("error.remote.invalidData"));
      const results = value.results.map((item) => {
        if (!isDynamicRecord(item) || typeof item.agentId !== "string" || !isConversationMessage(item.message))
          throw new Error(currentText().t("error.remote.invalidData"));
        return { agentId: item.agentId, message: item.message };
      });
      return { results, total: value.total, nextCursor: value.nextCursor };
    },
    async searchFiles(query, cursor) {
      // The workspace hides the Files filter while the host does not serve `conversation-file-search-v1`.
      if (!capabilities.includes(CONVERSATION_FILE_SEARCH_CAPABILITY))
        throw new Error(currentText().t("error.team.conversationFileSearchUnsupported"));
      return teamApi("POST", CONVERSATION_FILE_SEARCH_ROUTES.search, decodeConversationFileSearchResponse, {
        query,
        cursor: cursor ?? null,
        limit: CONVERSATION_FILE_SEARCH_PAGE_LIMIT,
      });
    },
    async dispose(options) {
      if (options?.sessionsEnded) sessionsEnded = true;
      await discardCompletedDrafts();
      await releaseLiveView();
      browserView.disconnect();
      viewListeners.clear();
      disposed = true;
      generation += 1;
      connectedHost = null;
      duplicateOperationIds.clear();
      revokeLocalDraftPreviews([...localDraftPreviews.keys()]);
      try {
        await Promise.all([peer.dispose(), hosts?.dispose(), ...retiring]);
      } finally {
        releaseHostLock?.();
        releaseHostLock = null;
        hostChannel?.close();
      }
    },
  };
}

/**
 * The largest file that the browser sends or reads through the host connection: the host's limit, as
 * on desktop. The phone keeps its smaller limit, because its native bridge copies each file.
 */
const WEB_FILE_BYTES = TEAM_PROTOCOL_V2_MAX_FILE_BYTES;
/** A file read asks for the larger limit. Without it, the connection refuses a file above the phone's limit. */
const WEB_FILE_DOWNLOAD: RemoteLargeDownload = { maxBytes: WEB_FILE_BYTES };

/** A channel image read through the host. `url` stays undefined until `read` ends; null: no image. */
interface ChannelPicture {
  source: string;
  url: string | null | undefined;
  read: Promise<string | null>;
}

/** Channel image reads that run at the same time, so a long channel list does not fill the connection. */
const CHANNEL_PICTURE_READS = 4;

/** The version of the host's `openbot-avatar://channel/<id>?v=<version>` URL, as mobile reads it. */
function channelPictureVersion(source: string, channelId: string): string | null {
  try {
    const url = new URL(source);
    if (url.hostname !== "channel" || decodeURIComponent(url.pathname.slice(1)) !== channelId) return null;
    return url.searchParams.get("v") || null;
  } catch {
    return null;
  }
}

function decodeWebFile(value: unknown): WebFile {
  if (!isDynamicRecord(value)) throw new Error(currentText().t("error.remote.invalidData"));
  const base64 = requiredString(value, "base64");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  if ((base64.length / 4) * 3 - padding > WEB_FILE_BYTES) throw new Error(currentText().t("error.remote.fileTooLarge"));
  return {
    name: requiredString(value, "name"),
    mimeType: requiredString(value, "mimeType"),
    base64,
  };
}

/**
 * The host's own reason for a refusal. It redacts it; a server failure keeps the generic text. Over
 * WebRTC the host sends a refusal as an error frame, so it arrives as a failed command whose
 * reference is `host/<4xx status>/<code>`.
 */
function hostRefusal(result: RemoteTeamCommandResult): string | null {
  const status = result.ok ? result.status : Number(/^host\/(\d{3})(?:\/|$)/u.exec(result.reference ?? "")?.[1]);
  if (status === undefined || !(status >= 400 && status < 500)) return null;
  const reason = result.ok ? (isDynamicRecord(result.body) ? result.body.error : undefined) : result.error;
  if (!isString(reason) || !reason.trim()) return null;
  const text = reason.trim();
  return text.length > 300 ? `${text.slice(0, 299)}…` : text;
}

function toTeamMember(member: RemoteTeamMember): TeamMemberSummary {
  return {
    id: member.membershipId,
    username: member.email,
    email: member.email,
    name: member.name,
    avatarUrl: member.avatarUrl ?? null,
    role: member.role,
    createdAt: new Date(member.createdAt ?? 0).toISOString(),
    disabled: member.status !== "active",
  };
}

function toTeamInvite(invite: RemoteTeamInvite): TeamInviteSummary {
  return {
    id: invite.inviteId,
    role: invite.role,
    expiresAt: new Date(invite.expiresAt).toISOString(),
    usedAt: invite.usedAt === null ? null : new Date(invite.usedAt).toISOString(),
    email: invite.email,
    permanent: invite.permanent,
    useCount: invite.useCount,
  };
}

function queueSnapshot(agentId: string, value: unknown): QueueSnapshot {
  if (!isQueueSnapshot(value) || value.agentId !== agentId)
    throw new Error(currentText().t("app.errorStatus.queueLoad"));
  return value;
}

function decodeWebBrowserTab(tab: unknown): BrowserTab {
  if (
    !isDynamicRecord(tab) ||
    typeof tab.loading !== "boolean" ||
    (tab.ownerThreadId !== null && typeof tab.ownerThreadId !== "string") ||
    (tab.ownerAgentId !== null && typeof tab.ownerAgentId !== "string")
  )
    throw new Error(currentText().t("error.remote.invalidData"));
  return {
    id: requiredString(tab, "id"),
    title: requiredString(tab, "title"),
    url: requiredString(tab, "url"),
    loading: tab.loading,
    ownerThreadId: tab.ownerThreadId,
    ownerAgentId: tab.ownerAgentId,
  };
}

function decodeWebBrowserPreview(value: unknown): BrowserPreview {
  if (
    !isDynamicRecord(value) ||
    !isString(value.dataUrl) ||
    value.dataUrl.length > 2_000_000 ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.dataUrl) ||
    !isNumber(value.width) ||
    !Number.isSafeInteger(value.width) ||
    value.width < 1 ||
    value.width > 960 ||
    !isNumber(value.height) ||
    !Number.isSafeInteger(value.height) ||
    value.height < 1 ||
    value.height > 600
  )
    throw new Error(currentText().t("error.remote.invalidData"));
  return { dataUrl: value.dataUrl, width: value.width, height: value.height };
}

function decodeWebConversationSnapshot(value: unknown): ConversationPage {
  if (!isConversationWithReadState(value)) throw new Error(currentText().t("error.remote.invalidData"));
  return { ...value, references: {}, pageInfo: { hasOlder: false, olderCursor: null } };
}

function decodeWebConversationPage(value: unknown): ConversationPage {
  if (
    !isConversationWithReadState(value) ||
    !isDynamicRecord(value) ||
    !isDynamicRecord(value.pageInfo) ||
    typeof value.pageInfo.hasOlder !== "boolean" ||
    (value.pageInfo.olderCursor !== null && typeof value.pageInfo.olderCursor !== "string") ||
    (value.pageInfo.hasOlder && !value.pageInfo.olderCursor) ||
    !isDynamicRecord(value.references)
  )
    throw new Error(currentText().t("error.remote.invalidData"));
  const references: ConversationPage["references"] = {};
  for (const [id, message] of Object.entries(value.references)) {
    if (!isConversationMessage(message)) throw new Error(currentText().t("error.remote.invalidData"));
    references[id] = message;
  }
  return {
    ...value,
    references,
    pageInfo: {
      hasOlder: value.pageInfo.hasOlder,
      olderCursor: value.pageInfo.olderCursor,
      // history-extent-v1: the host sends the unloaded length only when it was negotiated.
      ...optionalHistoryExtent(value.pageInfo),
    },
  };
}
