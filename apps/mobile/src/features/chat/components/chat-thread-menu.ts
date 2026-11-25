import { avatarHeadColor } from "@openbot/brand/bloub-avatar";
import type { AvatarColor, AvatarHue } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { useMemo } from "react";
import { useAgentThreadReads } from "@/features/chat/components/use-agent-thread-reads";
import { useOpenAgentTasks } from "@/features/chat/components/use-open-agent-tasks";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MenuAction } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export const MAIN_THREAD_ID = "main";
export const DRAFT_THREAD_ID = "new";

const THREAD_PREFIX = "thread:";
const MENU_TITLE_LENGTH = 34;

function menuTitle(title: string): string {
  if (title.length <= MENU_TITLE_LENGTH) return title;
  const cut = title.slice(0, MENU_TITLE_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${(space > MENU_TITLE_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface ChatThreadMenu {
  actions: MenuAction[];
  onPressAction: (id: string) => void;
  attention: number;
  color: string;
  inThread: boolean;
  threadCount: number;
}

export function useChatThreadMenu(
  agent: {
    id: string;
    serverId: string;
    avatarSeed: string;
    avatarHue: AvatarHue | null;
    avatarColor: AvatarColor | null;
  },
  activeId: string,
): ChatThreadMenu | undefined {
  const { t } = useText();
  const supported = useMobileWorkspaceSelector((current) => current.canUseTasks(agent.serverId));
  const tasks = useOpenAgentTasks(agent.serverId, agent.id);
  const reads = useAgentThreadReads(agent.serverId, agent.id);
  const agentColor = avatarHeadColor(agent.avatarSeed, agent.avatarHue, agent.avatarColor);
  return useMemo(() => {
    if (!supported) return undefined;
    const inThread = activeId !== MAIN_THREAD_ID;
    const unread = (taskId: string) => taskId !== activeId && (reads.get(taskId)?.unreadCount ?? 0) > 0;
    const openThread = (taskId: string) => {
      if (inThread) router.setParams<"/task/[taskId]">({ taskId });
      else router.push({ pathname: "/task/[taskId]", params: { serverId: agent.serverId, agentId: agent.id, taskId } });
    };
    const actions: MenuAction[] = [
      {
        id: "threads",
        title: "",
        displayInline: true,
        subactions: [
          {
            id: MAIN_THREAD_ID,
            title: t("mobile.chat.threads.main"),
            image: "bubble.left.and.bubble.right",
            state: activeId === MAIN_THREAD_ID ? "on" : "off",
          },
          ...tasks.map(
            (task): MenuAction => ({
              id: `${THREAD_PREFIX}${task.id}`,
              title: menuTitle(task.title),
              ...(unread(task.id) ? { image: "circle.fill", imageColor: agentColor } : { image: "link" }),
              state: activeId === task.id ? "on" : "off",
            }),
          ),
        ],
      },
      {
        id: "more",
        title: "",
        displayInline: true,
        subactions: [
          {
            id: DRAFT_THREAD_ID,
            title: t("mobile.chat.threads.new"),
            image: "plus",
            attributes: { disabled: activeId === DRAFT_THREAD_ID },
          },
          { id: "all", title: t("mobile.chat.threads.all"), image: "list.bullet" },
          { id: "info", title: t("mobile.chat.threads.agentInfo"), image: "info.circle" },
        ],
      },
    ];
    const onPressAction = (id: string) => {
      void haptics.selection();
      if (id === MAIN_THREAD_ID) {
        if (inThread)
          router.dismissTo({ pathname: "/chat/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } });
      } else if (id === DRAFT_THREAD_ID) openThread(DRAFT_THREAD_ID);
      else if (id === "all")
        router.push({ pathname: "/server-tasks", params: { serverId: agent.serverId, agentId: agent.id } });
      else if (id === "info")
        router.push({ pathname: "/agent-info/[agentId]", params: { agentId: agent.id, serverId: agent.serverId } });
      else if (id.startsWith(THREAD_PREFIX)) {
        const taskId = id.slice(THREAD_PREFIX.length);
        if (taskId !== activeId) openThread(taskId);
      }
    };
    const attention = tasks.filter((task) => task.id !== activeId && unread(task.id)).length;
    return { actions, onPressAction, attention, color: agentColor, inThread, threadCount: tasks.length };
  }, [supported, tasks, reads, agentColor, activeId, agent.id, agent.serverId, t]);
}
