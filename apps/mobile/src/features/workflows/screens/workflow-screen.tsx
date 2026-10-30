import * as Clipboard from "expo-clipboard";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import Pin from "lucide-react-native/icons/pin";
import PinOff from "lucide-react-native/icons/pin-off";
import { useState } from "react";
import { Alert, View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { WorkflowRunRow } from "@/features/workflows/components/workflow-run-row";
import { workflowStepRows } from "@/features/workflows/components/workflow-steps-list";
import { useWorkflowCommands } from "@/features/workflows/model/use-workflow-commands";
import { useWorkflowDetail, useWorkflowRuns } from "@/features/workflows/model/use-workflows";
import { workflowOutline } from "@/features/workflows/model/workflow-outline";
import { stepLabel } from "@/features/workflows/model/workflow-steps";
import {
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { currentText, useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const NO_IDS: readonly string[] = [];
/** The workflow page shows the newest runs; the Runs page shows them all. */
const LATEST_RUNS = 3;

/**
 * Drawer > Workflows > one workflow: run it, edit it, pin it to the drawer, and read its steps,
 * its trigger and its newest runs.
 */
export function WorkflowScreen() {
  const { t, format, errorMessage } = useText();
  const { serverId, workflowId } = useLocalSearchParams<{ serverId: string; workflowId: string }>();
  const detail = useWorkflowDetail(serverId, workflowId);
  const runs = useWorkflowRuns(serverId, workflowId);
  const agents = useMobileWorkspaceSelector((current) => current.agents);
  const serverAgents = agents.filter((agent) => agent.serverId === serverId);
  const pinned = useMobileWorkspaceSelector((current) => current.pinnedWorkflowIds[serverId] ?? NO_IDS).includes(
    workflowId,
  );
  const { deleteWorkflow } = useMobileWorkspaceActions();
  const commands = useWorkflowCommands(serverId);
  const [starting, setStarting] = useState(false);
  const workflow = detail.data;
  const title = workflow?.summary.title ?? t("mobile.app.route.workflow");
  const runList = runs.data?.runs ?? [];
  const latest = runList[0];
  const moreRuns = runList.length > LATEST_RUNS || Boolean(runs.data?.nextBefore);
  const trigger = workflow?.graph.nodes.find((node) => node.kind === "trigger");
  const triggerState = workflow?.triggers.find((state) => state.nodeId === trigger?.id);

  const runNow = async () => {
    setStarting(true);
    const runId = await commands.run(workflowId);
    setStarting(false);
    if (runId) commands.openRun(workflowId, runId);
  };
  const confirmDelete = () => {
    void haptics.notification("warning");
    Alert.alert(t("mobile.workflow.delete.title", { name: title }), t("mobile.workflow.delete.body"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("mobile.workflow.delete.confirm"),
        style: "destructive",
        onPress: () =>
          void deleteWorkflow(workflowId, serverId).then(
            () => router.back(),
            (error: unknown) => {
              const text = currentText();
              Alert.alert(
                text.t("mobile.workflow.delete.failed"),
                text.errorMessage(error, text.t("mobile.workflow.alert.tryAgain")),
              );
            },
          ),
      },
    ]);
  };

  const PinIcon = pinned ? PinOff : Pin;
  const pinLabel = pinned ? t("mobile.workflow.action.unpin") : t("mobile.workflow.action.pin");
  return (
    <>
      {workflow ? (
        isAndroid ? (
          <AndroidHeaderButton
            placement="right"
            glass
            icon={PinIcon}
            accessibilityLabel={pinLabel}
            onPress={() => commands.togglePin(workflowId)}
          />
        ) : (
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon={pinned ? "pin.slash" : "pin"}
              accessibilityLabel={pinLabel}
              onPress={() => commands.togglePin(workflowId)}
            />
          </Stack.Toolbar>
        )
      ) : null}
      <LargeTitleScrollView
        title={title}
        caption={workflow ? t("mobile.workflow.detail.steps", { count: workflow.summary.steps }) : undefined}
        contentContainerClassName="gap-7 px-4 pt-3"
      >
        {!workflow ? (
          <Typography.Paragraph className="px-1 text-text-secondary" style={typeScale.preview}>
            {detail.isError
              ? errorMessage(detail.error, t("mobile.workflow.detail.loadFailed"))
              : t("mobile.workflow.list.loading")}
          </Typography.Paragraph>
        ) : (
          <>
            <View className="flex-row gap-2">
              <Button
                className="flex-1 bg-action"
                feedbackVariant="scale"
                isDisabled={starting}
                onPress={() => void runNow()}
              >
                <Button.Label className="text-action-foreground">
                  {starting ? t("mobile.workflow.detail.starting") : t("mobile.workflow.action.run")}
                </Button.Label>
              </Button>
              {workflow.needsNewerApp ? null : (
                <Button className="flex-1" variant="tertiary" onPress={() => commands.edit(workflowId)}>
                  <Button.Label>{t("mobile.workflow.action.edit")}</Button.Label>
                </Button>
              )}
            </View>
            {workflow.needsNewerApp ? (
              <Typography.Paragraph className="px-1 text-text-secondary" style={typeScale.caption}>
                {t("mobile.workflow.detail.newerApp")}
              </Typography.Paragraph>
            ) : null}
            {latest?.run.status === "approval" ? (
              <SettingsSection>
                <SettingsRow onPress={() => commands.openRun(workflowId, latest.run.id)}>
                  <Typography.Paragraph className="font-medium text-warning-text">
                    {t("mobile.workflow.detail.waits", { number: latest.run.number })}
                  </Typography.Paragraph>
                </SettingsRow>
              </SettingsSection>
            ) : null}
            <SettingsSection
              title={t("mobile.workflow.detail.stepsTitle")}
              footer={workflowOutline(workflow.graph) ? undefined : t("mobile.workflow.detail.canvasOrder")}
            >
              {workflowStepRows(workflow.graph, serverAgents, t)}
            </SettingsSection>
            {trigger ? (
              <SettingsSection title={t("mobile.workflow.detail.trigger")}>
                <SettingsRow
                  disclosure={false}
                  supportingText={
                    triggerState?.nextDueAt
                      ? t("mobile.workflow.detail.nextRun", {
                          time: format.date(new Date(triggerState.nextDueAt), {
                            weekday: "short",
                            hour: "numeric",
                            minute: "2-digit",
                          }),
                        })
                      : undefined
                  }
                >
                  <Typography.Paragraph>{stepLabel(trigger, serverAgents, t)}</Typography.Paragraph>
                </SettingsRow>
                {triggerState?.webhookUrl ? (
                  <SettingsRow
                    supportingText={triggerState.webhookUrl}
                    onPress={() => {
                      const url = triggerState.webhookUrl;
                      if (!url) return;
                      void Clipboard.setStringAsync(url).then(() => haptics.notification("success"));
                    }}
                    accessibilityLabel={t("mobile.workflow.detail.copyWebhook")}
                  >
                    <Typography.Paragraph>{t("mobile.workflow.detail.copyWebhook")}</Typography.Paragraph>
                  </SettingsRow>
                ) : null}
              </SettingsSection>
            ) : null}
            <SettingsSection title={t("mobile.workflow.detail.runs")}>
              {runList.length > 0 ? (
                runList
                  .slice(0, LATEST_RUNS)
                  .map((item) => (
                    <WorkflowRunRow
                      key={item.run.id}
                      detail={item}
                      onPress={() => commands.openRun(workflowId, item.run.id)}
                    />
                  ))
              ) : (
                <SettingsRow disclosure={false}>
                  <Typography.Paragraph className="text-text-secondary">
                    {runs.isError
                      ? errorMessage(runs.error, t("mobile.workflow.detail.runsFailed"))
                      : runs.data
                        ? t("mobile.workflow.detail.noRuns")
                        : t("mobile.workflow.list.loading")}
                  </Typography.Paragraph>
                </SettingsRow>
              )}
              {moreRuns ? (
                <SettingsRow onPress={() => commands.openRuns(workflowId)}>
                  <Typography.Paragraph>{t("mobile.workflow.detail.allRuns")}</Typography.Paragraph>
                </SettingsRow>
              ) : null}
            </SettingsSection>
            <SettingsSection
              footer={t("mobile.workflow.detail.revision", {
                revision: workflow.revision,
                time: formatUpdatedAt(workflow.summary.updatedAt, format),
              })}
            >
              <SettingsRow disclosure={false} onPress={confirmDelete}>
                <Typography.Paragraph className="text-danger-text">
                  {t("mobile.workflow.delete.confirm")}
                </Typography.Paragraph>
              </SettingsRow>
            </SettingsSection>
          </>
        )}
      </LargeTitleScrollView>
    </>
  );
}
