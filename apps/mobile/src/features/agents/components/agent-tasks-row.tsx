import { useNavigation } from "expo-router";
import { StackActions } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import ListChecks from "lucide-react-native/icons/list-checks";
import { useOpenAgentTasks } from "@/features/chat/components/use-open-agent-tasks";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const TASKS_ROUTE = "server-tasks";

export function AgentTasksRow({ agent }: { agent: MobileAgent }) {
  const { t, format } = useText();
  const sheetStack = useNavigation().getParent();
  const supported = useMobileWorkspaceSelector((current) => current.canUseTasks(agent.serverId));
  const open = useOpenAgentTasks(agent.serverId, agent.id);
  if (!supported || !sheetStack) return null;
  return (
    <SettingsRow
      leading={<RowIcon icon={ListChecks} />}
      value={open.length > 0 ? format.number(open.length) : undefined}
      onPress={() => {
        void haptics.impact("soft");
        sheetStack.dispatch(StackActions.replace(TASKS_ROUTE, { serverId: agent.serverId, agentId: agent.id }));
      }}
    >
      <Typography.Paragraph>{t("mobile.app.route.threads")}</Typography.Paragraph>
    </SettingsRow>
  );
}
