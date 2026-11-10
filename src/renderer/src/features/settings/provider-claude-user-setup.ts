import type { OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { ProviderClaudeUserSetup } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";

/** The "Use my Claude Code setup" calls of one server's host. The desktop reaches them through main. */
export type HostClaudeUserSetupCalls = Pick<
  OpenBotDesktopApi["hostAdmin"],
  "getClaudeUserSetup" | "setClaudeUserSetup"
>;

export interface HostClaudeUserSetupOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostClaudeUserSetupCalls;
}

export interface ProviderClaudeUserSetupSource extends HostClaudeUserSetupOptions {
  serverId: string;
  /** A joined server: the setup is the one of the host's user, on the host. */
  remote: boolean;
}

/**
 * The Claude page's "Use my Claude Code setup" switch of this computer or a joined server
 * (`claude-user-setup-v1`). The host checks the role again. Undefined while `source` is.
 *
 * Each new value of `status` reads the setting again: the host sends a status event after a change.
 */
export function createProviderClaudeUserSetup(
  source: () => ProviderClaudeUserSetupSource | undefined,
  status: () => unknown,
): () => ProviderClaudeUserSetup | undefined {
  const { t, errorMessage } = useText();
  const calls = (): HostClaudeUserSetupCalls => source()?.calls ?? window.openbot.hostAdmin;
  const [state, setState] = createStore<{ value: boolean | null; pending: boolean; error: string | null }>({
    value: null,
    pending: false,
    error: null,
  });
  /** Bumped for each server, so an answer for an earlier one is dropped. */
  let generation = 0;

  /** Bumped for each read and each save, so only the last answer shows. */
  let reads = 0;

  function load(serverId: string, request: number): void {
    const read = ++reads;
    untrack(calls)
      .getClaudeUserSetup(serverId)
      .then(
        (next) => {
          if (request === generation && read === reads && !state.pending)
            setState((draft) => {
              draft.value = next.enabled;
              draft.error = null;
            });
        },
        (error: unknown) => {
          if (request === generation && read === reads && !state.pending)
            setState((draft) => {
              draft.error = errorMessage(error, t("provider.settings.claudeUserSetupLoadFailed"));
            });
        },
      );
  }

  createEffect(
    () => source()?.serverId,
    (serverId) => {
      const current = ++generation;
      setState(() => ({ value: null, pending: false, error: null }));
      if (serverId !== undefined) load(serverId, current);
    },
  );

  let opened = false;
  createEffect(status, () => {
    // The effect above reads the setting when the page opens.
    if (!opened) {
      opened = true;
      return;
    }
    const serverId = untrack(source)?.serverId;
    if (serverId !== undefined && !untrack(() => state.pending)) load(serverId, generation);
  });

  async function choose(next: boolean): Promise<void> {
    const serverId = source()?.serverId;
    if (serverId === undefined || state.pending) return;
    const request = generation;
    reads++;
    setState((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      const saved = await calls().setClaudeUserSetup(next, serverId);
      if (request === generation)
        setState((draft) => {
          draft.value = saved.enabled;
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

  const setup: ProviderClaudeUserSetup = {
    get value() {
      return state.value;
    },
    get pending() {
      return state.pending;
    },
    get error() {
      return state.error;
    },
    get remote() {
      return source()?.remote === true;
    },
    onChange: (next) => void choose(next),
  };
  return () => (source() ? setup : undefined);
}
