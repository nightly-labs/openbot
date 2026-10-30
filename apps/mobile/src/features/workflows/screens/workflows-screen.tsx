import type { WorkflowSummary } from "@openbot/contracts/ipc";
import { Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Plus from "lucide-react-native/icons/plus";
import { Pressable, View } from "react-native";
import { SettingsSection } from "@/features/settings/components/settings-content";
import { WorkflowRow } from "@/features/workflows/components/workflow-row";
import { useWorkflowCommands } from "@/features/workflows/model/use-workflow-commands";
import { useWorkflowList } from "@/features/workflows/model/use-workflows";
import { isActiveRun } from "@/features/workflows/model/workflow-steps";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const NO_IDS: readonly string[] = [];

/**
 * Drawer > Workflows: the workflows of a server. The ones with a run that goes on or waits for the
 * person come first. A row opens the workflow; a long press pins it to the drawer, runs it or edits it.
 */
export function WorkflowsScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const serverName = useMobileWorkspaceSelector(
    (current) => current.servers.find((server) => server.id === serverId)?.name,
  );
  const pinned = useMobileWorkspaceSelector((current) => current.pinnedWorkflowIds[serverId] ?? NO_IDS);
  const { list, online, supported } = useWorkflowList(serverId);
  const commands = useWorkflowCommands(serverId);
  const workflows = list.data ?? [];
  const active = workflows.filter((workflow) => isActiveRun(workflow.lastRun?.status));
  const rest = workflows.filter((workflow) => !isActiveRun(workflow.lastRun?.status));
  const canCreate = online && supported;

  const note = !supported
    ? t(online ? "mobile.workflow.unsupported" : "mobile.workflow.offline")
    : list.isError
      ? errorMessage(list.error, t("mobile.workflow.list.loadFailed"))
      : !list.data
        ? t(online ? "mobile.workflow.list.loading" : "mobile.workflow.offline")
        : workflows.length === 0
          ? t("mobile.workflow.list.empty")
          : null;

  const row = (workflow: WorkflowSummary) => (
    <WorkflowRow
      key={workflow.id}
      workflow={workflow}
      pinned={pinned.includes(workflow.id)}
      onPress={() => commands.open(workflow.id)}
      onAction={(action) => {
        if (action === "pin") commands.togglePin(workflow.id);
        else if (action === "run") void commands.run(workflow.id);
        else commands.edit(workflow.id);
      }}
    />
  );

  return (
    <>
      {isAndroid ? (
        <AndroidHeaderButton
          placement="right"
          glass
          icon={Plus}
          accessibilityLabel={t("mobile.workflow.list.new")}
          hidden={!canCreate}
          onPress={commands.create}
        />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="plus"
            accessibilityLabel={t("mobile.workflow.list.new")}
            hidden={!canCreate}
            onPress={commands.create}
          />
        </Stack.Toolbar>
      )}
      <LargeTitleScrollView
        title={t("mobile.app.route.workflows")}
        caption={serverName}
        contentContainerClassName="gap-7 px-4 pt-3"
      >
        {note ? (
          <View className="gap-2 px-1">
            <Typography.Paragraph className="text-text-secondary" style={typeScale.preview}>
              {note}
            </Typography.Paragraph>
            {list.isError ? (
              <Pressable accessibilityRole="button" className="self-start py-1" onPress={() => void list.refetch()}>
                <Typography.Paragraph className="font-medium text-accent-text" style={typeScale.preview}>
                  {t("common.retry")}
                </Typography.Paragraph>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {active.length > 0 ? (
          <SettingsSection title={t("mobile.workflow.list.active")}>{active.map(row)}</SettingsSection>
        ) : null}
        {rest.length > 0 ? (
          <SettingsSection
            title={active.length > 0 ? t("mobile.workflow.list.all") : undefined}
            footer={t("mobile.workflow.list.hint")}
          >
            {rest.map(row)}
          </SettingsSection>
        ) : null}
      </LargeTitleScrollView>
    </>
  );
}
