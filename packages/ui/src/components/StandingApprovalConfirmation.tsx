import { ConfirmDialog } from "@openbot/ui";
import { useText } from "@openbot/ui/text";

/** Explains the same standing grant from the approval card and the model picker. */
export function StandingApprovalConfirmation(props: {
  open: boolean;
  agentName?: string;
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusTarget?: HTMLElement;
}) {
  const { t } = useText();
  return (
    <ConfirmDialog
      open={props.open}
      tone="default"
      initialFocus="cancel"
      title={
        props.agentName === undefined
          ? t("app.standingApproval.titleUnnamed")
          : t("app.standingApproval.title", { name: props.agentName })
      }
      description={
        props.agentName === undefined
          ? t("app.standingApproval.descriptionUnnamed")
          : t("app.standingApproval.description", { name: props.agentName })
      }
      confirmLabel={t("prompt.approval.alwaysAllow")}
      restoreFocusTarget={props.restoreFocusTarget}
      onCancel={props.onCancel}
      onConfirm={props.onConfirm}
    />
  );
}
