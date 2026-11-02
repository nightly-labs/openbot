import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { WorkflowRunRow } from "@/features/workflows/components/workflow-run-row";
import { useWorkflowCommands } from "@/features/workflows/model/use-workflow-commands";
import { useWorkflowDetail, useWorkflowRunHistory } from "@/features/workflows/model/use-workflows";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { useText } from "@/shared/lib/text";

/** Drawer > Workflows > one workflow > Runs: all its runs, newest first, with older pages on request. */
export function WorkflowRunsScreen() {
  const { t, errorMessage } = useText();
  const { serverId, workflowId } = useLocalSearchParams<{ serverId: string; workflowId: string }>();
  const detail = useWorkflowDetail(serverId, workflowId);
  const history = useWorkflowRunHistory(serverId, workflowId);
  const commands = useWorkflowCommands(serverId);
  const runs = history.data?.pages.flatMap((page) => page.runs) ?? [];
  return (
    <LargeTitleScrollView
      title={t("mobile.workflow.detail.runs")}
      caption={detail.data?.summary.title}
      contentContainerClassName="gap-7 px-4 pt-3"
    >
      <SettingsSection>
        {runs.length > 0 ? (
          runs.map((item) => (
            <WorkflowRunRow key={item.run.id} detail={item} onPress={() => commands.openRun(workflowId, item.run.id)} />
          ))
        ) : (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-text-secondary">
              {history.isError
                ? errorMessage(history.error, t("mobile.workflow.detail.runsFailed"))
                : history.data
                  ? t("mobile.workflow.detail.noRuns")
                  : t("mobile.workflow.list.loading")}
            </Typography.Paragraph>
          </SettingsRow>
        )}
        {history.hasNextPage ? (
          <SettingsRow
            disclosure={false}
            disabled={history.isFetchingNextPage}
            onPress={() => void history.fetchNextPage()}
          >
            <Typography.Paragraph>
              {history.isFetchingNextPage ? t("mobile.workflow.list.loading") : t("mobile.workflow.runs.older")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </LargeTitleScrollView>
  );
}
