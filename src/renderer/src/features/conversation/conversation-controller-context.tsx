import { createContext, type ParentProps, useContext } from "solid-js";
import type { createConversationController } from "./conversation-controller";

export type ConversationController = ReturnType<typeof createConversationController>;

const ConversationControllerContext = createContext<ConversationController>();

export function useConversationController(): ConversationController {
  const controller = useContext(ConversationControllerContext);
  if (!controller) throw new Error("Conversation controller is unavailable outside Conversation.");
  return controller;
}

export function ConversationControllerProvider(props: ParentProps<{ controller: ConversationController }>) {
  return <ConversationControllerContext value={props.controller}>{props.children}</ConversationControllerContext>;
}
