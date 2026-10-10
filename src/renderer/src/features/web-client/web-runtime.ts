import {
  assertSupportedAttachmentName,
  attachmentFileExtension,
  supportedAttachmentExtensions,
} from "@openbot/contracts/attachment-files";
import type {
  AccountUsage,
  AgentEvent,
  AgentModelOption,
  AgentStatus,
  AgentSummary,
  AttachmentSummary,
  AvatarImageInput,
  BrowserLiveViewEvent,
  BrowserNavigateInput,
  BrowserOpenInput,
  BrowserPreview,
  BrowserTab,
  CancelQueuedMessageInput,
  ConversationPage,
  ConversationReadState,
  ConversationSearchPage,
  CreateAgentInput,
  DuplicateAgentResult,
  EditQueuedMessageInput,
  InvitePreview,
  QueueSnapshot,
  ReorderQueueInput,
  RespondToApprovalInput,
  RespondToBrowserSecretInput,
  RespondToBrowserTakeoverInput,
  RespondToPromptInput,
  SetMessageReactionInput,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  SteerQueuedMessageInput,
  TeamInviteSummary,
  TeamMemberSummary,
  TeamRealtimeEvent,
  UpdateAgentInput,
  UpdateQueuedMessageInput,
  WorkspaceDirectory,
} from "@openbot/contracts/ipc";
import {
  decodeWorkspaceDirectory,
  isAccountUsage,
  isAgentModelOption,
  isAgentStatus,
  isAgentSummary,
  isConversationMessage,
  isConversationReadState,
  isConversationWithReadState,
  isQueuedMessageReceipt,
  isQueueSnapshot,
  isSidebarLayoutSnapshot,
  isTeamPresenceSnapshot,
} from "@openbot/contracts/ipc";
import { guardedListDecoder, requiredString } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  decodeBrowserViewInputValue,
  TEAM_BROWSER_VIEW_CLIPBOARD_CAPABILITY,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { TEAM_BROWSER_NAVIGATION_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import { type TeamProtocolSupportV1, teamProtocolUpdateDirection } from "@openbot/contracts/team-protocol/v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import { decodeTeamProtocolSupportV7Base } from "@openbot/contracts/team-protocol/v7-base";
import {
  WORKSPACE_DIRECTORY_CAPABILITY,
  WORKSPACE_DIRECTORY_ROUTES,
} from "@openbot/contracts/team-protocol/workspace-directory-v1";
import { runTeamEffect } from "@openbot/team-client";
import { createRemoteBrowserView, type RemoteBrowserView } from "@openbot/team-client/browser-view";
import {
  RemoteDirectoryError,
  RemoteTeamDirectoryClient,
  type RemoteTeamHost,
  type RemoteTeamInvite,
  type RemoteTeamMember,
} from "@openbot/team-client/remote-directory";
import {
  createRemoteTeamPeer,
  MOBILE_ATTACHMENT_BYTES,
  type RemoteFileUpload,
  type RemoteTeamConnectionUpdate,
} from "@openbot/team-client/remote-peer";
import { remoteWorkspaceReadTimeout } from "@openbot/team-client/remote-recovery";
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
  teamChannelsApi,
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
  team: ServerAdminPort;
}

export interface WebFile {
  name: string;
  mimeType: string;
  base64: string;
}

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
  closeBrowserTab(tabId: string): Promise<void>;
  respondToBrowserSecret?: (input: RespondToBrowserSecretInput) => Promise<void>;
  getSidebarLayout?: () => Promise<SidebarLayoutSnapshot>;
  mutateSidebarLayout?: (action: SidebarLayoutAction) => Promise<SidebarLayoutSnapshot>;
  /** The host's channel routes. A channel page arrives without host file URLs. */
  channels?: TeamChannelsApi;
  /** The team member this connection signs in as, which is how the host names this reader's messages. */
  currentMemberId?: () => Promise<string>;
  respondToTakeover(input: RespondToBrowserTakeoverInput): Promise<void>;
  listHosts(): Promise<RemoteTeamHost[]>;
  /** Ends this account's membership of a host. The account service refuses the owner. */
  leaveHost(hostId: string, membershipId: string): Promise<void>;
  removeOwnedHost?: (hostId: string) => Promise<void>;
  previewInvite(url: string): Promise<InvitePreview>;
  acceptInvite(url: string): Promise<RemoteTeamHost>;
  connect(host: RemoteTeamHost): Promise<string[]>;
  disconnect(): Promise<void>;
  listAgents(): Promise<AgentSummary[]>;
  conversation(agentId: string, before?: string): Promise<ConversationPage>;
  /** Marks this member's messages from the agent read through `throughMessageId`, or all when it is null. */
  markRead(agentId: string, throughMessageId: string | null): Promise<ConversationReadState>;
  /** This member's read state for each agent, keyed by agent id. Invalid entries are left out. */
  conversationReads(): Promise<Record<string, ConversationReadState>>;
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
  react(input: SetMessageReactionInput): Promise<void>;
  setAvatar(agentId: string, image: AvatarImageInput | null): Promise<void>;
  models(): Promise<AgentModelOption[]>;
  status(): Promise<AgentStatus>;
  accountUsage?: () => Promise<AccountUsage>;
  createAgent(input: CreateAgentInput): Promise<AgentSummary>;
  duplicateAgent(agentId: string): Promise<DuplicateAgentResult>;
  updateAgent(input: UpdateAgentInput): Promise<void>;
  deleteAgent(agentId: string): Promise<void>;
  /** Searches one agent's conversation, or every conversation on the host when `agentId` is not set. */
  search(agentId: string | undefined, query: string, cursor?: string): Promise<ConversationSearchPage>;
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
  /** An event of a host this tab has not opened that a notification can show. */
  hostNotice?(hostId: string, event: WebHostNotice, agents: AgentSummary[]): void;
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
  const peer = dependencies.createPeer(
    {
      current: {
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
      },
    },
    { waitForHost: true },
  );
  let releaseHostLock: (() => void) | null = null;
  let lockedHostId: string | null = null;
  const hostChannel = dependencies.openHostChannel?.(accountId) ?? null;
  const hosts = hostChannel
    ? createWebHostConnections({
        accountId,
        channel: hostChannel,
        actions: sessionActions,
        createPeer: dependencies.createPeer,
        acquireHostLock: dependencies.acquireHostLock,
        pinHostKey: (host) => pinWebHostKey(accountId, host),
        onState: (hostId, state) => events.hostState?.(hostId, state),
        onSessionRevoked: () => events.hostSessionRevoked?.(),
        // Without a listener, the status connections read no agent list.
        ...(events.hostNotice
          ? {
              onNotice: (hostId: string, event: WebHostNotice, agents: AgentSummary[]) =>
                events.hostNotice?.(hostId, event, agents),
            }
          : {}),
      })
    : undefined;
  // Another tab asks for the host that this tab has open: it stays here.
  hostChannel?.addEventListener("message", (event) => {
    const message = decodeWebHostTabMessage(event.data);
    if (message?.type === "release" && message.hostId === lockedHostId)
      hostChannel.postMessage({
        type: "busy",
        hostId: message.hostId,
        requestId: message.requestId,
      } satisfies WebHostTabMessage);
  });
  let connecting: Promise<unknown> | null = null;
  let disposed = false;
  let generation = 0;
  let uploadGeneration = 0;
  let capabilities: string[] = [];
  let connectedHost: RemoteTeamHost | null = null;
  const duplicateOperationIds = new Map<string, string>();
  const completedDraftIdsByHost = new Map<string, Set<string>>();
  const draftCleanupRetryHosts = new Set<string>();
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
  async function request(method: string, path: string, body: TeamProtocolV2Json = {}, upload?: RemoteFileUpload) {
    if (disposed) throw new Error(currentText().t("webClient.error.connectionClosed"));
    const current = generation;
    const requestHostId = lockedHostId;
    const result = await peer.execute({
      id: crypto.randomUUID(),
      type: "request",
      method,
      path,
      body,
      upload,
      timeoutMs: method === "GET" && path === TEAM_API_ROUTES.me ? 15_000 : remoteWorkspaceReadTimeout(method, path),
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
        hostRefusal(result.status, result.body) ?? currentText().t("webClient.error.requestIncomplete"),
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
  function requireHost(): RemoteTeamHost {
    if (!connectedHost) throw new Error(currentText().t("webClient.error.hostNotConnected"));
    return connectedHost;
  }
  async function listMembers(): Promise<TeamMemberSummary[]> {
    return (await runTeamEffect(directory.listMembers(requireHost().hostId))).map(toTeamMember);
  }
  const admin: WebAdminRuntime = {
    request: teamApi,
    team: {
      async getPresence() {
        const value = await request("GET", TEAM_API_ROUTES.team.presence);
        if (!isTeamPresenceSnapshot(value)) throw new Error("The host returned invalid presence.");
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
  const channels = teamChannelsApi(teamApi);
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
  async function connectHost(host: RemoteTeamHost): Promise<string[]> {
    try {
      await peer.cancelUpload().catch(() => undefined);
      const switchingHost = lockedHostId !== host.hostId;
      const retryDraftCleanup = switchingHost && draftCleanupRetryHosts.has(host.hostId);
      if (switchingHost) await discardCompletedDrafts();
      await releaseLiveView();
      browserView.disconnect();
      if (switchingHost) {
        await peer.execute({ id: crypto.randomUUID(), type: "disconnect" });
        releaseHostLock?.();
        releaseHostLock = null;
        lockedHostId = null;
        // This tab's own status connection gives the host up first.
        await hosts?.select(host.hostId);
        const release = await acquireOpenedWebHostLock(
          accountId,
          host.hostId,
          hostChannel,
          dependencies.acquireHostLock,
        );
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
      const support = decodeTeamProtocolSupportV7Base(await request("GET", TEAM_API_ROUTES.compatibility));
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
      if (!Array.isArray(value)) throw new Error("The host returned an invalid tab list.");
      return value.map(decodeWebBrowserTab);
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
    async closeBrowserTab(tabId) {
      await request("POST", TEAM_API_ROUTES.browser.close, { tabId });
    },
    async browserPreview(tabId) {
      return decodeWebBrowserPreview(await request("POST", TEAM_API_ROUTES.browser.preview, { tabId }));
    },
    async getSidebarLayout() {
      const value = await request("GET", TEAM_API_ROUTES.sidebarLayout.state);
      if (!isSidebarLayoutSnapshot(value)) throw new Error("The host returned an invalid sidebar layout.");
      return value;
    },
    async mutateSidebarLayout(action) {
      const value = await request("POST", TEAM_API_ROUTES.sidebarLayout.actions, { ...action });
      if (!isSidebarLayoutSnapshot(value)) throw new Error("The host returned an invalid sidebar layout.");
      return value;
    },
    channels: {
      ...channels,
      async readChannel(input) {
        const page = await channels.readChannel(input);
        // A host file URL must not reach the browser; attachments are downloaded through the host.
        return {
          ...page,
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
        return channel;
      },
    },
    async currentMemberId() {
      const value = await request("GET", TEAM_API_ROUTES.me);
      if (!isDynamicRecord(value)) throw new Error("The host returned an invalid team member.");
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
    async connect(host) {
      // An attempt that waits for an offline host has no deadline, so another host replaces it.
      if (connecting && waitingHostId !== null && waitingHostId !== host.hostId) {
        const previous = connecting;
        await peer.execute({ id: crypto.randomUUID(), type: "disconnect" });
        await previous.catch(() => undefined);
      }
      if (connecting || disposed) throw new Error(currentText().t("webClient.error.connectionChanging"));
      const attempt = connectHost(host);
      connecting = attempt;
      try {
        return await attempt;
      } finally {
        if (connecting === attempt) {
          connecting = null;
          waitingHostId = null;
        }
      }
    },
    async disconnect() {
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
        void hosts?.select(null);
      }
    },
    async listAgents() {
      return guardedListDecoder(isAgentSummary, "teammates")(await request("GET", TEAM_API_ROUTES.agents.all));
    },
    async conversation(id, before) {
      if (!capabilities.includes("conversation-pagination")) {
        return decodeWebConversationSnapshot(await request("GET", TEAM_API_ROUTES.agent.conversation(id)));
      }
      const query = new URLSearchParams({ limit: "50", ...(before ? { before } : {}) });
      return decodeWebConversationPage(await request("GET", `${TEAM_API_ROUTES.agent.conversationPage(id)}?${query}`));
    },
    async markRead(id, throughMessageId) {
      const value = await request("POST", TEAM_API_ROUTES.agent.conversationRead(id), { throughMessageId });
      if (!isConversationReadState(value)) throw new Error("The host returned an invalid read state.");
      return value;
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
      let binary = "";
      for (const byte of image.bytes) binary += String.fromCharCode(byte);
      await request(
        "PUT",
        TEAM_API_ROUTES.agent.avatar(agentId),
        {},
        { name: "avatar", mimeType: image.mimeType, base64: btoa(binary) },
      );
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
      assertSupportedAttachmentName(file.name);
      const extension = attachmentFileExtension(file.name);
      const supported = supportedAttachmentExtensions({
        eml: capabilities.includes("eml-attachments"),
        media: capabilities.includes("media-attachments"),
      });
      if (extension && !supported.includes(extension)) throw new Error(currentText().t("webClient.error.fileType"));
      if (file.size > MOBILE_ATTACHMENT_BYTES) throw new Error(currentText().t("error.remote.attachmentTooLarge"));
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (currentUpload !== uploadGeneration || uploadHostGeneration !== generation)
        throw new Error(currentText().t("webClient.error.uploadCancelled"));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const mimeType = file.type || "application/octet-stream";
      const value = await Effect.runPromise(
        uploadAttachmentDraft(teamApi, { name: file.name, mimeType, base64: btoa(binary) }).pipe(
          Effect.mapError((error) => error.cause),
        ),
      );
      if (currentUpload !== uploadGeneration) {
        if (uploadHostGeneration === generation)
          await Effect.runPromise(
            discardAttachmentDraft(teamApi, value.id).pipe(Effect.mapError((error) => error.cause)),
          );
        throw new Error(currentText().t("webClient.error.uploadCancelled"));
      }
      trackCompletedDraft(value.id, uploadHostGeneration === generation ? lockedHostId : null);
      // The host names the draft's preview with the desktop `openbot-attachment:` scheme.
      return { ...value, previewUrl: null };
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
    },
    async download(id) {
      return decodeWebFile(await request("GET", TEAM_API_ROUTES.attachment(id)));
    },
    async sharedFile(path) {
      const query = new URLSearchParams({ path });
      return decodeWebFile(await request("GET", `${TEAM_API_ROUTES.sharedFiles}?${query}`));
    },
    async workspaceFile(agentId, path) {
      // The released URL spells the agent `botId`.
      const query = new URLSearchParams({ botId: agentId, path });
      return decodeWebFile(await request("GET", `${TEAM_API_ROUTES.workspaceFiles}?${query}`));
    },
    async workspaceDirectory(agentId, path) {
      if (!capabilities.includes(WORKSPACE_DIRECTORY_CAPABILITY))
        throw new Error(currentText().t("error.team.workspaceDirectoryUnsupported"));
      return decodeWorkspaceDirectory(await request("POST", WORKSPACE_DIRECTORY_ROUTES.list, { agentId, path }));
    },
    async models() {
      return guardedListDecoder(isAgentModelOption, "models")(await request("GET", TEAM_API_ROUTES.agents.models));
    },
    async status() {
      const value = await request("GET", TEAM_API_ROUTES.agents.status);
      if (!isAgentStatus(value)) throw new Error("The host returned an invalid status.");
      return value;
    },
    async accountUsage() {
      const value = await request("GET", TEAM_API_ROUTES.agents.usage);
      if (!isAccountUsage(value)) throw new Error("The host returned invalid account usage.");
      return value;
    },
    async createAgent(input) {
      const value = await request("POST", TEAM_API_ROUTES.agents.all, { ...input });
      if (!isAgentSummary(value)) throw new Error("The host returned an invalid teammate.");
      return value;
    },
    async duplicateAgent(agentId) {
      if (!capabilities.includes("agent-duplication")) throw new Error(currentText().t("webClient.error.duplication"));
      const operationKey = `${lockedHostId ?? ""}\0${agentId}`;
      const operationId = duplicateOperationIds.get(operationKey) ?? crypto.randomUUID();
      duplicateOperationIds.set(operationKey, operationId);
      const value = await request("POST", TEAM_API_ROUTES.agent.duplicate(agentId), { operationId });
      if (!isDynamicRecord(value) || !isAgentSummary(value.agent) || !isSidebarLayoutSnapshot(value.layout))
        throw new Error("The host returned an invalid duplicated agent.");
      duplicateOperationIds.delete(operationKey);
      return { agent: value.agent, layout: value.layout } satisfies DuplicateAgentResult;
    },
    async updateAgent(input) {
      await request("PATCH", TEAM_API_ROUTES.agent.one(input.agentId), { ...input });
    },
    async deleteAgent(agentId) {
      if (connectedHost?.role === "member") throw new Error(currentText().t("error.team.membersCannotDeleteAgents"));
      await Effect.runPromise(deleteAgent(teamApi, agentId).pipe(Effect.mapError((error) => error.cause)));
    },
    async search(agentId, query, cursor) {
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
        throw new Error("The host returned invalid search results.");
      const results = value.results.map((item) => {
        if (!isDynamicRecord(item) || typeof item.agentId !== "string" || !isConversationMessage(item.message))
          throw new Error("The host returned an invalid search result.");
        return { agentId: item.agentId, message: item.message };
      });
      return { results, total: value.total, nextCursor: value.nextCursor };
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
      try {
        await Promise.all([peer.dispose(), hosts?.dispose()]);
      } finally {
        releaseHostLock?.();
        releaseHostLock = null;
        hostChannel?.close();
      }
    },
  };
}

function decodeWebFile(value: unknown): WebFile {
  if (!isDynamicRecord(value)) throw new Error("The host returned an invalid file.");
  const base64 = requiredString(value, "base64");
  if (base64.length > Math.ceil(MOBILE_ATTACHMENT_BYTES / 3) * 4)
    throw new Error(currentText().t("error.remote.attachmentTooLarge"));
  if (atob(base64).length > MOBILE_ATTACHMENT_BYTES)
    throw new Error(currentText().t("error.remote.attachmentTooLarge"));
  return {
    name: requiredString(value, "name"),
    mimeType: requiredString(value, "mimeType"),
    base64,
  };
}

/** The host's own reason for a refusal. It redacts it; a server failure keeps the generic text. */
function hostRefusal(status: number | undefined, body: unknown): string | null {
  if (status === undefined || status < 400 || status >= 500) return null;
  if (!isDynamicRecord(body) || !isString(body.error) || !body.error.trim()) return null;
  const text = body.error.trim();
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
    throw new Error("The host returned an invalid tab.");
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
    throw new Error("The host returned an invalid browser preview.");
  return { dataUrl: value.dataUrl, width: value.width, height: value.height };
}

function decodeWebConversationSnapshot(value: unknown): ConversationPage {
  if (!isConversationWithReadState(value)) throw new Error("The host returned an invalid conversation.");
  return { ...value, references: {}, pageInfo: { hasOlder: false, olderCursor: null } };
}

export function decodeWebConversationPage(value: unknown): ConversationPage {
  if (
    !isConversationWithReadState(value) ||
    !isDynamicRecord(value) ||
    !isDynamicRecord(value.pageInfo) ||
    typeof value.pageInfo.hasOlder !== "boolean" ||
    (value.pageInfo.olderCursor !== null && typeof value.pageInfo.olderCursor !== "string") ||
    (value.pageInfo.hasOlder && !value.pageInfo.olderCursor) ||
    !isDynamicRecord(value.references)
  )
    throw new Error("The host returned an invalid conversation page.");
  const references: ConversationPage["references"] = {};
  for (const [id, message] of Object.entries(value.references)) {
    if (!isConversationMessage(message)) throw new Error("The host returned an invalid referenced message.");
    references[id] = message;
  }
  return {
    ...value,
    references,
    pageInfo: { hasOlder: value.pageInfo.hasOlder, olderCursor: value.pageInfo.olderCursor },
  };
}
