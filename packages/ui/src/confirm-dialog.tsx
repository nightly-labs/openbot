import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import { Alert, AlertContent, AlertDescription, AlertIcon } from "./alert";
import { Button } from "./button";
import { AlertDialog } from "./complex";
import { ShieldCheck, Trash2, TriangleAlert } from "./icons";
import { useText } from "./text";

export type ConfirmDialogTone = "destructive" | "default";

export interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  dismissWhilePending?: boolean;
  hideCancel?: boolean;
  onConfirm: () => void | Promise<void>;
  title: JSX.Element;
  description?: JSX.Element;
  children?: JSX.Element;
  media?: JSX.Element;
  icon?: JSX.Element;
  tone?: ConfirmDialogTone;
  confirmLabel: JSX.Element;
  pendingLabel?: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: JSX.Element;
  initialFocus?: "confirm" | "cancel" | "field";
  confirmRef?: (element: HTMLButtonElement) => void;
  restoreFocusTarget?: HTMLElement | null | undefined;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const { t } = useText();
  const [running, setRunning] = createSignal(false);
  const pending = () => Boolean(props.pending) || running();
  const tone = () => props.tone ?? "destructive";
  const cancelDisabled = () => pending() && !props.dismissWhilePending;
  let confirmButton: HTMLButtonElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;
  let body: HTMLDivElement | undefined;
  let restoreTarget: HTMLElement | undefined;
  let restoreFrame: number | undefined;
  onSettled(() => () => {
    if (restoreFrame !== undefined) cancelAnimationFrame(restoreFrame);
  });

  async function confirm(): Promise<void> {
    if (pending()) return;
    const result = props.onConfirm();
    if (!result) return;
    setRunning(true);
    try {
      await result;
    } finally {
      setRunning(false);
    }
  }

  return (
    <AlertDialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open && !cancelDisabled()) props.onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay class="ui-confirm-dialog-overlay">
          <AlertDialog.Content
            class="ui-confirm-dialog"
            data-tone={tone()}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              const opener = document.activeElement;
              restoreTarget = opener instanceof HTMLElement && opener !== document.body ? opener : undefined;
              const field = props.initialFocus === "field" ? body?.querySelector<HTMLElement>("input, textarea") : null;
              const target =
                field ?? (props.initialFocus === "cancel" && !props.hideCancel ? cancelButton : confirmButton);
              target?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
              const target = props.restoreFocusTarget ?? restoreTarget;
              if (!target?.isConnected) return;
              event.preventDefault();
              target.focus({ preventScroll: true });
              restoreFrame = requestAnimationFrame(() => {
                restoreFrame = requestAnimationFrame(() => {
                  if (!props.open && target.isConnected) target.focus({ preventScroll: true });
                });
              });
            }}
          >
            <div class="ui-confirm-dialog-main">
              <Show
                when={props.media}
                fallback={
                  <span class="ui-confirm-dialog-icon" aria-hidden="true">
                    {props.icon ?? (tone() === "destructive" ? <Trash2 /> : <ShieldCheck />)}
                  </span>
                }
              >
                <div class="ui-confirm-dialog-media">{props.media}</div>
              </Show>
              <div class="ui-confirm-dialog-content">
                <AlertDialog.Title as="h2" class="ui-confirm-dialog-title">
                  {props.title}
                </AlertDialog.Title>
                <Show when={props.description}>
                  <AlertDialog.Description class="ui-confirm-dialog-description">
                    {props.description}
                  </AlertDialog.Description>
                </Show>
                <Show when={props.children}>
                  <div ref={body} class="ui-confirm-dialog-body">
                    {props.children}
                  </div>
                </Show>
                <Show when={props.error}>
                  <Alert tone="danger" report={false} role="alert" class="ui-confirm-dialog-error">
                    <AlertIcon>
                      <TriangleAlert />
                    </AlertIcon>
                    <AlertContent>
                      <AlertDescription>{props.error}</AlertDescription>
                    </AlertContent>
                  </Alert>
                </Show>
              </div>
            </div>
            <footer class="ui-confirm-dialog-actions">
              <Show when={!props.hideCancel}>
                <Button
                  ref={(element: HTMLButtonElement) => {
                    cancelButton = element;
                  }}
                  variant="ghost"
                  type="button"
                  data-cuelume-tap="close"
                  disabled={cancelDisabled()}
                  onClick={() => props.onCancel()}
                >
                  {props.cancelLabel ?? t("common.cancel")}
                </Button>
              </Show>
              <Button
                ref={(element: HTMLButtonElement) => {
                  confirmButton = element;
                  props.confirmRef?.(element);
                }}
                variant={tone() === "destructive" ? "destructive" : "default"}
                type="button"
                data-cuelume-tap={tone() === "destructive" ? "close" : ""}
                data-cuelume-emphasis={tone() === "destructive" ? "strong" : undefined}
                class="ui-confirm-dialog-confirm"
                loading={pending()}
                loadingLabel={props.pendingLabel}
                onClick={() => void confirm()}
              >
                <Show when={tone() === "destructive"}>
                  <Trash2 aria-hidden="true" />
                </Show>
                {props.confirmLabel}
              </Button>
            </footer>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
