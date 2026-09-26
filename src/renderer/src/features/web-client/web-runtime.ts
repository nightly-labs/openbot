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
  BrowserPreview,
  BrowserTab,
  ConversationPage,
  ConversationSearchPage,
  CreateAgentInput,
  DuplicateAgentResult,
  InvitePreview,
  RespondToApprovalInput,
  RespondToBrowserSecretInput,
  RespondToBrowserTakeoverInput,
  RespondToPromptInput,
  SetMessageReactionInput,
  SidebarLayoutAction,
  SidebarLayoutSnapshot,
  TeamInviteSummary,
  TeamMemberSummary,
  TeamRealtimeEvent,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import {
  isAccountUsage,
  isAgentModelOption,
  isAgentStatus,
  isAgentSummary,
  isConversationMessage,
  isConversationSnapshot,
  isQueuedMessageReceipt,
  isSidebarLayoutSnapshot,
  isTeamPresenceSnapshot,
} from "@openbot/contracts/ipc";
import { guardedListDecoder, requiredString } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  decodeBrowserViewInputValue,
  TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY,
} from "@openbot/contracts/team-protocol/browser-view-v1";
import { decodeTeamProtocolSupportV1 } from "@openbot/contracts/team-protocol/v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import { createRemoteBrowserView, type RemoteBrowserView } from "@openbot/team-client/browser-view";
import {
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
import {
  deleteAgent,
  discardAttachmentDraft,
  interruptAgentTurn,
  respondToBrowserSecret,
  respondToBrowserTakeover,
  type TeamApiRequest,
  uploadAttachmentDraft,
} from "@openbot/team-client/team-api-requests";
import type { BrowserViewRuntime } from "@openbot/ui/features/browser/BrowserLiveView";
import { currentText } from "@openbot/ui/text";
import type { ServerAdminPort } from "../servers/servers-port";
import { acquireWebHostLock } from "./web-host-lock";

/**
 * The host controls of the connected host. The host answers the Team API routes, and the account
 * service answers the member and invitation routes; both refuse a `member`, so the UI gate is not
 * the only one.
 */
export interface WebAdminRuntime {
  request: TeamApiRequest;
  team: ServerAdminPort;
}

export interface WebWorkspaceRuntime {
  admin?: WebAdminRuntime;
  browser: BrowserViewRuntime;
  browserTabs(): Promise<BrowserTab[]>;
  browserPreview?: (tabId: string) => Promise<BrowserPreview>;
  respondToBrowserSecret?: (input: RespondToBrowserSecretInput) => Promise<void>;
  getSidebarLayout?: () => Promise<SidebarLayoutSnapshot>;
  mutateSidebarLayout?: (action: SidebarLayoutAction) => Promise<SidebarLayoutSnapshot>;
  respondToTakeover(input: RespondToBrowserTakeoverInput): Promise<void>;
  listHosts(): Promise<RemoteTeamHost[]>;
  previewInvite(url: string): Promise<InvitePreview>;
  acceptInvite(url: string): Promise<RemoteTeamHost>;
  connect(host: RemoteTeamHost): Promise<string[]>;
  disconnect(): Promise<void>;
  listAgents(): Promise<AgentSummary[]>;
  conversation(agentId: string, before?: string): Promise<ConversationPage>;
  send(agentId: string, text: string, attachmentDraftIds: string[], replyToMessageId?: string | null): Promise<void>;
  stop(agentId: string, turnId: string): Promise<void>;
  approve(input: RespondToApprovalInput): Promise<void>;
  answer(input: RespondToPromptInput): Promise<void>;
  upload(file: File): Promise<AttachmentSummary>;
  cancelUpload(): Promise<void>;
  discard(attachmentId: string): Promise<void>;
  download(attachmentId: string): Promise<{ name: string; mimeType: string; base64: string }>;
  react(input: SetMessageReactionInput): Promise<void>;
  setAvatar(agentId: string, image: AvatarImageInput | null): Promise<void>;
  models(): Promise<AgentModelOption[]>;
  status(): Promise<AgentStatus>;
  accountUsage?: () => Promise<AccountUsage>;
  createAgent(input: CreateAgentInput): Promise<AgentSummary>;
  duplicateAgent(agentId: string): Promise<DuplicateAgentResult>;
  updateAgent(input: UpdateAgentInput): Promise<void>;
  deleteAgent(agentId: string): Promise<void>;
  search(agentId: string, query: string, cursor?: string): Promise<ConversationSearchPage>;
  dispose(): Promise<void>;
}

export interface WebRuntimeEvents {
  connection(update: RemoteTeamConnectionUpdate): void;
  event(hostId: string, event: AgentEvent | TeamRealtimeEvent): void;
  accountChanged(): Promise<void>;
}

interface WebConnectionDependencies {
  createPeer: typeof createRemoteTeamPeer;
  acquireHostLock: typeof acquireWebHostLock;
}

export function createWebWorkspaceRuntime(
  accountId: string,
  events: WebRuntimeEvents,
  accountFetch: typeof fetch,
  dependencies: WebConnectionDependencies = { createPeer: createRemoteTeamPeer, acquireHostLock: acquireWebHostLock },
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
  const peer = dependencies.createPeer({
    current: {
      getBootstrap: (id, key, sessionId) => directory.createBootstrap(id, key, sessionId),
      endSession: (id) => directory.endSession(id),
      onConnectionUpdate: async (update) => {
        if (update.state !== "online") {
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
  });
  let releaseHostLock: (() => void) | null = null;
  let lockedHostId: string | null = null;
  let connecting = false;
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
        await discardAttachmentDraft(teamApi, id);
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
    const result = await peer.execute({ id: crypto.randomUUID(), type: "request", method, path, body, upload });
    if (disposed || generation !== current) throw new Error(currentText().t("webClient.error.hostChanged"));
    if (!result.ok || (result.status ?? 500) >= 400)
      throw new Error(hostRefusal(result.status, result.body) ?? currentText().t("webClient.error.requestIncomplete"));
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
    return (await directory.listMembers(requireHost().hostId)).map(toTeamMember);
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
        return (await directory.listInvites(requireHost().hostId))
          .filter((invite) => invite.revokedAt === null)
          .map(toTeamInvite);
      },
      async createInvite(input) {
        const host = requireHost();
        const invite = input.email
          ? await directory.sendInviteEmail(host, { role: input.role, email: input.email })
          : await directory.createInvite(host, input);
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
        if (input.disabled) await directory.leaveHost(hostId, input.memberId);
        else await directory.updateMember(hostId, input.memberId, input.role ?? current.role, input.disabled === false);
        const updated = (await listMembers()).find((member) => member.id === input.memberId);
        if (!updated) throw new Error(currentText().t("webClient.error.memberNotFound"));
        return updated;
      },
      removeMember: (memberId) => directory.leaveHost(requireHost().hostId, memberId),
      revokeInvite: (inviteId) => directory.revokeInvite(inviteId),
    },
  };
  const browserView = createRemoteBrowserView(
    (data) => peer.sendHostStreamData(data),
    request,
    () => capabilities.includes(TEAM_BROWSER_VIEW_FRAME_POINT_CAPABILITY),
  );
  let liveView: RemoteBrowserView | null = null;
  let liveViewGeneration = 0;
  async function releaseLiveView(): Promise<void> {
    liveViewGeneration += 1;
    const current = liveView;
    liveView = null;
    if (current) {
      await current.close().catch(() => undefined);
    } else {
      // Also cancel an open request that has not installed its session yet.
      browserView.disconnect();
    }
  }
  const viewListeners = new Set<(event: BrowserLiveViewEvent) => void>();
  const emitView = (event: BrowserLiveViewEvent) => {
    for (const listener of viewListeners) listener(event);
  };
  return {
    admin,
    browser: {
      async startLiveView(tabId) {
        const currentGeneration = ++liveViewGeneration;
        const next = await browserView.open(
          tabId,
          (frame) => emitView({ type: "frame", tabId, ...frame }),
          () => emitView({ type: "stopped", tabId, reason: currentText().t("webClient.error.viewEnded") }),
        );
        if (currentGeneration !== liveViewGeneration) {
          await next.close().catch(() => undefined);
          throw new Error(currentText().t("webClient.error.viewChanged"));
        }
        liveView = next;
      },
      async stopLiveView() {
        await releaseLiveView();
      },
      async sendLiveViewInput(input) {
        if (liveView) await liveView.input(decodeBrowserViewInputValue(input));
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
      return value.map((tab) => {
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
      });
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
    respondToBrowserSecret: (input) => respondToBrowserSecret(teamApi, input),
    respondToTakeover: (input) => respondToBrowserTakeover(teamApi, input),
    listHosts: () => directory.listHosts(),
    async previewInvite(url) {
      const value = await directory.previewInvite(url);
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
    acceptInvite: (url) => directory.acceptInvite(url),
    async connect(host) {
      if (connecting || disposed) throw new Error(currentText().t("webClient.error.connectionChanging"));
      connecting = true;
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
          const release = await dependencies.acquireHostLock(accountId, host.hostId);
          if (disposed) {
            release();
            throw new Error(currentText().t("webClient.error.connectionClosed"));
          }
          releaseHostLock = release;
          lockedHostId = host.hostId;
        }
        const current = ++generation;
        connectedHost = host;
        // Pin after directory validation and before connecting. Never silently replace a saved identity.
        const key = `openbot.web.host-key:${accountId}:${host.hostId}`;
        const pinned = localStorage.getItem(key);
        if (pinned && pinned !== host.devicePublicKey)
          throw new Error(currentText().t("webClient.error.identityChanged"));
        localStorage.setItem(key, host.devicePublicKey);
        const result = await peer.execute({
          id: crypto.randomUUID(),
          type: "connect",
          hostId: host.hostId,
          hostPublicKey: host.devicePublicKey,
        });
        if (!result.ok || disposed || current !== generation)
          throw new Error(currentText().t("webClient.error.connectionUnavailable"));
        const support = decodeTeamProtocolSupportV1(await request("GET", TEAM_API_ROUTES.compatibility));
        if (support.protocol.minimum > TEAM_PROTOCOL_V3 || support.protocol.maximum < TEAM_PROTOCOL_V3)
          throw new Error(currentText().t("webClient.error.incompatible"));
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
        }
        throw error;
      } finally {
        connecting = false;
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
    async send(id, text, attachmentDraftIds, replyToMessageId = null) {
      const result = await request("POST", TEAM_API_ROUTES.agent.messages(id), {
        text,
        attachmentDraftIds,
        replyToMessageId,
      });
      if (!isQueuedMessageReceipt(result)) throw new Error(currentText().t("webClient.error.sendUnconfirmed"));
      removeCompletedDrafts(attachmentDraftIds);
    },
    stop: (id, turnId) => interruptAgentTurn(teamApi, id, turnId),
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
      const value = await uploadAttachmentDraft(teamApi, { name: file.name, mimeType, base64: btoa(binary) });
      if (currentUpload !== uploadGeneration) {
        if (uploadHostGeneration === generation) await discardAttachmentDraft(teamApi, value.id);
        throw new Error(currentText().t("webClient.error.uploadCancelled"));
      }
      trackCompletedDraft(value.id, uploadHostGeneration === generation ? lockedHostId : null);
      return value;
    },
    async cancelUpload() {
      uploadGeneration += 1;
      await peer.cancelUpload();
    },
    async discard(id) {
      await discardAttachmentDraft(teamApi, id);
      removeCompletedDrafts([id]);
    },
    async download(id) {
      const value = await request("GET", TEAM_API_ROUTES.attachment(id));
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
      await deleteAgent(teamApi, agentId);
    },
    async search(agentId, query, cursor) {
      const params = new URLSearchParams({ botId: agentId, q: query, limit: "50", ...(cursor ? { cursor } : {}) });
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
    async dispose() {
      await discardCompletedDrafts();
      await releaseLiveView();
      browserView.disconnect();
      viewListeners.clear();
      disposed = true;
      generation += 1;
      connectedHost = null;
      duplicateOperationIds.clear();
      try {
        await peer.dispose();
      } finally {
        releaseHostLock?.();
        releaseHostLock = null;
      }
    },
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
  if (!isConversationSnapshot(value)) throw new Error("The host returned an invalid conversation.");
  return { ...value, references: {}, pageInfo: { hasOlder: false, olderCursor: null } };
}

export function decodeWebConversationPage(value: unknown): ConversationPage {
  if (
    !isConversationSnapshot(value) ||
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
