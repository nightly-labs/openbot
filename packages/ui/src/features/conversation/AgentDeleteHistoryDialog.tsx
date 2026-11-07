import { ConfirmDialog, ErrorReference } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createSignal } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";

/**
 * Asks before the messages of the agent's own chat go. The agent settings open it. A failure stays in
 * the dialog; a delete closes it.
 */
export function AgentDeleteHistoryDialog(props: {
  agent: Pick<AgentProfile, "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;
  open: boolean;
  onClose: () => void;
  remove: () => Promise<void>;
  restoreFocusTarget?: HTMLElement | null | undefined;
}) {
  const { t, errorMessage } = useText();
  const [failure, setFailure] = createSignal<UserErrorDetails | null>(null);
  async function confirm(): Promise<void> {
    setFailure(null);
    try {
      await props.remove();
      props.onClose();
    } catch (error) {
      setFailure({
        message: errorMessage(error, t("agentSettings.deleteHistory.failed")),
        reference: errorReference(error),
      });
    }
  }
  return (
    <ConfirmDialog
      open={props.open}
      initialFocus="cancel"
      media={<AgentAvatar agent={props.agent} style={{ width: "44px", height: "44px" }} />}
      title={t("agentSettings.deleteHistory.confirmTitle", { name: props.agent.name })}
      description={t("agentSettings.deleteHistory.confirmDescription")}
      confirmLabel={t("agentSettings.deleteHistory.confirm")}
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
