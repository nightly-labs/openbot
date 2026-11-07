import type { ProviderClaudeUserSetup } from "@openbot/ui/features/settings/ProviderSettingsPage";
import { useText } from "@openbot/ui/text";
import { createEffect, createStore, untrack } from "solid-js";

/**
 * The Claude page's "Use my Claude Code setup" switch of this computer. A joined server has no route
 * for it, so `enabled` is false for one. Undefined while `enabled` is false.
 *
 * Each new value of `status` reads the setting again: main sends a status event after a change.
 */
export function createProviderClaudeUserSetup(
  enabled: () => boolean,
  status: () => unknown,
): () => ProviderClaudeUserSetup | undefined {
  const { t, errorMessage } = useText();
  const [state, setState] = createStore<{ value: boolean | null; pending: boolean; error: string | null }>({
    value: null,
    pending: false,
    error: null,
  });
  /** Bumped for each read and each save, so only the last answer shows. */
  let reads = 0;

  function load(): void {
    const read = ++reads;
    window.openbot.getClaudeUserSetup().then(
      (next) => {
        if (read === reads && !untrack(() => state.pending))
          setState((draft) => {
            draft.value = next.enabled;
            draft.error = null;
          });
      },
      (error: unknown) => {
        if (read === reads && !untrack(() => state.pending))
          setState((draft) => {
            draft.error = errorMessage(error, t("provider.settings.claudeUserSetupLoadFailed"));
          });
      },
    );
  }

  createEffect(
    () => ({ open: enabled(), status: status() }),
    ({ open }) => {
      if (open && !untrack(() => state.pending)) load();
    },
  );

  async function choose(next: boolean): Promise<void> {
    if (state.pending) return;
    reads++;
    setState((draft) => {
      draft.pending = true;
      draft.error = null;
    });
    try {
      const saved = await window.openbot.setClaudeUserSetup(next);
      setState((draft) => {
        draft.value = saved.enabled;
      });
    } catch (error) {
      setState((draft) => {
        draft.error = errorMessage(error, t("error.provider.useChangeFailed"));
      });
    } finally {
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
    onChange: (next) => void choose(next),
  };
  return () => (enabled() ? setup : undefined);
}
