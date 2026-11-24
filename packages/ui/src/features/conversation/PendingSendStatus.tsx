import { ErrorReference, IconButton, Pencil, RotateCcw, TriangleAlert, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

export interface PendingSendStatusProps {
  state: "waiting" | "sending" | "failed";
  error?: string | null;
  errorReference?: string | null;
  updateRequired?: boolean;
  retrySafe: boolean;
  canEdit: boolean;
  onRetry: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}

export function SteerUnreadStatus(): JSX.Element {
  const { t } = useText();
  return (
    <div class="pending-send-status">
      <span role="status">{t("chat.send.steerUnread")}</span>
    </div>
  );
}

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
          <ErrorReference reference={props.errorReference ?? null} />
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
