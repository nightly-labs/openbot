import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";

/** Pin, run and edit, as the list, the workflow page and the drawer offer them. */
export function useWorkflowCommands(serverId: string) {
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const { toggleWorkflowPin, startWorkflowRun } = useMobileWorkspaceActions();
  return {
    togglePin: (workflowId: string) => {
      void haptics.selection();
      toggleWorkflowPin(workflowId, serverId);
    },
    /** Starts a run of the whole workflow and answers the run id, or null when the host refused it. */
    run: async (workflowId: string): Promise<string | null> => {
      void haptics.impact("light");
      try {
        const started = await startWorkflowRun(workflowId, serverId);
        void queryClient.invalidateQueries({ queryKey: queryKeys.workflowList(queryScope, serverId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.workflow(queryScope, serverId, workflowId) });
        return started.run.id;
      } catch (error) {
        void haptics.notification("error");
        const text = currentText();
        Alert.alert(
          text.t("mobile.workflow.alert.runFailedTitle"),
          text.errorMessage(error, text.t("mobile.workflow.alert.runFailedBody")),
        );
        return null;
      }
    },
    edit: (workflowId: string) => {
      void haptics.impact("soft");
      router.push({ pathname: "/workflow-editor", params: { serverId, workflowId } });
    },
    create: () => {
      void haptics.impact("soft");
      router.push({ pathname: "/workflow-editor", params: { serverId } });
    },
    open: (workflowId: string) =>
      router.push({ pathname: "/server-workflows/workflow", params: { serverId, workflowId } }),
    openRuns: (workflowId: string) =>
      router.push({ pathname: "/server-workflows/runs", params: { serverId, workflowId } }),
    openRun: (workflowId: string, runId?: string) =>
      router.push({
        pathname: "/server-workflows/run",
        params: runId ? { serverId, workflowId, runId } : { serverId, workflowId },
      }),
  };
}
