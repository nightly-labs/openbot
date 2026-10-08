import type { ServerSummary } from "@openbot/contracts/ipc";
import { ConfirmDialog, toast } from "@openbot/ui";
import { createSignal } from "solid-js";
import { useText } from "../../text";

/**
 * Asks before the user leaves a joined server from the server menu. A failed leave stays in the
 * dialog. `onLeave` resolves when the server is no longer in the list.
 */
export function LeaveServerDialog(props: {
  server: Pick<ServerSummary, "name"> | null;
  onClose: () => void;
  onLeave: () => Promise<void>;
}) {
  const { t, errorMessage } = useText();
  const [error, setError] = createSignal<string | null>(null);
  function close(): void {
    setError(null);
    props.onClose();
  }
  return (
    <ConfirmDialog
      open={props.server !== null}
      initialFocus="cancel"
      title={t("server.settings.leaveConfirmTitle", { name: props.server?.name ?? "" })}
      description={t("server.settings.leaveConfirmDescription")}
      confirmLabel={t("server.settings.leaveTitle")}
      pendingLabel={t("server.settings.leaving")}
      error={error() ?? undefined}
      onCancel={close}
      onConfirm={async () => {
        // Read now: a successful leave takes the server out of the list.
        const name = props.server?.name ?? "";
        setError(null);
        try {
          await props.onLeave();
        } catch (failure) {
          setError(errorMessage(failure, t("server.settings.actionFailed")));
          return;
        }
        close();
        toast.success(t("server.settings.leftTitle", { name }));
      }}
    />
  );
}
