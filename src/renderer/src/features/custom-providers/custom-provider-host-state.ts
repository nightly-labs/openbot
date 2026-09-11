import type { CustomProviderRestart, CustomProviderSummary, SaveCustomProviderInput } from "@openbot/contracts/ipc";
import { createStore } from "solid-js";
import { errorMessage } from "../../error-message";
import { customProviderRestartMessage } from "./custom-provider-restart";

interface CustomProviderHostState {
  /** The form that describes a new endpoint. */
  open: boolean;
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
  /** Onboarding selects the endpoint it has just saved, and its first model with it. */
  onSaved?: (value: SaveCustomProviderInput) => void;
  /** Onboarding drops a model whose endpoint is gone. The saved list is already up to date here. */
  onRemoved?: (id: string) => void;
}

/**
 * The dialog state both hosts of the custom provider surfaces need: Settings and onboarding.
 *
 * It is shared for the removal alone. That path carries a sentence the user must recognise in both
 * places, a busy ID and two message fallbacks, and a second copy of it would drift silently - only
 * one of the two hosts has a test that reads the confirmation word for word.
 *
 * Each host builds its own instance, so no submit state is shared, and the two dialogs cannot open
 * at once: a stacked pair of overlays traps focus between them.
 */
export function createCustomProviderHostState(options: CustomProviderHostOptions) {
  const [state, setState] = createStore<CustomProviderHostState>({
    open: false,
    manageOpen: false,
    saving: false,
    submitError: null,
    note: null,
    removing: null,
  });

  function openForm(): void {
    setState((current) => {
      current.open = true;
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
      const restart = await options.onAdd?.(value);
      setState((current) => {
        current.open = false;
        current.note = restart ? customProviderRestartMessage("Saved", restart) : null;
      });
      options.onSaved?.(value);
    } catch (error) {
      setState((current) => {
        current.submitError = errorMessage(error, "OpenBot could not save this endpoint.");
      });
    } finally {
      setState((current) => {
        current.saving = false;
      });
    }
  }

  async function remove(provider: CustomProviderSummary): Promise<void> {
    if (
      !window.confirm(
        `Remove ${provider.name}? Its API key is discarded, its models disappear from the picker, and any agent using one falls back to a default model.`,
      )
    ) {
      return;
    }
    setState((current) => {
      current.removing = provider.id;
      current.note = null;
    });
    try {
      const restart = await options.onDelete?.(provider.id);
      setState((current) => {
        current.note = restart ? customProviderRestartMessage("Removed", restart) : null;
      });
      options.onRemoved?.(provider.id);
    } catch (error) {
      setState((current) => {
        current.note = errorMessage(error, `OpenBot could not remove ${provider.name}.`);
      });
    } finally {
      setState((current) => {
        current.removing = null;
      });
    }
  }

  return { state, openForm, closeForm, openList, closeList, submit, remove };
}

export type CustomProviderHost = ReturnType<typeof createCustomProviderHostState>;
