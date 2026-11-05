import type { WorkflowGitHubDeliveryOutcome } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { WorkflowGitHubEventRow } from "@/features/workflows/components/workflow-github-event-row";
import { useWorkflowCommands } from "@/features/workflows/model/use-workflow-commands";
import { useWorkflowDetail, useWorkflowGitHubHistory, useWorkflowRuns } from "@/features/workflows/model/use-workflows";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { useText } from "@/shared/lib/text";

const GROUPS = [
  { outcome: "waiting", title: "mobile.workflow.github.history.waitingGroup" },
  { outcome: "started", title: "mobile.workflow.github.history.startedGroup" },
  { outcome: "skipped", title: "mobile.workflow.github.history.skippedGroup" },
] as const satisfies readonly { outcome: WorkflowGitHubDeliveryOutcome; title: MobileTextKey }[];

/**
 * Drawer > Workflows > a workflow > GitHub events: the newest events that GitHub sent to the triggers
 * of the workflow, in the groups of the desktop Events menu: waiting, started and skipped.
 */
export function WorkflowGitHubEventsScreen() {
  const { t, errorMessage } = useText();
  const { serverId, workflowId } = useLocalSearchParams<{ serverId: string; workflowId: string }>();
  const detail = useWorkflowDetail(serverId, workflowId);
  const history = useWorkflowGitHubHistory(serverId, workflowId);
  const runs = useWorkflowRuns(serverId, workflowId);
  const commands = useWorkflowCommands(serverId);
  const data = history.data;
  const runList = runs.data?.runs.map((entry) => entry.run) ?? [];
  const groups = data
    ? GROUPS.map((group) => ({
        ...group,
        deliveries: data.deliveries.filter((delivery) => delivery.outcome === group.outcome),
      })).filter((group) => group.deliveries.length > 0)
    : [];
  return (
    <LargeTitleScrollView
      title={t("mobile.workflow.github.history.title")}
      caption={detail.data?.summary.title}
      contentContainerClassName="gap-7 px-4 pt-3"
    >
      {groups.length > 0 && data ? (
        groups.map((group) => (
          <SettingsSection key={group.outcome} title={t(group.title)}>
            {group.deliveries.map((delivery) => (
              <WorkflowGitHubEventRow
                key={delivery.id}
                delivery={delivery}
                history={data}
                runs={runList}
                onOpenRun={(runId) => commands.openRun(workflowId, runId)}
              />
            ))}
          </SettingsSection>
        ))
      ) : (
        <SettingsSection>
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-text-secondary">
              {history.isError
                ? errorMessage(history.error, t("mobile.workflow.github.history.loadFailed"))
                : data
                  ? t("mobile.workflow.github.history.none")
                  : t("mobile.workflow.list.loading")}
            </Typography.Paragraph>
          </SettingsRow>
        </SettingsSection>
      )}
    </LargeTitleScrollView>
  );
}
