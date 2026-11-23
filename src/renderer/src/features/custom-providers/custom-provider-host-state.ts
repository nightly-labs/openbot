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
  open: boolean;
  editing: CustomProviderSummary | null;
  manageOpen: boolean;
  saving: boolean;
  submitError: string | null;
  note: string | null;
  removing: string | null;
}

interface CustomProviderHostOptions {
  onAdd?: (value: SaveCustomProviderInput) => Promise<CustomProviderRestart> | undefined;
  onDelete?: (id: string) => Promise<CustomProviderRestart> | undefined;
  onUpdate?: (input: UpdateCustomProviderInput) => Promise<CustomProviderRestart> | undefined;
  onSaved?: (value: SaveCustomProviderInput) => void;
  onRemoved?: (id: string) => void;
  onUpdated?: (input: UpdateCustomProviderInput) => void;
  discoverModels?: () => ((endpoint: CustomProviderEndpoint) => Promise<readonly DiscoveredModel[]>) | undefined;
}

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
  let discoveryRequest = 0;

  function resetDiscovery(): void {
    discoveryRequest += 1;
    setDiscovery({ status: "idle" });
  }

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
