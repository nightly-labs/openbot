import type { ChannelCommand, ChannelPage, ChannelSummary } from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, flush, onSettled, reconcile, untrack } from "solid-js";
import { mergeChannelPage } from "./channel-page-merge";

/**
 * Takes the older edge of a page: its cursor, and the unloaded length that belongs to that cursor. A
 * page with no length removes the old one, so the day rail never draws a length for another window.
 */
function takeOlderWindow(target: ChannelPage, source: ChannelPage): void {
  target.olderCursor = source.olderCursor;
  if (source.olderCount === undefined) delete target.olderCount;
  else target.olderCount = source.olderCount;
  if (source.oldestAt === undefined) delete target.oldestAt;
  else target.oldestAt = source.oldestAt;
}

import type { ChannelsPort } from "./channels-port";

interface ChannelsState {
  channels: ChannelSummary[];
  selectedId: string | null;
  page: ChannelPage | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  editing: "create" | "settings" | null;
  archived: boolean;
  collapsed: boolean;
}

/**
 * What the channels domain needs from the app around it. The desktop builds it from its contexts;
 * the browser client builds it from its host connection. The domain itself is the same code.
 */
export interface ChannelsEnvironment {
  /** Read on each call, so a test can replace the runtime per case. */
  port: () => ChannelsPort;
  agents: () => AgentProfile[];
  /** Who reads. A change drops the list, the selection, and every command still pending. */
  scopeKey: () => string;
  /** The channel this reader had open, if they are known and had one. */
  readSelection: (scope: string) => string | null;
  writeSelection: (channelId: string | null) => void;
  supported: () => boolean;
  /** Whether this reader may delete a channel; `supported()` is checked as well. */
  deletionSupported: () => boolean;
  /** Clears whatever else covers the workspace, because a channel is about to cover it. */
  beforeOpen: () => void;
  /** Whether a message that arrives now is in front of the reader. */
  canMarkRead: () => boolean;
}

export type ChannelsController = ReturnType<typeof createChannelsController>;

export function createChannelsController(env: ChannelsEnvironment) {
  const [state, setState] = createStore<ChannelsState>({
    channels: [],
    selectedId: null,
    page: null,
    loading: false,
    pending: false,
    error: null,
    editing: null,
    archived: false,
    collapsed: false,
  });
  let disposed = false;
  let pendingCommands = 0;
  let refreshId = 0;
  let failedCommand: ChannelCommand | null = null;
  const readThrough = new Map<string, number>();

  const supported = env.supported;
  /**
   * One read at a time, and at most one more behind it.
   *
   * A channel publishes on every streamed chunk, and a read is two calls: a read for each event,
   * of which only the newest may write, threw away every answer while a member was writing. The
   * transcript then stood still until the turn ended, and an opening channel stayed on Loading.
   * Waiting for the newest answer instead of the newest request keeps the reads bounded and each
   * one lands.
   */
  let reading: Promise<void> | null = null;
  let readAgain = false;
  let readToken = 0;
  let laterRead: Promise<void> | null = null;
  let settleLaterRead: (() => void) | null = null;
  function refresh(selectedOverride?: string | null): Promise<void> {
    // Navigation carries the selection it wants, so it never waits behind the read it replaces.
    if (reading && selectedOverride === undefined) {
      readAgain = true;
      return reading;
    }
    const token = ++readToken;
    const run = read(selectedOverride).finally(() => {
      if (token !== readToken) return;
      reading = null;
      const settle = settleLaterRead;
      laterRead = null;
      settleLaterRead = null;
      if (readAgain && !disposed) {
        readAgain = false;
        void refresh().finally(() => settle?.());
      } else settle?.();
    });
    reading = run;
    return run;
  }
  /**
   * A read that starts after this call.
   *
   * The read in flight started before the write, so its answer can hold the state the write
   * replaced. A settings panel that saves each field builds the next save from the page it holds,
   * and two removals in a row put the first member back.
   */
  function refreshAfter(): Promise<void> {
    if (!reading) return refresh();
    readAgain = true;
    laterRead ??= new Promise<void>((resolve) => {
      settleLaterRead = resolve;
    });
    return laterRead;
  }
  async function read(selectedOverride?: string | null) {
    if (!supported()) return;
    const id = ++refreshId;
    const account = env.scopeKey();
    const selected = selectedOverride === undefined ? state.selectedId : selectedOverride;
    try {
      const channels = await env.port().agent.listChannels();
      const selectedExists = selected !== null && channels.some((channel) => channel.id === selected);
      const page = selectedExists ? await env.port().agent.readChannel({ channelId: selected }) : null;
      if (disposed || account !== env.scopeKey() || id !== refreshId || selected !== state.selectedId) return;
      setState((state) => {
        state.channels = channels;
        if (selected && !selectedExists) {
          state.selectedId = null;
          state.editing = null;
          readThrough.delete(selected);
          if (failedCommand?.channelId === selected) failedCommand = null;
        }
        if (page && state.page?.channel.id === page.channel.id) {
          const merged = mergeChannelPage(state.page.messages, page.messages);
          reconcile(merged.messages, "id")(state.page.messages);
          reconcile(page.tasks, "id")(state.page.tasks);
          Object.assign(state.page, { channel: page.channel, throughSequence: page.throughSequence });
          if (merged.takeFetchedCursor) takeOlderWindow(state.page, page);
        } else state.page = page;
        state.loading = false;
        if (!failedCommand) state.error = null;
      });
      if (selected && !selectedExists) env.writeSelection(null);
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
            error: error instanceof Error ? error.message : currentText().t("channel.error.load"),
            loading: false,
          });
        });
    }
  }
  async function open(channelId: string) {
    env.beforeOpen();
    env.writeSelection(channelId);
    flush(() =>
      setState((state) => {
        Object.assign(state, { selectedId: channelId, page: null, editing: null, loading: true });
      }),
    );
    await refreshAfter();
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
          state.error = error instanceof Error ? error.message : currentText().t("channel.error.action");
        });
      return false;
    }
  }
  /**
   * `onAccepted` runs after the service accepts the command and the channel refreshes. When the
   * reader leaves the scope during the request, it runs at once and the result is `false`: a sent
   * message must still leave the composer, or it comes back as a draft.
   */
  async function command(input: ChannelCommand, onAccepted?: (accepted: ChannelCommand) => void): Promise<boolean> {
    const account = env.scopeKey();
    // Only the save that creates a channel opens it, and only while the reader has stayed where
    // the save started. The sidebar takes a click through a save of the settings, and settings
    // save on every field, so a save that selected its own channel on arrival would pull the
    // reader back out of the channel they opened and drop the draft they began there.
    const creating = input.type === "save" && state.editing === "create";
    const selectedBefore = state.selectedId;
    // A `save` is never dropped: settings commit each field as it is left, and a silently
    // discarded autosave is lost work. The service serializes saves per channel and every
    // command is idempotent on its `operationId`, so letting them queue is safe.
    if (state.pending && input.type !== "stop" && input.type !== "archive" && input.type !== "save") return false;
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
      if (disposed || account !== env.scopeKey()) {
        onAccepted?.(attempt);
        return false;
      }
      failedCommand = null;
      // Only creation closes the editor. Settings save on every field, so closing on a save
      // would shut the panel under the user between two edits.
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
      if (!disposed && account === env.scopeKey()) {
        failedCommand = attempt;
        setState((state) => {
          Object.assign(state, {
            error: error instanceof Error ? error.message : currentText().t("channel.error.update"),
          });
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
          reconcile([...older.messages.filter((item) => !ids.has(item.id)), ...page.messages], "id")(page.messages);
          takeOlderWindow(page, older);
        });
    } catch (error) {
      if (!disposed && account === env.scopeKey() && state.selectedId === channelId)
        setState((state) => {
          state.error = error instanceof Error ? error.message : currentText().t("channel.error.loadOlder");
        });
    }
  }
  createEffect(env.scopeKey, (scope) => {
    // Read once for this scope; a later capability change does not reset the open channel.
    const channelsSupported = untrack(supported);
    const selected = channelsSupported ? env.readSelection(scope) : null;
    refreshId += 1;
    readThrough.clear();
    failedCommand = null;
    pendingCommands = 0;
    flush(() =>
      setState((state) => {
        Object.assign(state, {
          channels: [],
          selectedId: selected,
          page: null,
          pending: false,
          error: null,
          editing: null,
        });
      }),
    );
    if (channelsSupported) void untrack(() => refresh(selected));
  });
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
  /** Reads each unread channel's latest page for its boundary, since a summary has no sequence. */
  function markAllRead(): Promise<boolean> {
    const unread = state.channels.filter((channel) => channel.unreadCount > 0).map((channel) => channel.id);
    const account = env.scopeKey();
    return perform(async () => {
      const results = await Promise.allSettled(
        unread.map(async (channelId) => {
          const page = await env.port().agent.readChannel({ channelId });
          // The port follows the current server, so a read for the previous one must not reach it.
          if (disposed || account !== env.scopeKey()) return;
          await env.port().agent.channelCommand({
            type: "read",
            channelId,
            throughSequence: page.throughSequence,
            operationId: crypto.randomUUID(),
          });
        }),
      );
      // The other channels are read, so the list shows them before the first failure is reported.
      const failure = results.find((result) => result.status === "rejected");
      if (failure) {
        await refreshAfter();
        throw failure.reason;
      }
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
    refresh,
    retry: async (onAccepted?: (accepted: ChannelCommand) => void) => {
      const previous = failedCommand;
      if (previous) return (await command(previous, onAccepted)) ? previous : null;
      await refresh();
      return null;
    },
    open,
    editChannel: async (channelId: string) => {
      if (state.selectedId !== channelId) await open(channelId);
      if (state.page?.channel.id !== channelId || state.page.channel.archived) return;
      setState((state) => {
        state.editing = "settings";
      });
    },
    remove: async (channelId: string) => {
      if (!(await command({ type: "archive", channelId, operationId: crypto.randomUUID() }))) {
        throw new Error(state.error ?? currentText().t("channel.error.delete"));
      }
    },
    command,
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
    create: () =>
      setState((state) => {
        state.editing = "create";
        state.error = null;
      }),
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
