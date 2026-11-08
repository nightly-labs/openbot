import type { ClientAgentModelOption } from "@openbot/contracts/ipc";
import type { HermesProfileOptions } from "@openbot/ui/features/agents/HermesProfileSelect";
import { createEffect, createMemo, createSignal, createStore, onCleanup } from "solid-js";
import { agentsPort } from "./agents-port";

/** Owns local discovery and a catalog for the selected profile. A failed read keeps the selection. */
export function createHermesProfiles(
  enabled: () => boolean,
  profileId: () => string | undefined,
  catalog: () => ClientAgentModelOption[],
) {
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
    () => ({ enabled: enabled(), profileId: profileId(), revision: revision() }),
    (selection) => {
      const current = ++generation;
      if (!selection.enabled) return;
      setState((draft) => {
        draft.loading = true;
        draft.models = [];
        draft.key = selection.profileId;
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
          draft.modelsUnavailable = models.status === "rejected";
          if (profiles.status === "fulfilled") draft.profiles = profiles.value;
          draft.models = models.status === "fulfilled" ? models.value : [];
        });
      });
    },
  );
  return {
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
      enabled()
        ? [
            ...catalog().filter((model) => model.provider !== "hermes"),
            ...(state.key === profileId() ? state.models : []),
          ]
        : catalog(),
    ),
  };
}
