import type { AgentModelOption, AgentProviderId, HostProviderAccounts } from "@openbot/contracts/ipc";
import { CLAUDE_API_KEY_ACCOUNT_ID } from "@openbot/contracts/team-protocol/claude-api-key-v1";
import { create } from "zustand";
import { isProviderKeyAccount } from "@/features/servers/model/provider-admin";

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
  return [
    ...options,
    ...accountModels.filter((option) => {
      if (listed.has(option.id)) return false;
      listed.add(option.id);
      return true;
    }),
  ];
}

export function poolAccountModels(
  host: HostProviderAccounts | null,
  provider: AgentProviderId,
  accountId: string,
): AgentModelOption[] {
  const pool = host?.pools?.find((entry) => entry.provider === provider)?.pool;
  const member = (id: string) =>
    id !== CLAUDE_API_KEY_ACCOUNT_ID && !isProviderKeyAccount(provider, id) && !pool?.leftOut.includes(id);
  if (!pool?.accountModels || !member(accountId)) return [];
  return (host?.providers.find((entry) => entry.provider === provider)?.accounts ?? []).flatMap((account) =>
    account.state === "connected" && member(account.id) ? (account.models ?? []) : [],
  );
}
