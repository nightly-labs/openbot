import { ConfirmDialog, ErrorReference } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { errorReference, type UserErrorDetails } from "@openbot/user-errors";
import { createSignal } from "solid-js";
import type { AgentProfile } from "../../data";
import { useText } from "../../text";

export function AgentDeleteDialog(props: {
  agent: Pick<AgentProfile, "name" | "avatarSeed" | "avatarHue" | "avatarUrl">;
  onClose: () => void;
  remove: () => Promise<void>;
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
        message: errorMessage(error, t("sidebar.delete.failed")),
        reference: errorReference(error),
      });
    }
  }
  return (
    <ConfirmDialog
      open
      initialFocus="cancel"
      media={<AgentAvatar agent={props.agent} style={{ width: "44px", height: "44px" }} />}
      title={t("sidebar.delete.title", { name: props.agent.name })}
      description={t("sidebar.delete.agentDescription")}
      confirmLabel={t("common.delete")}
      pendingLabel={t("sidebar.delete.pending")}
      error={
        failure() ? (
          <>
            {failure()?.message}
            <ErrorReference reference={failure()?.reference} />
          </>
        ) : undefined
      }
      onCancel={() => {
        setFailure(null);
        props.onClose();
      }}
      onConfirm={confirm}
    />
  );
}
