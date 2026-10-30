import { useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import { useOpenAgentTasks } from "@/features/chat/components/use-open-agent-tasks";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The route name of the Tasks screen in the app stack, `app/(app)/server-tasks.tsx`. */
const TASKS_ROUTE = "server-tasks";

/**
 * The agent's open tasks in its sheet. Tasks is a full screen, so the screen of this agent's tasks
 * takes the place of the sheet, and Back returns to what was under the sheet. Hidden on a host
 * without `agent-tasks-v1`.
 */
export function AgentTasksRow({ agent }: { agent: MobileAgent }) {
  const { t, format } = useText();
  // The stack that presents this sheet. The sheet has its own stack inside.
  const sheetStack = useNavigation().getParent();
  const supported = useMobileWorkspaceSelector((current) => current.canUseTasks(agent.serverId));
  const open = useOpenAgentTasks(agent.serverId, agent.id);
  if (!supported || !sheetStack) return null;
  return (
    <SettingsRow
      supportingText={open.length > 0 ? format.number(open.length) : undefined}
      onPress={() => {
        void haptics.impact("soft");
        sheetStack.dispatch(StackActions.replace(TASKS_ROUTE, { serverId: agent.serverId, agentId: agent.id }));
      }}
    >
      <Typography.Paragraph>{t("mobile.app.route.threads")}</Typography.Paragraph>
    </SettingsRow>
  );
}
