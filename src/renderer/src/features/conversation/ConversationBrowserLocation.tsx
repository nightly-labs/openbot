import { BrowserLocationCard } from "@openbot/ui/features/conversation/ConversationPrompts";
import { For } from "solid-js";
import { useConversationViewScope } from "./conversation-scope";

export function ConversationBrowserLocation() {
  const { browserTabs, answerBrowserPermission, permissionAnswerPending } = useConversationViewScope();
  const asking = () =>
    browserTabs().flatMap((tab) => (tab.permissionRequest ? [{ tabId: tab.id, request: tab.permissionRequest }] : []));
  return (
    <For each={asking()} keyed={(entry) => entry.request.id}>
      {(entry) => (
        <BrowserLocationCard
          request={entry().request}
          pending={permissionAnswerPending()}
          onAnswer={(allow, always) => void answerBrowserPermission(entry().tabId, entry().request.id, allow, always)}
        />
      )}
    </For>
  );
}
