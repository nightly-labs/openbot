import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { BranchIcon } from "../ConversationIcons";

/** Where a branch came from, for the line after its copied messages. */
export interface AgentThreadBranchSource {
  /** The last copied message. The line shows after it. */
  throughMessageId: string;
  /** The title of the source thread, or the name of the agent's own chat. Null when the source was deleted. */
  label: string | null;
  /** Opens the source at the message that the branch came from. Missing when the source cannot open. */
  onOpen?: (() => void) | undefined;
}

/** The line between the messages that a branch copied and the messages that came after. */
export function BranchDivider(props: { source: AgentThreadBranchSource }) {
  const { t } = useText();
  const text = () =>
    props.source.label === null
      ? t("conversation.threads.branch.fromDeleted")
      : t("conversation.threads.branch.from", { title: props.source.label });
  return (
    <div class="agent-thread-branch-divider">
      <hr />
      <Show
        when={props.source.label !== null && props.source.onOpen}
        fallback={
          <span class="agent-thread-branch-text">
            <BranchIcon />
            <span>{text()}</span>
          </span>
        }
      >
        {(onOpen) => (
          <Button variant="ghost" size="xs" class="agent-thread-branch-link" onClick={() => onOpen()()}>
            <BranchIcon />
            <span>{text()}</span>
          </Button>
        )}
      </Show>
      <hr />
    </div>
  );
}
