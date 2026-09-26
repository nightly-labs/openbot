import type { TeamPresenceMember } from "@openbot/contracts/ipc";
import { useText } from "@openbot/ui/text";
import { Loading } from "solid-js";
import { DirectConversation } from "../../lazy-views";
import { useServers } from "../servers/servers-context";
import { usePresence } from "../team/team-context";
import { useDirectMessages } from "./direct-messages-context";

/**
 * A conversation with a person rather than an Agent. The member is a prop because
 * the shell holds it in a keyed `<Show>`: switching to another person has to
 * remount the transcript, and a `useDirectMessages()` read here would keep the
 * same component alive across the change and leave the previous scroll state on
 * screen.
 */
export function WorkspaceDirectConversation(props: { member: TeamPresenceMember }) {
  const { activeServerSupportsCapability } = useServers();
  const { currentTeamMember } = usePresence();
  const {
    directConversations,
    directConversationLoading,
    directConversationError,
    directConversationPages,
    directOlderLoading,
    directOlderErrors,
    directTypingMemberIds,
    sendDirectMessage,
    markDirectMessagesRead,
    loadOlderDirectMessages,
    openDirectMessage,
    setDirectTyping,
  } = useDirectMessages();
  const { t } = useText();

  return (
    <Loading
      fallback={
        <main class="direct-conversation" aria-label={t("conversation.direct.loadingLabel")}>
          <div class="direct-conversation-state" role="status">
            {t("conversation.direct.loading")}
          </div>
        </main>
      }
    >
      <DirectConversation
        member={props.member}
        currentMemberId={currentTeamMember()?.id ?? ""}
        snapshot={directConversations()[props.member.id]}
        loading={directConversationLoading()}
        loadError={directConversationError()}
        hasOlder={
          activeServerSupportsCapability("conversation-pagination") &&
          (directConversationPages()[props.member.id]?.hasOlder ?? false)
        }
        loadingOlder={directOlderLoading()[props.member.id] === true}
        olderError={directOlderErrors()[props.member.id] ?? null}
        typing={directTypingMemberIds().has(props.member.id)}
        onSend={sendDirectMessage}
        onMarkRead={() => markDirectMessagesRead(props.member.id)}
        onLoadOlder={() => void loadOlderDirectMessages(props.member.id)}
        onOpenMessage={(messageId) => openDirectMessage(props.member.id, messageId)}
        onTypingChange={setDirectTyping}
      />
    </Loading>
  );
}
