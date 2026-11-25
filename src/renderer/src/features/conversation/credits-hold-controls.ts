import type { AgentApproval, CreditsHold, CreditsHoldAction } from "@openbot/contracts/ipc";
import type { CreditsHoldAgent, CreditsHoldControls } from "@openbot/ui/features/conversation/CreditsHoldCard";
import type { CreditsMenu } from "@openbot/ui/features/credits/credits-store";
import { adoptCreditAsksMuted, adoptMediaApprovalCredits } from "../servers/media-approval-credits-store";

interface CreditsHoldSource {
  agents: () => readonly (CreditsHoldAgent & { id: string })[];
  credits: () => CreditsMenu;
  walletId: () => string | null;
  serverId: () => string | undefined;
  respond: (approval: AgentApproval, action: CreditsHoldAction) => Promise<CreditsHold | null>;
  setMuted: (muted: boolean) => Promise<void>;
}

export function creditsHoldControls(source: CreditsHoldSource): CreditsHoldControls {
  return {
    agent: (agentId) => source.agents().find((agent) => agent.id === agentId),
    balance: () => {
      const state = source.credits().state;
      if (!state?.available) return null;
      const walletId = source.walletId();
      return state.servers.find((wallet) => wallet.serverId === walletId)?.balance ?? state.balance;
    },
    buy: () => source.credits().onOpen(source.walletId()),
    respond: async (approval, action) => {
      const hold = await source.respond(approval, action);
      const serverId = source.serverId();
      if (action === "enable" && serverId) adoptMediaApprovalCredits(serverId, { agents: true });
      if (action === "mute" && serverId && hold === null) adoptCreditAsksMuted(serverId, true);
      return hold;
    },
    unmute: async () => {
      await source.setMuted(false);
      const serverId = source.serverId();
      if (serverId) adoptCreditAsksMuted(serverId, false);
    },
  };
}
