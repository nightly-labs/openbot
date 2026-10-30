import type { OpenBotDesktopApi, PromptCacheTtl } from "@openbot/contracts/ipc";
import type { ProviderPromptCache } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";

/** The prompt cache calls of one server's host. The desktop reaches them through main. */
export type HostPromptCacheTtlCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getPromptCacheTtl" | "setPromptCacheTtl">;

export interface HostPromptCacheTtlOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostPromptCacheTtlCalls;
}

export interface ProviderPromptCacheSource extends HostPromptCacheTtlOptions {
  serverId: string;
}

/**
 * The Claude page's prompt cache time of this computer or a joined server (`prompt-cache-ttl-v1`).
 * The host checks the role again. Undefined while `source` is.
 */
export function createProviderPromptCache(
  source: () => ProviderPromptCacheSource | undefined,
): () => ProviderPromptCache | undefined {
  const { t, errorMessage } = useText();
  const calls = (): HostPromptCacheTtlCalls => source()?.calls ?? window.openbot.hostAdmin;
  const [state, setState] = createStore<{ value: PromptCacheTtl | null; pending: boolean; error: string | null }>({
    value: null,
    pending: false,
    error: null,
  });
  /** Bumped for each server, so an answer for an earlier one is dropped. */
  let generation = 0;

  createEffect(
    () => source()?.serverId,
    (serverId) => {
      const current = ++generation;
      setState(() => ({ value: null, pending: false, error: null }));
      if (serverId === undefined) return;
      untrack(calls)
        .getPromptCacheTtl(serverId)
        .then(
          (next) => {
            if (current === generation)
              setState((draft) => {
                draft.value = next.ttl;
              });
          },
          (error: unknown) => {
            if (current === generation)
              setState((draft) => {
                draft.error = errorMessage(error, t("provider.settings.promptCacheLoadFailed"));
              });
          },
        );
    },
  );

  async function choose(ttl: PromptCacheTtl): Promise<void> {
    const serverId = source()?.serverId;
    if (serverId === undefined || state.pending) return;
    const request = generation;
    setState((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      const next = await calls().setPromptCacheTtl(ttl, serverId);
      if (request === generation)
        setState((draft) => {
          draft.value = next.ttl;
        });
    } catch (error) {
      if (request === generation)
        setState((draft) => {
          draft.error = errorMessage(error, t("error.provider.useChangeFailed"));
        });
    } finally {
      if (request === generation)
        setState((draft) => {
          draft.pending = false;
        });
    }
  }

  const cache: ProviderPromptCache = {
    get value() {
      return state.value;
    },
    get pending() {
      return state.pending;
    },
    get error() {
      return state.error;
    },
    onChange: (ttl) => void choose(ttl),
  };
  return () => (source() ? cache : undefined);
}
