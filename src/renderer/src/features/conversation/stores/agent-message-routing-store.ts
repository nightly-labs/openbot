import type { CustomMessageRoutingSettings } from "@openbot/contracts/ipc";
import type { AgentCustomMessageRoutingOptions } from "@openbot/ui/features/conversation/AgentSettingsPanel";
import { createEffect, createMemo, createStore, onSettled, untrack } from "solid-js";
import { conversationPort } from "../conversation-port";
import type { ConversationTarget } from "../conversation-types";
import { customMessageRoutingPort } from "../custom-message-routing-port";

/** Actual custom routing of the agent whose local settings are open, independent of legacy fields. */
export function createAgentMessageRoutingStore(options: {
  desktop(): boolean;
  target(): ConversationTarget | null;
  onError(error: unknown): void;
}) {
  const [state, setState] = createStore<{
    key: string | null;
    settings: CustomMessageRoutingSettings | null;
    saving: boolean;
    loaded: boolean;
  }>({ key: null, settings: null, saving: false, loaded: false });
  let reads = 0;
  let disposed = false;
  let reloadAfterSave = false;
  let generation = 0;
  const keyFor = (target: ConversationTarget) => `${target.serverId}\0${target.agentId}`;
  const target = createMemo(options.target, {
    equals: (previous, next) => (previous ? keyFor(previous) : null) === (next ? keyFor(next) : null),
  });

  async function load(target: ConversationTarget): Promise<void> {
    const read = ++reads;
    const key = keyFor(target);
    try {
      const settings = await customMessageRoutingPort().getCustomMessageRouting();
      if (disposed || read !== reads || state.key !== key || state.saving) return;
      setState((draft) => {
        draft.settings = settings.available ? settings : null;
        draft.loaded = true;
      });
    } catch (error) {
      if (!disposed && read === reads && state.key === key) options.onError(error);
    }
  }

  createEffect(
    () => target(),
    (next) => {
      generation++;
      reads++;
      reloadAfterSave = false;
      setState((draft) => {
        draft.key = next ? keyFor(next) : null;
        draft.settings = null;
        draft.saving = false;
        draft.loaded = false;
      });
      if (next) void load(next);
    },
  );

  onSettled(() => {
    const unsubscribe = untrack(options.desktop)
      ? conversationPort().agent.onScopedEvent(({ serverId, event }) => {
          const current = target();
          if (!current || serverId !== current.serverId || event.type !== "agents-changed") return;
          if (state.saving) reloadAfterSave = true;
          else void load(current);
        })
      : undefined;
    return () => {
      disposed = true;
      reads++;
      unsubscribe?.();
    };
  });

  async function change(target: ConversationTarget, mode: AgentCustomMessageRoutingOptions["mode"]): Promise<void> {
    const key = keyFor(target);
    if (state.key !== key || !state.settings?.available || state.saving) return;
    const startedGeneration = generation;
    reads++;
    setState((draft) => {
      draft.saving = true;
    });
    try {
      const settings = await customMessageRoutingPort().setCustomMessageRouting({ agentIds: [target.agentId], mode });
      if (disposed || generation !== startedGeneration || state.key !== key) return;
      setState((draft) => {
        draft.settings = settings.available ? settings : null;
      });
    } catch (error) {
      if (!disposed && generation === startedGeneration && state.key === key) {
        options.onError(error);
        reloadAfterSave = true;
      }
    } finally {
      if (!disposed && generation === startedGeneration && state.key === key) {
        setState((draft) => {
          draft.saving = false;
        });
        if (reloadAfterSave) {
          reloadAfterSave = false;
          void load(target);
        }
      }
    }
  }

  return {
    ready(): boolean {
      const current = target();
      return !current || (state.key === keyFor(current) && state.loaded);
    },
    current(): AgentCustomMessageRoutingOptions | undefined {
      const current = target();
      const settings = state.settings;
      if (!current || state.key !== keyFor(current) || !settings?.available) return undefined;
      return {
        mode: settings.agents[current.agentId] ?? null,
        defaultMode: settings.defaultMode,
        saving: state.saving,
        onChange: (mode) => change(current, mode),
      };
    },
  };
}
