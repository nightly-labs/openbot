import type { WorkflowSummary } from "@openbot/contracts/ipc";
import type { Href } from "expo-router";
import { Typography } from "heroui-native";
import Play from "lucide-react-native/icons/play";
import UserRoundCheck from "lucide-react-native/icons/user-round-check";
import { memo, useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { useWorkflowCommands } from "@/features/workflows/model/use-workflow-commands";
import { useWorkflowList } from "@/features/workflows/model/use-workflows";
import { RUN_STATUS_LABEL } from "@/features/workflows/model/workflow-steps";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const NO_IDS: readonly string[] = [];
const PIN_BUTTON = 34;

export interface DrawerWorkflows {
  /** False on a host without `workflows-v1`: the drawer has no Workflows row then. */
  supported: boolean;
  /** The runs that wait for the person, else the runs that go on. */
  value: string | null;
  needsYou: boolean;
  pinned: WorkflowSummary[];
}

/** The value of the Workflows row and the pinned workflows, from the list that the host keeps current. */
export function useDrawerWorkflows(serverId: string, open: boolean): DrawerWorkflows {
  const { t } = useText();
  const { list, supported } = useWorkflowList(serverId, open);
  const pinnedIds = useMobileWorkspaceSelector((current) => current.pinnedWorkflowIds[serverId] ?? NO_IDS);
  const workflows = list.data ?? [];
  const needsYou = workflows.filter((workflow) => workflow.lastRun?.status === "approval").length;
  const running = workflows.filter((workflow) => workflow.lastRun?.status === "running").length;
  return {
    supported,
    value: needsYou
      ? t("mobile.workflow.drawer.needYou", { count: needsYou })
      : running
        ? t("mobile.workflow.drawer.running", { count: running })
        : null,
    needsYou: needsYou > 0,
    pinned: pinnedIds.flatMap((id) => workflows.find((workflow) => workflow.id === id) ?? []),
  };
}

/**
 * A pinned workflow under the Workflows row. The row opens the workflow, or the run that waits for the
 * person; the button runs it, or opens the run that goes on.
 */
const PinnedWorkflowRow = memo(function PinnedWorkflowRow({
  serverId,
  workflow,
  onNavigate,
}: {
  serverId: string;
  workflow: WorkflowSummary;
  onNavigate: (href: Href) => void;
}) {
  const { t, format } = useText();
  const [control, foreground, warning, warningSoft, secondary] = useCSSVariable([
    "--openbot-bg-control",
    "--openbot-text-primary",
    "--openbot-warning-text",
    "--openbot-file-orange-soft",
    "--openbot-text-secondary",
  ]);
  const commands = useWorkflowCommands(serverId);
  const [starting, setStarting] = useState(false);
  const status = workflow.lastRun?.status;
  const waits = status === "approval";
  const runs = status === "running" || status === "stopping" || starting;
  const runHref: Href = { pathname: "/server-workflows/run", params: { serverId, workflowId: workflow.id } };
  const workflowHref: Href = { pathname: "/server-workflows/workflow", params: { serverId, workflowId: workflow.id } };
  const line = waits
    ? t("mobile.workflow.drawer.review")
    : workflow.lastRun
      ? t("mobile.workflow.list.lastRun", {
          status: t(RUN_STATUS_LABEL[workflow.lastRun.status]),
          time: formatUpdatedAt(workflow.lastRun.at, format),
        })
      : t("mobile.workflow.list.neverRun");
  const lineClass = waits
    ? "font-medium text-warning-text"
    : runs
      ? "text-accent-text"
      : status === "failed"
        ? "text-danger-text"
        : "text-text-secondary";
  return (
    <View className="flex-row items-center gap-2 pr-1" style={{ minHeight: 44 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${workflow.title}, ${line}`}
        className="min-w-0 flex-1 py-1"
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        onPress={() => {
          void haptics.impact("soft");
          onNavigate(waits ? runHref : workflowHref);
        }}
      >
        <Typography.Paragraph numberOfLines={1} style={typeScale.preview}>
          {workflow.title}
        </Typography.Paragraph>
        <Typography.Paragraph className={lineClass} numberOfLines={1} style={typeScale.small}>
          {line}
        </Typography.Paragraph>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          waits
            ? t("mobile.workflow.drawer.reviewNamed", { name: workflow.title })
            : runs
              ? t("mobile.workflow.drawer.showRun", { name: workflow.title })
              : t("mobile.workflow.drawer.runNamed", { name: workflow.title })
        }
        className="items-center justify-center rounded-full"
        style={({ pressed }) => ({
          width: PIN_BUTTON,
          height: PIN_BUTTON,
          backgroundColor: String(waits ? warningSoft : control),
          transform: [{ scale: pressed ? 0.92 : 1 }],
        })}
        onPress={() => {
          if (waits || runs) {
            void haptics.impact("soft");
            onNavigate(runHref);
            return;
          }
          setStarting(true);
          void commands.run(workflow.id).finally(() => setStarting(false));
        }}
      >
        {waits ? (
          <UserRoundCheck color={String(warning)} size={16} strokeWidth={2} />
        ) : runs ? (
          <ActivityIndicator size="small" color={String(secondary)} />
        ) : (
          <Play color={String(foreground)} fill={String(foreground)} size={12} strokeWidth={2} />
        )}
      </Pressable>
    </View>
  );
});

/** The pinned workflows of the open server, under the Workflows row of the drawer. */
export function DrawerPinnedWorkflows({
  serverId,
  pinned,
  onNavigate,
}: {
  serverId: string;
  pinned: readonly WorkflowSummary[];
  onNavigate: (href: Href) => void;
}) {
  if (pinned.length === 0) return null;
  return (
    <View className="pb-1" style={{ marginLeft: 44 }}>
      {pinned.map((workflow) => (
        <PinnedWorkflowRow key={workflow.id} serverId={serverId} workflow={workflow} onNavigate={onNavigate} />
      ))}
    </View>
  );
}
