import type { AgentApproval } from "@openbot/contracts/ipc";
import { createEffect } from "solid-js";
import { createNearWalletStore } from "../vault/stores/near-wallet-store";
import { NearPaymentCard } from "./conversation-cards";

type ApprovalAnswer = () => Promise<boolean>;

export function useNearPaymentApproval(local: () => boolean) {
  const wallet = createNearWalletStore();
  createEffect(local, (enabled) => {
    if (!enabled) return;
    const stop = wallet.subscribe();
    void wallet.refresh().catch(() => undefined);
    return stop;
  });
  const payment = (approval: AgentApproval) => {
    if (approval.kind !== "permissions" || !local()) return undefined;
    const requestId = String(approval.requestId);
    return wallet.state.status.payments.find((candidate) => candidate.requestId === requestId);
  };
  const card = (approval: AgentApproval, onApprove: ApprovalAnswer, onReject: ApprovalAnswer) => {
    const pending = payment(approval);
    if (!pending) return undefined;
    return (
      <NearPaymentCard
        payment={pending}
        status={wallet.state.status}
        actions={wallet.actions}
        onApprove={onApprove}
        onReject={onReject}
      />
    );
  };
  return { payment, card, wallet };
}
