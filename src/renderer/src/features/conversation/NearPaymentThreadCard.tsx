import type { AgentMessage } from "@openbot/ui/data";
import { NearPaymentRecordCard } from "@openbot/ui/features/vault/NearPaymentRecordCard";
import { useConversationViewScope } from "./conversation-scope";

export function useThreadNearPaymentCard() {
  const { openExternalMessageUrl } = useConversationViewScope();
  return (message: AgentMessage) => {
    const payment = message.nearPayment;
    if (!payment) return undefined;
    return <NearPaymentRecordCard payment={payment} onOpenLink={(url) => void openExternalMessageUrl(url)} />;
  };
}
