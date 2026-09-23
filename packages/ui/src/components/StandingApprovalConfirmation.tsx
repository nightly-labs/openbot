import { ConfirmDialog } from "@openbot/ui";

/** Explains the same standing grant from the approval card and the model picker. */
export function StandingApprovalConfirmation(props: {
  open: boolean;
  agentName?: string;
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusTarget?: HTMLElement;
}) {
  return (
    <ConfirmDialog
      open={props.open}
      tone="default"
      initialFocus="cancel"
      title={`Always allow ${props.agentName ?? "this agent"}?`}
      description={`${props.agentName ?? "This agent"} will run commands, change files and widen its own filesystem and network access on this computer without asking again. Publishing, replacing and deleting public sites still require approval unless Turbo mode is on. You can turn off Auto approve in this agent's model menu.`}
      confirmLabel="Always allow"
      restoreFocusTarget={props.restoreFocusTarget}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}
