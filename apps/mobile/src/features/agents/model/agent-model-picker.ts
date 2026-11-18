import type { AgentModelOption, AgentProviderId } from "@openbot/contracts/ipc";
import { create } from "zustand";

/**
 * The model list that the Model row opens. The form under it keeps the unsaved provider, model and
 * effort, so the list only names them and gives the pick back to the form.
 */
export interface AgentModelPickerRequest {
  serverId: string;
  provider: AgentProviderId;
  model: string | undefined;
  /** The models that the chosen account serves and the provider's own sign-in does not. */
  accountModels: readonly AgentModelOption[];
  /** Gets the option from the list on the page, which can be newer than the list of the form. */
  choose: (option: AgentModelOption) => void;
}

export const useAgentModelPicker = create<{
  request: AgentModelPickerRequest | null;
  open: (request: AgentModelPickerRequest) => void;
}>((set) => ({
  request: null,
  open: (request) => set({ request }),
}));

/**
 * The host's models of a provider, then the models that only the chosen account serves. The
 * released model list gives the catalogue of the provider's own sign-in (`provider-account-models-v1`).
 */
export function withAccountModels(
  options: readonly AgentModelOption[],
  accountModels: readonly AgentModelOption[],
): AgentModelOption[] {
  const listed = new Set(options.map((option) => option.id));
  return [...options, ...accountModels.filter((option) => !listed.has(option.id))];
}
