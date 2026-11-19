import { useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { useEffect, useRef } from "react";
import { requestComposerFocus, requestComposerText } from "@/features/chat/model/composer-requests";
import { haptics } from "@/shared/lib/haptics";

const CHAT_ROUTE = "chat/[agentId]";

export function useTryInChat(serverId: string): (agentId: string, text: string) => void {
  const sheetStack = useNavigation().getParent();
  const sent = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (sent.current) requestComposerFocus({ serverId, agentId: sent.current });
    },
    [serverId],
  );
  return (agentId, text) => {
    if (!sheetStack) return;
    void haptics.impact("light");
    requestComposerText({ serverId, agentId, text });
    sent.current = agentId;
    sheetStack.dispatch(StackActions.replace(CHAT_ROUTE, { agentId }));
  };
}
