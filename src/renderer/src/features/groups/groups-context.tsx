import { GROUP_CHATS_CAPABILITY, type GroupCommand, type GroupPage, type GroupSummary } from "@openbot/contracts/ipc";
import { createEffect, createStore, flush, onSettled, reconcile } from "solid-js";
import { createSimpleContext } from "../../simple-context";
import { useAuth } from "../account/account-context";
import { useAgents } from "../agents/agents-context";
import { useServers } from "../servers/servers-context";

interface GroupsState {
  groups: GroupSummary[];
  selectedId: string | null;
  page: GroupPage | null;
  loading: boolean;
  pending: boolean;
  error: string | null;
  editing: "create" | "settings" | null;
  archived: boolean;
  collapsed: boolean;
}

const Groups = createSimpleContext({
  name: "Groups",
  init: () => {
    const { activeServerSupportsCapability } = useServers();
    const { setAgentSetupOpen } = useAgents();
    const { centralAuth } = useAuth();
    const accountKey = () => {
      const auth = centralAuth();
      return auth.status === "signed_in" ? auth.user.id : auth.status;
    };
    const [state, setState] = createStore<GroupsState>({
      groups: [],
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
    let failedCommand: GroupCommand | null = null;
    const readThrough = new Map<string, number>();

    const supported = () => activeServerSupportsCapability(GROUP_CHATS_CAPABILITY);
    async function refresh() {
      if (!supported()) return;
      const id = ++refreshId;
      const account = accountKey();
      const selected = state.selectedId;
      try {
        const [groups, page] = await Promise.all([
          window.openbot.agent.listGroups(),
          selected ? window.openbot.agent.readGroup({ groupId: selected }) : Promise.resolve(null),
        ]);
        if (disposed || account !== accountKey() || id !== refreshId || selected !== state.selectedId) return;
        setState((state) => {
          state.groups = groups;
          if (page && state.page?.group.id === page.group.id) {
            const older = state.page.messages.filter((item) => item.sequence < (page.messages[0]?.sequence ?? 0));
            reconcile([...older, ...page.messages], "id")(state.page.messages);
            reconcile(page.tasks, "id")(state.page.tasks);
            Object.assign(state.page, { group: page.group, throughSequence: page.throughSequence });
            if (!older.length) state.page.olderCursor = page.olderCursor;
          } else state.page = page;
          state.loading = false;
          if (!failedCommand) state.error = null;
        });
        if (selected && page && document.hasFocus() && page.throughSequence > (readThrough.get(selected) ?? 0)) {
          readThrough.set(selected, page.throughSequence);
          try {
            await window.openbot.agent.groupCommand({
              type: "read",
              groupId: selected,
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
              error: error instanceof Error ? error.message : "Could not load groups.",
              loading: false,
            });
          });
      }
    }
    async function open(groupId: string) {
      setAgentSetupOpen(false);
      flush(() =>
        setState((state) => {
          Object.assign(state, { selectedId: groupId, page: null, editing: null, loading: true });
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
            state.error = error instanceof Error ? error.message : "The group action failed.";
          });
        return false;
      }
    }
    async function command(input: GroupCommand): Promise<boolean> {
      const account = accountKey();
      if (state.pending && input.type !== "stop" && input.type !== "archive") return false;
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
        await window.openbot.agent.groupCommand(attempt);
        if (disposed || account !== accountKey()) return false;
        failedCommand = null;
        if (input.type === "save") setAgentSetupOpen(false);
        if (input.type === "save")
          flush(() =>
            setState((state) => {
              Object.assign(state, { selectedId: input.groupId, editing: null });
            }),
          );
        await refresh();
        return true;
      } catch (error) {
        if (!disposed && account === accountKey()) {
          failedCommand = attempt;
          setState((state) => {
            Object.assign(state, { error: error instanceof Error ? error.message : "The group could not be updated." });
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
      const groupId = state.selectedId;
      const beforeSequence = state.page?.olderCursor;
      const account = accountKey();
      if (!groupId || !beforeSequence) return;
      try {
        const older = await window.openbot.agent.readGroup({ groupId, beforeSequence });
        if (!disposed && account === accountKey() && state.selectedId === groupId)
          setState((state) => {
            const page = state.page;
            if (!page || page.olderCursor !== beforeSequence) return;
            const ids = new Set(page.messages.map((item) => item.id));
            reconcile([...older.messages.filter((item) => !ids.has(item.id)), ...page.messages], "id")(page.messages);
            page.olderCursor = older.olderCursor;
          });
      } catch (error) {
        if (!disposed && account === accountKey() && state.selectedId === groupId)
          setState((state) => {
            state.error = error instanceof Error ? error.message : "Could not load earlier messages.";
          });
      }
    }
    createEffect(accountKey, () => {
      refreshId += 1;
      readThrough.clear();
      failedCommand = null;
      pendingCommands = 0;
      flush(() =>
        setState((state) => {
          Object.assign(state, {
            groups: [],
            selectedId: null,
            page: null,
            pending: false,
            error: null,
            editing: null,
          });
        }),
      );
      if (supported()) void refresh();
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
      refresh,
      retry: async () => {
        const previous = failedCommand;
        if (previous) return (await command(previous)) ? previous : null;
        await refresh();
        return null;
      },
      open,
      command,
      perform,
      loadOlder,
      close: () =>
        setState((state) => {
          Object.assign(state, { selectedId: null, page: null, editing: null });
        }),
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
export const GroupsProvider = Groups.provider;
export const useGroups = Groups.use;
