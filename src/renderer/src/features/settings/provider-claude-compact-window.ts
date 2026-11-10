import type { ClaudeCompactWindowSetting, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { ProviderClaudeCompactWindow } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";

/** The Claude compaction size calls of one server's host. The desktop reaches them through main. */
export type HostClaudeCompactWindowCalls = Pick<
  OpenBotDesktopApi["hostAdmin"],
  "getClaudeCompactWindow" | "setClaudeCompactWindow"
>;

export interface HostClaudeCompactWindowOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostClaudeCompactWindowCalls;
}

export interface ProviderClaudeCompactWindowSource extends HostClaudeCompactWindowOptions {
  serverId: string;
}

/**
 * The Claude page's compaction size of this computer or a joined server (`claude-compact-window-v1`).
 * The host checks the role again. Undefined while `source` is.
 *
 * Each new value of `status` reads the size again: the host sends a status event after a change.
 */
export function createProviderClaudeCompactWindow(
  source: () => ProviderClaudeCompactWindowSource | undefined,
  status: () => unknown,
): () => ProviderClaudeCompactWindow | undefined {
  const { t, errorMessage } = useText();
  const calls = (): HostClaudeCompactWindowCalls => source()?.calls ?? window.openbot.hostAdmin;
  const [state, setState] = createStore<{
    value: ClaudeCompactWindowSetting | null;
    pending: boolean;
    error: string | null;
  }>({ value: null, pending: false, error: null });
  /** Bumped for each server, so an answer for an earlier one is dropped. */
  let generation = 0;

  /** Bumped for each read and each save, so only the last answer shows. */
  let reads = 0;

  /** A status event came during a save, so the size is read again after it. */
  let changedDuringSave = false;

  function load(serverId: string, request: number): void {
    const read = ++reads;
    untrack(calls)
      .getClaudeCompactWindow(serverId)
      .then(
        (next) => {
          if (request === generation && read === reads && !state.pending)
            setState((draft) => {
              draft.value = { tokens: next.tokens };
              draft.error = null;
            });
        },
        (error: unknown) => {
          if (request === generation && read === reads && !state.pending)
            setState((draft) => {
              draft.error = errorMessage(error, t("provider.settings.compactWindowLoadFailed"));
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
    // The effect above reads the size when the page opens.
    if (!opened) {
      opened = true;
      return;
    }
    const serverId = untrack(source)?.serverId;
    if (serverId === undefined) return;
    if (untrack(() => state.pending)) changedDuringSave = true;
    else load(serverId, generation);
  });

  async function choose(tokens: number | null): Promise<void> {
    const serverId = source()?.serverId;
    if (serverId === undefined || state.pending) return;
    const request = generation;
    reads++;
    changedDuringSave = false;
    setState((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      const saved = await calls().setClaudeCompactWindow(tokens, serverId);
      if (request === generation)
        setState((draft) => {
          draft.value = { tokens: saved.tokens };
        });
    } catch (error) {
      if (request === generation)
        setState((draft) => {
          draft.error = errorMessage(error, t("error.provider.useChangeFailed"));
        });
    } finally {
      if (request === generation) {
        setState((draft) => {
          draft.pending = false;
        });
        // Another client can have changed the size during the save.
        if (changedDuringSave) {
          changedDuringSave = false;
          load(serverId, request);
        }
      }
    }
  }

  const compaction: ProviderClaudeCompactWindow = {
    get value() {
      return state.value;
    },
    get pending() {
      return state.pending;
    },
    get error() {
      return state.error;
    },
    onChange: (tokens) => void choose(tokens),
  };
  return () => (source() ? compaction : undefined);
}
