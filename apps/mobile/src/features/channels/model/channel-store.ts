import { isAvatarMimeType } from "@openbot/contracts/avatar-images";
import {
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  CHANNEL_TASK_CANCEL_CAPABILITY,
  type Channel,
  type ChannelCommand,
  type ChannelPage,
  type ChannelSummary,
  type CreateChannelRoutineInput,
  closedChannelTaskSequences,
  decodeChannel,
  decodeChannelMemories,
  decodeChannelPage,
  decodeChannelRoutines,
  decodeChannelSummaries,
  isAttachmentSummary,
  mergeChannelTasks,
  type RespondToPromptInput,
  type UpdateChannelRoutineInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  CHANNEL_COMPACT_AVAILABILITY_CAPABILITY,
  CHANNEL_COMPACT_AVAILABILITY_ROUTE,
  decodeChannelCompactAvailability,
} from "@openbot/contracts/team-protocol/channel-compact-availability-v1";
import {
  CHANNEL_PICTURE_CAPABILITY,
  CHANNEL_PICTURE_ROUTES,
} from "@openbot/contracts/team-protocol/channel-picture-v1";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { CHAT_HISTORY_CAPABILITY, CHAT_HISTORY_ROUTES } from "@openbot/contracts/team-protocol/chat-history-v1";
import { ROUTINES_ONCE_CAPABILITY } from "@openbot/contracts/team-protocol/routines-once-v1";
import { decodeTeamProtocolV2Json, type TeamProtocolV2Json } from "@openbot/contracts/team-protocol/v2";
import { sourceText } from "@openbot/i18n/source";
import type { RemoteFileUpload } from "@openbot/team-client/remote-peer";
import {
  createOnceChannelRoutine,
  isOnceSchedule,
  listOnceChannelRoutines,
  type RoutinesOncePost,
  requireReleasedScheduleOn,
  updateChannelRoutineOnce,
} from "@openbot/team-client/routines-once";
import { replaceEqualDeep } from "@tanstack/react-query";
import { answeredPromptResolution } from "../../chat/model/question-prompt";
import { saveChannelImage, savedChannelImage } from "../../workspace/model/agent-avatar-cache";

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
  canCancelTasks: boolean;
  canSetPicture: boolean;
  canUseContextActions: boolean;
  canUseOnceRoutines: boolean;
  canCheckCompact: boolean;
  loading: boolean;
  listed: boolean;
  error: { cause: unknown } | null;
}
type ChannelFlags = Omit<ChannelState, "channels" | "pages">;
const FLAG_KEYS: readonly (keyof ChannelFlags)[] = [
  "supported",
  "canDelete",
  "canCancelTasks",
  "canSetPicture",
  "canUseContextActions",
  "canUseOnceRoutines",
  "canCheckCompact",
  "loading",
  "listed",
  "error",
];
function sameFlags(a: ChannelFlags, b: ChannelFlags) {
  return FLAG_KEYS.every((key) => a[key] === b[key]);
}
export interface ChannelView extends ChannelFlags {
  summary: ChannelSummary | undefined;
  page: ChannelPage | undefined;
}
const CHANGE_READ_INTERVAL_MS = 250;
const EMPTY_WARMED_CHANNELS: ReadonlySet<string> = new Set();
const EMPTY: ChannelState = {
  channels: [],
  pages: new Map(),
  supported: false,
  canDelete: false,
  canCancelTasks: false,
  canSetPicture: false,
  canUseContextActions: false,
  canUseOnceRoutines: false,
  canCheckCompact: false,
  loading: false,
  listed: false,
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
  views: Map<string, ChannelView>;
  changeTimer: ReturnType<typeof setTimeout> | null;
  changeReadAt: number;
  changeMissed: boolean;
  warmed: Set<string>;
}

export class ChannelHistoryRefreshError extends Error {}

export class MobileChannelStore {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private active = true;
  setActive(active: boolean) {
    this.active = active;
    if (!active) return;
    for (const [serverId, entry] of this.entries) if (entry.changeMissed) this.readChanges(serverId, entry);
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
        views: new Map(),
        changeTimer: null,
        changeReadAt: 0,
        changeMissed: false,
        warmed: new Set(),
      };
      this.entries.set(serverId, entry);
    }
    return entry;
  }
  get(serverId: string) {
    return this.entry(serverId).state;
  }
  peek(serverId: string): ChannelState | undefined {
    return this.entries.get(serverId)?.state;
  }
  whenListed(serverId: string, timeoutMs: number): Promise<ChannelState> {
    const entry = this.entry(serverId);
    if (entry.state.listed || entry.state.error) return Promise.resolve(entry.state);
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        unsubscribe();
        resolve(this.get(serverId));
      };
      const timer = setTimeout(finish, timeoutMs);
      const unsubscribe = this.subscribe(serverId, () => {
        const state = this.get(serverId);
        if (state.listed || state.error) finish();
      });
    });
  }
  subscribe(serverId: string, listener: () => void) {
    const entry = this.entry(serverId);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }
  channelView(serverId: string, channelId: string): ChannelView {
    const entry = this.entry(serverId);
    const { channels, pages, ...flags } = entry.state;
    const summary = channels.find((channel) => channel.id === channelId);
    const page = pages.get(channelId);
    const cached = entry.views.get(channelId);
    if (cached && cached.summary === summary && cached.page === page && sameFlags(cached, flags)) return cached;
    const view = { ...flags, summary, page };
    entry.views.set(channelId, view);
    return view;
  }
  private publish(entry: Entry, patch: Partial<ChannelState>) {
    if (!entry.valid) return;
    const next = { ...entry.state, ...patch };
    if (next.channels === entry.state.channels && next.pages === entry.state.pages && sameFlags(next, entry.state))
      return;
    entry.state = next;
    for (const listener of entry.listeners) listener();
  }
  configure(serverId: string, capabilities: string[]) {
    const entry = this.entry(serverId);
    const supported = capabilities.includes(CHANNEL_CHATS_CAPABILITY);
    this.publish(entry, {
      supported,
      canDelete: capabilities.includes(CHANNEL_DELETE_CAPABILITY),
      canCancelTasks: capabilities.includes(CHANNEL_TASK_CANCEL_CAPABILITY),
      canSetPicture: capabilities.includes(CHANNEL_PICTURE_CAPABILITY),
      canUseContextActions: capabilities.includes(CHAT_HISTORY_CAPABILITY),
      canUseOnceRoutines: capabilities.includes(ROUTINES_ONCE_CAPABILITY),
      canCheckCompact: capabilities.includes(CHANNEL_COMPACT_AVAILABILITY_CAPABILITY),
      ...(supported ? {} : { listed: true, channels: [], pages: new Map() }),
    });
  }
  restore(
    serverId: string,
    capabilities: readonly string[],
    channels: ChannelSummary[],
    pages: ChannelPage[],
    warmedIds?: ReadonlySet<string>,
  ) {
    const entry = this.entry(serverId);
    if (entry.state.listed || entry.state.channels.length || !capabilities.includes(CHANNEL_CHATS_CAPABILITY)) return;
    const ids = new Set(channels.map((channel) => channel.id));
    if (warmedIds) {
      for (const page of pages) {
        if (ids.has(page.channel.id) && warmedIds.has(page.channel.id) && !entry.observed.has(page.channel.id)) {
          entry.warmed.add(page.channel.id);
        }
      }
    }
    this.publish(entry, {
      supported: true,
      canDelete: capabilities.includes(CHANNEL_DELETE_CAPABILITY),
      canCancelTasks: capabilities.includes(CHANNEL_TASK_CANCEL_CAPABILITY),
      canSetPicture: capabilities.includes(CHANNEL_PICTURE_CAPABILITY),
      canUseContextActions: capabilities.includes(CHAT_HISTORY_CAPABILITY),
      canUseOnceRoutines: capabilities.includes(ROUTINES_ONCE_CAPABILITY),
      canCheckCompact: capabilities.includes(CHANNEL_COMPACT_AVAILABILITY_CAPABILITY),
      channels,
      pages: new Map(pages.filter((page) => ids.has(page.channel.id)).map((page) => [page.channel.id, page])),
    });
  }
  cachedChannels(serverId: string): { channels: ChannelSummary[]; pages: ChannelPage[] } | null {
    const state = this.entries.get(serverId)?.state;
    if (!state?.supported || (!state.listed && !state.channels.length)) return null;
    return {
      channels: state.channels,
      pages: [...state.pages.values()].map((page) => {
        if (page.messages.length <= 50) return page;
        const messages = page.messages.slice(-50);
        return { ...page, messages, olderCursor: messages[0]?.sequence ?? page.olderCursor };
      }),
    };
  }
  remove(serverId: string) {
    const entry = this.entries.get(serverId);
    if (!entry) return;
    this.publish(entry, EMPTY);
    entry.valid = false;
    if (entry.changeTimer) clearTimeout(entry.changeTimer);
    entry.changeTimer = null;
    for (const id of entry.historyWaiters.keys()) this.finishHistory(entry, id, false);
    this.entries.delete(serverId);
  }
  dispose() {
    for (const id of this.entries.keys()) this.remove(id);
  }
  observe(serverId: string, channelId: string) {
    const entry = this.entry(serverId);
    entry.warmed.delete(channelId);
    entry.observed.set(channelId, (entry.observed.get(channelId) ?? 0) + 1);
    if (entry.observed.get(channelId) === 1) void this.refresh(serverId);
    return () => {
      const count = (entry.observed.get(channelId) ?? 1) - 1;
      if (count) entry.observed.set(channelId, count);
      else {
        entry.observed.delete(channelId);
        entry.views.delete(channelId);
        if ((entry.state.pages.get(channelId)?.messages.length ?? 0) > 50) {
          const pages = new Map(entry.state.pages);
          const current = entry.state.pages.get(channelId);
          if (current) {
            const messages = current.messages.slice(-50);
            pages.set(channelId, { ...current, messages, olderCursor: messages[0]?.sequence ?? current.olderCursor });
          }
          this.publish(entry, { pages });
        }
      }
    };
  }
  changed(serverId: string, channelId: string) {
    const entry = this.entry(serverId);
    if (!this.active || !entry.state.supported) return;
    if (entry.observed.has(channelId)) entry.readChannels.add(channelId);
    if (entry.changeTimer) return;
    const wait = entry.changeReadAt + CHANGE_READ_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.readChanges(serverId, entry);
      return;
    }
    entry.changeTimer = setTimeout(() => {
      entry.changeTimer = null;
      if (entry.valid) this.readChanges(serverId, entry);
    }, wait);
  }
  private readChanges(serverId: string, entry: Entry) {
    if (!this.active) {
      entry.changeMissed = true;
      return;
    }
    entry.changeMissed = false;
    if (!entry.state.supported) return;
    entry.changeReadAt = Date.now();
    void this.read(serverId, entry);
  }
  refresh(serverId: string, channelId?: string): Promise<void> {
    const entry = this.entry(serverId);
    if (!this.active || !entry.state.supported) return Promise.resolve();
    for (const id of entry.observed.keys()) {
      if (!channelId || channelId === id) entry.readChannels.add(id);
    }
    return this.read(serverId, entry);
  }
  async prefetch(serverId: string, channelId: string): Promise<boolean> {
    const entry = this.entry(serverId);
    if (!this.active || !entry.state.supported) return false;
    if (entry.state.pages.has(channelId) || entry.observed.has(channelId)) return false;
    const writes = entry.writes;
    const page = await this.request("POST", CHANNEL_ROUTES.read, decodeChannelPage, { channelId }, serverId);
    if (!entry.valid || !this.active || writes !== entry.writes) return false;
    if (!entry.state.channels.some((channel) => channel.id === channelId)) return false;
    const current = entry.state.pages.get(channelId);
    if (current && page.channel.revision < current.channel.revision) return false;
    const merged = mergeLatestChannelPage(current, page);
    if (merged === current) return false;
    const nextPages = new Map(entry.state.pages);
    nextPages.set(channelId, merged);
    entry.warmed.add(channelId);
    this.publish(entry, { pages: nextPages });
    return true;
  }
  warmedChannelIds(serverId: string): ReadonlySet<string> {
    return this.entries.get(serverId)?.warmed ?? EMPTY_WARMED_CHANNELS;
  }
  private read(serverId: string, entry: Entry): Promise<void> {
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
            this.onList?.(serverId, stableChannels);
            const ids = new Set(channels.map((channel) => channel.id));
            listedIds = ids;
            const pages = new Map(entry.state.pages);
            for (const id of pages.keys()) if (!ids.has(id)) pages.delete(id);
            this.publish(entry, {
              channels: stableChannels,
              pages: pages.size === entry.state.pages.size ? entry.state.pages : pages,
              listed: true,
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
            const first = page.messages[0]?.sequence ?? 0;
            const held = merged.messages.filter((message) => message.sequence < first);
            const closed = current ? closedChannelTaskSequences(page.tasks, current.tasks, held) : [];
            if (closed.length) void this.readClosedTasks(serverId, entry, id, closed).catch(() => undefined);
            this.finishHistory(entry, id, true);
          };
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
          this.publish(entry, { error: { cause: error } });
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
  private async readClosedTasks(serverId: string, entry: Entry, channelId: string, sequences: number[]) {
    let covered = Number.POSITIVE_INFINITY;
    for (const sequence of sequences) {
      if (sequence >= covered) continue;
      const page = await this.request(
        "POST",
        CHANNEL_ROUTES.read,
        decodeChannelPage,
        { channelId, beforeSequence: sequence + 1 },
        serverId,
      );
      covered = page.messages[0]?.sequence ?? sequence;
      const latest = entry.state.pages.get(channelId);
      if (!entry.valid || !latest) return;
      const tasks = mergeChannelTasks(latest.tasks, page.tasks, latest.messages);
      if (tasks.length === latest.tasks.length) continue;
      const pages = new Map(entry.state.pages);
      pages.set(channelId, { ...latest, tasks });
      this.publish(entry, { pages });
    }
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
    failureMessage = sourceText("error.remote.historyRefreshFailed"),
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
      void this.refresh(serverId, channelId).then(
        () => finish(false),
        () => finish(false),
      );
    });
  }
  removeMessage(serverId: string, channelId: string, messageId: string) {
    const entry = this.entry(serverId);
    const page = entry.state.pages.get(channelId);
    if (!page?.messages.some((message) => message.id === messageId)) return;
    const pages = new Map(entry.state.pages);
    pages.set(channelId, { ...page, messages: page.messages.filter((message) => message.id !== messageId) });
    this.publish(entry, { pages });
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
    const merged = [...messages.values()].sort((a, b) => a.sequence - b.sequence);
    const pages = new Map(entry.state.pages);
    pages.set(channelId, {
      ...latest,
      messages: merged,
      tasks: mergeChannelTasks(latest.tasks, page.tasks, merged),
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
    if (!page || page.channel.archived) throw new Error(sourceText("error.remote.formUnavailable"));
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
    const current = entry.state.pages.get(channelId);
    if (entry.valid && current && message && prompt) {
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
    if (!entry.state.supported) throw new Error(sourceText("error.remote.channelsUnsupported"));
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
      this.applyChannel(entry, result);
      if (options?.waitForRefresh && command.type === "send" && entry.observed.has(result.id))
        await this.refreshHistory(serverId, result.id);
      else if (
        options?.waitForRefresh &&
        (command.type === "resume" || command.type === "reassign" || command.type === "cancel")
      )
        await this.refreshHistory(serverId, result.id, sourceText("error.remote.taskHistoryRefreshFailed"));
      else {
        const refresh = this.refresh(serverId);
        if (options?.waitForRefresh) await refresh;
      }
    }
    return result;
  }
  private applyChannel(entry: Entry, result: Channel) {
    entry.writes += 1;
    const previous = entry.state.channels.find((channel) => channel.id === result.id);
    if (previous && result.revision < previous.revision) return;
    const summary: ChannelSummary = { unreadCount: 0, activeTasks: 0, lastMessage: null, ...previous, ...result };
    this.publish(entry, {
      channels: previous
        ? entry.state.channels.map((channel) => (channel.id === result.id ? summary : channel))
        : [...entry.state.channels, summary],
    });
  }
  async setImage(serverId: string, channelId: string, image: RemoteFileUpload | null) {
    const entry = this.entry(serverId);
    if (!entry.state.canSetPicture) throw new Error(sourceText("error.remote.channelsUnsupported"));
    const result = await this.request(
      image ? "PUT" : "DELETE",
      `${CHANNEL_PICTURE_ROUTES.image}?${new URLSearchParams({ channelId })}`,
      decodeChannel,
      undefined,
      serverId,
      image ?? undefined,
    );
    if (image && result.imageUrl)
      saveChannelImage(serverId, channelId, result.imageUrl, `data:${image.mimeType};base64,${image.base64}`);
    if (entry.valid) this.applyChannel(entry, result);
    return result;
  }
  async image(serverId: string, channelId: string, imageUrl: string): Promise<string> {
    const saved = savedChannelImage(serverId, channelId, imageUrl);
    if (saved) return saved;
    const version = new URL(imageUrl).searchParams.get("v");
    if (!version) throw new Error("The channel image has no version.");
    const dataUrl = await this.request(
      "GET",
      `${CHANNEL_PICTURE_ROUTES.image}?${new URLSearchParams({ channelId, v: version })}`,
      (value) => {
        if (
          !isDynamicRecord(value) ||
          !isString(value.mimeType) ||
          !isAvatarMimeType(value.mimeType) ||
          !isString(value.base64)
        )
          throw new Error("The host returned an invalid channel image.");
        return `data:${value.mimeType};base64,${value.base64}`;
      },
      undefined,
      serverId,
    );
    return saveChannelImage(serverId, channelId, imageUrl, dataUrl);
  }
  async markAllRead(serverId: string, operationId: () => string) {
    const entry = this.entry(serverId);
    if (!entry.state.supported) return;
    const unread = entry.state.channels.filter((channel) => channel.unreadCount > 0).map((channel) => channel.id);
    if (unread.length === 0) return;
    const results = await Promise.allSettled(
      unread.map((channelId) => this.#readThrough(serverId, channelId, operationId)),
    );
    await this.refresh(serverId);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  }
  async markRead(serverId: string, channelId: string, operationId: () => string) {
    await this.#readThrough(serverId, channelId, operationId);
    await this.refresh(serverId);
  }
  async #readThrough(serverId: string, channelId: string, operationId: () => string) {
    const page = await this.request("POST", CHANNEL_ROUTES.read, decodeChannelPage, { channelId }, serverId);
    await this.command(serverId, {
      type: "read",
      operationId: operationId(),
      channelId,
      throughSequence: page.throughSequence,
    });
  }
  memories(serverId: string, channelId: string) {
    return this.request("POST", CHANNEL_ROUTES.memories, decodeChannelMemories, { channelId }, serverId);
  }
  routines(serverId: string, channelId: string) {
    return this.request("POST", CHANNEL_ROUTES.routines, decodeChannelRoutines, { channelId }, serverId);
  }
  async onceRoutines(serverId: string, channelId: string) {
    if (!this.entry(serverId).state.canUseOnceRoutines) return [];
    return listOnceChannelRoutines(this.oncePost(serverId), channelId);
  }
  private oncePost(serverId: string): RoutinesOncePost {
    return (path, decode, body) => this.request("POST", path, decode, body, serverId);
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
    if (isOnceSchedule(input.schedule)) {
      requireReleasedScheduleOn(input.schedule, this.entry(serverId).state.canUseOnceRoutines);
      await createOnceChannelRoutine(this.oncePost(serverId), input);
      return;
    }
    await this.request(
      "POST",
      CHANNEL_ROUTES.routineCreate,
      () => undefined,
      decodeTeamProtocolV2Json(input),
      serverId,
    );
  }
  async updateRoutine(serverId: string, input: UpdateChannelRoutineInput) {
    if (this.entry(serverId).state.canUseOnceRoutines) {
      await updateChannelRoutineOnce(this.oncePost(serverId), input);
      return;
    }
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
  async testRoutine(serverId: string, channelId: string, routineId: string) {
    await this.request("POST", CHANNEL_ROUTES.routineTest, () => undefined, { channelId, routineId }, serverId);
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
  async clearContext(serverId: string, channelId: string) {
    await this.contextAction(serverId, CHAT_HISTORY_ROUTES.channelClear, channelId);
  }
  async compactContext(serverId: string, channelId: string) {
    await this.contextAction(serverId, CHAT_HISTORY_ROUTES.channelCompact, channelId, false);
  }
  async compactAvailable(serverId: string, channelId: string): Promise<boolean> {
    if (!this.entry(serverId).state.canCheckCompact) return true;
    const answer = await this.request(
      "POST",
      CHANNEL_COMPACT_AVAILABILITY_ROUTE,
      decodeChannelCompactAvailability,
      { channelId },
      serverId,
    );
    return answer.available;
  }
  async deleteHistory(serverId: string, channelId: string) {
    await this.contextAction(serverId, CHAT_HISTORY_ROUTES.channelDelete, channelId);
  }
  private async contextAction(serverId: string, path: string, channelId: string, changesHistory = true) {
    const entry = this.entry(serverId);
    if (!entry.state.canUseContextActions)
      throw new Error(
        sourceText(
          path === CHAT_HISTORY_ROUTES.channelDelete
            ? "error.team.historyDeleteUnsupported"
            : "error.team.channelContextUnsupported",
        ),
      );
    await this.request("POST", path, () => undefined, { channelId }, serverId);
    if (!changesHistory) return;
    entry.writes += 1;
    if (path === CHAT_HISTORY_ROUTES.channelDelete && entry.state.pages.has(channelId)) {
      const pages = new Map(entry.state.pages);
      pages.delete(channelId);
      this.publish(entry, { pages });
    }
    await this.refresh(serverId, channelId);
  }
  async delete(serverId: string, channelId: string) {
    const entry = this.entry(serverId);
    if (!entry.state.canDelete) throw new Error(sourceText("error.remote.channelDeleteUnsupported"));
    await this.request("POST", CHANNEL_ROUTES.delete, () => undefined, { channelId }, serverId);
    entry.writes += 1;
    const pages = new Map(entry.state.pages);
    pages.delete(channelId);
    this.publish(entry, { channels: entry.state.channels.filter((channel) => channel.id !== channelId), pages });
    void this.refresh(serverId);
  }
}

function mergeLatestChannelPage(current: ChannelPage | undefined, page: ChannelPage): ChannelPage {
  if (!current) return page;
  const first = page.messages[0]?.sequence ?? 0;
  const older = current.messages.filter((message) => message.sequence < first);
  if (!older.length || (older.at(-1)?.sequence ?? 0) + 1 < first) return replaceEqualDeep(current, page);
  const messages = [...older, ...page.messages];
  const tasks = mergeChannelTasks(page.tasks, current.tasks, older);
  return replaceEqualDeep(current, { ...page, messages, tasks, olderCursor: current.olderCursor });
}
