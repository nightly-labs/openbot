import {
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  type ChannelCommand,
  type ChannelPage,
  type ChannelSummary,
  type CreateChannelRoutineInput,
  decodeChannel,
  decodeChannelMemories,
  decodeChannelPage,
  decodeChannelRoutines,
  decodeChannelSummaries,
  isAttachmentSummary,
  type RespondToPromptInput,
  type UpdateChannelRoutineInput,
} from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import { userErrorMessage } from "@openbot/user-errors";
import { replaceEqualDeep } from "@tanstack/react-query";
import { answeredPromptResolution } from "../../chat/model/question-prompt";

export type ChannelRequest = <T>(
  method: string,
  path: string,
  decode: (value: unknown) => T,
  body: TeamProtocolV2Json | undefined,
  serverId: string,
  upload?: RemoteFileUpload,
  onUploadProgress?: (fraction: number) => void,
) => Promise<T>;
export interface ChannelState {
  channels: ChannelSummary[];
  pages: ReadonlyMap<string, ChannelPage>;
  supported: boolean;
  canDelete: boolean;
  loading: boolean;
  error: string | null;
}
const EMPTY: ChannelState = {
  channels: [],
  pages: new Map(),
  supported: false,
  canDelete: false,
  loading: false,
  error: null,
};
interface Entry {
  state: ChannelState;
  listeners: Set<() => void>;
  observed: Map<string, number>;
  pending: Promise<void> | null;
  dirty: boolean;
  readChannels: Set<string>;
  valid: boolean;
  writes: number;
  historyWaiters: Map<string, Set<(success: boolean) => void>>;
}

export class ChannelHistoryRefreshError extends Error {}

/** Channel events are invalidations. Keep one read in flight and one trailing read per host. */
export class MobileChannelStore {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private active = true;
  setActive(active: boolean) {
    this.active = active;
  }
  retainServers(ids: string[]) {
    const available = new Set(ids);
    for (const id of this.entries.keys()) if (!available.has(id)) this.remove(id);
  }
  constructor(
    private request: ChannelRequest,
    private onList?: (serverId: string, channels: ChannelSummary[]) => void,
  ) {}

  private entry(serverId: string): Entry {
    let entry = this.entries.get(serverId);
    if (!entry) {
      const listeners = this.listeners.get(serverId) ?? new Set<() => void>();
      this.listeners.set(serverId, listeners);
      entry = {
        state: EMPTY,
        listeners,
        observed: new Map(),
        pending: null,
        dirty: false,
        readChannels: new Set(),
        valid: true,
        writes: 0,
        historyWaiters: new Map(),
      };
      this.entries.set(serverId, entry);
    }
    return entry;
  }
  get(serverId: string) {
    return this.entry(serverId).state;
  }
  subscribe(serverId: string, listener: () => void) {
    const entry = this.entry(serverId);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }
  private publish(entry: Entry, patch: Partial<ChannelState>) {
    if (!entry.valid) return;
    const next = { ...entry.state, ...patch };
    if (
      next.channels === entry.state.channels &&
      next.pages === entry.state.pages &&
      next.supported === entry.state.supported &&
      next.canDelete === entry.state.canDelete &&
      next.loading === entry.state.loading &&
      next.error === entry.state.error
    )
      return;
    entry.state = next;
    for (const listener of entry.listeners) listener();
  }
  configure(serverId: string, capabilities: string[]) {
    const entry = this.entry(serverId);
    this.publish(entry, {
      supported: capabilities.includes(CHANNEL_CHATS_CAPABILITY),
      canDelete: capabilities.includes(CHANNEL_DELETE_CAPABILITY),
    });
  }
  remove(serverId: string) {
    const entry = this.entries.get(serverId);
    if (!entry) return;
    this.publish(entry, EMPTY);
    entry.valid = false;
    for (const id of entry.historyWaiters.keys()) this.finishHistory(entry, id, false);
    this.entries.delete(serverId);
  }
  dispose() {
    for (const id of this.entries.keys()) this.remove(id);
  }
  observe(serverId: string, channelId: string) {
    const entry = this.entry(serverId);
    entry.observed.set(channelId, (entry.observed.get(channelId) ?? 0) + 1);
    if (entry.observed.get(channelId) === 1) void this.refresh(serverId);
    return () => {
      const count = (entry.observed.get(channelId) ?? 1) - 1;
      if (count) entry.observed.set(channelId, count);
      else {
        entry.observed.delete(channelId);
        // Match single chats: keep short windows for reopening while offline.
        if ((entry.state.pages.get(channelId)?.messages.length ?? 0) > 50) {
          const pages = new Map(entry.state.pages);
          const current = entry.state.pages.get(channelId);
          if (current) {
            const messages = current.messages.slice(-50);
            pages.set(channelId, { ...current, messages, olderCursor: messages[0].sequence });
          }
          this.publish(entry, { pages });
        }
      }
    };
  }
  refresh(serverId: string, channelId?: string): Promise<void> {
    const entry = this.entry(serverId);
    if (!this.active || !entry.state.supported) return Promise.resolve();
    for (const id of entry.observed.keys()) {
      if (!channelId || channelId === id) entry.readChannels.add(id);
    }
    if (entry.pending) {
      entry.dirty = true;
      return entry.pending;
    }
    const run = async () => {
      do {
        entry.dirty = false;
        const readChannels = [...entry.readChannels];
        entry.readChannels.clear();
        this.publish(entry, {
          loading: entry.state.channels.length === 0 && entry.state.pages.size === 0,
          error: null,
        });
        try {
          const writes = entry.writes;
          let listedIds: Set<string> | undefined;
          const list = async () => {
            const channels = await this.request(
              "GET",
              CHANNEL_ROUTES.list,
              decodeChannelSummaries,
              undefined,
              serverId,
            );
            if (!entry.valid || !this.active) return;
            if (writes !== entry.writes) {
              entry.dirty = true;
              return;
            }
            const stableChannels = replaceEqualDeep(entry.state.channels, channels);
            // A local deletion can already match this list while its saved pin still needs cleanup.
            this.onList?.(serverId, stableChannels);
            const ids = new Set(channels.map((channel) => channel.id));
            listedIds = ids;
            const pages = new Map(entry.state.pages);
            for (const id of pages.keys()) if (!ids.has(id)) pages.delete(id);
            this.publish(entry, {
              channels: stableChannels,
              pages: pages.size === entry.state.pages.size ? entry.state.pages : pages,
            });
          };
          const read = async (id: string) => {
            const page = await this.request(
              "POST",
              CHANNEL_ROUTES.read,
              decodeChannelPage,
              { channelId: id },
              serverId,
            );
            if (!entry.valid || !this.active) return;
            if (writes !== entry.writes) {
              entry.dirty = true;
              return;
            }
            if (!entry.observed.has(id) || (listedIds && !listedIds.has(id))) return;
            const current = entry.state.pages.get(id);
            if (current && page.channel.revision < current.channel.revision) return;
            const merged = mergeLatestChannelPage(current, page);
            if (merged !== current) {
              const nextPages = new Map(entry.state.pages);
              nextPages.set(id, merged);
              this.publish(entry, { pages: nextPages });
            }
            this.finishHistory(entry, id, true);
          };
          // Publish history as soon as it arrives; a slow sidebar request must not block opening a chat.
          const results = await Promise.allSettled([
            list(),
            ...readChannels.map((id) =>
              read(id).catch((error) => {
                if (writes === entry.writes) this.finishHistory(entry, id, false);
                throw error;
              }),
            ),
          ]);
          for (const result of results) if (result.status === "rejected") throw result.reason;
        } catch (error) {
          this.publish(entry, { error: userErrorMessage(error, "Could not load channels. Try again.") });
        } finally {
          this.publish(entry, { loading: false });
        }
      } while (entry.valid && this.active && entry.dirty);
    };
    entry.pending = run().finally(() => {
      entry.pending = null;
    });
    return entry.pending;
  }
  private finishHistory(entry: Entry, channelId: string, success: boolean) {
    const waiters = entry.historyWaiters.get(channelId);
    if (!waiters) return;
    entry.historyWaiters.delete(channelId);
    for (const finish of waiters) finish(success);
  }
  refreshHistory(
    serverId: string,
    channelId: string,
    failureMessage = "The message was sent, but chat history could not refresh.",
  ): Promise<void> {
    const entry = this.entry(serverId);
    return new Promise((resolve, reject) => {
      const finish = (success: boolean) => {
        const waiters = entry.historyWaiters.get(channelId);
        waiters?.delete(finish);
        if (!waiters?.size) entry.historyWaiters.delete(channelId);
        if (success) resolve();
        else reject(new ChannelHistoryRefreshError(failureMessage));
      };
      const waiters = entry.historyWaiters.get(channelId) ?? new Set();
      waiters.add(finish);
      entry.historyWaiters.set(channelId, waiters);
      // Only the required history read holds up a send, not the list or trailing event refreshes.
      void this.refresh(serverId, channelId).then(
        () => finish(false),
        () => finish(false),
      );
    });
  }
  async older(serverId: string, channelId: string) {
    const entry = this.entry(serverId);
    const current = entry.state.pages.get(channelId);
    if (current?.olderCursor == null) return;
    const page = await this.request(
      "POST",
      CHANNEL_ROUTES.read,
      decodeChannelPage,
      { channelId, beforeSequence: current.olderCursor },
      serverId,
    );
    const latest = entry.state.pages.get(channelId);
    if (!entry.valid || !latest || latest.olderCursor !== current.olderCursor) return;
    const messages = new Map(page.messages.map((message) => [message.id, message]));
    for (const message of latest.messages) messages.set(message.id, message);
    const pages = new Map(entry.state.pages);
    pages.set(channelId, {
      ...latest,
      messages: [...messages.values()].sort((a, b) => a.sequence - b.sequence),
      olderCursor: page.olderCursor,
    });
    this.publish(entry, { pages });
  }
  async respondToPrompt(serverId: string, channelId: string, agentId: string, input: RespondToPromptInput) {
    const entry = this.entry(serverId);
    const page = entry.state.pages.get(channelId);
    const message = page?.messages.find(
      (item) =>
        item.author.kind === "agent" &&
        item.author.id === agentId &&
        !item.superseded &&
        item.message.questionPrompt?.requestId === input.requestId &&
        !item.message.questionPrompt.resolution,
    );
    const prompt = message?.message.questionPrompt;
    if (!prompt || page?.channel.archived) throw new Error("This form is no longer available.");
    await this.request(
      "POST",
      TEAM_API_ROUTES.respond.prompt,
      () => undefined,
      {
        requestId: input.requestId,
        answers: input.answers,
      },
      serverId,
    );
    // A successful answer stays resolved even if the history refresh loses connection.
    const current = entry.state.pages.get(channelId);
    if (entry.valid && current) {
      const pages = new Map(entry.state.pages);
      pages.set(channelId, {
        ...current,
        messages: current.messages.map((item) =>
          item.id === message.id && item.message.questionPrompt && !item.message.questionPrompt.resolution
            ? {
                ...item,
                message: {
                  ...item.message,
                  questionPrompt: {
                    ...item.message.questionPrompt,
                    resolution: answeredPromptResolution(prompt.questions, input.answers),
                  },
                },
              }
            : item,
        ),
      });
      entry.writes++;
      this.publish(entry, { pages });
      void this.refresh(serverId, channelId);
    }
  }
  async command(serverId: string, command: ChannelCommand, options?: { waitForRefresh: boolean }) {
    const entry = this.entry(serverId);
    if (!entry.state.supported) throw new Error("Update this desktop server to use channels.");
    const unreadChannel =
      command.type === "read" ? entry.state.channels.find((channel) => channel.id === command.channelId) : undefined;
    const result = await this.request(
      "POST",
      CHANNEL_ROUTES.command,
      decodeChannel,
      decodeTeamProtocolV2Json(command),
      serverId,
    );
    if (entry.valid && command.type === "read") {
      // A read receipt changes unread state, not channel history or its revision.
      const channels = entry.state.channels.map((channel) =>
        channel === unreadChannel &&
        channel.unreadCount !== 0 &&
        command.throughSequence >= (entry.state.pages.get(channel.id)?.throughSequence ?? Infinity)
          ? { ...channel, unreadCount: 0 }
          : channel,
      );
      if (channels.some((channel, index) => channel !== entry.state.channels[index])) this.publish(entry, { channels });
      return result;
    }
    if (entry.valid) {
      entry.writes += 1;
      const previous = entry.state.channels.find((channel) => channel.id === result.id);
      if (!previous || result.revision >= previous.revision) {
        const summary: ChannelSummary = { unreadCount: 0, activeTasks: 0, lastMessage: null, ...previous, ...result };
        this.publish(entry, {
          channels: previous
            ? entry.state.channels.map((channel) => (channel.id === result.id ? summary : channel))
            : [...entry.state.channels, summary],
        });
      }
      if (options?.waitForRefresh && command.type === "send") await this.refreshHistory(serverId, result.id);
      else if (options?.waitForRefresh && (command.type === "resume" || command.type === "reassign"))
        await this.refreshHistory(serverId, result.id, "The task was changed, but chat history could not refresh.");
      else {
        const refresh = this.refresh(serverId);
        if (options?.waitForRefresh) await refresh;
      }
    }
    return result;
  }
  memories(serverId: string, channelId: string) {
    return this.request("POST", CHANNEL_ROUTES.memories, decodeChannelMemories, { channelId }, serverId);
  }
  routines(serverId: string, channelId: string) {
    return this.request("POST", CHANNEL_ROUTES.routines, decodeChannelRoutines, { channelId }, serverId);
  }
  async saveMemory(serverId: string, channelId: string, text: string, memoryId?: string) {
    await this.request(
      "POST",
      memoryId ? CHANNEL_ROUTES.memoryUpdate : CHANNEL_ROUTES.memoryCreate,
      () => undefined,
      { channelId, text, ...(memoryId ? { memoryId } : {}) },
      serverId,
    );
  }
  async deleteMemory(serverId: string, channelId: string, memoryId: string) {
    await this.request("POST", CHANNEL_ROUTES.memoryDelete, () => undefined, { channelId, memoryId }, serverId);
  }
  async createRoutine(serverId: string, input: CreateChannelRoutineInput) {
    await this.request(
      "POST",
      CHANNEL_ROUTES.routineCreate,
      () => undefined,
      decodeTeamProtocolV2Json(input),
      serverId,
    );
  }
  async updateRoutine(serverId: string, input: UpdateChannelRoutineInput) {
    await this.request(
      "POST",
      CHANNEL_ROUTES.routineUpdate,
      () => undefined,
      decodeTeamProtocolV2Json(input),
      serverId,
    );
  }
  async deleteRoutine(serverId: string, channelId: string, routineId: string) {
    await this.request("POST", CHANNEL_ROUTES.routineDelete, () => undefined, { channelId, routineId }, serverId);
  }
  async upload(serverId: string, input: RemoteFileUpload, onProgress?: (fraction: number) => void) {
    const query = new URLSearchParams({ name: input.name, mime: input.mimeType });
    return this.request(
      "POST",
      `${TEAM_API_ROUTES.attachments}?${query}`,
      (value) => {
        if (!isAttachmentSummary(value)) throw new Error("The host returned an invalid attachment.");
        return value;
      },
      undefined,
      serverId,
      input,
      onProgress,
    );
  }
  async discard(serverId: string, attachmentId: string) {
    await this.request("DELETE", TEAM_API_ROUTES.attachment(attachmentId), () => undefined, undefined, serverId);
  }
  async delete(serverId: string, channelId: string) {
    const entry = this.entry(serverId);
    if (!entry.state.canDelete) throw new Error("Update this desktop server to delete channels.");
    await this.request("POST", CHANNEL_ROUTES.delete, () => undefined, { channelId }, serverId);
    entry.writes += 1;
    const pages = new Map(entry.state.pages);
    pages.delete(channelId);
    this.publish(entry, { channels: entry.state.channels.filter((channel) => channel.id !== channelId), pages });
    void this.refresh(serverId);
  }
}

export function mergeLatestChannelPage(current: ChannelPage | undefined, page: ChannelPage): ChannelPage {
  if (!current) return page;
  const first = page.messages[0]?.sequence ?? 0;
  const older = current.messages.filter((message) => message.sequence < first);
  const merged =
    !older.length || (older.at(-1)?.sequence ?? 0) + 1 < first
      ? page
      : { ...page, messages: [...older, ...page.messages], olderCursor: current.olderCursor };
  return replaceEqualDeep(current, merged);
}
