import type { AgentTask } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { TASKS_CLOSED_SHOWN, type TasksSectionId, taskSections } from "@openbot/team-client/agent-tasks";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Plus from "lucide-react-native/icons/plus";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { DRAFT_THREAD_ID } from "@/features/chat/components/chat-thread-menu";
import { useServerThreadReads } from "@/features/chat/components/use-agent-thread-reads";
import { TaskListRow } from "@/features/servers/components/task-list-row";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
import { useThreadActions } from "@/features/servers/model/use-thread-actions";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { LargeTitleScrollView } from "@/shared/components/large-title";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

const SECTION_TITLE = {
  needsYou: "mobile.server.threads.section.needsYou",
  working: "mobile.server.threads.section.working",
  waiting: "mobile.server.threads.section.waiting",
  unread: "mobile.server.threads.section.unread",
  read: "mobile.server.threads.section.read",
  closed: "mobile.server.threads.section.closed",
} as const satisfies Record<TasksSectionId, MobileTextKey>;

/**
 * The threads of all agents of a server, or of one agent with `agentId`: working, unread, read, then
 * the newest archived threads. The host keeps the read marks; a host without them shows the open threads by what
 * they need: needs you, working, waiting. The bar's plus opens the new thread sheet, where
 * the person chooses the agent, or on one agent's page a new thread with that agent.
 */
export function ServerTasksScreen() {
  const { t } = useText();
  const { serverId, agentId } = useLocalSearchParams<{ serverId: string; agentId?: string }>();
  const { servers } = useMobileWorkspace();
  const server = servers.find((item) => item.id === serverId);
  const { agents, tasks, online, supported, ready, retry } = useServerTasks(serverId, { agentId });
  const [showAllClosed, setShowAllClosed] = useState(false);
  const threadActions = useThreadActions(serverId);
  const threadReads = useServerThreadReads(serverId, tasks);
  const agent = agentId ? agents.find((item) => item.id === agentId) : undefined;
  const agentOf = (id: string) => agents.find((item) => item.id === id);
  const title = agent ? t("mobile.server.threads.agentTitle", { name: agent.name }) : t("mobile.app.route.threads");
  const canStart = Boolean(server) && online && supported && agents.length > 0;

  // One agent's page starts a thread with that agent, as its thread menu does: its first message
  // starts it. The page of all agents asks which agent starts it.
  const newTask = () => {
    void haptics.impact("soft");
    if (agentId) router.push({ pathname: "/task/[taskId]", params: { serverId, agentId, taskId: DRAFT_THREAD_ID } });
    else router.push({ pathname: "/new-task", params: { serverId } });
  };
  const open = (task: AgentTask) =>
    router.push({ pathname: "/task/[taskId]", params: { serverId, agentId: task.agentId, taskId: task.id } });

  const note = !server
    ? t("mobile.server.unavailable")
    : !supported
      ? t(online ? "mobile.server.threads.unsupported" : "mobile.server.threads.offline")
      : agents.length === 0
        ? t("mobile.server.threads.noAgents")
        : !online && tasks.length === 0
          ? t("mobile.server.threads.offline")
          : !ready && tasks.length === 0
            ? t("mobile.server.threads.loading")
            : null;
  const isUnread = threadReads ? (task: AgentTask) => (threadReads.get(task.id)?.unreadCount ?? 0) > 0 : undefined;
  const sections = note
    ? []
    : taskSections(tasks, showAllClosed, isUnread).filter((section) => section.tasks.length > 0);

  return (
    <>
      {isAndroid ? (
        <AndroidHeaderButton
          placement="right"
          glass
          icon={Plus}
          accessibilityLabel={t("mobile.server.threads.new")}
          hidden={!canStart}
          onPress={newTask}
        />
      ) : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="plus"
            accessibilityLabel={t("mobile.server.threads.new")}
            hidden={!canStart}
            onPress={newTask}
          />
        </Stack.Toolbar>
      )}
      <LargeTitleScrollView title={title} caption={server?.name} contentContainerClassName="pt-1">
        {note ? <EmptyNote text={note} /> : null}
        {retry ? (
          <Pressable accessibilityRole="button" className="px-5 py-2" onPress={retry}>
            <Typography.Paragraph className="text-muted" style={typeScale.preview}>
              {t("mobile.server.threads.loadFailed")}{" "}
              <Typography.Paragraph className="font-medium text-accent-text" style={typeScale.preview}>
                {t("common.retry")}
              </Typography.Paragraph>
            </Typography.Paragraph>
          </Pressable>
        ) : null}
        {!note && sections.length === 0 && !retry ? (
          <EmptyNote text={t(canStart ? "mobile.server.threads.emptyStart" : "mobile.server.threads.emptyList")} />
        ) : null}
        {sections.map((section) => (
          <View key={section.id}>
            <View className="flex-row items-center gap-1.5 px-5 pt-3.5 pb-1.5">
              <Typography.Paragraph
                accessibilityRole="header"
                className="font-medium text-muted"
                style={typeScale.caption}
              >
                {t(SECTION_TITLE[section.id])}
              </Typography.Paragraph>
              <Typography.Paragraph className="text-muted opacity-60" style={typeScale.caption}>
                {section.count}
              </Typography.Paragraph>
            </View>
            {section.tasks.map((task) => (
              <TaskListRow
                key={task.id}
                task={task}
                agent={agent ? undefined : agentOf(task.agentId)}
                dimmed={section.id === "closed"}
                onPress={() => open(task)}
                menu={{ actions: threadActions.menu(task), onAction: (id) => threadActions.run(task, id) }}
              />
            ))}
            {section.id === "closed" && !showAllClosed && section.count > TASKS_CLOSED_SHOWN ? (
              <Pressable
                accessibilityRole="button"
                className="self-start px-5 py-2"
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                onPress={() => {
                  void haptics.selection();
                  setShowAllClosed(true);
                }}
              >
                <Typography.Paragraph className="font-medium text-accent-text" style={typeScale.preview}>
                  {t("mobile.server.threads.showAll", { count: section.count })}
                </Typography.Paragraph>
              </Pressable>
            ) : null}
          </View>
        ))}
      </LargeTitleScrollView>
    </>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <Typography.Paragraph className="px-5 py-4 text-muted" style={typeScale.preview}>
      {text}
    </Typography.Paragraph>
  );
}
