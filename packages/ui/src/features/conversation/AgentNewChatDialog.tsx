import { ConfirmDialog, ErrorReference } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createSignal } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";

/**
 * Asks before the agent forgets its chat. The agent settings and the context meter open it. A failure
 * stays in the dialog; a new chat closes it.
 */
export function AgentNewChatDialog(props: {
  agent: Pick<AgentProfile, "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;
  open: boolean;
  onClose: () => void;
  start: () => Promise<void>;
  restoreFocusTarget?: HTMLElement | null | undefined;
}) {
  const { t, errorMessage } = useText();
  const [failure, setFailure] = createSignal<UserErrorDetails | null>(null);
  async function confirm(): Promise<void> {
    setFailure(null);
    try {
      await props.start();
      props.onClose();
    } catch (error) {
      setFailure({ message: errorMessage(error, t("agentSettings.newChat.failed")), reference: errorReference(error) });
    }
  }
  return (
    <ConfirmDialog
      open={props.open}
      tone="default"
      initialFocus="cancel"
      media={<AgentAvatar agent={props.agent} style={{ width: "44px", height: "44px" }} />}
      title={t("agentSettings.newChat.confirmTitle", { name: props.agent.name })}
      description={t("agentSettings.newChat.confirmDescription")}
      confirmLabel={t("agentSettings.newChat.confirm")}
      error={
        failure() ? (
          <>
            {failure()?.message}
            <ErrorReference reference={failure()?.reference} />
          </>
        ) : undefined
      }
      restoreFocusTarget={props.restoreFocusTarget}
      onCancel={() => {
        setFailure(null);
        props.onClose();
      }}
      onConfirm={confirm}
    />
  );
}
