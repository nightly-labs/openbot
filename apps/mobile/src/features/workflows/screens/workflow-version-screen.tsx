import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsSection } from "@/features/settings/components/settings-content";
import { workflowStepRows } from "@/features/workflows/components/workflow-steps-list";
import {
  useWorkflowDetail,
  useWorkflowVersionGraph,
  useWorkflowVersions,
} from "@/features/workflows/model/use-workflows";
import { VERSION_KIND_LABEL } from "@/features/workflows/model/workflow-steps";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

/**
 * Drawer > Workflows > a workflow > Version history > a version: its steps, read-only, and Make
 * current. The host keeps the workflow before the restore as a version, so a restore can be undone.
 */
export function WorkflowVersionScreen() {
  const { t, format, errorMessage } = useText();
  const { serverId, workflowId, versionId } = useLocalSearchParams<{
    serverId: string;
    workflowId: string;
    versionId: string;
  }>();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const detail = useWorkflowDetail(serverId, workflowId);
  const versions = useWorkflowVersions(serverId, workflowId);
  const graph = useWorkflowVersionGraph(serverId, workflowId, versionId);
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const serverAgents = agents.filter((agent) => agent.serverId === serverId);
  const { restoreWorkflowVersion } = useMobileWorkspaceActions();
  const [restoring, setRestoring] = useState(false);
  const version = versions.data?.find((candidate) => candidate.id === versionId);

  const restore = async () => {
    setRestoring(true);
    try {
      await restoreWorkflowVersion({ workflowId, versionId }, serverId);
      void haptics.notification("success");
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowList(queryScope, serverId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflow(queryScope, serverId, workflowId) });
      router.back();
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      Alert.alert(
        text.t("mobile.workflow.version.restoreFailed"),
        text.errorMessage(error, text.t("mobile.workflow.alert.tryAgain")),
      );
    } finally {
      setRestoring(false);
    }
  };
  const confirmRestore = () => {
    void haptics.notification("warning");
    Alert.alert(t("mobile.workflow.version.restoreTitle"), t("mobile.workflow.version.restoreBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("mobile.workflow.version.makeCurrent"), onPress: () => void restore() },
    ]);
  };

  return (
    <LargeTitleScrollView
      title={
        version
          ? t("mobile.workflow.version.title", {
              revision: version.revision,
              time: formatUpdatedAt(version.at, format),
            })
          : t("mobile.workflow.version.label")
      }
      caption={detail.data?.summary.title}
      contentContainerClassName="gap-7 px-4 pt-3"
    >
      {version ? (
        <Typography.Paragraph className="px-1 text-text-secondary" style={typeScale.preview}>
          {t(VERSION_KIND_LABEL[version.kind])}
        </Typography.Paragraph>
      ) : null}
      {graph.data ? (
        <>
          <Button className="bg-action" feedbackVariant="scale" isDisabled={restoring} onPress={confirmRestore}>
            <Button.Label className="text-action-foreground">
              {restoring ? t("mobile.workflow.version.restoring") : t("mobile.workflow.version.makeCurrent")}
            </Button.Label>
          </Button>
          <SettingsSection
            title={t("mobile.workflow.detail.stepsTitle")}
            footer={t("mobile.workflow.version.readOnly")}
          >
            {workflowStepRows(graph.data, serverAgents, t)}
          </SettingsSection>
        </>
      ) : (
        <Typography.Paragraph className="px-1 text-text-secondary" style={typeScale.preview}>
          {graph.isError
            ? errorMessage(graph.error, t("mobile.workflow.version.loadFailed"))
            : t("mobile.workflow.list.loading")}
        </Typography.Paragraph>
      )}
    </LargeTitleScrollView>
  );
}
