import type { AgentModelId, AgentProviderId, OpenBotDesktopApi, ProviderModelVisibility } from "@openbot/contracts/ipc";
import type { ProviderModelVisibilityControl } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";

/** The model list calls of one server's host. The desktop reaches them through main. */
export type HostModelVisibilityCalls = Pick<
  OpenBotDesktopApi["hostAdmin"],
  "getModelVisibility" | "setModelVisibility"
>;

export interface HostModelVisibilityOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostModelVisibilityCalls;
}

export interface ProviderModelVisibilitySource extends HostModelVisibilityOptions {
  serverId: string;
}

/**
 * The Models section of each provider page, for this computer or a joined server
 * (`model-visibility-v1`). The host checks the role again. Undefined while `source` is.
 *
 * A switch shows its change at once. Saves go one at a time, and only the last change is sent.
 * Each new value of `status` reads the list again, as the model picker does: a provider can list
 * its models after the page opens, and another admin can change the list.
 */
export function createProviderModelVisibility(
  source: () => ProviderModelVisibilitySource | undefined,
  status: () => unknown,
): () => ((provider: AgentProviderId) => ProviderModelVisibilityControl) | undefined {
  const { t, errorMessage } = useText();
  const calls = (): HostModelVisibilityCalls => source()?.calls ?? window.openbot.hostAdmin;

  /** Runs when a provider page opens, so its effect ends when the page closes. */
  function open(provider: AgentProviderId): ProviderModelVisibilityControl {
    const [state, setState] = createStore<{ list: ProviderModelVisibility | null; error: string | null }>({
      list: null,
      error: null,
    });
    /** Bumped for each server, so an answer for an earlier one is dropped. */
    let generation = 0;
    /** Bumped for each change, so a read that started before it cannot show the list from before it. */
    let reads = 0;
    let saving = false;
    /** The next list to send; `shown: null` resets the provider. */
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
      // The effect above reads the list when the page opens.
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
            // The switches show the change that failed; the host has the list that is true.
            saving = false;
            load(serverId, request);
            return;
          }
        }
      } finally {
        saving = false;
        // A change for the next server waited for this save to end.
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
        // The host knows the default; the switches change when it answers.
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
