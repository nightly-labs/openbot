import { create } from "zustand";

export interface VaultAgentPickerRequest {
  serverId: string;
  agents: readonly string[] | null;
  onChange: (agents: string[] | null) => void;
}

export const useVaultAgentPicker = create<{
  request: VaultAgentPickerRequest | null;
  open: (request: VaultAgentPickerRequest) => void;
}>((set) => ({
  request: null,
  open: (request) => set({ request }),
}));
