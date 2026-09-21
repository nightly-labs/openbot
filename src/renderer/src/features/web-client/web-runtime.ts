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
  TeamRealtimeEvent,
  UpdateAgentInput,
} from "@openbot/contracts/ipc";
import {
  BROWSER_SECRET_RESPONSE_PATH,
  isAccountUsage,
  isAgentModelOption,
  isAgentStatus,
  isAgentSummary,
  isAttachmentSummary,
  isConversationMessage,
  isConversationSnapshot,
  isQueuedMessageReceipt,
  isSidebarLayoutSnapshot,
} from "@openbot/contracts/ipc";
import { guardedListDecoder, requiredString } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { decodeBrowserViewInputValue } from "@openbot/contracts/team-protocol/browser-view-v1";
import { decodeTeamProtocolSupportV1 } from "@openbot/contracts/team-protocol/v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { TEAM_PROTOCOL_V3 } from "@openbot/contracts/team-protocol/v3";
import { createRemoteBrowserView, type RemoteBrowserView } from "@openbot/team-client/browser-view";
import { RemoteTeamDirectoryClient, type RemoteTeamHost } from "@openbot/team-client/remote-directory";
import {
  createRemoteTeamPeer,
  MOBILE_ATTACHMENT_BYTES,
  type RemoteFileUpload,
  type RemoteTeamConnectionUpdate,
} from "@openbot/team-client/remote-peer";
import type { BrowserViewRuntime } from "../browser/BrowserLiveView";
import { acquireWebHostLock } from "./web-host-lock";

export interface WebWorkspaceRuntime {
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
    hostKeys: {
      get: async (id) => localStorage.getItem(`openbot.web.host-key:${accountId}:${id}`),
      set: async (id, key) => localStorage.setItem(`openbot.web.host-key:${accountId}:${id}`, key),
    },
  });
  const peer = dependencies.createPeer({
    current: {
      getBootstrap: (id, key) => directory.createBootstrap(id, key),
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
  let connectedHostRole: RemoteTeamHost["role"] | null = null;
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
        await request("DELETE", TEAM_API_ROUTES.attachment(id));
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
    if (disposed) throw new Error("The browser connection is closed.");
    const current = generation;
    const result = await peer.execute({ id: crypto.randomUUID(), type: "request", method, path, body, upload });
    if (disposed || generation !== current) throw new Error("The selected host changed.");
    if (!result.ok || (result.status ?? 500) >= 400)
      throw new Error("The host could not complete this request. Refresh before trying again.");
    return result.body;
  }
  const browserView = createRemoteBrowserView((data) => peer.sendHostStreamData(data), request);
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
    browser: {
      async startLiveView(tabId) {
        const currentGeneration = ++liveViewGeneration;
        const next = await browserView.open(
          tabId,
          (frame) => emitView({ type: "frame", tabId, ...frame }),
          () => emitView({ type: "stopped", tabId, reason: "The browser view ended." }),
        );
        if (currentGeneration !== liveViewGeneration) {
          await next.close().catch(() => undefined);
          throw new Error("The browser view changed.");
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
    async respondToBrowserSecret(input) {
      await request("POST", BROWSER_SECRET_RESPONSE_PATH, { ...input });
    },
    async respondToTakeover(input) {
      await request("POST", TEAM_API_ROUTES.respond.browserTakeover, { ...input });
    },
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
      if (connecting || disposed) throw new Error("The host connection is changing.");
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
            throw new Error("The browser connection is closed.");
          }
          releaseHostLock = release;
          lockedHostId = host.hostId;
        }
        const current = ++generation;
        connectedHostRole = host.role;
        // Pin after directory validation and before connecting. Never silently replace a saved identity.
        const key = `openbot.web.host-key:${accountId}:${host.hostId}`;
        const pinned = localStorage.getItem(key);
        if (pinned && pinned !== host.devicePublicKey)
          throw new Error("The host identity changed. Connection refused.");
        localStorage.setItem(key, host.devicePublicKey);
        const result = await peer.execute({
          id: crypto.randomUUID(),
          type: "connect",
          hostId: host.hostId,
          hostPublicKey: host.devicePublicKey,
        });
        if (!result.ok || disposed || current !== generation) throw new Error("The host connection is not available.");
        const support = decodeTeamProtocolSupportV1(await request("GET", TEAM_API_ROUTES.compatibility));
        if (support.protocol.minimum > TEAM_PROTOCOL_V3 || support.protocol.maximum < TEAM_PROTOCOL_V3)
          throw new Error("This host is not compatible with OpenBot web. Update the host and reload this page.");
        capabilities = support.capabilities;
        if (retryDraftCleanup) await discardCompletedDrafts(host.hostId);
        return capabilities;
      } catch (error) {
        capabilities = [];
        connectedHostRole = null;
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
        connectedHostRole = null;
      }
    },
    async listAgents() {
      return guardedListDecoder(isAgentSummary, "teammates")(await request("GET", TEAM_API_ROUTES.agents.all));
    },
    async conversation(id, before) {
      if (!capabilities.includes("conversation-pagination")) {
        const snapshot: unknown = await request("GET", TEAM_API_ROUTES.agent.conversation(id));
        if (!isConversationSnapshot(snapshot)) throw new Error("The host returned an invalid conversation.");
        return {
          agentId: snapshot.agentId,
          threadId: snapshot.threadId,
          activeTurnId: snapshot.activeTurnId,
          revision: snapshot.revision,
          messages: snapshot.messages,
          references: {},
          pageInfo: { hasOlder: false, olderCursor: null },
        };
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
      if (!isQueuedMessageReceipt(result))
        throw new Error("Message delivery is not confirmed. Refresh before sending it again.");
      removeCompletedDrafts(attachmentDraftIds);
    },
    async stop(id, turnId) {
      await request("POST", TEAM_API_ROUTES.agent.interrupt(id), { turnId });
    },
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
      if (extension && !supported.includes(extension)) throw new Error("Update the host to attach this file type.");
      if (file.size > MOBILE_ATTACHMENT_BYTES) throw new Error("Attachments must be 10 MB or smaller.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (currentUpload !== uploadGeneration || uploadHostGeneration !== generation)
        throw new Error("The attachment upload was cancelled.");
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const mimeType = file.type || "application/octet-stream";
      const query = new URLSearchParams({ name: file.name, mime: mimeType });
      const value = await request(
        "POST",
        `${TEAM_API_ROUTES.attachments}?${query}`,
        {},
        { name: file.name, mimeType, base64: btoa(binary) },
      );
      if (!isAttachmentSummary(value)) throw new Error("The host returned an invalid attachment.");
      if (currentUpload !== uploadGeneration) {
        if (uploadHostGeneration === generation) await request("DELETE", TEAM_API_ROUTES.attachment(value.id));
        throw new Error("The attachment upload was cancelled.");
      }
      trackCompletedDraft(value.id, uploadHostGeneration === generation ? lockedHostId : null);
      return value;
    },
    async cancelUpload() {
      uploadGeneration += 1;
      await peer.cancelUpload();
    },
    async discard(id) {
      await request("DELETE", TEAM_API_ROUTES.attachment(id));
      removeCompletedDrafts([id]);
    },
    async download(id) {
      const value = await request("GET", TEAM_API_ROUTES.attachment(id));
      if (!isDynamicRecord(value)) throw new Error("The host returned an invalid file.");
      const base64 = requiredString(value, "base64");
      if (base64.length > Math.ceil(MOBILE_ATTACHMENT_BYTES / 3) * 4)
        throw new Error("Attachments must be 10 MB or smaller.");
      if (atob(base64).length > MOBILE_ATTACHMENT_BYTES) throw new Error("Attachments must be 10 MB or smaller.");
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
      if (!capabilities.includes("agent-duplication")) throw new Error("This host does not support agent duplication.");
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
      if (connectedHostRole === "member") throw new Error("Members cannot delete agents.");
      await request("DELETE", TEAM_API_ROUTES.agent.one(agentId));
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
      connectedHostRole = null;
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
