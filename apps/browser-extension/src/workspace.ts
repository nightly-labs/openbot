import { isKnownAgentProvider } from "@openbot/contracts/agent-providers";
import type { AgentRuntimeSnapshot, AttachmentSummary } from "@openbot/contracts/ipc";
import {
  type AgentStatus,
  type AgentTask,
  type AvatarColor,
  CHANNEL_CHATS_CAPABILITY,
  type ChannelDraft,
  type ChannelMessage,
  type ChannelSummary,
  type ChannelTask,
  type ClientAgentModelOption,
  type ClientAgentSummary,
  type ConversationMessage,
  type ConversationSnapshot,
  isAgentStatus,
  isClientAgentModelOption,
  isClientAgentSummary,
  isConversationReadState,
  isConversationWithReadState,
  isQueuedMessageReceipt,
  isSidebarLayoutSnapshot,
  type SidebarLayoutSnapshot,
  sidebarFolderAncestors,
  sidebarFolderParents,
  sidebarFolderTreeOrder,
  type TeamRole,
} from "@openbot/contracts/ipc";
import { guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  AGENT_COLORS_CAPABILITY,
  AGENT_COLORS_ROUTES,
  decodeAgentColorsSnapshot,
} from "@openbot/contracts/team-protocol/agent-colors-v1";
import { AGENT_CREATE_OPERATION_CAPABILITY } from "@openbot/contracts/team-protocol/agent-create-operation-v1";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import { AGENT_THREAD_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import { AGENT_THREAD_READS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_WELCOME_CAPABILITY, TEAM_AGENT_CREATE_MODEL_CAPABILITY } from "@openbot/contracts/team-protocol/current";
import {
  SIDEBAR_FOLDERS_CAPABILITY,
  SIDEBAR_FOLDERS_ROUTES,
} from "@openbot/contracts/team-protocol/sidebar-folders-v1";
import { SIDEBAR_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/sidebar-pins-v1";
import type { SyncClientMessage, SyncServerMessage } from "@openbot/contracts/team-protocol/sync-v1";
import type { TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { VOICE_TRANSCRIPTION_CAPABILITY } from "@openbot/contracts/team-protocol/voice-transcription-v1";
import { runTeamEffect } from "@openbot/team-client";
import { bytesToBase64 } from "@openbot/team-client/base64";
import { createClientSync } from "@openbot/team-client/client-sync";
import {
  MOBILE_ATTACHMENT_BYTES,
  type RemoteTeamConnectionUpdate,
  type RemoteTeamEvent,
} from "@openbot/team-client/remote-peer";
import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
import { readSidebarPins, setAgentColor } from "@openbot/team-client/team-admin-requests";
import {
  discardAttachmentDraft,
  listAgentTasks,
  markAgentThreadRead,
  readAgentTask,
  sendAgentTaskMessage,
  startAgentTask,
  type TeamApiRequest,
  TeamRequestError,
  teamChannelsApi,
  uploadAttachmentDraft,
} from "@openbot/team-client/team-api-requests";
import { createAgentInitialMessage } from "@openbot/ui/features/agents/agent-initial-message";
import type { FirstAgentDraft } from "@openbot/ui/features/agents/FirstAgentSetup";
import { currentText } from "@openbot/ui/text";
import { createStore, flush } from "solid-js";
import { createAgentSettingsApi } from "./agent-settings";
import { track, withResult } from "./analytics";
import { createAttachmentMedia, type HostFile } from "./attachment-media";

export interface OpenChat {
  agentId: string;
  taskId: string | null;
  draftThread: boolean;
  status: "loading" | "ready" | "failed";
  messages: ConversationMessage[];
  threadId: string | null;
  revision: number;
  activeTurnId: string | null;
  sending: boolean;
  error: string | null;
}

interface SidebarPin {
  kind: "agent" | "channel";
  id: string;
}

export interface OpenChannel {
  channelId: string;
  status: "loading" | "ready" | "failed";
  messages: ChannelMessage[];
  throughSequence: number;
  tasks: ChannelTask[];
  sending: boolean;
  error: string | null;
}

interface WorkspaceFolder {
  id: string;
  name: string;
  depth: number;
}

type PendingPrompt = AgentRuntimeSnapshot["pendingPrompts"][number];

export interface WorkspaceState {
  status: "loading" | "ready" | "failed";
  error: string | null;
  agents: ClientAgentSummary[];
  colors: Record<string, AvatarColor>;
  pins: SidebarPin[];
  unread: Record<string, number>;
  threads: Record<string, AgentTask[]>;
  folders: WorkspaceFolder[];
  folderOf: Record<string, string>;
  channels: ChannelSummary[];
  channel: OpenChannel | null;
  memberId: string | null;
  chat: OpenChat | null;
  prompts: PendingPrompt[];
}

export const decodeAgents = guardedListDecoder(isClientAgentSummary, "agents");
const decodeModels = guardedListDecoder(isClientAgentModelOption, "models");
const SIDEBAR_LAYOUT_CAPABILITY = "sidebar-layout";
const CHANNEL_READ_INTERVAL_MS = 250;

const SHOWN_ITEM_TYPES: ReadonlySet<string | undefined> = new Set([
  undefined,
  "agentMessage",
  "final_answer",
  "agent_attachment",
  "image_generation",
]);

export function isChatMessage(message: ConversationMessage): boolean {
  const files = (message.attachments?.length ?? 0) > 0;
  if (message.author === "user") return message.text.trim().length > 0 || files;
  if (message.author !== "assistant" && message.author !== "agent") return false;
  return SHOWN_ITEM_TYPES.has(message.itemType) && (message.text.length > 0 || files);
}

function withoutHostPreview(message: ConversationMessage): ConversationMessage {
  if (!message.attachments) return message;
  return { ...message, attachments: message.attachments.map((attachment) => ({ ...attachment, previewUrl: null })) };
}

export interface WorkspaceSyncLink {
  role: TeamRole | null;
  send: (message: SyncClientMessage) => Promise<void>;
}

export function createWorkspace(
  hostRequest: TeamApiRequest,
  capabilities: readonly string[],
  download: (attachmentId: string) => Promise<HostFile>,
  transcribe: (wav: Uint8Array) => Promise<string>,
  syncLink?: WorkspaceSyncLink,
) {
  const media = createAttachmentMedia(download);
  const [state, setState] = createStore<WorkspaceState>({
    status: "loading",
    error: null,
    agents: [],
    colors: {},
    pins: [],
    unread: {},
    threads: {},
    folders: [],
    folderOf: {},
    channels: [],
    channel: null,
    memberId: null,
    chat: null,
    prompts: [],
  });
  const has = (capability: string) => capabilities.includes(capability);
  const sync = syncLink
    ? createClientSync({
        capabilities,
        role: syncLink.role,
        focusedAgentId: null,
        focusedChannelId: null,
        send: syncLink.send,
        emit: (event) => applyEvent(event),
        channelsChanged: () => void readChannels().catch(() => undefined),
        readsChanged: () => void readReads().catch(() => undefined),
      })
    : null;
  let syncPaused = false;
  const request: TeamApiRequest = (method, path, decode, body, upload) =>
    hostRequest(method, path, decode, body, upload).finally(() => sync?.wrote(method, path));
  const raw = (method: string, path: string, body?: TeamProtocolV2Json) =>
    request(method, path, (value) => value, body);
  let readsTimer: ReturnType<typeof setTimeout> | null = null;
  let chatGeneration = 0;
  const createOperationId = retryOperationIds(() => crypto.randomUUID());
  const channelsApi = has(CHANNEL_CHATS_CAPABILITY) ? teamChannelsApi(request) : null;
  const changedChannels = new Set<string>();
  let channelTimer: ReturnType<typeof setTimeout> | null = null;

  async function readReads(): Promise<void> {
    const synced = sync?.conversationReads();
    const value = synced ?? (await raw("GET", TEAM_API_ROUTES.agents.conversationReads));
    const unread: Record<string, number> = {};
    if (isDynamicRecord(value))
      for (const [agentId, read] of Object.entries(value))
        if (isConversationReadState(read)) unread[agentId] = read.unreadCount;
    setState((draft) => {
      draft.unread = unread;
    });
  }
  function refreshReadsSoon(): void {
    if (readsTimer) clearTimeout(readsTimer);
    readsTimer = setTimeout(() => {
      readsTimer = null;
      void readReads().catch(() => undefined);
    }, 400);
  }

  function decodeLayout(value: unknown): SidebarLayoutSnapshot {
    if (!isSidebarLayoutSnapshot(value)) throw new Error(currentText().t("extension.connection.requestFailed"));
    return value;
  }

  function showLayout(layout: SidebarLayoutSnapshot): void {
    const parents = sidebarFolderParents(layout);
    const sections = new Map(layout.sections.map((section) => [section.id, section]));
    const folders = sidebarFolderTreeOrder(layout.order, parents).flatMap((id) => {
      const section = sections.get(id);
      return section ? [{ id, name: section.name, depth: sidebarFolderAncestors(parents, id).length }] : [];
    });
    setState((draft) => {
      draft.folders = folders;
      draft.folderOf = Object.fromEntries(
        Object.entries(layout.agentAssignments).filter(([, sectionId]) => sections.has(sectionId)),
      );
    });
  }

  async function readLayout(): Promise<void> {
    if (!has(SIDEBAR_LAYOUT_CAPABILITY)) return;
    showLayout(
      sync?.sidebarLayout() ??
        (has(SIDEBAR_FOLDERS_CAPABILITY)
          ? await request("POST", SIDEBAR_FOLDERS_ROUTES.read, decodeLayout, {})
          : await request("GET", TEAM_API_ROUTES.sidebarLayout.state, decodeLayout)),
    );
  }

  async function createFolder(name: string): Promise<void> {
    showLayout(
      await withResult(
        request(
          "POST",
          has(SIDEBAR_FOLDERS_CAPABILITY) ? SIDEBAR_FOLDERS_ROUTES.actions : TEAM_API_ROUTES.sidebarLayout.actions,
          decodeLayout,
          { type: "create", name },
        ),
        (result) => track("folder_action", { action: "created", result }),
      ),
    );
  }

  async function readMemberId(): Promise<void> {
    if (!channelsApi) return;
    const value = await raw("GET", TEAM_API_ROUTES.me);
    const id = isDynamicRecord(value) && isString(value.id) ? value.id : null;
    setState((draft) => {
      draft.memberId = id;
    });
  }

  async function readChannels(): Promise<void> {
    if (!channelsApi) return;
    const synced = sync?.channels();
    const channels = synced ?? (await channelsApi.listChannels());
    if (!synced)
      sync?.noteOrder(
        "channels",
        channels.map((channel) => channel.id),
      );
    setState((draft) => {
      draft.channels = channels.filter((channel) => !channel.archived);
    });
  }

  async function reloadChannel(): Promise<void> {
    const open = state.channel;
    if (!channelsApi || !open) return;
    const { channelId } = open;
    try {
      const page = (await sync?.channelPage(channelId)) ?? (await channelsApi.readChannel({ channelId }));
      if (state.channel?.channelId !== channelId) return;
      const read = page.throughSequence > open.throughSequence;
      setState((draft) => {
        if (!draft.channel) return;
        draft.channel.messages = page.messages.map((entry) => ({
          ...entry,
          message: withoutHostPreview(entry.message),
        }));
        draft.channel.throughSequence = page.throughSequence;
        draft.channel.tasks = page.tasks;
        draft.channel.status = "ready";
        const row = draft.channels.find((channel) => channel.id === channelId);
        if (row) row.unreadCount = 0;
      });
      if (read)
        await channelsApi
          .channelCommand({
            type: "read",
            operationId: crypto.randomUUID(),
            channelId,
            throughSequence: page.throughSequence,
          })
          .catch(() => undefined);
    } catch (error) {
      if (state.channel?.channelId !== channelId) return;
      setState((draft) => {
        if (!draft.channel) return;
        draft.channel.status = "failed";
        draft.channel.error = error instanceof Error ? error.message : currentText().t("extension.chat.loadFailed");
      });
    }
  }

  function openChannel(channelId: string): void {
    setState((draft) => {
      draft.channel = {
        channelId,
        status: "loading",
        messages: [],
        throughSequence: -1,
        tasks: [],
        sending: false,
        error: null,
      };
    });
    flush();
    sync?.focusChannel(channelId);
    void reloadChannel();
  }

  function closeChannel(): void {
    sync?.focusChannel(null);
    setState((draft) => {
      draft.channel = null;
    });
  }

  async function sendToChannel(text: string, attachments: readonly AttachmentSummary[] = []): Promise<void> {
    const open = state.channel;
    if (!channelsApi || !open || open.sending) return;
    const { channelId } = open;
    const operationId = crypto.randomUUID();
    const channel = state.channels.find((entry) => entry.id === channelId);
    const named = /^@(\S+)/.exec(text)?.[1]?.toLowerCase();
    const recipient = named
      ? (channel?.members ?? [])
          .map((member) => state.agents.find((agent) => agent.id === member.agentId))
          .find((agent) => agent?.name.replace(/\s+/g, "").toLowerCase() === named)
      : undefined;
    setState((draft) => {
      if (!draft.channel) return;
      draft.channel.sending = true;
      draft.channel.error = null;
      draft.channel.messages.push({
        id: `pending-${operationId}`,
        channelId,
        sequence: Number.MAX_SAFE_INTEGER,
        author: { kind: "member", id: state.memberId ?? "", name: "" },
        taskId: null,
        superseded: false,
        message: {
          id: `pending-${operationId}`,
          author: "user",
          source: "user",
          text,
          createdAt: new Date().toISOString(),
          status: "completed",
          ...(attachments.length ? { attachments: [...attachments] } : {}),
        },
      });
    });
    try {
      await channelsApi.channelCommand({
        type: "send",
        operationId,
        channelId,
        text,
        recipientAgentId: recipient?.id ?? null,
        replyToMessageId: null,
        attachmentDraftIds: attachments.map((attachment) => attachment.id),
      });
      void track("message_send", { target: "channel", result: "succeeded" });
      await reloadChannel();
    } catch (error) {
      void track("message_send", { target: "channel", result: "failed" });
      if (state.channel?.channelId !== channelId) return;
      setState((draft) => {
        if (!draft.channel) return;
        draft.channel.messages = draft.channel.messages.filter((entry) => entry.id !== `pending-${operationId}`);
        draft.channel.error = error instanceof Error ? error.message : currentText().t("extension.chat.sendFailed");
      });
      throw error;
    } finally {
      setState((draft) => {
        if (draft.channel?.channelId === channelId) draft.channel.sending = false;
      });
    }
  }

  async function createChannel(draft: ChannelDraft): Promise<string> {
    if (!channelsApi) throw new Error(currentText().t("extension.create.failed"));
    const channel = await withResult(
      channelsApi.channelCommand({
        type: "save",
        operationId: crypto.randomUUID(),
        channelId: crypto.randomUUID(),
        draft,
      }),
      (result) => track("channel_action", { action: "created", result }),
    );
    setState((next) => {
      if (!next.channels.some((entry) => entry.id === channel.id))
        next.channels.unshift({ ...channel, unreadCount: 0, activeTasks: 0, lastMessage: null });
    });
    if (!sync?.channels()) void readChannels().catch(() => undefined);
    return channel.id;
  }

  function channelChangedSoon(channelId: string): void {
    changedChannels.add(channelId);
    if (channelTimer) return;
    channelTimer = setTimeout(() => {
      channelTimer = null;
      const open = state.channel && changedChannels.has(state.channel.channelId);
      changedChannels.clear();
      void readChannels().catch(() => undefined);
      if (open) void reloadChannel();
    }, CHANNEL_READ_INTERVAL_MS);
  }

  async function load(): Promise<void> {
    try {
      const [agents, colors, pins] = await Promise.all([
        sync?.agents() ?? request("GET", TEAM_API_ROUTES.agents.all, decodeAgents),
        has(AGENT_COLORS_CAPABILITY)
          ? request("POST", AGENT_COLORS_ROUTES.read, decodeAgentColorsSnapshot, {}).then((value) => value.agents)
          : Promise.resolve([]),
        has(SIDEBAR_PINS_CAPABILITY)
          ? (sync?.sidebarPins()?.items ?? runTeamEffect(readSidebarPins(request)).then((value) => value.items))
          : Promise.resolve([]),
        readReads(),
        readLayout().catch(() => undefined),
        readChannels().catch(() => undefined),
        readMemberId().catch(() => undefined),
      ]);
      sync?.noteOrder(
        "agents",
        agents.map((agent) => agent.id),
      );
      setState((draft) => {
        draft.agents = agents;
        draft.colors = Object.fromEntries(colors.map((entry) => [entry.agentId, entry.color]));
        draft.pins = pins.map((pin) => ({ kind: pin.kind, id: pin.id }));
        draft.status = "ready";
      });
    } catch (error) {
      setState((draft) => {
        draft.status = "failed";
        draft.error = error instanceof Error ? error.message : currentText().t("extension.connection.requestFailed");
      });
    }
  }

  function setMessages(snapshot: ConversationSnapshot): void {
    setState((draft) => {
      const chat = draft.chat;
      if (!chat) return;
      chat.messages = snapshot.messages.map(withoutHostPreview);
      chat.threadId = snapshot.threadId;
      chat.revision = snapshot.revision;
      chat.activeTurnId = snapshot.activeTurnId;
      chat.status = "ready";
    });
  }

  async function readMainChat(agentId: string): Promise<ConversationSnapshot> {
    const synced = await sync?.conversationPage(agentId);
    if (synced) return synced;
    if (!has("conversation-pagination")) {
      const value = await raw("GET", TEAM_API_ROUTES.agent.conversation(agentId));
      if (!isConversationWithReadState(value)) throw new Error(currentText().t("extension.connection.requestFailed"));
      return value;
    }
    const value = await raw("GET", `${TEAM_API_ROUTES.agent.conversationPage(agentId)}?limit=50`);
    if (!isConversationWithReadState(value)) throw new Error(currentText().t("extension.connection.requestFailed"));
    return value;
  }

  async function reloadChat(): Promise<void> {
    const chat = state.chat;
    if (!chat || chat.draftThread) return;
    const generation = chatGeneration;
    const { agentId, taskId } = chat;
    try {
      const snapshot =
        taskId === null
          ? await readMainChat(agentId)
          : await runTeamEffect(readAgentTask(request, { agentId, taskId }));
      if (generation !== chatGeneration) return;
      setMessages(snapshot);
      void markRead(agentId, taskId, snapshot.messages.at(-1)?.id ?? null);
    } catch (error) {
      if (generation !== chatGeneration) return;
      setState((draft) => {
        if (!draft.chat) return;
        draft.chat.status = "failed";
        draft.chat.error = error instanceof Error ? error.message : currentText().t("extension.chat.loadFailed");
      });
    }
  }

  async function markRead(agentId: string, taskId: string | null, throughMessageId: string | null) {
    if (!throughMessageId) return;
    if (taskId === null) {
      const value = await raw("POST", TEAM_API_ROUTES.agent.conversationRead(agentId), { throughMessageId }).catch(
        () => null,
      );
      if (!isConversationReadState(value)) return;
      const count = value.unreadCount;
      setState((draft) => {
        draft.unread[agentId] = count;
      });
    } else if (has(AGENT_THREAD_READS_CAPABILITY)) {
      await runTeamEffect(markAgentThreadRead(request, { agentId, taskId, throughMessageId })).catch(() => undefined);
    }
  }

  async function loadThreads(agentId: string): Promise<void> {
    if (!has(AGENT_TASKS_CAPABILITY)) return;
    const snapshot = await runTeamEffect(listAgentTasks(request, agentId));
    setState((draft) => {
      draft.threads[agentId] = snapshot.tasks;
    });
  }

  function openChat(agentId: string, taskId: string | null): void {
    chatGeneration += 1;
    sync?.focus(taskId === null ? agentId : null);
    setState((draft) => {
      draft.chat = {
        agentId,
        taskId,
        draftThread: false,
        status: "loading",
        messages: [],
        threadId: null,
        revision: -1,
        activeTurnId: null,
        sending: false,
        error: null,
      };
    });
    flush();
    void reloadChat();
    void loadThreads(agentId).catch(() => undefined);
  }

  function newThread(agentId: string): void {
    chatGeneration += 1;
    sync?.focus(null);
    setState((draft) => {
      draft.chat = {
        agentId,
        taskId: null,
        draftThread: true,
        status: "ready",
        messages: [],
        threadId: null,
        revision: -1,
        activeTurnId: null,
        sending: false,
        error: null,
      };
    });
    flush();
  }

  function closeChat(): void {
    chatGeneration += 1;
    sync?.focus(null);
    setState((draft) => {
      draft.chat = null;
    });
  }

  async function send(text: string, attachments: readonly AttachmentSummary[] = []): Promise<void> {
    const chat = state.chat;
    if (!chat || chat.sending) return;
    const generation = chatGeneration;
    const clientMessageId = crypto.randomUUID();
    const { agentId, taskId, draftThread } = chat;
    const target = draftThread ? "new_thread" : taskId !== null ? "thread" : "chat";
    const attachmentDraftIds = attachments.map((attachment) => attachment.id);
    setState((draft) => {
      if (!draft.chat) return;
      draft.chat.sending = true;
      draft.chat.error = null;
      draft.chat.messages.push({
        id: `pending-${clientMessageId}`,
        author: "user",
        source: "user",
        text,
        createdAt: new Date().toISOString(),
        status: "completed",
        ...(attachments.length ? { attachments: [...attachments] } : {}),
      });
    });
    try {
      if (draftThread) {
        const task = await runTeamEffect(
          startAgentTask(request, { agentId, text, attachmentDraftIds, clientMessageId }),
        );
        if (generation !== chatGeneration) return;
        setState((draft) => {
          if (!draft.chat) return;
          draft.chat.draftThread = false;
          draft.chat.taskId = task.id;
          draft.threads[agentId] = [task, ...(draft.threads[agentId] ?? []).filter((entry) => entry.id !== task.id)];
        });
        flush();
      } else if (taskId !== null) {
        await runTeamEffect(
          sendAgentTaskMessage(request, { agentId, taskId, text, attachmentDraftIds, clientMessageId }),
        );
      } else {
        const receipt = await raw("POST", TEAM_API_ROUTES.agent.messages(agentId), {
          text,
          attachmentDraftIds,
          replyToMessageId: null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          clientMessageId,
        });
        if (!isQueuedMessageReceipt(receipt)) throw new Error(currentText().t("extension.chat.sendFailed"));
      }
      void track("message_send", { target, result: "succeeded" });
      if (generation === chatGeneration) await reloadChat();
    } catch (error) {
      void track("message_send", { target, result: "failed" });
      if (generation !== chatGeneration) return;
      setState((draft) => {
        if (!draft.chat) return;
        draft.chat.messages = draft.chat.messages.filter((message) => message.id !== `pending-${clientMessageId}`);
        draft.chat.error = error instanceof Error ? error.message : currentText().t("extension.chat.sendFailed");
      });
      throw error;
    } finally {
      if (generation === chatGeneration)
        setState((draft) => {
          if (draft.chat) draft.chat.sending = false;
        });
    }
  }

  async function uploadImage(file: File): Promise<AttachmentSummary> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const upload = {
      name: file.name,
      mimeType: file.type,
      base64: bytesToBase64(bytes),
      maxBytes: MOBILE_ATTACHMENT_BYTES,
    };
    return runTeamEffect(uploadAttachmentDraft(request, upload)).catch((error: unknown) => {
      throw error instanceof TeamRequestError ? error.cause : error;
    });
  }

  function discardImage(attachmentId: string): void {
    void runTeamEffect(discardAttachmentDraft(request, attachmentId)).catch(() => undefined);
  }

  function chatTakesImages(chat: OpenChat): boolean {
    return (chat.taskId === null && !chat.draftThread) || has(AGENT_THREAD_FILES_CAPABILITY);
  }

  async function agentCatalog(): Promise<{ models: ClientAgentModelOption[]; status: AgentStatus } | null> {
    if (!has(TEAM_AGENT_CREATE_MODEL_CAPABILITY)) return null;
    const [models, status] = await Promise.all([
      request("GET", TEAM_API_ROUTES.agents.models, decodeModels),
      request("GET", TEAM_API_ROUTES.agents.status, (value) => {
        if (!isAgentStatus(value)) throw new Error(currentText().t("extension.connection.requestFailed"));
        return value;
      }),
    ]);
    return { models, status };
  }

  async function createAgent(draft: FirstAgentDraft): Promise<string> {
    const withModel = has(TEAM_AGENT_CREATE_MODEL_CAPABILITY) && isKnownAgentProvider(draft.provider);
    const profile = {
      name: draft.name.trim(),
      description: draft.purpose.trim(),
      initialMessage: createAgentInitialMessage(draft, has(AGENT_WELCOME_CAPABILITY)),
      avatarSeed: draft.avatarSeed,
      avatarHue: draft.avatarHue,
      ...(withModel
        ? {
            provider: draft.provider,
            model: draft.model,
            ...(draft.reasoningEffort ? { reasoningEffort: draft.reasoningEffort } : {}),
          }
        : {}),
    };
    const operation = has(AGENT_CREATE_OPERATION_CAPABILITY) ? createOperationId(profile) : null;
    const agent = await request(
      "POST",
      TEAM_API_ROUTES.agents.all,
      (value) => {
        if (!isClientAgentSummary(value)) throw new Error(currentText().t("extension.connection.requestFailed"));
        return value;
      },
      { ...profile, ...(operation ? { operationId: operation.id } : {}) },
    ).catch((error: unknown) => {
      operation?.failed();
      void track("agent_action", { action: "create", result: "failed" });
      throw error;
    });
    void track("agent_action", { action: "create", result: "succeeded" });
    setState((draft) => {
      if (!draft.agents.some((entry) => entry.id === agent.id)) draft.agents.push(agent);
    });
    const color = draft.avatarColor;
    if (color && has(AGENT_COLORS_CAPABILITY))
      await runTeamEffect(setAgentColor(request, { agentId: agent.id, color })).then(
        () =>
          setState((next) => {
            next.colors[agent.id] = color;
          }),
        () => undefined,
      );
    return agent.id;
  }

  function appendDelta(event: {
    threadId: string;
    turnId: string;
    messageId: string;
    delta: string;
    createdAt: string;
    revision: number;
  }): boolean {
    let stale = false;
    setState((draft) => {
      const chat = draft.chat;
      if (chat?.status !== "ready") return;
      if (chat.threadId !== null && chat.threadId !== event.threadId) {
        stale = true;
        return;
      }
      if (event.revision <= chat.revision) return;
      const message = chat.messages.findLast((entry) => entry.id === event.messageId);
      if (message) {
        message.text += event.delta;
        message.status = "streaming";
      } else
        chat.messages.push({
          id: event.messageId,
          turnId: event.turnId,
          author: "assistant",
          source: "assistant",
          text: event.delta,
          createdAt: event.createdAt,
          status: "streaming",
        });
      chat.revision = event.revision;
      chat.activeTurnId = event.turnId;
    });
    return !stale;
  }

  async function answerPrompt(requestId: string | number, answers: Record<string, string[]>): Promise<boolean> {
    try {
      await raw("POST", TEAM_API_ROUTES.respond.prompt, { requestId, answers });
    } catch {
      void track("agent_input_action", { kind: "prompt", decision: "answered", result: "failed" });
      return false;
    }
    void track("agent_input_action", { kind: "prompt", decision: "answered", result: "succeeded" });
    setState((draft) => {
      draft.prompts = draft.prompts.filter((prompt) => prompt.requestId !== requestId);
    });
    return true;
  }

  function handleEvent(event: RemoteTeamEvent): void {
    if (sync && !sync.hostEvent(event)) return;
    applyEvent(event);
  }

  function connection(update: RemoteTeamConnectionUpdate): void {
    if (!sync) return;
    if (update.state !== "online") {
      syncPaused = true;
      sync.pause();
    } else if (syncPaused || update.resync) {
      syncPaused = false;
      sync.resubscribe();
    }
  }

  function applyEvent(event: RemoteTeamEvent): void {
    const chat = state.chat;
    const mainChatOf = (agentId: string) =>
      chat !== null && chat.taskId === null && !chat.draftThread && chat.agentId === agentId;
    switch (event.type) {
      case "agents-changed":
        setState((draft) => {
          draft.agents = event.agents;
        });
        return;
      case "agent-colors-changed":
        setState((draft) => {
          draft.colors = Object.fromEntries(event.agents.map((entry) => [entry.agentId, entry.color]));
        });
        return;
      case "sidebar-pins-changed":
        setState((draft) => {
          draft.pins = event.items.map((pin) => ({ kind: pin.kind, id: pin.id }));
        });
        return;
      case "sidebar-layout-changed":
        showLayout(event.layout);
        return;
      case "channels-changed":
        channelChangedSoon(event.channelId);
        return;
      case "conversation-delta":
        if (mainChatOf(event.agentId) && !appendDelta(event)) void reloadChat();
        return;
      case "agent-task-conversation-delta":
        if (chat?.taskId === event.taskId && !appendDelta(event)) void reloadChat();
        return;
      case "agent-task-conversation":
        if (chat?.taskId === event.taskId) setMessages(event.snapshot);
        return;
      case "agent-tasks-changed":
        setState((draft) => {
          draft.threads[event.snapshot.agentId] = event.snapshot.tasks;
        });
        return;
      case "turn-started":
        if (mainChatOf(event.agentId))
          setState((draft) => {
            if (draft.chat) draft.chat.activeTurnId = event.turnId;
          });
        return;
      case "conversation":
        if (mainChatOf(event.snapshot.agentId)) void reloadChat();
        refreshReadsSoon();
        return;
      case "conversation-invalidated":
        if (mainChatOf(event.agentId)) void reloadChat();
        refreshReadsSoon();
        return;
      case "turn-completed":
        if (chat && chat.agentId === event.agentId) void reloadChat();
        refreshReadsSoon();
        return;
      case "runtime-snapshot":
        setState((draft) => {
          draft.prompts = event.snapshot.pendingPrompts;
        });
        return;
      case "prompt": {
        const { type: _type, ...prompt } = event;
        setState((draft) => {
          draft.prompts = [...draft.prompts.filter((entry) => entry.requestId !== prompt.requestId), prompt];
        });
        return;
      }
      case "agent-input-resolved":
        if (event.kind === "prompt")
          setState((draft) => {
            draft.prompts = draft.prompts.filter((entry) => String(entry.requestId) !== String(event.requestId));
          });
        return;
      default:
        return;
    }
  }

  return {
    state,
    load,
    openChat,
    newThread,
    closeChat,
    send,
    agentCatalog,
    createAgent,
    createFolder,
    request,
    settings: createAgentSettingsApi(request, capabilities),
    foldersAvailable: () => has(SIDEBAR_LAYOUT_CAPABILITY),
    channelsAvailable: () => channelsApi !== null,
    openChannel,
    closeChannel,
    reloadChannel,
    sendToChannel,
    createChannel,
    clearChannelError: () =>
      setState((draft) => {
        if (draft.channel) draft.channel.error = null;
      }),
    clearChatError: () =>
      setState((draft) => {
        if (draft.chat) draft.chat.error = null;
      }),
    handleEvent,
    connection,
    receiveSync: (message: SyncServerMessage) => sync?.receive(message),
    syncedAgents: () => sync?.agents() ?? null,
    syncAvailable: () => sync !== null,
    reloadChat,
    answerPrompt,
    threadsAvailable: () => has(AGENT_TASKS_CAPABILITY),
    transcribe: has(VOICE_TRANSCRIPTION_CAPABILITY) ? transcribe : null,
    uploadImage,
    discardImage,
    chatTakesImages,
    media,
    dispose: () => {
      media.dispose();
      if (readsTimer) clearTimeout(readsTimer);
      if (channelTimer) clearTimeout(channelTimer);
      chatGeneration += 1;
      sync?.dispose();
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
