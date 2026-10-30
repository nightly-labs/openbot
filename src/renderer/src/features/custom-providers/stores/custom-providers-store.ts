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
  /** False until the first list arrives, so an empty list is not read as "none saved". */
  loaded: boolean;
}

/** Runs a change of the list and records its result. The endpoint's name and address are not sent. */
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

/**
 * The endpoints the user named, as the renderer sees them: a list with no key in it.
 *
 * The API is taken as an accessor rather than as an object, because this store is built while the
 * context mounts and a test harness may install `window.openbot` around it. An absent group leaves
 * the list empty and every mutation a no-op, which is what a build without the endpoints should look
 * like rather than a crash on the Settings tab.
 *
 * `busy` and `submitError` are deliberately absent: both hosts of the dialog keep them locally, so
 * they stay prop-driven for Storybook, and two hosts never share one submit state.
 */
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

  /**
   * The mutations write the list main returned and then re-throw, so the button that started the
   * call owns the message. They return the restart outcome, which is the only honest answer to "are
   * the models there yet": the save resolves on the durable write, not on model discovery.
   */
  async function saveCustomProvider(input: SaveCustomProviderInput): Promise<CustomProviderRestart> {
    const group = api();
    if (!group) throw new Error(currentText().t("customProvider.saveUnavailable"));
    const result = await tracked("custom_provider_saved", () => group.save(input));
    apply(result.providers);
    return result.restart;
  }

  /** Only this computer's endpoints have `update`. */
  async function updateCustomProvider(input: UpdateCustomProviderInput): Promise<CustomProviderRestart> {
    const group = api();
    if (!group?.update) throw new Error(currentText().t("customProvider.saveUnavailable"));
    const update = group.update;
    const result = await tracked("custom_provider_saved", () => update(input));
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
