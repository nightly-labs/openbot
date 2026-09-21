import { AlertDialog, Button } from "./ui";

/** Explains the same standing grant from the approval card and the model picker. */
export function StandingApprovalConfirmation(props: {
  open: boolean;
  agentName?: string;
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusTarget?: HTMLElement;
}) {
  let cancelButton: HTMLButtonElement | undefined;
  return (
    <AlertDialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay class="approval-confirm-backdrop">
          <AlertDialog.Content
            class="approval-confirm-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              cancelButton?.focus({ preventScroll: true });
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              props.restoreFocusTarget?.focus({ preventScroll: true });
            }}
          >
            <AlertDialog.Title>Always allow {props.agentName ?? "this agent"}?</AlertDialog.Title>
            <AlertDialog.Description>
              {props.agentName ?? "This agent"} will run commands, change files and widen its own filesystem and network
              access on this computer without asking again. This also allows publishing, updating and deleting public
              sites. You can turn off Auto approve in this agent's model menu.
            </AlertDialog.Description>
            <div class="approval-confirm-actions">
              <Button ref={cancelButton} variant="outline" type="button" onClick={props.onCancel}>
                Cancel
              </Button>
              <Button variant="default" type="button" onClick={props.onConfirm}>
                Always allow
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Overlay>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
