import type { ServerSummary } from "@openbot/contracts/ipc";
import { ConfirmDialog, toast } from "@openbot/ui";
import { createEffect, createSignal } from "solid-js";
import { useText } from "../../text";

const LEAVE_TEXT = {
  leave: {
    title: "server.settings.leaveConfirmTitle",
    description: "server.settings.leaveConfirmDescription",
    confirm: "server.settings.leaveTitle",
    pending: "server.settings.leaving",
    done: "server.settings.leftTitle",
  },
  remove: {
    title: "server.settings.removeConfirmTitle",
    description: "server.settings.removeConfirmDescription",
    confirm: "server.settings.removeTitle",
    pending: "server.settings.removing",
    done: "server.settings.removedTitle",
  },
  delete: {
    title: "server.local.deleteConfirmTitle",
    description: "server.local.deleteConfirmDescription",
    confirm: "server.rail.delete",
    pending: "server.local.deleting",
    done: "server.local.deletedTitle",
  },
} as const;

export function LeaveServerDialog(props: {
  server: Pick<ServerSummary, "name"> | null;
  onClose: () => void;
  removeOwned?: boolean;
  deleteLocal?: boolean;
  onLeave: () => Promise<void>;
  restoreFocusTarget?: HTMLElement | null | undefined;
}) {
  const { t, errorMessage } = useText();
  const [error, setError] = createSignal<string | null>(null);
  createEffect(
    () => props.server !== null,
    (open) => {
      if (open) setError(null);
    },
  );
  const mode = () => (props.deleteLocal ? "delete" : props.removeOwned ? "remove" : "leave");
  function close(): void {
    setError(null);
    props.onClose();
  }
  return (
    <ConfirmDialog
      open={props.server !== null}
      initialFocus="cancel"
      restoreFocusTarget={props.restoreFocusTarget}
      title={t(LEAVE_TEXT[mode()].title, { name: props.server?.name ?? "" })}
      description={t(LEAVE_TEXT[mode()].description)}
      confirmLabel={t(LEAVE_TEXT[mode()].confirm)}
      pendingLabel={t(LEAVE_TEXT[mode()].pending)}
      error={error() ?? undefined}
      onCancel={close}
      onConfirm={async () => {
        const name = props.server?.name ?? "";
        const done = LEAVE_TEXT[mode()].done;
        setError(null);
        try {
          await props.onLeave();
        } catch (failure) {
          setError(errorMessage(failure, t("server.settings.actionFailed")));
          return;
        }
        close();
        toast.success(t(done, { name }));
      }}
    />
  );
}
