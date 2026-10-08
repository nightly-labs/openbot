import type { ServerSummary } from "@openbot/contracts/ipc";
import { ConfirmDialog, toast } from "@openbot/ui";
import { createEffect, createSignal } from "solid-js";
import { useText } from "../../text";

/**
 * Asks before the user leaves a joined server. A failed leave stays in the dialog. The dialog
 * closes when `onLeave` resolves.
 */
export function LeaveServerDialog(props: {
  server: Pick<ServerSummary, "name"> | null;
  onClose: () => void;
  onLeave: () => Promise<void>;
  /** The element that opened the dialog. A menu item is gone when the dialog closes. */
  restoreFocusTarget?: HTMLElement | null | undefined;
}) {
  const { t, errorMessage } = useText();
  const [error, setError] = createSignal<string | null>(null);
  // The server can leave the list while the dialog is open, so the next open starts without an error.
  createEffect(
    () => props.server !== null,
    (open) => {
      if (open) setError(null);
    },
  );
  function close(): void {
    setError(null);
    props.onClose();
  }
  return (
    <ConfirmDialog
      open={props.server !== null}
      initialFocus="cancel"
      restoreFocusTarget={props.restoreFocusTarget ?? undefined}
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
