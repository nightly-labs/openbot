import type { AgentTask } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import {
  TASKS_CLOSED_SHOWN,
  type TasksSection,
  type TasksSectionId,
  taskSections,
} from "@openbot/team-client/agent-tasks";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useNavigationState, useRoute } from "expo-router/react-navigation";
import { Typography } from "heroui-native";
import Plus from "lucide-react-native/icons/plus";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated from "react-native-reanimated";
import { DRAFT_THREAD_ID } from "@/features/chat/components/chat-thread-menu";
import { useServerThreadReads } from "@/features/chat/components/use-agent-thread-reads";
import { TaskListRow } from "@/features/servers/components/task-list-row";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
import { useThreadActions } from "@/features/servers/model/use-thread-actions";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
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

const INITIAL_ROWS = 16;

type ThreadListItem =
  | { kind: "header"; key: string; section: TasksSectionId; count: number }
  | { kind: "task"; key: string; task: AgentTask; dimmed: boolean }
  | { kind: "showAll"; key: string; count: number };

const itemKey = (item: ThreadListItem) => item.key;

function listItems(sections: readonly TasksSection[], showAllClosed: boolean): ThreadListItem[] {
  const items: ThreadListItem[] = [];
  for (const section of sections) {
    items.push({ kind: "header", key: `section:${section.id}`, section: section.id, count: section.count });
    for (const task of section.tasks) {
      items.push({ kind: "task", key: task.id, task, dimmed: section.id === "closed" });
    }
    if (section.id === "closed" && !showAllClosed && section.count > TASKS_CLOSED_SHOWN) {
      items.push({ kind: "showAll", key: "show-all", count: section.count });
    }
  }
  return items;
}

function sameTasks(previous: readonly AgentTask[], next: readonly AgentTask[]): boolean {
  return previous.length === next.length && previous.every((task, index) => task === next[index]);
}

export function ServerTasksScreen() {
  const { t } = useText();
  const { serverId, agentId } = useLocalSearchParams<{ serverId: string; agentId?: string }>();
  const serverName = useMobileWorkspaceSelector(
    (workspace) => workspace.servers.find((item) => item.id === serverId)?.name,
  );
  const hasServer = serverName !== undefined;
  const { agents, tasks, online, supported, ready, retry } = useServerTasks(serverId, { agentId });
  const [showAllClosed, setShowAllClosed] = useState(false);
  const threadActions = useThreadActions(serverId);
  const threadReads = useServerThreadReads(serverId, tasks).reads;
  const agentById = useMemo(() => new Map(agents.map((item) => [item.id, item])), [agents]);
  const agent = agentId ? agentById.get(agentId) : undefined;
  const title = agent ? t("mobile.server.threads.agentTitle", { name: agent.name }) : t("mobile.app.route.threads");
  const canStart = hasServer && online && supported && agents.length > 0;
  const [listWidth, setListWidth] = useState<number>();

  const route = useRoute();
  const overAgentChat = useNavigationState((state) => {
    const below = state.routes[state.routes.findIndex((candidate) => candidate.key === route.key) - 1];
    const params = below?.params;
    return (
      below?.name === "chat/[agentId]" && params !== undefined && "agentId" in params && params.agentId === agentId
    );
  });
  const show = agentId && overAgentChat ? router.replace : router.push;
  const newTask = () => {
    void haptics.impact("soft");
    if (agentId) show({ pathname: "/task/[taskId]", params: { serverId, agentId, taskId: DRAFT_THREAD_ID } });
    else router.push({ pathname: "/new-task", params: { serverId } });
  };
  const open = (task: AgentTask) =>
    show({ pathname: "/task/[taskId]", params: { serverId, agentId: task.agentId, taskId: task.id } });
  const latest = useRef({ open, run: threadActions.run });
  useLayoutEffect(() => {
    latest.current = { open, run: threadActions.run };
  });
  const openTask = useCallback((task: AgentTask) => latest.current.open(task), []);
  const runAction = useCallback((task: AgentTask, id: string) => latest.current.run(task, id), []);

  const note = !hasServer
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
  const [shownTasks, setShownTasks] = useState(tasks);
  if (shownTasks !== tasks && !sameTasks(shownTasks, tasks)) setShownTasks(tasks);
  const unreadKey = threadReads
    ? shownTasks
        .filter((task) => (threadReads.get(task.id)?.unreadCount ?? 0) > 0)
        .map((task) => task.id)
        .join("\n")
    : null;
  const items = useMemo(() => {
    if (note) return [];
    const unread = unreadKey === null ? null : new Set(unreadKey.split("\n"));
    const isUnread = unread ? (task: AgentTask) => unread.has(task.id) : undefined;
    const sections = taskSections(shownTasks, showAllClosed, isUnread).filter((section) => section.tasks.length > 0);
    return listItems(sections, showAllClosed);
  }, [note, shownTasks, showAllClosed, unreadKey]);

  const renderItem = ({ item }: { item: ThreadListItem }) =>
    item.kind === "header" ? (
      <View className="flex-row items-center gap-1.5 px-5 pt-3.5 pb-1.5">
        <Typography.Paragraph accessibilityRole="header" className="font-medium text-muted" style={typeScale.caption}>
          {t(SECTION_TITLE[item.section])}
        </Typography.Paragraph>
        <Typography.Paragraph className="text-muted opacity-60" style={typeScale.caption}>
          {item.count}
        </Typography.Paragraph>
      </View>
    ) : item.kind === "task" ? (
      <TaskListRow
        task={item.task}
        agent={agent ? undefined : agentById.get(item.task.agentId)}
        dimmed={item.dimmed}
        onPress={openTask}
        menu={{ actions: threadActions.menu(item.task), onAction: runAction }}
        slotWidth={listWidth}
      />
    ) : (
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
          {t("mobile.server.threads.showAll", { count: item.count })}
        </Typography.Paragraph>
      </Pressable>
    );

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
      <LargeTitleScrollView
        title={title}
        caption={serverName}
        renderScroll={(scrollProps, largeTitle) => (
          <Animated.FlatList
            {...scrollProps}
            removeClippedSubviews={false}
            onLayout={(event) => setListWidth(event.nativeEvent.layout.width)}
            data={items}
            keyExtractor={itemKey}
            renderItem={renderItem}
            initialNumToRender={INITIAL_ROWS}
            ListHeaderComponent={
              <>
                {largeTitle}
                <View className="pt-1">
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
                  {!note && items.length === 0 && !retry ? (
                    <EmptyNote
                      text={t(canStart ? "mobile.server.threads.emptyStart" : "mobile.server.threads.emptyList")}
                    />
                  ) : null}
                </View>
              </>
            }
          />
        )}
      />
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
