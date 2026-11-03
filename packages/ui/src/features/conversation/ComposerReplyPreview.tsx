import type { InstalledSkill } from "@openbot/contracts/ipc";
import { Button } from "@openbot/ui";
import type { AgentMessage, AgentProfile } from "../../data";
import { useText } from "../../text";
import { CloseIcon } from "./ConversationIcons";
import { ReplyQuote } from "./ReplyQuote";

/** The message that the draft replies to, above the message box, with a button that removes the reply. */
export function ComposerReplyPreview(props: {
  message: AgentMessage;
  agents: AgentProfile[];
  skills?: InstalledSkill[] | undefined;
  disabled?: boolean | undefined;
  onCancel: () => void;
}) {
  const { t } = useText();
  return (
    <div class="composer-reply-preview">
      <div>
        <span>{t(props.message.author === "you" ? "composer.reply.toYou" : "composer.reply.toAgent")}</span>
        <ReplyQuote
          body={props.message.body || t("composer.reply.attachment")}
          agents={props.agents}
          skills={props.skills}
          attachments={props.message.attachments}
          citations={props.message.citations}
        />
      </div>
      <Button
        variant="ghost"
        type="button"
        aria-label={t("composer.reply.cancel")}
        disabled={props.disabled}
        onClick={() => props.onCancel()}
      >
        <CloseIcon />
      </Button>
    </div>
  );
}
