import type { ActivityInboxItem, AgentTask } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { TASKS_CLOSED_SHOWN, type TasksSectionId, taskSections } from "@openbot/team-client/agent-tasks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Button, Typography } from "heroui-native";
import Plus from "lucide-react-native/icons/plus";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { DRAFT_THREAD_ID } from "@/features/chat/components/chat-thread-menu";
import { useServerThreadReads } from "@/features/chat/components/use-agent-thread-reads";
import { TaskListRow } from "@/features/servers/components/task-list-row";
import { useServerTasks } from "@/features/servers/model/use-server-tasks";
import { useThreadActions } from "@/features/servers/model/use-thread-actions";
import {
  useMobileWorkspace,
  useMobileWorkspaceActions,
  useMobileWorkspaceSelector,
} from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
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
  const queryScope = useQueryScope();
  const queryClient = useQueryClient();
  const server = servers.find((item) => item.id === serverId);
  const { agents, tasks, online, supported, ready, retry } = useServerTasks(serverId, { agentId });
  const canUseInbox = useMobileWorkspaceSelector((current) => current.canUseActivityInbox(serverId));
  const inboxActions = useMobileWorkspaceActions();
  const inbox = useQuery({
    queryKey: queryKeys.activityInbox(queryScope, serverId),
    enabled: Boolean(server) && online && canUseInbox,
    retry: false,
    queryFn: () => inboxActions.loadActivityInbox(serverId),
  });
  const [showAllClosed, setShowAllClosed] = useState(false);
  const [inboxActionError, setInboxActionError] = useState(false);
  const threadActions = useThreadActions(serverId);
  const threadReads = useServerThreadReads(serverId, tasks).reads;
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
  const openReport = (item: ActivityInboxItem) =>
    router.push({ pathname: "/task/[taskId]", params: { serverId, agentId: item.agentId, taskId: item.taskId } });
  const refreshInbox = () => queryClient.invalidateQueries({ queryKey: queryKeys.activityInbox(queryScope, serverId) });
  const classify = async (item: ActivityInboxItem, classification: "reference" | "actionable") => {
    setInboxActionError(false);
    try {
      await inboxActions.classifyActivityInboxItem({ itemId: item.itemId, classification }, serverId);
      await refreshInbox();
    } catch {
      setInboxActionError(true);
    }
  };
  const followup = async (item: ActivityInboxItem) => {
    setInboxActionError(false);
    const previous = item.followupReceipt;
    const retryAction = previous?.status === "pending" || previous?.status === "unknown" ? previous : null;
    try {
      await inboxActions.followupActivityInboxItem(
        {
          itemId: item.itemId,
          actionId: retryAction?.actionId ?? Crypto.randomUUID(),
          clientMessageId: retryAction?.clientMessageId ?? Crypto.randomUUID(),
          text: t("mobile.server.activityInbox.followupMessage"),
        },
        serverId,
      );
      await refreshInbox();
    } catch {
      setInboxActionError(true);
    }
  };

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
        {online && supported && !canUseInbox ? (
          <Typography.Paragraph className="px-5 py-2 text-muted" style={typeScale.preview}>
            {t("mobile.server.activityInbox.unavailable")}
          </Typography.Paragraph>
        ) : null}
        {canUseInbox && inbox.data?.complete === false ? (
          <Typography.Paragraph className="px-5 py-2 text-muted" style={typeScale.preview}>
            {t("mobile.server.activityInbox.unavailable")}
          </Typography.Paragraph>
        ) : null}
        {canUseInbox && inbox.data?.items.length ? (
          <View className="gap-2 px-5 pb-3">
            <Typography.Paragraph
              accessibilityRole="header"
              className="font-medium text-muted"
              style={typeScale.caption}
            >
              {t("mobile.server.activityInbox.title")}
            </Typography.Paragraph>
            {inbox.data.items
              .filter((item) => !agentId || item.agentId === agentId)
              .map((item) => {
                const status = item.followupReceipt?.status;
                const statusText =
                  status === "queued"
                    ? t("mobile.server.activityInbox.queued")
                    : status === "pending"
                      ? t("mobile.server.activityInbox.pending")
                      : status === "running"
                        ? t("mobile.server.activityInbox.running")
                        : status === "result_linked"
                          ? t("mobile.server.activityInbox.resultLinked")
                          : status === "unknown"
                            ? t("mobile.server.activityInbox.unknown")
                            : status === "rejected"
                              ? t("mobile.server.activityInbox.rejected")
                              : t("mobile.server.activityInbox.reference");
                const canFollowUp =
                  !item.followupReceipt ||
                  item.followupReceipt.status === "pending" ||
                  (item.followupReceipt.status === "unknown" &&
                    item.followupReceipt.reasonCode !== "action-payload-mismatch") ||
                  (item.followupReceipt.status === "rejected" && item.followupReceipt.deliveryId === null);
                return (
                  <View key={item.itemId} className="gap-1.5 rounded-xl bg-surface px-3 py-3">
                    <Typography.Paragraph className="font-medium" style={typeScale.preview}>
                      {item.title}
                    </Typography.Paragraph>
                    <Typography.Paragraph className="text-muted" style={typeScale.caption}>
                      {statusText}
                    </Typography.Paragraph>
                    <View className="flex-row flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onPress={() => openReport(item)}>
                        <Button.Label>
                          {status === "result_linked"
                            ? t("mobile.server.activityInbox.openResult")
                            : t("mobile.server.activityInbox.open")}
                        </Button.Label>
                      </Button>
                      {item.state === "received_unrouted" ? (
                        <>
                          <Button size="sm" variant="secondary" onPress={() => void classify(item, "reference")}>
                            <Button.Label>{t("mobile.server.activityInbox.keepReference")}</Button.Label>
                          </Button>
                          <Button size="sm" variant="secondary" onPress={() => void classify(item, "actionable")}>
                            <Button.Label>{t("mobile.server.activityInbox.markActionable")}</Button.Label>
                          </Button>
                        </>
                      ) : null}
                      {canFollowUp && (item.kind === "reference" || item.state === "triage" || status) ? (
                        <Button size="sm" onPress={() => void followup(item)}>
                          <Button.Label>{t("mobile.server.activityInbox.followup")}</Button.Label>
                        </Button>
                      ) : null}
                    </View>
                  </View>
                );
              })}
          </View>
        ) : null}
        {inboxActionError ? (
          <Typography.Paragraph className="px-5 py-2 text-muted" style={typeScale.preview}>
            {t("mobile.server.activityInbox.error")}
          </Typography.Paragraph>
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
