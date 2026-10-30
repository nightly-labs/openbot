import type { AvatarHue } from "@openbot/contracts/ipc";
import { router } from "expo-router";
import { useMemo } from "react";
import { getBloubAvatarColor } from "@/features/agents/model/bloub-activity";
import { useAgentThreadReads } from "@/features/chat/components/use-agent-thread-reads";
import { useOpenAgentTasks } from "@/features/chat/components/use-open-agent-tasks";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MenuAction } from "@/shared/components/menu-view";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The agent's own chat in the thread menu. It is not a task: the agent chat screen shows it. */
export const MAIN_THREAD_ID = "main";
/** The task id of a new thread before its first message starts it, as the desktop draft tab. */
export const DRAFT_THREAD_ID = "new";

const THREAD_PREFIX = "thread:";
/**
 * About two lines of a thread title in the menu. The iOS menu shows up to three lines and has no line
 * limit, so a longer title ends at a word with an ellipsis.
 */
const MENU_TITLE_LENGTH = 34;

function menuTitle(title: string): string {
  if (title.length <= MENU_TITLE_LENGTH) return title;
  const cut = title.slice(0, MENU_TITLE_LENGTH);
  const space = cut.lastIndexOf(" ");
  return `${(space > MENU_TITLE_LENGTH / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The actions of the agent's name in the chat header, and the open threads that need the person. */
export interface ChatThreadMenu {
  actions: MenuAction[];
  onPressAction: (id: string) => void;
  /** The open threads, other than the one on the screen, with agent messages that the person has not read. */
  attention: number;
  /** The agent's color, for the dot of an unread thread. */
  color: string;
}

/**
 * The thread menu of an agent, as the desktop thread list: the agent's own chat, its open threads, a
 * new thread, all its threads with the archived ones, and the agent's info. `activeId` is the thread
 * on the screen: `MAIN_THREAD_ID` in the agent's chat, `DRAFT_THREAD_ID`, or a task id. Undefined on
 * a host without `agent-tasks-v1`; the agent's name then opens the agent's info, as before.
 */
export function useChatThreadMenu(
  agent: { id: string; serverId: string; avatarSeed: string; avatarHue: AvatarHue | null },
  activeId: string,
): ChatThreadMenu | undefined {
  const { t } = useText();
  const supported = useMobileWorkspaceSelector((current) => current.canUseTasks(agent.serverId));
  const tasks = useOpenAgentTasks(agent.serverId, agent.id);
  const reads = useAgentThreadReads(agent.serverId, agent.id);
  const agentColor = getBloubAvatarColor(agent.avatarSeed, agent.avatarHue);
  return useMemo(() => {
    if (!supported) return undefined;
    const inThread = activeId !== MAIN_THREAD_ID;
    const unread = (taskId: string) => taskId !== activeId && (reads.get(taskId)?.unreadCount ?? 0) > 0;
    const openThread = (taskId: string) => {
      // A thread replaces the thread on the screen, so Back still returns to the agent's chat.
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
              // iOS menus have one image for each item: an unread thread shows a dot in the agent's color.
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
        // The agent's chat is under the thread, or a notification opened the thread with no chat under it.
        if (inThread) router.dismissTo({ pathname: "/chat/[agentId]", params: { agentId: agent.id } });
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
    return { actions, onPressAction, attention, color: agentColor };
  }, [supported, tasks, reads, agentColor, activeId, agent.id, agent.serverId, t]);
}
