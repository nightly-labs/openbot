import type {
  ChannelAudienceInput,
  ChannelAudienceResult,
  ChannelAudienceTarget,
  ChannelCommand,
  ChannelPage,
  ChannelSummary,
} from "@openbot/contracts/ipc";
import type { AgentProfile } from "@openbot/ui/data";
import { currentText } from "@openbot/ui/text";
import { createEffect, createStore, flush, onSettled, reconcile, untrack } from "solid-js";
import { clearChannelAudience, pendingChannelAudience, saveChannelAudience } from "./channel-audience-pending";
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
  pendingAudience: ChannelAudienceInput | null;
  acceptedAudience: ChannelAudienceInput | null;
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
  audienceSupported?: () => boolean;
  audienceScope?: () => string;
  /** Whether this reader may delete a channel; `supported()` is checked as well. */
  deletionSupported: () => boolean;
  /** Clears whatever else covers the workspace, because a channel is about to cover it. */
  beforeOpen: () => void;
  /** Whether a message that arrives now is in front of the reader. */
  canMarkRead: () => boolean;
}

function copyAudience(input: ChannelAudienceInput): ChannelAudienceInput {
  return {
    operationId: input.operationId,
    channelId: input.channelId,
    text: input.text,
    replyToMessageId: input.replyToMessageId,
    attachmentDraftIds: [...input.attachmentDraftIds],
    audience:
      input.audience.kind === "all" ? { kind: "all" } : { kind: "members", agentIds: [...input.audience.agentIds] },
  };
}

export type ChannelsController = ReturnType<typeof createChannelsController>;

export function createChannelsController(env: ChannelsEnvironment) {
  const [state, setState] = createStore<ChannelsState>({
    channels: [],
    selectedId: null,
    page: null,
    loading: false,
    pending: false,
    pendingAudience: null,
    acceptedAudience: null,
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
        if (!failedCommand && !state.pendingAudience) state.error = null;
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
          state.pending = pendingInView();
        });
    }
  }
  const audienceScope = () => env.audienceScope?.() ?? env.scopeKey();
  let audienceGeneration = 0;
  // UI ownership changes synchronously. Solid may publish its corresponding store draft later.
  let currentAudience: ChannelAudienceInput | null = null;
  let sendingAudience: number | null = null;
  let stoppingAudience: number | null = null;
  function pendingInView(): boolean {
    return pendingCommands > 0 || sendingAudience === audienceGeneration || stoppingAudience === audienceGeneration;
  }
  const audienceChecks = new Set<number>();
  function audienceOwner(input: ChannelAudienceInput) {
    const account = env.scopeKey();
    const scope = audienceScope();
    const generation = audienceGeneration;
    const viewCurrent = () =>
      !disposed &&
      account === env.scopeKey() &&
      scope === audienceScope() &&
      generation === audienceGeneration &&
      state.selectedId === input.channelId;
    return {
      scope,
      generation,
      viewCurrent,
      current: () =>
        viewCurrent() &&
        currentAudience?.channelId === input.channelId &&
        currentAudience.operationId === input.operationId,
    };
  }
  async function settleAudience(
    result: ChannelAudienceResult,
    input: ChannelAudienceInput,
    owner: ReturnType<typeof audienceOwner>,
    onAccepted?: (accepted: ChannelAudienceInput) => void,
  ): Promise<boolean> {
    if (
      "status" in result
        ? result.channelId !== input.channelId || result.operationId !== input.operationId
        : result.channel.id !== input.channelId
    )
      throw new Error(currentText().t("error.backend.channelAudienceReceiptInvalid"));
    // An old response may settle its own durable envelope, but never the current view or draft.
    clearChannelAudience(owner.scope, input);
    if (!owner.current()) return false;
    currentAudience = null;
    if ("status" in result) {
      flush(() =>
        setState((state) => {
          state.pendingAudience = null;
          state.error = currentText().t("error.backend.channelAudienceRejected");
        }),
      );
      return false;
    }
    flush(() =>
      setState((state) => {
        state.pendingAudience = null;
        state.acceptedAudience = input;
        state.error = null;
      }),
    );
    onAccepted?.(input);
    await refreshAfter();
    return owner.viewCurrent();
  }
  async function audienceCommand(
    input: ChannelAudienceInput,
    onAccepted?: (accepted: ChannelAudienceInput) => void,
    retry = false,
  ): Promise<boolean> {
    input = copyAudience(input);
    const scope = audienceScope();
    if (state.pending || state.selectedId !== input.channelId) return false;
    if (!env.audienceSupported?.()) {
      setState((state) => {
        state.error = currentText().t("error.backend.channelAudienceUnsupported");
      });
      return false;
    }
    let owner: ReturnType<typeof audienceOwner> | undefined;
    try {
      if (!retry) saveChannelAudience(scope, input);
      currentAudience = input;
      sendingAudience = audienceGeneration;
      flush(() =>
        setState((state) => {
          state.pendingAudience = input;
          state.error = null;
          state.pending = true;
        }),
      );
      owner = audienceOwner(input);
      const result = await env.port().agent.channelAudienceCommand(input);
      return await settleAudience(result, input, owner, onAccepted);
    } catch (error) {
      if (owner?.current())
        setState((state) => {
          state.error = error instanceof Error ? error.message : currentText().t("channel.error.update");
        });
      // Preflight storage failures have no in-flight owner and no pending envelope.
      else if (!owner && !disposed && scope === audienceScope() && state.selectedId === input.channelId)
        setState((state) => {
          state.error = error instanceof Error ? error.message : currentText().t("channel.error.update");
        });
      return false;
    } finally {
      // A settled result cleared this operation; the view generation still owns its pending flag.
      if (owner?.viewCurrent() && (!currentAudience || currentAudience.operationId === input.operationId)) {
        sendingAudience = null;
        setState((state) => {
          state.pending = pendingInView();
        });
      }
    }
  }
  async function checkAudience(
    onAccepted?: (accepted: ChannelAudienceInput) => void,
    restored?: ChannelAudienceInput,
  ): Promise<boolean> {
    const pending = restored ?? state.pendingAudience;
    const input = pending ? copyAudience(pending) : null;
    if (!input || sendingAudience === audienceGeneration || !env.audienceSupported?.()) return false;
    const owner = audienceOwner(input);
    if (!owner.current() || audienceChecks.has(owner.generation)) return false;
    audienceChecks.add(owner.generation);
    try {
      const result = await env
        .port()
        .agent.channelAudienceReceipt({ channelId: input.channelId, operationId: input.operationId });
      if (!result) return false; // A miss is not rejection; no replay follows.
      return await settleAudience(result, input, owner, onAccepted);
    } catch (error) {
      if (owner.current())
        setState((state) => {
          state.error = error instanceof Error ? error.message : currentText().t("channel.error.update");
        });
      return false;
    } finally {
      audienceChecks.delete(owner.generation);
    }
  }
  createEffect(
    () => [env.scopeKey(), audienceScope(), state.selectedId, supported()] as const,
    ([, , channelId, online]) => {
      audienceGeneration += 1;
      currentAudience = null;
      sendingAudience = null;
      stoppingAudience = null;
      flush(() =>
        setState((state) => {
          state.pendingAudience = null;
          state.acceptedAudience = null;
          state.error = null;
          state.pending = pendingInView();
        }),
      );
      try {
        const input = channelId ? pendingChannelAudience(audienceScope(), channelId) : null;
        currentAudience = input;
        flush(() =>
          setState((state) => {
            state.pendingAudience = input;
          }),
        );
        if (input && online) void checkAudience(undefined, input);
      } catch (error) {
        setState((state) => {
          state.error = error instanceof Error ? error.message : currentText().t("channel.error.update");
        });
      }
    },
  );

  async function stopAudience(channelId: string, targets: readonly ChannelAudienceTarget[]): Promise<boolean> {
    if (stoppingAudience === audienceGeneration) return false;
    const account = env.scopeKey();
    const scope = audienceScope();
    const generation = audienceGeneration;
    const current = () =>
      !disposed &&
      account === env.scopeKey() &&
      scope === audienceScope() &&
      generation === audienceGeneration &&
      state.page?.channel.id === channelId;
    const ids = targets.map((target) => target.taskId);
    if (!current()) return false;
    stoppingAudience = generation;
    flush(() =>
      setState((state) => {
        state.pending = true;
        state.error = null;
      }),
    );
    try {
      for (const taskId of ids) {
        if (!current()) return false;
        const task = state.page?.tasks.find((task) => task.id === taskId);
        if (!task || task.state === "completed" || task.state === "cancelled" || task.state === "paused") continue;
        const input: ChannelCommand = {
          type: "stop",
          operationId: crypto.randomUUID(),
          channelId,
          taskId,
          recipientAgentId: null,
        };
        try {
          await env.port().agent.channelCommand(input);
        } catch (error) {
          if (current()) {
            failedCommand = input; // Existing manual Retry uses this exact per-root operation.
            setState((state) => {
              state.error = error instanceof Error ? error.message : currentText().t("channel.error.update");
            });
          }
          return false; // No claim that this root or the remaining peers stopped.
        }
        if (!current()) return false;
        failedCommand = null;
        await refreshAfter();
      }
      return current();
    } finally {
      if (current()) {
        stoppingAudience = null;
        setState((state) => {
          state.pending = pendingInView();
        });
      }
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
  createEffect(
    () => ({ scope: env.scopeKey(), supported: supported() }),
    (next, previous) => {
      if (next.scope !== previous?.scope) {
        const selected = next.supported ? env.readSelection(next.scope) : null;
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
              acceptedAudience: null,
              error: null,
              editing: null,
            });
          }),
        );
        if (next.supported) void untrack(() => refresh(selected));
        return;
      }
      // A capability change does not reset the open channel. Support can arrive after the scope starts:
      // a remote host reports its capabilities after it connects, and again after each reconnect.
      if (!next.supported || previous.supported) return;
      const saved = state.selectedId === null ? env.readSelection(next.scope) : null;
      if (saved === null) {
        void refresh();
        return;
      }
      // As `open`, but the read gets the channel as an argument: a store write in an effect shows only
      // after the flush, so a read that takes the selection from the store reads the old one.
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
    audienceCommand,
    stopAudience,
    retryAudience: (onAccepted?: (accepted: ChannelAudienceInput) => void) =>
      state.pendingAudience ? audienceCommand(state.pendingAudience, onAccepted, true) : Promise.resolve(false),
    checkAudience,
    audienceSupported: () => env.audienceSupported?.() === true,
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
