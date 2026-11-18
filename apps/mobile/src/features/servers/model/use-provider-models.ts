import type { AgentModelId, AgentProviderId, ProviderModelVisibility } from "@openbot/contracts/ipc";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { useText } from "@/shared/lib/text";

/** The save of one model list: the next list to send (`shown: null` resets the provider), and whether a save runs. */
interface ModelSave {
  queued: { shown: AgentModelId[] | null } | null;
  saving: boolean;
}

/**
 * The saves by query key. The provider page and the Models page read the same list, and either
 * page's read can run, so both must see a save that runs.
 */
const saves = new Map<string, ModelSave>();

function saveOf(key: readonly unknown[]): ModelSave {
  const id = JSON.stringify(key);
  let save = saves.get(id);
  if (!save) {
    save = { queued: null, saving: false };
    saves.set(id, save);
  }
  return save;
}

/**
 * The models of one provider of a host and the ones its model picker shows (`model-visibility-v1`),
 * as the provider page and the Models page read them. The host checks the role again.
 *
 * A change shows at once. Saves go one at a time, and only the last change is sent, as on desktop.
 * A failed save reads the list again, because the host has the list that is true.
 */
export function useProviderModels(serverId: string, provider: AgentProviderId | null, admin: ProviderAdmin | null) {
  const { t, errorMessage } = useText();
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const models = admin?.models;
  const queryKey = queryKeys.providerModels(queryScope, serverId, provider ?? "");
  const keys = useRef(queryKey);
  keys.current = queryKey;
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey,
    retry: false,
    staleTime: 0,
    // A read while a change is saved would show the list from before it; the save answers the list.
    queryFn:
      models && provider
        ? async () => {
            const shown = queryClient.getQueryData<ProviderModelVisibility>(keys.current);
            const save = saveOf(keys.current);
            return shown && (save.saving || save.queued) ? shown : models.read(provider);
          }
        : skipToken,
  });

  const flush = useCallback(async () => {
    const key = keys.current;
    const save = saveOf(key);
    if (!models || !provider || save.saving) return;
    save.saving = true;
    let failed = false;
    try {
      while (save.queued) {
        const { shown } = save.queued;
        save.queued = null;
        const next = await models.set(provider, shown);
        if (save.queued === null) queryClient.setQueryData(key, next);
      }
    } catch (cause) {
      save.queued = null;
      failed = true;
      setError(errorMessage(cause, t("mobile.server.providers.modelsFailed")));
    } finally {
      save.saving = false;
      // The loop ends with nothing queued, so the next change starts from a new record.
      saves.delete(JSON.stringify(key));
      // The page shows the change that failed; the host has the list that is true. The read starts
      // after the flag is reset, so it asks the host and a new change can start its own save.
      if (failed) void queryClient.invalidateQueries({ queryKey: key, exact: true });
      // The model pickers of this server read the list that the host now gives.
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentModels(queryScope, serverId) });
    }
  }, [models, provider, queryClient, queryScope, serverId, errorMessage, t]);

  const change = useCallback(
    (shown: AgentModelId[]) => {
      const key = keys.current;
      if (!queryClient.getQueryData<ProviderModelVisibility>(key)) return;
      // A read that started before the change stops, and does not put back the list from before it.
      void queryClient.cancelQueries({ queryKey: key, exact: true }, { revert: false });
      queryClient.setQueryData<ProviderModelVisibility>(key, (current) =>
        current ? { ...current, shown: [...shown], changed: true } : current,
      );
      setError(null);
      saveOf(key).queued = { shown: [...shown] };
      void flush();
    },
    [flush, queryClient],
  );

  /** The host knows the default; the list changes when it answers. */
  const reset = useCallback(() => {
    if (!queryClient.getQueryData(keys.current)) return;
    setError(null);
    saveOf(keys.current).queued = { shown: null };
    void flush();
  }, [flush, queryClient]);

  return { available: Boolean(models), list, error, change, reset };
}
