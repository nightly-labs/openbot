import type { AgentModelId, AgentProviderId, ProviderModelVisibility } from "@openbot/contracts/ipc";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import type { ProviderAdmin } from "@/features/servers/model/provider-admin";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { useText } from "@/shared/lib/text";

interface ModelSave {
  queued: { shown: AgentModelId[] | null } | null;
  saving: boolean;
}

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
      saves.delete(JSON.stringify(key));
      if (failed) void queryClient.invalidateQueries({ queryKey: key, exact: true });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentModels(queryScope, serverId) });
    }
  }, [models, provider, queryClient, queryScope, serverId, errorMessage, t]);

  const change = useCallback(
    (shown: AgentModelId[]) => {
      const key = keys.current;
      if (!queryClient.getQueryData<ProviderModelVisibility>(key)) return;
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

  const reset = useCallback(() => {
    if (!queryClient.getQueryData(keys.current)) return;
    setError(null);
    saveOf(keys.current).queued = { shown: null };
    void flush();
  }, [flush, queryClient]);

  return { available: Boolean(models), list, error, change, reset };
}
