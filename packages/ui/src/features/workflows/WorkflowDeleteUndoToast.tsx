import { Button, Progress, toast, Workflow } from "@openbot/ui";
import { currentText } from "../../text";
import { startUndoCountdown, type UndoCountdown } from "../agents/AgentDeleteUndoToast";

function WorkflowDeleteUndoToast(props: { name: string; countdown: UndoCountdown; onUndo: () => void }) {
  const { t } = currentText();
  return (
    <div
      class="agent-delete-undo-toast"
      onPointerEnter={() => props.countdown.hold("pointer", true)}
      onPointerLeave={() => props.countdown.hold("pointer", false)}
      onFocusIn={() => props.countdown.hold("focus", true)}
      onFocusOut={(event) => {
        if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)))
          props.countdown.hold("focus", false);
      }}
    >
      <span class="wfn-undo-toast-tile" aria-hidden="true">
        <Workflow class="wfn-undo-toast-icon" />
      </span>
      <div class="agent-delete-undo-toast-text">
        <strong class="agent-delete-undo-toast-title">
          {t("workflow.canvas.deleteUndo.title", { name: props.name })}
        </strong>
      </div>
      <div class="ui-toast-card-actions agent-delete-undo-toast-actions">
        <Button type="button" variant="default" size="sm" onClick={() => props.onUndo()}>
          {t("workflow.canvas.deleteUndo.action")}
        </Button>
      </div>
      <Progress
        value={props.countdown.left() * 100}
        minValue={0}
        maxValue={100}
        class="agent-delete-undo-toast-bar"
        aria-hidden="true"
      />
    </div>
  );
}

let deleteToasts = 0;

export function showWorkflowDeleteToast(title: string, handlers: { onUndo: () => void; onKeep: () => void }) {
  deleteToasts += 1;
  const id = `workflow-delete-${deleteToasts}`;
  let settled = false;
  const settle = (then: () => void) => {
    if (settled) return;
    settled = true;
    countdown.stop();
    queueMicrotask(() => {
      toast.dismiss(id);
      then();
    });
  };
  const keep = () => settle(handlers.onKeep);
  const countdown = startUndoCountdown(keep);
  toast(() => <WorkflowDeleteUndoToast name={title} countdown={countdown} onUndo={() => settle(handlers.onUndo)} />, {
    id,
    duration: Number.POSITIVE_INFINITY,
    unstyled: true,
    closeButton: false,
    class: "agent-delete-undo-toast-host",
  });
  return keep;
}
