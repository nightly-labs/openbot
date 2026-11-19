import type {
  CustomProviderRestart,
  CustomProviderSummary,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { currentText } from "@openbot/ui/text";
import { createStore } from "solid-js";
import { desktopAnalytics } from "../../../analytics";
import type { CustomProvidersEndpointApi } from "../custom-providers-port";

interface CustomProvidersState {
  providers: CustomProviderSummary[];
  loaded: boolean;
}

async function tracked<T>(
  action: "custom_provider_saved" | "custom_provider_removed",
  run: () => Promise<T>,
): Promise<T> {
  try {
    const result = await run();
    desktopAnalytics.track("provider_action", { action, result: "succeeded" });
    return result;
  } catch (error) {
    desktopAnalytics.track("provider_action", {
      action,
      result: "failed",
      failure_code: action === "custom_provider_saved" ? "update_failed" : "delete_failed",
    });
    throw error;
  }
}

export function createCustomProvidersStore(api: () => CustomProvidersEndpointApi | undefined) {
  const [state, setState] = createStore<CustomProvidersState>({ providers: [], loaded: false });

  function apply(providers: CustomProviderSummary[]): void {
    setState((current) => {
      current.providers = providers;
      current.loaded = true;
    });
  }

  function customProviders(): CustomProviderSummary[] {
    return state.providers;
  }

  function customProvidersLoaded(): boolean {
    return state.loaded;
  }

  async function refreshCustomProviders(): Promise<void> {
    const group = api();
    if (!group) return;
    apply(await group.list());
  }

  async function saveCustomProvider(input: SaveCustomProviderInput): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.saveUnavailable"));
    const result = await tracked("custom_provider_saved", () => group.save(input));
    apply(result.providers);
    return result.restart;
  }

  async function updateCustomProvider(input: UpdateCustomProviderInput): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.saveUnavailable"));
    const result = await tracked("custom_provider_saved", () => group.update(input));
    apply(result.providers);
    return result.restart;
  }

  async function deleteCustomProvider(id: string): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.removeUnavailable"));
    const result = await tracked("custom_provider_removed", () => group.delete({ id }));
    apply(result.providers);
    return result.restart;
  }

  return {
    customProviders,
    customProvidersLoaded,
    refreshCustomProviders,
    saveCustomProvider,
    updateCustomProvider,
    deleteCustomProvider,
  };
}
