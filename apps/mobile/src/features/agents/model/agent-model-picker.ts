import type { AgentModelOption, AgentProviderId } from "@openbot/contracts/ipc";
import { create } from "zustand";

export interface AgentModelPickerRequest {
  serverId: string;
  provider: AgentProviderId;
  model: string | undefined;
  accountModels: readonly AgentModelOption[];
  choose: (option: AgentModelOption) => void;
}

export const useAgentModelPicker = create<{
  request: AgentModelPickerRequest | null;
  open: (request: AgentModelPickerRequest) => void;
}>((set) => ({
  request: null,
  open: (request) => set({ request }),
}));

export function withAccountModels(
  options: readonly AgentModelOption[],
  accountModels: readonly AgentModelOption[],
): AgentModelOption[] {
  const listed = new Set(options.map((option) => option.id));
  return [...options, ...accountModels.filter((option) => !listed.has(option.id))];
}
