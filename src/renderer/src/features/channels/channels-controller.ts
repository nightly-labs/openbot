import {
  type AvatarImageInput,
  type ChannelCommand,
  type ChannelPage,
  type ChannelSummary,
  closedChannelTaskSequences,
  mergeChannelTasks,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import type { AgentProfile } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, flush, onSettled, reconcile, snapshot, untrack } from "solid-js";
import { actionToast } from "../../action-toast";
import { type DesktopAnalyticsProperties, desktopAnalytics } from "../../analytics";
import { mergeChannelPage } from "./channel-page-merge";

function takeOlderWindow(target: ChannelPage, source: ChannelPage): void {
  target.olderCursor = source.olderCursor;
  if (source.olderCount === undefined) delete target.olderCount;
  else target.olderCount = source.olderCount;
  if (source.oldestAt === undefined) delete target.oldestAt;
  else target.oldestAt = source.oldestAt;
}

import type { ChannelFoldersMode } from "./channel-folders-port";
import type { ChannelsPort } from "./channels-port";

interface ChannelsState {
  channels: ChannelSummary[];
  listed: boolean;
  selectedId: string | null;
  page: ChannelPage | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  errorReference: string | null;
  editing: "create" | "settings" | null;
  archived: boolean;
  collapsed: boolean;
}

export interface ChannelsEnvironment {
  port: () => ChannelsPort;
  agents: () => AgentProfile[];
  scopeKey: () => string;
  readSelection: (scope: string) => string | null;
  writeSelection: (channelId: string | null) => void;
  supported: () => boolean;
  deletionSupported: () => boolean;
  messageDeletionSupported: () => boolean;
  deletesAnyMessage: () => boolean;
  taskCancelSupported: () => boolean;
  isolationSupported: () => boolean;
  browserSupported: () => boolean;
  pictureSupported: () => boolean;
  contextActionsSupported: () => boolean;
  foldersMode: () => ChannelFoldersMode | null;
  beforeOpen: () => void;
  canMarkRead: () => boolean;
  onList?: (channels: ChannelSummary[], scope: string) => void;
}

export type ChannelsController = ReturnType<typeof createChannelsController>;

function failure(error: unknown, fallback: AppTextKey): Pick<ChannelsState, "error" | "errorReference"> {
  const details = currentText().errorDetails(error, currentText().t(fallback));
  return { error: details.message, errorReference: details.reference };
}

type ChannelAction = DesktopAnalyticsProperties<"channel_action">["action"];

function channelAction(input: ChannelCommand, creating: boolean, page: ChannelPage | null): ChannelAction | null {
  if (input.type === "archive") return "archived";
  if (input.type !== "save") return null;
  if (creating) return "created";
  if (page?.channel.id !== input.channelId) return null;
  const members = new Set(page.channel.members.map((member) => member.agentId));
  return input.draft.members.some((member) => !members.has(member.agentId)) ? "member_added" : null;
}

const KEPT_PAGES = 6;
const CHANGE_READ_GAP_MS = 250;

export function createChannelsController(env: ChannelsEnvironment) {
  const [state, setState] = createStore<ChannelsState>({
    channels: [],
    listed: false,
    selectedId: null,
    page: null,
    loading: false,
    pending: false,
    error: null,
    errorReference: null,
    editing: null,
    archived: false,
    collapsed: false,
  });
  let disposed = false;
  let pendingCommands = 0;
  let refreshId = 0;
  let failedCommand: ChannelCommand | null = null;
  const readThrough = new Map<string, number>();
  let visitRead: string | null = null;
  const keptPages = new Map<string, ChannelPage>();
  const dirtyKeptPages = new Set<string>();
  let replaceLoadedPage = false;
  const changeListeners = new Set<(channelId: string | null) => void>();
  function announce(channelId: string | null): void {
    for (const listener of changeListeners) listener(channelId);
  }
  function keepPage(page: ChannelPage | null): void {
    if (!page) return;
    keptPages.delete(page.channel.id);
    dirtyKeptPages.delete(page.channel.id);
    keptPages.set(page.channel.id, snapshot(page));
    for (const id of keptPages.keys()) {
      if (keptPages.size <= KEPT_PAGES) break;
      keptPages.delete(id);
      dirtyKeptPages.delete(id);
    }
  }

  const supported = env.supported;
  let reading: Promise<void> | null = null;
  let readAgain = false;
  let readAgainPage = false;
  let readToken = 0;
  let laterRead: Promise<void> | null = null;
  let settleLaterRead: (() => void) | null = null;
  let readStartedAt = 0;
  let endWaitingGap: (() => void) | null = null;
  function refresh(selectedOverride?: string | null, withPage = true): Promise<void> {
    if (reading && selectedOverride === undefined) {
      readAgain = true;
      readAgainPage ||= withPage;
      return reading;
    }
    const token = ++readToken;
    readStartedAt = Date.now();
    const run = read(selectedOverride, withPage).finally(() => {
      if (token !== readToken) return;
      reading = null;
      const settle = settleLaterRead;
      laterRead = null;
      settleLaterRead = null;
      if (readAgain && !disposed) {
        const page = readAgainPage;
        readAgain = false;
        readAgainPage = false;
        const gap = settle ? 0 : CHANGE_READ_GAP_MS - (Date.now() - readStartedAt);
        if (gap <= 0) void refresh(undefined, page).finally(() => settle?.());
        else readAfterGap(gap, page);
      } else settle?.();
    });
    reading = run;
    return run;
  }
  function readAfterGap(gap: number, page: boolean): void {
    const held = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, gap);
      endWaitingGap = () => {
        clearTimeout(timer);
        resolve();
      };
    }).then(() => {
      endWaitingGap = null;
      if (reading !== held) return;
      reading = null;
      if (disposed) return;
      const withPage = page || readAgainPage;
      readAgain = false;
      readAgainPage = false;
      return refresh(undefined, withPage);
    });
    reading = held;
  }
  function refreshAfter(): Promise<void> {
    if (!reading) return refresh();
    readAgain = true;
    readAgainPage = true;
    laterRead ??= new Promise<void>((resolve) => {
      settleLaterRead = resolve;
    });
    endWaitingGap?.();
    return laterRead;
  }
  async function read(selectedOverride?: string | null, withPage = true) {
    if (!supported()) return;
    const id = ++refreshId;
    const account = env.scopeKey();
    const selected = selectedOverride === undefined ? state.selectedId : selectedOverride;
    try {
      const listPromise = env.port().agent.listChannels();
      const pagePromise =
        selected !== null && withPage
          ? env
              .port()
              .agent.readChannel({ channelId: selected })
              .then(
                (value) => ({ ok: true as const, value }),
                (error: unknown) => ({ ok: false as const, error }),
              )
          : null;
      const channels = await listPromise;
      const selectedExists = selected !== null && channels.some((channel) => channel.id === selected);
      let page: ChannelPage | null = null;
      if (selectedExists && pagePromise) {
        const result = await pagePromise;
        if (!result.ok) throw result.error;
        page = result.value;
      }
      if (disposed || account !== env.scopeKey() || id !== refreshId || selected !== state.selectedId) return;
      env.onList?.(channels, account);
      let closed: number[] = [];
      const readNow = selected !== null && selected === visitRead && env.canMarkRead();
      const listed = readNow
        ? channels.map((channel) =>
            channel.id === selected && channel.unreadCount > 0 ? { ...channel, unreadCount: 0 } : channel,
          )
        : channels;
      setState((state) => {
        reconcile(listed, "id")(state.channels);
        state.listed = true;
        if (selected && !selectedExists) {
          state.selectedId = null;
          state.editing = null;
          readThrough.delete(selected);
          keptPages.delete(selected);
          dirtyKeptPages.delete(selected);
          if (failedCommand?.channelId === selected) failedCommand = null;
        }
        if (
          page &&
          state.page?.channel.id === page.channel.id &&
          !replaceLoadedPage &&
          page.channel.revision === state.page.channel.revision
        ) {
          const merged = mergeChannelPage(state.page.messages, page.messages);
          const kept = merged.messages.slice(0, merged.messages.length - page.messages.length);
          const held = snapshot(state.page.tasks);
          const tasks = mergeChannelTasks(page.tasks, held, kept);
          closed = closedChannelTaskSequences(page.tasks, held, kept);
          reconcile(merged.messages, "id")(state.page.messages);
          reconcile(tasks, "id")(state.page.tasks);
          Object.assign(state.page, { channel: page.channel, throughSequence: page.throughSequence });
          if (page.waits === undefined) delete state.page.waits;
          else state.page.waits = page.waits;
          if (merged.takeFetchedCursor) takeOlderWindow(state.page, page);
        } else if (withPage || !selectedExists) {
          state.page = page;
          replaceLoadedPage = false;
        }
        if (withPage || !selectedExists) state.loading = false;
        if (!failedCommand && withPage) state.error = null;
      });
      if (selected && closed.length) void loadClosedTasks(selected, closed, account);
      if (selected && !selectedExists) env.writeSelection(null);
      if (selected && page && env.canMarkRead()) visitRead = selected;
      if (selected && page && env.canMarkRead() && page.throughSequence > (readThrough.get(selected) ?? 0)) {
        readThrough.set(selected, page.throughSequence);
        try {
          await env.port().agent.channelCommand({
            type: "read",
            channelId: selected,
            throughSequence: page.throughSequence,
            operationId: crypto.randomUUID(),
          });
        } catch (error) {
          readThrough.delete(selected);
          throw error;
        }
      }
    } catch (error) {
      if (!disposed && account === env.scopeKey() && id === refreshId)
        setState((state) => {
          Object.assign(state, {
            ...failure(error, "channel.error.load"),
            loading: false,
          });
        });
    }
  }
  async function open(channelId: string) {
    if (!supported()) return;
    env.beforeOpen();
    env.writeSelection(channelId);
    keepPage(state.page);
    visitRead = null;
    const kept = keptPages.get(channelId) ?? null;
    keptPages.delete(channelId);
    replaceLoadedPage = dirtyKeptPages.delete(channelId);
    flush(() =>
      setState((state) => {
        Object.assign(state, { selectedId: channelId, page: kept, editing: null, loading: kept === null });
      }),
    );
    await refresh(channelId);
  }
  async function perform(action: () => Promise<void>): Promise<boolean> {
    const account = env.scopeKey();
    try {
      await action();
      if (!disposed && account === env.scopeKey()) await refreshAfter();
      return !disposed && account === env.scopeKey();
    } catch (error) {
      if (!disposed && account === env.scopeKey())
        setState((state) => {
          Object.assign(state, failure(error, "channel.error.action"));
        });
      return false;
    }
  }
  async function command(input: ChannelCommand, onAccepted?: (accepted: ChannelCommand) => void): Promise<boolean> {
    const account = env.scopeKey();
    const creating = input.type === "save" && state.editing === "create";
    const selectedBefore = state.selectedId;
    const action = channelAction(input, creating, state.page);
    let accepted = false;
    if (
      state.pending &&
      input.type !== "stop" &&
      input.type !== "archive" &&
      input.type !== "restore" &&
      input.type !== "save"
    )
      return false;
    pendingCommands += 1;
    const attempt =
      failedCommand &&
      JSON.stringify({ ...failedCommand, operationId: null }) === JSON.stringify({ ...input, operationId: null })
        ? failedCommand
        : input;
    flush(() =>
      setState((state) => {
        Object.assign(state, { pending: true, error: null });
      }),
    );
    try {
      await env.port().agent.channelCommand(attempt);
      accepted = true;
      if (action) desktopAnalytics.track("channel_action", { action, result: "succeeded" });
      if (disposed || account !== env.scopeKey()) {
        onAccepted?.(attempt);
        return false;
      }
      failedCommand = null;
      if (creating && state.selectedId === selectedBefore) {
        env.beforeOpen();
        env.writeSelection(input.channelId);
        flush(() =>
          setState((state) => {
            state.selectedId = input.channelId;
            if (state.editing === "create") state.editing = null;
          }),
        );
      }
      await refreshAfter();
      onAccepted?.(attempt);
      return true;
    } catch (error) {
      if (action && !accepted) desktopAnalytics.track("channel_action", { action, result: "failed" });
      if (!disposed && account === env.scopeKey()) {
        failedCommand = attempt;
        setState((state) => {
          Object.assign(state, failure(error, "channel.error.update"));
        });
      }
      return false;
    } finally {
      if (!disposed && account === env.scopeKey())
        setState((state) => {
          pendingCommands -= 1;
          state.pending = pendingCommands > 0;
        });
    }
  }
  async function send(input: Extract<ChannelCommand, { type: "send" }>): Promise<ChannelPage> {
    const account = env.scopeKey();
    const port = env.port();
    const before = state.page?.channel.id === input.channelId ? state.page.throughSequence : null;
    await port.agent.channelCommand(input);
    if (disposed || account !== env.scopeKey()) return port.agent.readChannel({ channelId: input.channelId });
    await refreshAfter();
    const page = state.page;
    return page?.channel.id === input.channelId && (before === null || page.throughSequence > before)
      ? page
      : port.agent.readChannel({ channelId: input.channelId });
  }
  async function loadClosedTasks(channelId: string, sequences: readonly number[], account: string) {
    let covered = Number.POSITIVE_INFINITY;
    for (const sequence of sequences) {
      if (sequence >= covered) continue;
      const fetched = await env
        .port()
        .agent.readChannel({ channelId, beforeSequence: sequence + 1 })
        .catch(() => null);
      if (!fetched || disposed || account !== env.scopeKey() || state.page?.channel.id !== channelId) return;
      covered = fetched.messages[0]?.sequence ?? sequence;
      setState((state) => {
        const page = state.page;
        if (!page || page.channel.id !== channelId) return;
        reconcile(mergeChannelTasks(snapshot(page.tasks), fetched.tasks, snapshot(page.messages)), "id")(page.tasks);
      });
    }
  }
  async function loadOlder() {
    const channelId = state.selectedId;
    const beforeSequence = state.page?.olderCursor;
    const account = env.scopeKey();
    if (!channelId || !beforeSequence) return;
    try {
      const older = await env.port().agent.readChannel({ channelId, beforeSequence });
      if (!disposed && account === env.scopeKey() && state.selectedId === channelId)
        setState((state) => {
          const page = state.page;
          if (!page || page.olderCursor !== beforeSequence) return;
          const ids = new Set(page.messages.map((item) => item.id));
          const added = older.messages.filter((item) => !ids.has(item.id));
          const tasks = mergeChannelTasks(snapshot(page.tasks), older.tasks, added);
          reconcile([...added, ...page.messages], "id")(page.messages);
          reconcile(tasks, "id")(page.tasks);
          takeOlderWindow(page, older);
        });
    } catch (error) {
      if (!disposed && account === env.scopeKey() && state.selectedId === channelId)
        setState((state) => {
          Object.assign(state, failure(error, "channel.error.loadOlder"));
        });
    }
  }
  createEffect(
    () => ({ scope: env.scopeKey(), supported: supported() }),
    (next, previous) => {
      if (next.scope !== previous?.scope) {
        const selected = next.supported ? env.readSelection(next.scope) : null;
        refreshId += 1;
        readThrough.clear();
        keptPages.clear();
        dirtyKeptPages.clear();
        replaceLoadedPage = false;
        visitRead = null;
        failedCommand = null;
        pendingCommands = 0;
        flush(() =>
          setState((state) => {
            Object.assign(state, {
              channels: [],
              listed: false,
              selectedId: selected,
              page: null,
              pending: false,
              error: null,
              editing: null,
            });
          }),
        );
        if (next.supported) void untrack(() => refresh(selected));
        return;
      }
      if (!next.supported || previous.supported) return;
      const saved = state.selectedId === null ? env.readSelection(next.scope) : null;
      if (saved === null) {
        void refresh();
        return;
      }
      env.beforeOpen();
      flush(() =>
        setState((state) => {
          Object.assign(state, { selectedId: saved, page: null, editing: null, loading: true });
        }),
      );
      void refresh(saved);
    },
  );
  onSettled(() => {
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      disposed = true;
      window.removeEventListener("focus", focus);
    };
  });
  function markAllRead(): Promise<boolean> {
    const unread = state.channels.filter((channel) => channel.unreadCount > 0).map((channel) => channel.id);
    const account = env.scopeKey();
    return perform(async () => {
      const results = await Promise.allSettled(
        unread.map(async (channelId) => {
          const page = await env.port().agent.readChannel({ channelId });
          if (disposed || account !== env.scopeKey()) return;
          await env.port().agent.channelCommand({
            type: "read",
            channelId,
            throughSequence: page.throughSequence,
            operationId: crypto.randomUUID(),
          });
        }),
      );
      const failure = results.find((result) => result.status === "rejected");
      if (failure) {
        await refreshAfter();
        throw failure.reason;
      }
    });
  }
  const messageDeletionSupported = () =>
    supported() && env.messageDeletionSupported() && env.port().agent.deleteChannelMessage !== undefined;
  async function deleteMessage(channelId: string, messageId: string): Promise<void> {
    const remove = env.port().agent.deleteChannelMessage;
    if (!remove || !messageDeletionSupported()) throw new Error(currentText().t("error.team.messageDeleteUnsupported"));
    const account = env.scopeKey();
    await remove({ channelId, messageId });
    if (disposed || account !== env.scopeKey()) return;
    setState((state) => {
      if (state.page?.channel.id !== channelId) return;
      state.page.messages = state.page.messages.filter((message) => message.id !== messageId);
    });
  }
  return {
    state,
    port: env.port,
    hasUnread: () => state.channels.some((channel) => channel.unreadCount > 0),
    markAllRead,
    agents: env.agents,
    supported,
    deletionSupported: () => supported() && env.deletionSupported(),
    taskCancelSupported: () => supported() && env.taskCancelSupported(),
    isolationSupported: () => supported() && env.isolationSupported(),
    browserSupported: () => supported() && env.browserSupported(),
    messageDeletionSupported,
    deletesAnyMessage: env.deletesAnyMessage,
    deleteMessage,
    pictureSupported: () => supported() && env.pictureSupported() && env.port().agent.setChannelImage !== undefined,
    foldersMode: () => (supported() && env.port().agent.listChannelFolders !== undefined ? env.foldersMode() : null),
    setImage: (channelId: string, image: AvatarImageInput | null) =>
      perform(async () => {
        const setChannelImage = env.port().agent.setChannelImage;
        if (!setChannelImage) throw new Error(currentText().t("channel.error.update"));
        await setChannelImage({ channelId, image });
      }),
    contextActionsSupported: () =>
      supported() &&
      env.contextActionsSupported() &&
      env.port().agent.clearChannelContext !== undefined &&
      env.port().agent.compactChannelContext !== undefined,
    clearContext: async (channelId: string) => {
      const clearChannelContext = env.port().agent.clearChannelContext;
      if (!clearChannelContext) throw new Error(currentText().t("channel.error.action"));
      await clearChannelContext(channelId);
      await refreshAfter();
    },
    historyDeletionSupported: () =>
      supported() &&
      env.contextActionsSupported() &&
      env.deletesAnyMessage() &&
      env.port().agent.deleteChannelHistory !== undefined,
    deleteHistory: async (channelId: string) => {
      const deleteChannelHistory = env.port().agent.deleteChannelHistory;
      if (!deleteChannelHistory) throw new Error(currentText().t("channel.error.action"));
      await deleteChannelHistory(channelId);
      keptPages.delete(channelId);
      dirtyKeptPages.delete(channelId);
      await refreshAfter();
    },
    compactContext: async (channelId: string) => {
      const compactChannelContext = env.port().agent.compactChannelContext;
      if (!compactChannelContext) throw new Error(currentText().t("channel.error.action"));
      await compactChannelContext(channelId);
    },
    compactAvailable: async (channelId: string) => {
      const channelCompactAvailability = env.port().agent.channelCompactAvailability;
      return channelCompactAvailability ? (await channelCompactAvailability(channelId)).available : true;
    },
    refresh,
    retry: async (onAccepted?: (accepted: ChannelCommand) => void) => {
      const previous = failedCommand;
      if (previous) return (await command(previous, onAccepted)) ? previous : null;
      await refresh();
      return null;
    },
    open,
    editChannel: async (channelId: string) => {
      if (!supported()) return;
      if (state.selectedId !== channelId) await open(channelId);
      if (state.page?.channel.id !== channelId || state.page.channel.archived) return;
      setState((state) => {
        state.editing = "settings";
      });
    },
    remove: async (channelId: string) => {
      if (await command({ type: "archive", channelId, operationId: crypto.randomUUID() })) return;
      const message = state.error ?? currentText().t("channel.error.delete");
      if (failedCommand?.type === "archive" && failedCommand.channelId === channelId) {
        failedCommand = null;
        setState((state) => {
          Object.assign(state, { error: null, errorReference: null });
        });
      }
      throw new Error(message);
    },
    restore: async (channelId: string) => {
      if (await command({ type: "restore", channelId, operationId: crypto.randomUUID() })) return;
      if (failedCommand?.type !== "restore" || failedCommand.channelId !== channelId) return;
      const message = state.error ?? currentText().t("channel.error.update");
      failedCommand = null;
      setState((state) => {
        Object.assign(state, { error: null, errorReference: null });
      });
      actionToast.error(message, { report: { operation: "other", source: "action", cause_code: "unknown" } });
    },
    changed: (channelId: string) => {
      if (channelId !== state.selectedId && keptPages.has(channelId)) dirtyKeptPages.add(channelId);
      announce(channelId);
      return refresh(undefined, channelId === state.selectedId);
    },
    resync: () => {
      keptPages.clear();
      dirtyKeptPages.clear();
      replaceLoadedPage = false;
      announce(null);
      return refresh();
    },
    onChange: (listener: (channelId: string | null) => void) => {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    command,
    send,
    perform,
    loadOlder,
    close: () => {
      env.writeSelection(null);
      setState((state) => {
        Object.assign(state, { selectedId: null, page: null, editing: null });
      });
    },
    edit: () =>
      setState((state) => {
        if (!state.page?.channel.archived) Object.assign(state, { editing: "settings" });
      }),
    closeEditor: () =>
      setState((state) => {
        state.editing = null;
      }),
    create: () => {
      if (!supported()) return;
      setState((state) => {
        state.editing = "create";
        state.error = null;
      });
    },
    toggleArchived: () =>
      setState((state) => {
        Object.assign(state, { archived: !state.archived });
      }),
    toggleCollapsed: () =>
      setState((state) => {
        Object.assign(state, { collapsed: !state.collapsed });
      }),
  };
}
