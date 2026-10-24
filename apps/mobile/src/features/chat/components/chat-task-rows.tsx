import type { AgentTask } from "@openbot/contracts/ipc";
import { isAgentTaskActive, isAgentTaskOpen } from "@openbot/team-client/agent-tasks";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import X from "lucide-react-native/icons/x";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useCSSVariable } from "uniwind";
import { showFailureAlert } from "@/features/analytics/failure-reports";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { AgentTaskMark } from "@/features/servers/components/agent-task-mark";
import { agentTaskStatus } from "@/features/servers/model/agent-task-text";
import {
  useMobileWorkspaceReader,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { haptics } from "@/shared/lib/haptics";
import { currentText, useText } from "@/shared/lib/text";

const NO_TASKS: AgentTask[] = [];

/**
 * The open tasks of one agent, as the desktop chat shows them: a task stays after its turn ends,
 * with its result, until the person closes it. The task events keep the list current, as on the
 * Tasks page. Empty on a host without `agent-tasks-v1`.
 */
export function useOpenAgentTasks(serverId: string, agentId: string): AgentTask[] {
  const queryScope = useQueryScope();
  const workspace = useMobileWorkspaceReader();
  const enabled = useMobileWorkspaceSelector(
    (current) =>
      current.servers.some((server) => server.id === serverId && server.state === "online") &&
      current.canUseTasks(serverId),
  );
  const list = useQuery({
    queryKey: queryKeys.agentTasks(queryScope, serverId, agentId),
    enabled,
    retry: false,
    queryFn: () => workspace().loadAgentTasks(agentId, serverId),
  });
  const tasks = list.data?.tasks;
  // One array while the list stays, so the rows under the activity do not draw the chat again.
  return useMemo(() => (tasks?.some(isAgentTaskOpen) ? tasks.filter(isAgentTaskOpen) : NO_TASKS), [tasks]);
}

/**
 * Under the agent's activity, one card for each open task: a spinner while it runs, else the task
 * mark, its title, and what it does now or how its last turn ended. A task turn does not show in the
 * chat, so this card says that the agent works. A tap opens the task, where the person can also
 * answer its questions. A task that does not run has a close button in its card, which moves it to
 * the closed tasks of the Tasks page.
 */
export function ChatTaskRows({ tasks, serverId }: { tasks: readonly AgentTask[]; serverId: string }) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  const accent = useCSSVariable("--openbot-accent-text");
  const workspace = useMobileWorkspaceReader();
  const [closing, setClosing] = useState<ReadonlySet<string>>(() => new Set());
  if (tasks.length === 0) return null;

  async function close(task: AgentTask) {
    if (closing.has(task.id)) return;
    void haptics.selection();
    setClosing((current) => new Set(current).add(task.id));
    try {
      await workspace().controlAgentTask("close", { agentId: task.agentId, taskId: task.id }, serverId);
    } catch (error) {
      void haptics.notification("error");
      const text = currentText();
      const title = text.t("mobile.server.tasks.error.close");
      showFailureAlert(error, "team", title, text.errorMessage(error, title));
    } finally {
      setClosing((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  return (
    <View className="items-start gap-2 pb-3">
      {tasks.map((task) => {
        const status = agentTaskStatus(task, t);
        const closable = !isAgentTaskActive(task);
        return (
          <View
            key={task.id}
            className="max-w-[88%] flex-row items-center rounded-[18px] border border-separator bg-control/60"
            style={{ borderCurve: "continuous" }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("mobile.chat.tasks.open", { title: task.title, status })}
              className={`shrink flex-row items-center gap-3 py-2.5 pl-3.5 ${closable ? "pr-1" : "pr-4"}`}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              onPress={() => {
                void haptics.selection();
                router.push({
                  pathname: "/task/[taskId]",
                  params: { serverId, agentId: task.agentId, taskId: task.id },
                });
              }}
            >
              {task.state === "running" ? <Spinner size="sm" color={String(accent)} /> : <AgentTaskMark task={task} />}
              <View className="min-w-0 shrink">
                <Typography.Paragraph weight="semibold" numberOfLines={1}>
                  {task.title}
                </Typography.Paragraph>
                <Typography.Paragraph type="body-sm" numberOfLines={1} className="text-text-secondary">
                  {t("mobile.chat.tasks.status", { status })}
                </Typography.Paragraph>
              </View>
            </Pressable>
            {closable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("mobile.chat.tasks.close", { title: task.title })}
                accessibilityState={{ disabled: closing.has(task.id) }}
                disabled={closing.has(task.id)}
                hitSlop={6}
                className="mr-1.5 size-9 items-center justify-center rounded-full"
                style={({ pressed }) => ({ opacity: closing.has(task.id) ? 0.45 : pressed ? 0.6 : 1 })}
                onPress={() => void close(task)}
              >
                <X color={String(muted)} size={16} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
