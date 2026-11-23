import type { WorkflowStep } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
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

export function showWorkflowFailure(error: unknown, title: MobileTextKey) {
  void haptics.notification("error");
  const text = currentText();
  Alert.alert(text.t(title), text.errorMessage(error, text.t("mobile.workflow.alert.tryAgain")));
}

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
      showWorkflowFailure(cause, failure);
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
