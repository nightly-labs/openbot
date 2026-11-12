import { useText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";

/** One host setting as a settings page shows it. `value` is null until the host answers. */
export interface HostSettingState<Value> {
  readonly value: Value | null;
  readonly pending: boolean;
  /** A load or a save that failed. */
  readonly error: string | null;
}

/**
 * One setting of this computer's host or a joined server's host, read and saved through `read` and
 * `save`. The host checks the role again.
 *
 * A new server reads the setting again and drops the answers for the server before it. Each new value
 * of `status` reads it again: the host sends a status event after a change, such as one from another
 * client. A status event that comes during a save reads the setting again after the save, because the
 * read that the save cancels could hold the change of the other client.
 */
export function createHostSetting<Value, Input>(options: {
  serverId: () => string | undefined;
  status: () => unknown;
  read: (serverId: string) => Promise<Value>;
  save: (input: Input, serverId: string) => Promise<Value>;
  /** The text when a read fails and the error has no text for the reader. */
  loadFailed: () => string;
}): { state: HostSettingState<Value>; choose: (input: Input) => Promise<void> } {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{ value: Value | null; pending: boolean; error: string | null }>({
    value: null,
    pending: false,
    error: null,
  });
  /** Bumped for each server, so an answer for an earlier one is dropped. */
  let generation = 0;

  /** Bumped for each read and each save, so only the last answer shows. */
  let reads = 0;

  /** A status event came during a save, so the setting is read again after it. */
  let changedDuringSave = false;

  function load(serverId: string, request: number): void {
    const read = ++reads;
    untrack(() => options.read(serverId)).then(
      (next) => {
        if (request === generation && read === reads && !state.pending)
          setState((draft) => {
            draft.value = next;
            draft.error = null;
          });
      },
      (error: unknown) => {
        if (request === generation && read === reads && !state.pending)
          setState((draft) => {
            draft.error = errorMessage(error, options.loadFailed());
          });
      },
    );
  }

  createEffect(options.serverId, (serverId) => {
    const current = ++generation;
    changedDuringSave = false;
    setState(() => ({ value: null, pending: false, error: null }));
    if (serverId !== undefined) load(serverId, current);
  });

  let opened = false;
  createEffect(options.status, () => {
    // The effect above reads the setting when the page opens.
    if (!opened) {
      opened = true;
      return;
    }
    const serverId = untrack(options.serverId);
    if (serverId === undefined) return;
    if (untrack(() => state.pending)) changedDuringSave = true;
    else load(serverId, generation);
  });

  async function choose(input: Input): Promise<void> {
    const serverId = options.serverId();
    if (serverId === undefined || state.pending) return;
    const request = generation;
    reads++;
    changedDuringSave = false;
    setState((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      const saved = await options.save(input, serverId);
      if (request === generation)
        setState((draft) => {
          draft.value = saved;
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
        if (changedDuringSave) {
          changedDuringSave = false;
          load(serverId, request);
        }
      }
    }
  }

  return { state, choose };
}
