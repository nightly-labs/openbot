import type { WorkflowNode, WorkflowStep } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import Square from "lucide-react-native/icons/square";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { SettingsSection } from "@/features/settings/components/settings-content";
import { WorkflowKindTile } from "@/features/workflows/components/workflow-kind-tile";
import { useWorkflowDetail, useWorkflowRun } from "@/features/workflows/model/use-workflows";
import { formatRunDuration } from "@/features/workflows/model/workflow-duration";
import { readingOrder } from "@/features/workflows/model/workflow-outline";
import {
  isActiveRun,
  latestSteps,
  RUN_STATUS_LABEL,
  STEP_STATUS_LABEL,
  stepLabel,
  stepText,
  triggerType,
} from "@/features/workflows/model/workflow-steps";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const STATUS_CLASS: Record<WorkflowStep["status"], string> = {
  running: "text-accent-text",
  approval: "text-warning-text",
  done: "text-success-text",
  failed: "text-danger-text",
  stopped: "text-text-secondary",
  skipped: "text-text-secondary",
};

/** Shows an error of an action on a run, in the language of the reader. */
function showFailure(
  error: unknown,
  title: "mobile.workflow.run.decideFailed" | "mobile.workflow.run.retryFailed" | "mobile.workflow.run.stopFailed",
) {
  void haptics.notification("error");
  const text = currentText();
  Alert.alert(text.t(title), text.errorMessage(error, text.t("mobile.workflow.alert.tryAgain")));
}

function RunStepRow({
  node,
  step,
  agents,
  busy,
  onDecide,
  onRetry,
}: {
  node: WorkflowNode;
  step: WorkflowStep | undefined;
  agents: readonly MobileAgent[];
  busy: boolean;
  onDecide: (step: WorkflowStep, approved: boolean) => void;
  onRetry: (step: WorkflowStep) => void;
}) {
  const { t } = useText();
  const [open, setOpen] = useState(false);
  const status = step?.status;
  const output = step?.output?.trim() ? step.output : null;
  return (
    <View className={`flex-row gap-3 px-4 py-3 ${status === "skipped" || !status ? "opacity-60" : ""}`}>
      <WorkflowKindTile kind={node.kind} trigger={node.kind === "trigger" ? triggerType(node) : undefined} size={30} />
      <View className="min-w-0 flex-1 gap-1">
        <View className="flex-row items-center justify-between gap-2">
          <Typography.Paragraph
            className="min-w-0 shrink text-text-secondary"
            numberOfLines={1}
            style={typeScale.small}
          >
            {stepLabel(node, agents, t)}
          </Typography.Paragraph>
          <Typography.Paragraph
            className={status ? STATUS_CLASS[status] : "text-text-secondary"}
            style={typeScale.small}
          >
            {status ? t(STEP_STATUS_LABEL[status]) : t("mobile.workflow.status.notRun")}
          </Typography.Paragraph>
        </View>
        <Typography.Paragraph style={typeScale.preview}>{stepText(node, t)}</Typography.Paragraph>
        {step?.branch ? (
          <Typography.Paragraph className="text-warning-text" style={typeScale.caption}>
            {t(step.branch === "yes" ? "mobile.workflow.run.answerYes" : "mobile.workflow.run.answerNo")}
          </Typography.Paragraph>
        ) : null}
        {step?.error ? (
          <Typography.Paragraph className="text-danger-text" style={typeScale.caption}>
            {step.error}
          </Typography.Paragraph>
        ) : null}
        {output ? (
          <View className="gap-1.5">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              className="self-start py-0.5"
              onPress={() => {
                void haptics.selection();
                setOpen((current) => !current);
              }}
            >
              <Typography.Paragraph className="font-medium text-accent-text" style={typeScale.caption}>
                {open ? t("mobile.workflow.run.hideOutput") : t("mobile.workflow.run.showOutput")}
              </Typography.Paragraph>
            </Pressable>
            {open ? (
              <View className="rounded-xl bg-control px-3 py-2.5">
                <Typography.Paragraph selectable className="text-text-secondary" style={typeScale.preview}>
                  {output}
                </Typography.Paragraph>
              </View>
            ) : null}
          </View>
        ) : null}
        {step && status === "approval" ? (
          <View className="mt-1 gap-3 rounded-2xl bg-control p-3">
            <Typography.Paragraph className="font-semibold" style={typeScale.body}>
              {stepText(node, t)}
            </Typography.Paragraph>
            <View className="flex-row gap-2">
              <Button className="flex-1" variant="tertiary" isDisabled={busy} onPress={() => onDecide(step, false)}>
                <Button.Label>{t("mobile.workflow.run.decline")}</Button.Label>
              </Button>
              <Button
                className="flex-1 bg-action"
                feedbackVariant="scale"
                isDisabled={busy}
                onPress={() => onDecide(step, true)}
              >
                <Button.Label className="text-action-foreground">{t("mobile.workflow.run.approve")}</Button.Label>
              </Button>
            </View>
          </View>
        ) : null}
        {step && status === "failed" ? (
          <Button
            size="sm"
            variant="tertiary"
            className="mt-1 self-start"
            isDisabled={busy}
            onPress={() => onRetry(step)}
          >
            <Button.Label>{t("mobile.workflow.run.retry")}</Button.Label>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Drawer > Workflows > a workflow > a run: each step with its status and output. The person approves
 * or declines a step that waits, retries a step that failed, and stops a run that goes on.
 */
export function WorkflowRunScreen() {
  const { t, format, errorMessage } = useText();
  const { serverId, workflowId, runId } = useLocalSearchParams<{
    serverId: string;
    workflowId: string;
    runId?: string;
  }>();
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const detail = useWorkflowDetail(serverId, workflowId);
  const { run: runDetail, loading, error } = useWorkflowRun(serverId, workflowId, runId);
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const serverAgents = agents.filter((agent) => agent.serverId === serverId);
  const { decideWorkflowStep, retryWorkflowStep, stopWorkflowRun } = useMobileWorkspaceActions();
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.workflow(queryScope, serverId, workflowId) });
  const act = async (operation: () => Promise<unknown>, failure: Parameters<typeof showFailure>[1]) => {
    setBusy(true);
    try {
      await operation();
      refresh();
    } catch (cause) {
      showFailure(cause, failure);
    } finally {
      setBusy(false);
    }
  };

  const run = runDetail?.run;
  const title = run ? t("mobile.workflow.run.title", { number: run.number }) : t("mobile.app.route.workflowRun");
  const latest = latestSteps(runDetail?.steps ?? []);
  const graph = detail.data?.graph;
  // The steps of the graph in reading order, then any step whose node the workflow no longer has.
  const nodes = graph ? readingOrder(graph) : [];
  const known = new Set(nodes.map((node) => node.id));
  const canStop = run ? isActiveRun(run.status) && run.status !== "stopping" : false;
  const stop = () => {
    if (!run) return;
    void haptics.notification("warning");
    Alert.alert(t("mobile.workflow.run.stopTitle"), t("mobile.workflow.run.stopBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.workflow.run.stop"),
        style: "destructive",
        onPress: () => void act(() => stopWorkflowRun(run.id, serverId), "mobile.workflow.run.stopFailed"),
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
            <SettingsSection title={t("mobile.workflow.detail.stepsTitle")}>
              {nodes.map((node) => (
                <RunStepRow
                  key={node.id}
                  node={node}
                  step={latest.get(node.id)}
                  agents={serverAgents}
                  busy={busy}
                  onDecide={(step, approved) =>
                    void act(
                      () => decideWorkflowStep({ stepId: step.id, approved }, serverId),
                      "mobile.workflow.run.decideFailed",
                    )
                  }
                  onRetry={(step) =>
                    void act(() => retryWorkflowStep(step.id, serverId), "mobile.workflow.run.retryFailed")
                  }
                />
              ))}
              {[...latest.values()]
                .filter((step) => !known.has(step.nodeId))
                .map((step) => (
                  <View key={step.id} className="px-4 py-3">
                    <Typography.Paragraph className="text-text-secondary" style={typeScale.caption}>
                      {t("mobile.workflow.run.removedStep", { status: t(STEP_STATUS_LABEL[step.status]) })}
                    </Typography.Paragraph>
                  </View>
                ))}
            </SettingsSection>
          </>
        )}
      </LargeTitleScrollView>
    </>
  );
}
