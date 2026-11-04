import type { WorkflowStep } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";

type WorkflowStepFailure =
  | "mobile.workflow.run.decideFailed"
  | "mobile.workflow.run.retryFailed"
  | "mobile.workflow.run.stopFailed"
  | "mobile.workflow.run.stopStepFailed";

/** Shows an error of an action on a step, in the language of the reader. */
function showStepFailure(error: unknown, title: WorkflowStepFailure) {
  void haptics.notification("error");
  const text = currentText();
  Alert.alert(text.t(title), text.errorMessage(error, text.t("mobile.workflow.alert.tryAgain")));
}

/**
 * The actions on the steps of a workflow's runs and on the steps that ran alone: decide, retry and
 * stop. One action goes at a time, and each one reads the workflow again.
 */
export function useWorkflowStepActions(serverId: string, workflowId: string) {
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const { decideWorkflowStep, retryWorkflowStep, stopWorkflowStep, stopWorkflowRun } = useMobileWorkspaceActions();
  const [busy, setBusy] = useState(false);
  const act = async (operation: () => Promise<unknown>, failure: WorkflowStepFailure) => {
    setBusy(true);
    try {
      await operation();
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflow(queryScope, serverId, workflowId) });
    } catch (cause) {
      showStepFailure(cause, failure);
    } finally {
      setBusy(false);
    }
  };
  return {
    busy,
    decide: (step: WorkflowStep, approved: boolean) =>
      void act(() => decideWorkflowStep({ stepId: step.id, approved }, serverId), "mobile.workflow.run.decideFailed"),
    retry: (step: WorkflowStep) =>
      void act(() => retryWorkflowStep(step.id, serverId), "mobile.workflow.run.retryFailed"),
    stop: (step: WorkflowStep) =>
      void act(() => stopWorkflowStep(step.id, serverId), "mobile.workflow.run.stopStepFailed"),
    stopRun: (runId: string) => void act(() => stopWorkflowRun(runId, serverId), "mobile.workflow.run.stopFailed"),
  };
}
