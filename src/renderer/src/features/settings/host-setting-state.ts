import { useText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";

export interface HostSettingState<Value> {
  readonly value: Value | null;
  readonly pending: boolean;
  readonly error: string | null;
}

export function createHostSetting<Value, Input>(options: {
  serverId: () => string | undefined;
  status: () => unknown;
  read: (serverId: string) => Promise<Value>;
  save: (input: Input, serverId: string) => Promise<Value>;
  loadFailed: () => string;
}): { state: HostSettingState<Value>; choose: (input: Input) => Promise<void> } {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{ value: Value | null; pending: boolean; error: string | null }>({
    value: null,
    pending: false,
    error: null,
  });
  let generation = 0;

  let reads = 0;

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
