import type { JSX } from "@solidjs/web";
import { createSignal, Show } from "solid-js";
import { Alert, AlertContent, AlertDescription, AlertIcon } from "./alert";
import { Button } from "./button";
import { AlertDialog } from "./complex";
import { ShieldCheck, Trash2, TriangleAlert } from "./icons";

export type ConfirmDialogTone = "destructive" | "default";

export interface ConfirmDialogProps {
  open: boolean;
  /** Escape, an overlay click and Cancel call this. It is not called while the confirmation is pending. */
  onCancel: () => void;
  /**
   * A returned promise keeps the dialog pending until it settles. Handle a failure in the caller and
   * show it through `error`; the caller also closes the dialog on success.
   */
  onConfirm: () => void | Promise<void>;
  title: JSX.Element;
  description?: JSX.Element;
  /** Extra body below the description, such as a list of what the action removes. */
  children?: JSX.Element;
  /** Replaces the tone icon, for example with an agent avatar. */
  media?: JSX.Element;
  tone?: ConfirmDialogTone;
  confirmLabel: string;
  /** Replaces the confirm label while pending, such as "Deleting…". */
  pendingLabel?: string;
  cancelLabel?: string;
  /** Marks the dialog pending in addition to a pending `onConfirm` promise. */
  pending?: boolean;
  error?: JSX.Element;
  /** The button that gets focus when the dialog opens. */
  initialFocus?: "confirm" | "cancel";
  /** Gets focus when the dialog closes, when the element that opened it closes with it, such as a menu item. */
  restoreFocusTarget?: HTMLElement;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const [running, setRunning] = createSignal(false);
  const pending = () => Boolean(props.pending) || running();
  const tone = () => props.tone ?? "destructive";
  let confirmButton: HTMLButtonElement | undefined;
  let cancelButton: HTMLButtonElement | undefined;
  // A controlled dialog has no Kobalte trigger, so it keeps the element that opened it itself.
  let restoreTarget: HTMLElement | undefined;

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
        if (!open && !pending()) props.onCancel();
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
              const target = props.initialFocus === "cancel" ? cancelButton : confirmButton;
              target?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
              const target = props.restoreFocusTarget ?? restoreTarget;
              if (!target?.isConnected) return;
              event.preventDefault();
              target.focus({ preventScroll: true });
            }}
          >
            <div class="ui-confirm-dialog-main">
              <Show
                when={props.media}
                fallback={
                  <span class="ui-confirm-dialog-icon" aria-hidden="true">
                    {tone() === "destructive" ? <Trash2 /> : <ShieldCheck />}
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
                  <div class="ui-confirm-dialog-body">{props.children}</div>
                </Show>
                <Show when={props.error}>
                  <Alert tone="danger" role="alert" class="ui-confirm-dialog-error">
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
              <Button
                ref={(element: HTMLButtonElement) => {
                  cancelButton = element;
                }}
                variant="ghost"
                type="button"
                disabled={pending()}
                onClick={() => props.onCancel()}
              >
                {props.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                ref={(element: HTMLButtonElement) => {
                  confirmButton = element;
                }}
                variant={tone() === "destructive" ? "destructive" : "default"}
                type="button"
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
