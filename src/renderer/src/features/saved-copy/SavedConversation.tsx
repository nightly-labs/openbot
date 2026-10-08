import type { AgentMessage } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { type ChatMessageAuthor, ChatMessageRow } from "@openbot/ui/features/conversation/ChatMessageRow";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { useAuth } from "../account/account-context";
import { isReaderAuthor } from "../team/reader-identity";
import { useSavedCopy } from "./saved-copy-context";

/**
 * The chat area while a joined server connects and a saved copy exists: the latest saved messages of
 * one chat, for reading only. It has no composer and no message actions, because each of them needs
 * the host, and it says that it shows a saved copy that can be out of date.
 */
export function SavedConversation() {
  const { t } = useText();
  const { centralAuth } = useAuth();
  const savedCopy = useSavedCopy();
  const author = (message: AgentMessage): ChatMessageAuthor => {
    const agent = savedCopy.selectedAgent();
    if (message.author !== "you") {
      return { kind: "agent", name: agent?.name ?? t("chat.message.agentFallback"), agent };
    }
    const sender = message.senderMember;
    const auth = centralAuth();
    const own =
      !sender ||
      isReaderAuthor(sender.id, {
        memberId: savedCopy.memberId(),
        accountUserId: auth.status === "signed_in" ? auth.user.id : null,
        onOwnComputer: false,
      });
    return own
      ? { kind: "you", name: t("chat.message.you") }
      : { kind: "member", name: sender.name.trim() || t("chat.message.memberFallback"), avatarSeed: sender.id };
  };
  return (
    <main class="conversation-panel saved-copy-conversation" aria-label={t("conversation.view.label")}>
      <header class="window-drag conversation-header">
        <div class="conversation-heading-group">
          <Show when={savedCopy.selectedAgent()}>
            {(agent) => (
              <span class="conversation-title saved-copy-title">
                <AgentAvatar agent={agent()} />
                <h1>{agent().name}</h1>
              </span>
            )}
          </Show>
        </div>
      </header>
      <div class="conversation-scroll saved-copy-scroll">
        <Show
          when={savedCopy.messages().length > 0}
          fallback={<p class="saved-copy-empty">{t("conversation.savedCopy.empty")}</p>}
        >
          <div class="virtual-chat-list virtual-chat-list-static">
            <For each={savedCopy.messages()}>
              {(message) => (
                <div class="virtual-chat-row">
                  <ChatMessageRow
                    message={message}
                    author={author(message)}
                    agents={savedCopy.agents()}
                    animate={false}
                    onSelectAgent={savedCopy.select}
                    onOpenLink={(url) => void savedCopy.openUrl(url).catch(() => undefined)}
                    onPreview={() => undefined}
                    onAttachmentAction={() => undefined}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
      <p class="saved-copy-status" role="status">
        {t("conversation.savedCopy.status")}
      </p>
    </main>
  );
}
