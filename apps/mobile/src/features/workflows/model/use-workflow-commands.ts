import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMobileWorkspaceActions } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { currentText } from "@/shared/lib/text";

export function useWorkflowCommands(serverId: string) {
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const { toggleWorkflowPin, startWorkflowRun, runWorkflowStep, runWorkflowGitHubLastEvent } =
    useMobileWorkspaceActions();
  const started = async <T>(workflowId: string, start: () => Promise<T>): Promise<T | null> => {
    void haptics.impact("light");
    try {
      const result = await start();
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowList(queryScope, serverId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflow(queryScope, serverId, workflowId) });
      return result;
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      Alert.alert(
        text.t("mobile.workflow.alert.runFailedTitle"),
        text.errorMessage(error, text.t("mobile.workflow.alert.runFailedBody")),
      );
      return null;
    }
  };
  return {
    togglePin: (workflowId: string) => {
      void haptics.selection();
      toggleWorkflowPin(workflowId, serverId);
    },
    run: async (workflowId: string, fromNodeId?: string): Promise<string | null> =>
      (await started(workflowId, () => startWorkflowRun(workflowId, serverId, fromNodeId)))?.run.id ?? null,
    runStep: async (workflowId: string, nodeId: string): Promise<boolean> =>
      (await started(workflowId, () => runWorkflowStep({ workflowId, nodeId }, serverId))) !== null,
    runLastEvent: async (workflowId: string, nodeId: string): Promise<string | null> =>
      (await started(workflowId, () => runWorkflowGitHubLastEvent({ workflowId, nodeId }, serverId)))?.run.id ?? null,
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
    openVersions: (workflowId: string) =>
      router.push({ pathname: "/server-workflows/versions", params: { serverId, workflowId } }),
    openVersion: (workflowId: string, versionId: string) =>
      router.push({ pathname: "/server-workflows/version", params: { serverId, workflowId, versionId } }),
    openGitHubEvents: (workflowId: string) =>
      router.push({ pathname: "/server-workflows/github-events", params: { serverId, workflowId } }),
  };
}
