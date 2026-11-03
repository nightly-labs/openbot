import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useWorkflowCommands } from "@/features/workflows/model/use-workflow-commands";
import { useWorkflowDetail, useWorkflowVersions } from "@/features/workflows/model/use-workflows";
import { VERSION_KIND_LABEL } from "@/features/workflows/model/workflow-steps";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { useText } from "@/shared/lib/text";

/**
 * Drawer > Workflows > a workflow > Version history: the versions that the host keeps, newest first.
 * A version opens its steps, and it can become the current workflow there.
 */
export function WorkflowVersionsScreen() {
  const { t, format, errorMessage } = useText();
  const { serverId, workflowId } = useLocalSearchParams<{ serverId: string; workflowId: string }>();
  const detail = useWorkflowDetail(serverId, workflowId);
  const versions = useWorkflowVersions(serverId, workflowId);
  const commands = useWorkflowCommands(serverId);
  const list = versions.data ?? [];
  return (
    <LargeTitleScrollView
      title={t("mobile.workflow.version.history")}
      caption={detail.data?.summary.title}
      contentContainerClassName="gap-7 px-4 pt-3"
    >
      <SettingsSection footer={list.length > 0 ? t("mobile.workflow.version.hint") : undefined}>
        {list.length > 0 ? (
          list.map((version) => (
            <SettingsRow
              key={version.id}
              supportingText={t(VERSION_KIND_LABEL[version.kind])}
              onPress={() => commands.openVersion(workflowId, version.id)}
            >
              <Typography.Paragraph>
                {t("mobile.workflow.version.title", {
                  revision: version.revision,
                  time: formatUpdatedAt(version.at, format),
                })}
              </Typography.Paragraph>
            </SettingsRow>
          ))
        ) : (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-text-secondary">
              {versions.isError
                ? errorMessage(versions.error, t("mobile.workflow.version.loadFailed"))
                : versions.data
                  ? t("mobile.workflow.version.none")
                  : t("mobile.workflow.list.loading")}
            </Typography.Paragraph>
          </SettingsRow>
        )}
      </SettingsSection>
    </LargeTitleScrollView>
  );
}
