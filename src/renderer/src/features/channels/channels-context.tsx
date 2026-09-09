import {
  CHANNEL_CHATS_CAPABILITY,
  CHANNEL_DELETE_CAPABILITY,
  type ChannelCommand,
  type ChannelPage,
  type ChannelSummary,
} from "@openbot/contracts/ipc";
import { createEffect, createStore, flush, onSettled, reconcile, untrack } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { useDirectMessages } from "../conversation/direct-messages-context";
import { useServers } from "../servers/servers-context";
import { mergeChannelPage } from "./channel-page-merge";
import { readChannelSelection, writeChannelSelection } from "./channel-selection";

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

const Channels = createSimpleContext({
  name: "Channels",
  init: () => {
    const { activeServer, activeServerId, activeServerSupportsCapability } = useServers();
    const { setAgentSetupOpen } = useAgents();
    const { clearDirectSelection, setDirectTyping } = useDirectMessages();
    const { centralAuth } = useAuth();
    const selectionServerId = untrack(activeServerId);
    const accountKey = () => {
      const auth = centralAuth();
      return auth.status === "signed_in" ? auth.user.id : auth.status;
    };
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

    function savedChannelId(account: string): string | null {
      return account === "loading" || account === "error"
        ? null
        : (readChannelSelection()[account]?.[selectionServerId] ?? null);
    }

    function persistChannelSelection(channelId: string | null): void {
      const status = centralAuth().status;
      if (status === "signed_in" || status === "signed_out") {
        writeChannelSelection(accountKey(), selectionServerId, channelId);
      }
    }

    const supported = () => activeServerSupportsCapability(CHANNEL_CHATS_CAPABILITY);
    async function refresh(selectedOverride?: string | null) {
      if (!supported()) return;
      const id = ++refreshId;
      const account = accountKey();
      const selected = selectedOverride === undefined ? state.selectedId : selectedOverride;
      try {
        const channels = await window.openbot.agent.listChannels();
        const selectedExists = selected !== null && channels.some((channel) => channel.id === selected);
        const page = selectedExists ? await window.openbot.agent.readChannel({ channelId: selected }) : null;
        if (disposed || account !== accountKey() || id !== refreshId || selected !== state.selectedId) return;
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
            if (merged.takeFetchedCursor) state.page.olderCursor = page.olderCursor;
          } else state.page = page;
          state.loading = false;
          if (!failedCommand) state.error = null;
        });
        if (selected && !selectedExists) persistChannelSelection(null);
        if (selected && page && document.hasFocus() && page.throughSequence > (readThrough.get(selected) ?? 0)) {
          readThrough.set(selected, page.throughSequence);
          try {
            await window.openbot.agent.channelCommand({
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
        if (!disposed && account === accountKey() && id === refreshId)
          setState((state) => {
            Object.assign(state, {
              error: error instanceof Error ? error.message : "Could not load channels.",
              loading: false,
            });
          });
      }
    }
    async function open(channelId: string) {
      setAgentSetupOpen(false);
      // The channel covers the workspace, and a direct conversation left selected under it is read
      // automatically as its messages arrive. Selecting an agent closes the channel in the shared
      // navigation; this is the same exchange the other way round.
      setDirectTyping(false);
      clearDirectSelection();
      persistChannelSelection(channelId);
      flush(() =>
        setState((state) => {
          Object.assign(state, { selectedId: channelId, page: null, editing: null, loading: true });
        }),
      );
      await refresh();
    }
    async function perform(action: () => Promise<void>): Promise<boolean> {
      const account = accountKey();
      try {
        await action();
        if (!disposed && account === accountKey()) await refresh();
        return !disposed && account === accountKey();
      } catch (error) {
        if (!disposed && account === accountKey())
          setState((state) => {
            state.error = error instanceof Error ? error.message : "The channel action failed.";
          });
        return false;
      }
    }
    async function command(input: ChannelCommand): Promise<boolean> {
      const account = accountKey();
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
        await window.openbot.agent.channelCommand(attempt);
        if (disposed || account !== accountKey()) return false;
        failedCommand = null;
        if (input.type === "save") {
          setAgentSetupOpen(false);
          setDirectTyping(false);
          clearDirectSelection();
        }
        // Only creation closes the editor. Settings save on every field, so closing on a save
        // would shut the panel under the user between two edits.
        if (input.type === "save") {
          persistChannelSelection(input.channelId);
          flush(() =>
            setState((state) => {
              state.selectedId = input.channelId;
              if (state.editing === "create") state.editing = null;
            }),
          );
        }
        await refresh();
        return true;
      } catch (error) {
        if (!disposed && account === accountKey()) {
          failedCommand = attempt;
          setState((state) => {
            Object.assign(state, {
              error: error instanceof Error ? error.message : "The channel could not be updated.",
            });
          });
        }
        return false;
      } finally {
        if (!disposed && account === accountKey())
          setState((state) => {
            pendingCommands -= 1;
            state.pending = pendingCommands > 0;
          });
      }
    }
    async function loadOlder() {
      const channelId = state.selectedId;
      const beforeSequence = state.page?.olderCursor;
      const account = accountKey();
      if (!channelId || !beforeSequence) return;
      try {
        const older = await window.openbot.agent.readChannel({ channelId, beforeSequence });
        if (!disposed && account === accountKey() && state.selectedId === channelId)
          setState((state) => {
            const page = state.page;
            if (!page || page.olderCursor !== beforeSequence) return;
            const ids = new Set(page.messages.map((item) => item.id));
            reconcile([...older.messages.filter((item) => !ids.has(item.id)), ...page.messages], "id")(page.messages);
            page.olderCursor = older.olderCursor;
          });
      } catch (error) {
        if (!disposed && account === accountKey() && state.selectedId === channelId)
          setState((state) => {
            state.error = error instanceof Error ? error.message : "Could not load earlier messages.";
          });
      }
    }
    createEffect(accountKey, () => {
      const selected = supported() ? savedChannelId(accountKey()) : null;
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
      if (supported()) void refresh(selected);
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
    return {
      state,
      supported,
      deletionSupported: () =>
        activeServerSupportsCapability(CHANNEL_DELETE_CAPABILITY) &&
        (activeServer()?.kind !== "remote" || activeServer()?.role === "owner" || activeServer()?.role === "admin"),
      refresh,
      retry: async () => {
        const previous = failedCommand;
        if (previous) return (await command(previous)) ? previous : null;
        await refresh();
        return null;
      },
      open,
      editChannel: async (channelId: string) => {
        if (state.selectedId !== channelId) await open(channelId);
        if (state.page?.channel.id !== channelId) return;
        setState((state) => {
          state.editing = "settings";
        });
      },
      remove: async (channelId: string) => {
        const account = accountKey();
        await window.openbot.agent.deleteChannel(channelId);
        if (disposed || account !== accountKey()) return;
        readThrough.delete(channelId);
        if (failedCommand?.channelId === channelId) failedCommand = null;
        const selected = state.selectedId === channelId;
        if (selected) persistChannelSelection(null);
        flush(() =>
          setState((state) => {
            state.channels = state.channels.filter((channel) => channel.id !== channelId);
            if (selected) {
              Object.assign(state, { selectedId: null, page: null, editing: null, loading: false, error: null });
            }
          }),
        );
        await refresh();
      },
      restore: async (channelId: string) => {
        await command({ type: "restore", channelId, operationId: crypto.randomUUID() });
      },
      command,
      perform,
      loadOlder,
      close: () => {
        persistChannelSelection(null);
        setState((state) => {
          Object.assign(state, { selectedId: null, page: null, editing: null });
        });
      },
      edit: () =>
        setState((state) => {
          Object.assign(state, { editing: "settings" });
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
  },
});
export const ChannelsProvider = Channels.provider;
export const useChannels = Channels.use;
