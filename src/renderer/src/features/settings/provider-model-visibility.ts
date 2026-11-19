import type { AgentModelId, AgentProviderId, OpenBotDesktopApi, ProviderModelVisibility } from "@openbot/contracts/ipc";
import type { ProviderModelVisibilityControl } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";

export type HostModelVisibilityCalls = Pick<
  OpenBotDesktopApi["hostAdmin"],
  "getModelVisibility" | "setModelVisibility"
>;

export interface HostModelVisibilityOptions {
  calls?: HostModelVisibilityCalls;
}

export interface ProviderModelVisibilitySource extends HostModelVisibilityOptions {
  serverId: string;
}

export function createProviderModelVisibility(
  source: () => ProviderModelVisibilitySource | undefined,
  status: () => unknown,
): () => ((provider: AgentProviderId) => ProviderModelVisibilityControl) | undefined {
  const { t, errorMessage } = useText();
  const calls = (): HostModelVisibilityCalls => source()?.calls ?? window.openbot.hostAdmin;

  function open(provider: AgentProviderId): ProviderModelVisibilityControl {
    const [state, setState] = createStore<{ list: ProviderModelVisibility | null; error: string | null }>({
      list: null,
      error: null,
    });
    let generation = 0;
    let reads = 0;
    let saving = false;
    let queued: { shown: AgentModelId[] | null } | null = null;

    function load(serverId: string, request: number): void {
      const read = ++reads;
      untrack(calls)
        .getModelVisibility(provider, serverId)
        .then(
          (next) => {
            if (request === generation && read === reads && !saving)
              setState((draft) => {
                draft.list = next;
              });
          },
          (error: unknown) => {
            if (request === generation)
              setState((draft) => {
                draft.error = errorMessage(error, t("provider.settings.modelsLoadFailed"));
              });
          },
        );
    }

    createEffect(
      () => source()?.serverId,
      (serverId) => {
        const request = ++generation;
        queued = null;
        setState(() => ({ list: null, error: null }));
        if (serverId !== undefined) load(serverId, request);
      },
    );

    let opened = false;
    createEffect(status, () => {
      if (!opened) {
        opened = true;
        return;
      }
      const serverId = untrack(source)?.serverId;
      if (serverId !== undefined && !saving && queued === null) load(serverId, generation);
    });

    async function flush(serverId: string, request: number): Promise<void> {
      saving = true;
      try {
        while (queued && request === generation) {
          const { shown } = queued;
          queued = null;
          try {
            const next = await calls().setModelVisibility({ provider, shown }, serverId);
            if (request === generation && queued === null)
              setState((draft) => {
                draft.list = next;
              });
          } catch (error) {
            if (request !== generation) return;
            queued = null;
            setState((draft) => {
              draft.error = errorMessage(error, t("error.provider.useChangeFailed"));
            });
            saving = false;
            load(serverId, request);
            return;
          }
        }
      } finally {
        saving = false;
        const next = source()?.serverId;
        if (queued && request !== generation && next !== undefined) void flush(next, generation);
      }
    }

    return {
      get list() {
        return state.list;
      },
      get error() {
        return state.error;
      },
      onChange: (shown) => {
        const serverId = source()?.serverId;
        if (serverId === undefined || !state.list) return;
        setState((draft) => {
          if (draft.list) {
            draft.list.shown = [...shown];
            draft.list.changed = true;
          }
          draft.error = null;
        });
        queued = { shown: [...shown] };
        reads++;
        if (!saving) void flush(serverId, generation);
      },
      onReset: () => {
        const serverId = source()?.serverId;
        if (serverId === undefined || !state.list) return;
        setState((draft) => {
          draft.error = null;
        });
        queued = { shown: null };
        reads++;
        if (!saving) void flush(serverId, generation);
      },
    };
  }

  return () => (source() ? open : undefined);
}
