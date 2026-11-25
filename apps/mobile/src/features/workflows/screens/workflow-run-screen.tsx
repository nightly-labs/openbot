import type { WorkflowStep } from "@openbot/contracts/ipc";
import { Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Square from "lucide-react-native/icons/square";
import { useMemo, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { WorkflowFlowView } from "@/features/workflows/components/workflow-flow-view";
import { WorkflowRunStepRow } from "@/features/workflows/components/workflow-run-step-row";
import { FlowRowNote } from "@/features/workflows/components/workflow-steps-list";
import { useWorkflowStepActions } from "@/features/workflows/model/use-workflow-step-actions";
import { useWorkflowDetail, useWorkflowGitHubHistory, useWorkflowRun } from "@/features/workflows/model/use-workflows";
import { formatRunDuration } from "@/features/workflows/model/workflow-duration";
import { useWorkflowEditorView } from "@/features/workflows/model/workflow-editor-view";
import { flowRows, workflowFlowTree } from "@/features/workflows/model/workflow-flow-tree";
import { githubItemLabel, githubItemUrl } from "@/features/workflows/model/workflow-github";
import {
  isActiveRun,
  latestSteps,
  RUN_STATUS_LABEL,
  STEP_STATUS_LABEL,
  stepLabel,
} from "@/features/workflows/model/workflow-steps";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export function WorkflowRunScreen() {
  const { t, format, errorMessage } = useText();
  const { serverId, workflowId, runId } = useLocalSearchParams<{
    serverId: string;
    workflowId: string;
    runId?: string;
  }>();
  const detail = useWorkflowDetail(serverId, workflowId);
  const { run: runDetail, loading, error } = useWorkflowRun(serverId, workflowId, runId);
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const serverAgents = agents.filter((agent) => agent.serverId === serverId);
  const steps = useWorkflowStepActions(serverId, workflowId);
  const github = useWorkflowGitHubHistory(serverId, workflowId, runDetail?.run.source === "github");
  const busy = steps.busy;

  const run = runDetail?.run;
  const githubItem = run ? github.data?.runs.find((entry) => entry.runId === run.id)?.item : undefined;
  const title = run ? t("mobile.workflow.run.title", { number: run.number }) : t("mobile.app.route.workflowRun");
  const latest = latestSteps(runDetail?.steps ?? []);
  const graph = detail.data?.graph;
  const rows = useMemo(() => (graph ? flowRows(workflowFlowTree(graph)) : []), [graph]);
  const byId = new Map(graph?.nodes.map((node) => [node.id, node]) ?? []);
  const known = new Set(rows.flatMap((row) => (row.type === "step" ? [row.id] : [])));
  const labelOf = (id: string) => {
    const node = byId.get(id);
    return node ? stepLabel(node, serverAgents, t) : "";
  };
  const view = useWorkflowEditorView((state) => state.view);
  const [chosen, setChosen] = useState<string | null>(null);
  const runOrder = rows.flatMap((row) => (row.type === "step" ? [row.id] : []));
  const attention = (status: WorkflowStep["status"]) =>
    runOrder.find((id) => latest.get(id)?.status === status) ?? null;
  const selectedId = chosen ?? attention("approval") ?? attention("failed") ?? attention("running");
  const selectedNode = selectedId ? byId.get(selectedId) : undefined;
  const removed = [...latest.values()].filter((step) => !known.has(step.nodeId));
  const canStop = run ? isActiveRun(run.status) && run.status !== "stopping" : false;
  const stop = () => {
    if (!run) return;
    void haptics.notification("warning");
    Alert.alert(t("mobile.workflow.run.stopTitle"), t("mobile.workflow.run.stopBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.workflow.run.stop"),
        style: "destructive",
        onPress: () => steps.stopRun(run.id),
      },
    ]);
  };

  return (
    <>
      {isAndroid ? (
        <AndroidHeaderButton
          placement="right"
          glass
          icon={Square}
          accessibilityLabel={t("mobile.workflow.run.stop")}
          hidden={!canStop}
          disabled={busy}
          onPress={stop}
        />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="stop.circle"
            accessibilityLabel={t("mobile.workflow.run.stop")}
            hidden={!canStop}
            disabled={busy}
            onPress={stop}
          />
        </Stack.Toolbar>
      )}
      <LargeTitleScrollView
        title={title}
        caption={detail.data?.summary.title}
        contentContainerClassName="gap-7 px-4 pt-3"
      >
        {!run ? (
          <Typography.Paragraph className="px-1 text-text-secondary" style={typeScale.preview}>
            {error && !loading
              ? errorMessage(error, t("mobile.workflow.run.loadFailed"))
              : loading
                ? t("mobile.workflow.list.loading")
                : t("mobile.workflow.run.none")}
          </Typography.Paragraph>
        ) : (
          <>
            <View className="gap-1 px-1">
              <Typography.Paragraph
                className={
                  run.status === "failed"
                    ? "text-danger-text"
                    : run.status === "approval"
                      ? "text-warning-text"
                      : "text-text-secondary"
                }
                style={typeScale.preview}
              >
                {[
                  t(RUN_STATUS_LABEL[run.status]),
                  formatUpdatedAt(run.startedAt, format),
                  formatRunDuration(run.startedAt, run.endedAt, t),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Typography.Paragraph>
              {run.error ? (
                <Typography.Paragraph className="text-danger-text" style={typeScale.caption}>
                  {run.error}
                </Typography.Paragraph>
              ) : null}
            </View>
            {githubItem ? (
              <SettingsSection title={t("mobile.workflow.github.runItem")}>
                <SettingsRow
                  supportingText={githubItem.repository}
                  accessibilityLabel={t("mobile.workflow.github.openItem", { number: githubItem.number })}
                  onPress={() => void Linking.openURL(githubItemUrl(githubItem)).catch(() => undefined)}
                >
                  <Typography.Paragraph numberOfLines={2}>{githubItemLabel(githubItem)}</Typography.Paragraph>
                </SettingsRow>
              </SettingsSection>
            ) : null}
            {view === "flow" && graph ? (
              <>
                <View className="gap-2">
                  <Typography type="body-xs" className="px-4 text-grouped-secondary">
                    {t("mobile.workflow.detail.stepsTitle")}
                  </Typography>
                  <WorkflowFlowView
                    serverId={serverId}
                    graph={graph}
                    agents={serverAgents}
                    run={{
                      steps: latest,
                      selectedId,
                      onSelect: (node) => {
                        void haptics.selection();
                        setChosen(node.id);
                      },
                    }}
                  />
                </View>
                {selectedNode ? (
                  <SettingsSection title={labelOf(selectedNode.id)}>
                    <WorkflowRunStepRow
                      node={selectedNode}
                      step={latest.get(selectedNode.id)}
                      agents={serverAgents}
                      busy={busy}
                      onDecide={steps.decide}
                      onRetry={steps.retry}
                      onStop={steps.stop}
                    />
                  </SettingsSection>
                ) : (
                  <Typography.Paragraph className="px-4 text-grouped-secondary" style={typeScale.caption}>
                    {t("mobile.workflow.run.selectHint")}
                  </Typography.Paragraph>
                )}
              </>
            ) : null}
            {view !== "flow" || removed.length > 0 ? (
              <SettingsSection title={view === "flow" ? undefined : t("mobile.workflow.detail.stepsTitle")}>
                {view === "flow"
                  ? null
                  : rows.map((row) => {
                      if (row.type !== "step")
                        return (
                          <FlowRowNote key={row.type === "loose" ? "loose" : row.key} row={row} labelOf={labelOf} />
                        );
                      const node = byId.get(row.id);
                      return node ? (
                        <WorkflowRunStepRow
                          key={node.id}
                          node={node}
                          step={latest.get(node.id)}
                          agents={serverAgents}
                          busy={busy}
                          onDecide={steps.decide}
                          onRetry={steps.retry}
                          onStop={steps.stop}
                          depth={row.depth}
                        />
                      ) : null;
                    })}
                {removed.map((step) => (
                  <View key={step.id} className="px-4 py-3">
                    <Typography.Paragraph className="text-text-secondary" style={typeScale.caption}>
                      {t("mobile.workflow.run.removedStep", { status: t(STEP_STATUS_LABEL[step.status]) })}
                    </Typography.Paragraph>
                  </View>
                ))}
              </SettingsSection>
            ) : null}
          </>
        )}
      </LargeTitleScrollView>
    </>
  );
}
