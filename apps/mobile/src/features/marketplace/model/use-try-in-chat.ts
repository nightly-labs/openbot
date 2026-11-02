import { useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { useEffect, useRef } from "react";
import { requestComposerFocus, requestComposerText } from "@/features/chat/model/composer-requests";
import { haptics } from "@/shared/lib/haptics";

/** The route name of an agent chat in the app stack, `app/(app)/chat/[agentId].tsx`. */
const CHAT_ROUTE = "chat/[agentId]";

/**
 * The Try of a listing sheet, as the desktop Marketplace has it: the example request goes into the
 * chosen agent's message field, and that agent's chat takes the place of the sheet. The user reads
 * and sends it; nothing is sent from here.
 */
export function useTryInChat(serverId: string): (agentId: string, text: string) => void {
  // The stack that presents the sheet. The sheet has its own stack inside, so the chat must replace
  // the sheet in the stack above it, as Agent info > Skills does for a new skill.
  const sheetStack = useNavigation().getParent();
  const sent = useRef<string | null>(null);
  // The native stack keeps a closing sheet mounted until its animation ends, so this cleanup runs
  // after the dismissal, when the chat can keep the keyboard.
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
