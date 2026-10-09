import { Button } from "@openbot/ui";
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
 * The delivery line under a message the host has not stored yet. The status text is a polite live
 * region, so a reader hears the message go from sending to failed without moving focus. A message
 * whose repeat the host cannot detect offers no Retry: the first send may have arrived.
 */
export function PendingSendStatus(props: PendingSendStatusProps): JSX.Element {
  const { t } = useText();
  const label = () => {
    if (props.state === "waiting") return t("chat.send.waiting");
    if (props.state === "sending") return t("chat.send.sending");
    return props.retrySafe ? t("chat.send.failed") : t("chat.send.unconfirmed");
  };
  return (
    <div class="pending-send-status" data-state={props.state}>
      <Show when={!props.updateRequired || props.state !== "failed"}>
        <span role="status" class="pending-send-label">
          {label()}
          <Show when={props.state === "failed" && props.error}>
            {(error) => <span class="pending-send-error">{error()}</span>}
          </Show>
        </span>
      </Show>
      <Show when={props.state === "failed"}>
        <Show when={props.retrySafe && !props.updateRequired}>
          <Button variant="ghost" size="xs" onClick={() => props.onRetry()}>
            {t("common.retry")}
          </Button>
        </Show>
        <Button variant="ghost" size="xs" disabled={!props.canEdit} onClick={() => props.onEdit()}>
          {t("chat.send.edit")}
        </Button>
        <Button variant="ghost" size="xs" onClick={() => props.onDismiss()}>
          {t("chat.send.dismiss")}
        </Button>
      </Show>
    </div>
  );
}
