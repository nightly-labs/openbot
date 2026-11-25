import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { BranchIcon } from "../ConversationIcons";

export interface AgentThreadBranchSource {
  throughMessageId: string;
  label: string | null;
  onOpen?: (() => void) | undefined;
}

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
