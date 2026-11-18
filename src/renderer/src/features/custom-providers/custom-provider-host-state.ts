import type {
  CustomProviderRestart,
  CustomProviderSummary,
  SaveCustomProviderInput,
  UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { customAgentRestartKey } from "@openbot/ui/features/custom-providers/CustomAgentSettings";
import {
  type CustomProviderEndpoint,
  customProviderUpdate,
  type DiscoveredModel,
  type ModelDiscovery,
} from "@openbot/ui/features/custom-providers/custom-provider-form";
import { currentText } from "@openbot/ui/text";
import { createSignal, createStore } from "solid-js";
import { customProviderRestartMessage } from "./custom-provider-restart";

interface CustomProviderHostState {
  /** The form that describes a new endpoint, or the saved one in `editing`. */
  open: boolean;
  /** The saved endpoint that the open form edits. Null for a new endpoint. */
  editing: CustomProviderSummary | null;
  /** The list of saved endpoints, where one is removed. */
  manageOpen: boolean;
  saving: boolean;
  /** Shown inside the form, which stays open and keeps the endpoint the user typed. */
  submitError: string | null;
  /** The last outcome of a save or a removal: when the models catch up, or why they did not. */
  note: string | null;
  /** The ID being removed, so only that row's button is busy. */
  removing: string | null;
}

interface CustomProviderHostOptions {
  /** Absent, or absent for this host's props, leaves the state alone: no note and no error. */
  onAdd?: (value: SaveCustomProviderInput) => Promise<CustomProviderRestart> | undefined;
  onDelete?: (id: string) => Promise<CustomProviderRestart> | undefined;
  /** Without it the form cannot edit. A joined server's host edits only with `custom-provider-edit-v1`. */
  onUpdate?: (input: UpdateCustomProviderInput) => Promise<CustomProviderRestart> | undefined;
  /** Onboarding selects the endpoint it has just saved, and its first model with it. */
  onSaved?: (value: SaveCustomProviderInput) => void;
  /** Onboarding drops a model whose endpoint is gone. The saved list is already up to date here. */
  onRemoved?: (id: string) => void;
  /** Settings drops a default model that the edit took out. */
  onUpdated?: (input: UpdateCustomProviderInput) => void;
  /** Asks the endpoint for its models. Without it the form has no "Find models". */
  discoverModels?: () => ((endpoint: CustomProviderEndpoint) => Promise<readonly DiscoveredModel[]>) | undefined;
}

/**
 * The dialog state both hosts of the custom provider surfaces need: Settings and onboarding.
 *
 * It is shared for the removal alone. That path carries a busy ID and two message fallbacks, and a
 * second copy of it would drift silently. The removal question itself is in the shared list dialog.
 *
 * Each host builds its own instance, so no submit state is shared, and the two dialogs cannot open
 * at once: a stacked pair of overlays traps focus between them.
 */
export function createCustomProviderHostState(options: CustomProviderHostOptions) {
  const [state, setState] = createStore<CustomProviderHostState>({
    open: false,
    editing: null,
    manageOpen: false,
    saving: false,
    submitError: null,
    note: null,
    removing: null,
  });
  const [discovery, setDiscovery] = createSignal<ModelDiscovery>({ status: "idle" });
  /** Counts the list requests, so the answer of a form that closed does not reach the next one. */
  let discoveryRequest = 0;

  function resetDiscovery(): void {
    discoveryRequest += 1;
    setDiscovery({ status: "idle" });
  }

  /** The "Find models" action of the open form, or undefined when this host cannot ask. */
  function discover(): ((endpoint: CustomProviderEndpoint) => void) | undefined {
    const discoverModels = options.discoverModels?.();
    if (!discoverModels) return undefined;
    return (endpoint) => void findModels(discoverModels, endpoint);
  }

  async function findModels(
    discoverModels: (endpoint: CustomProviderEndpoint) => Promise<readonly DiscoveredModel[]>,
    endpoint: CustomProviderEndpoint,
  ): Promise<void> {
    const request = ++discoveryRequest;
    setDiscovery({ status: "loading" });
    // An edit of a saved endpoint lets main use the stored key, which the form does not hold.
    const saved = state.editing;
    try {
      const models = await discoverModels(saved ? { ...endpoint, savedProviderId: saved.id } : endpoint);
      if (request === discoveryRequest) setDiscovery({ status: "found", models });
    } catch (error) {
      if (request !== discoveryRequest) return;
      const text = currentText();
      setDiscovery({ status: "failed", message: text.errorMessage(error, text.t("customProvider.discovery.empty")) });
    }
  }

  function openForm(): void {
    resetDiscovery();
    setState((current) => {
      current.open = true;
      current.editing = null;
      current.manageOpen = false;
      current.submitError = null;
    });
  }

  function openEdit(provider: CustomProviderSummary): void {
    resetDiscovery();
    setState((current) => {
      current.open = true;
      current.editing = provider;
      current.manageOpen = false;
      current.submitError = null;
    });
  }

  function closeForm(): void {
    setState((current) => {
      current.open = false;
    });
  }

  function openList(): void {
    setState((current) => {
      current.manageOpen = true;
      current.open = false;
      current.note = null;
    });
  }

  function closeList(): void {
    setState((current) => {
      current.manageOpen = false;
      current.note = null;
    });
  }

  /**
   * The save is awaited before the form closes: an earlier version closed first and dropped the
   * call, so a rejected save looked like a saved endpoint.
   */
  async function submit(value: SaveCustomProviderInput): Promise<void> {
    setState((current) => {
      current.saving = true;
      current.submitError = null;
      current.note = null;
    });
    try {
      const update = state.editing ? customProviderUpdate(value) : null;
      const restart = update ? await options.onUpdate?.(update) : await options.onAdd?.(value);
      setState((current) => {
        current.open = false;
        current.note = restart ? customProviderRestartMessage("Saved", restart, currentText().t) : null;
      });
      if (update) options.onUpdated?.(update);
      else options.onSaved?.(value);
    } catch (error) {
      setState((current) => {
        const text = currentText();
        current.submitError = text.errorMessage(error, text.t("customProvider.saveFailed"));
      });
    } finally {
      setState((current) => {
        current.saving = false;
      });
    }
  }

  /** Runs after the user accepts the removal question, which `CustomProviderListDialog` asks. */
  async function remove(provider: CustomProviderSummary): Promise<void> {
    setState((current) => {
      current.removing = provider.id;
      current.note = null;
    });
    try {
      const restart = await options.onDelete?.(provider.id);
      setState((current) => {
        current.note = restart ? customProviderRestartMessage("Removed", restart, currentText().t) : null;
      });
      options.onRemoved?.(provider.id);
    } catch (error) {
      setState((current) => {
        const text = currentText();
        current.note = text.errorMessage(error, text.t("customProvider.removeFailed", { name: provider.name }));
      });
    } finally {
      setState((current) => {
        current.removing = null;
      });
    }
  }

  /** A save made in another form, such as a detected provider's: the same note as `submit` writes. */
  function showSaved(kind: "models" | "agent", restart: CustomProviderRestart | undefined): void {
    const { t } = currentText();
    setState((current) => {
      if (!restart) current.note = null;
      else
        current.note =
          kind === "agent"
            ? t(customAgentRestartKey("saved", restart))
            : customProviderRestartMessage("Saved", restart, t);
    });
  }

  return { state, discovery, discover, openForm, openEdit, closeForm, openList, closeList, submit, remove, showSaved };
}
