import type { AgentProviderId, AgentProviderStatus, AgentStatus, ClientAgentModelOption } from "@openbot/contracts/ipc";
import type { HermesProfileOptions } from "@openbot/ui/features/agents/HermesProfileSelect";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createSignal, createStore, onCleanup } from "solid-js";
import { agentsPort } from "./agents-port";

/** Owns local discovery and a catalog for the selected profile. A failed read keeps the selection. */
export function createHermesProfiles(
  enabled: () => boolean,
  profileId: () => string | undefined,
  catalog: () => ClientAgentModelOption[],
) {
  const { t } = useText();
  const isEnabled = createMemo(enabled);
  const selectedProfileId = createMemo(profileId);
  const [revision, setRevision] = createSignal(0);
  const [state, setState] = createStore<{
    profiles: string[];
    models: ClientAgentModelOption[];
    key: string | undefined;
    loading: boolean;
    unavailable: boolean;
    modelsUnavailable: boolean;
  }>({ profiles: [], models: [], key: undefined, loading: false, unavailable: false, modelsUnavailable: false });
  let generation = 0;
  onCleanup(() => {
    generation += 1;
  });
  createEffect(
    () => ({ enabled: isEnabled(), profileId: selectedProfileId(), revision: revision() }),
    (selection) => {
      const current = ++generation;
      if (!selection.enabled) return;
      setState((draft) => {
        draft.loading = true;
        draft.models = [];
        draft.key = selection.profileId;
        draft.unavailable = false;
        draft.modelsUnavailable = false;
      });
      const port = agentsPort();
      void Promise.allSettled([
        port.listHermesProfiles(),
        port.listHermesModels(selection.profileId === undefined ? {} : { profileId: selection.profileId }),
      ]).then(([profiles, models]) => {
        if (current !== generation) return;
        setState((draft) => {
          draft.loading = false;
          draft.unavailable = profiles.status === "rejected";
          draft.modelsUnavailable =
            models.status === "rejected" || (selection.profileId !== undefined && models.value.length === 0);
          if (profiles.status === "fulfilled") draft.profiles = profiles.value;
          draft.models = models.status === "fulfilled" ? models.value : [];
        });
      });
    },
  );
  return {
    pickerStatus(status: AgentStatus): AgentStatus {
      if (!isEnabled() || selectedProfileId() === undefined) return status;
      const host = status.providers?.find((provider) => provider.id === "hermes");
      if (host?.off || host?.state === "not-installed" || host?.state === "outdated") return status;
      const checking = state.loading || state.key !== selectedProfileId();
      const failed = state.modelsUnavailable || state.models.length === 0;
      const hermes: AgentProviderStatus = {
        id: "hermes",
        state: checking ? "checking" : failed ? "error" : "available",
        version: host?.version ?? null,
        message: !checking && failed ? t("agentSettings.hermesProfile.modelsUnavailable") : null,
        ...(host?.off === undefined ? {} : { off: host.off }),
        ...(host?.cliSource === undefined ? {} : { cliSource: host.cliSource }),
      };
      return {
        ...status,
        providers: [...(status.providers ?? []).filter((provider) => provider.id !== "hermes"), hermes],
      };
    },
    canConnectProvider(provider: AgentProviderId): boolean {
      return provider !== "hermes" || !isEnabled() || selectedProfileId() === undefined;
    },
    options: createMemo(
      (): HermesProfileOptions => ({
        profiles: state.profiles,
        loading: state.loading,
        unavailable: state.unavailable,
        modelsUnavailable: state.modelsUnavailable,
        retry: () => setRevision((value) => value + 1),
      }),
    ),
    models: createMemo(() =>
      isEnabled()
        ? [
            ...catalog().filter((model) => model.provider !== "hermes"),
            ...(state.key === selectedProfileId() ? state.models : []),
          ]
        : catalog(),
    ),
  };
}
