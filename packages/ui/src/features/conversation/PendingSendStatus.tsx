import { IconButton, Pencil, RotateCcw, TriangleAlert, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

export interface PendingSendStatusProps {
  state: "waiting" | "sending" | "failed";
  /** Why the send failed, when the host or the connection said. */
  error?: string | null;
  /** The composer shows the update notice; keep recovery actions without a second error. */
  updateRequired?: boolean;
  /** The host drops a repeated send of this message, so Retry cannot store it twice. */
  retrySafe: boolean;
  /** Edit needs an empty composer, so the failed message replaces nothing the user wrote. */
  canEdit: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}

/**
 * The delivery status beside the time of a message the host has not stored yet. A send in flight
 * shows nothing; only a failure shows. The status text is a polite live region that stays while the
 * send runs, so a reader hears the failure without moving focus. A message whose repeat the host
 * cannot detect offers no Retry: the first send may have arrived.
 */
export function PendingSendStatus(props: PendingSendStatusProps): JSX.Element {
  const { t } = useText();
  const failed = () => props.state === "failed";
  return (
    <div class="pending-send-status" data-state={props.state}>
      <span role="status" class="pending-send-label">
        <Show when={failed() && !props.updateRequired}>
          <TriangleAlert aria-hidden="true" />
          {props.retrySafe ? t("chat.send.failed") : t("chat.send.unconfirmed")}
          <Show when={props.error}>{(error) => <span class="pending-send-error">{error()}</span>}</Show>
        </Show>
      </span>
      <Show when={failed()}>
        <Show when={props.retrySafe && !props.updateRequired}>
          <IconButton variant="ghost" size="icon-xs" label={t("common.retry")} onClick={() => props.onRetry()}>
            <RotateCcw aria-hidden="true" />
          </IconButton>
        </Show>
        <IconButton
          variant="ghost"
          size="icon-xs"
          label={t("chat.send.edit")}
          disabled={!props.canEdit}
          onClick={() => props.onEdit()}
        >
          <Pencil aria-hidden="true" />
        </IconButton>
        <IconButton variant="ghost" size="icon-xs" label={t("chat.send.dismiss")} onClick={() => props.onDismiss()}>
          <X aria-hidden="true" />
        </IconButton>
      </Show>
    </div>
  );
}
