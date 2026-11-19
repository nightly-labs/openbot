import { sideThreadItem } from "@openbot/ui/features/conversation/threads/thread-items";
import { MAIN_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import type { SidebarAgentThreads } from "@openbot/ui/features/sidebar/sidebar-types";
import type { AgentTasks } from "../agent-tasks/agent-tasks-state";
import type { AgentThreadTabsState } from "./agent-thread-tabs";
import { type ThreadWaits, taskWaitsFor } from "./conversation-threads";

export interface SidebarAgentThreadsInput {
  tasks: AgentTasks;
  tabs: AgentThreadTabsState;
  /** The agent whose chat is open, or an empty string. */
  activeAgentId: () => string;
  waits: () => ThreadWaits;
  /** Opens the agent's chat at the thread. */
  openThread: (agentId: string, threadId: string) => void;
  /** Missing where the sidebar does not start a thread, such as in a chat window. */
  onNew?: ((agentId: string) => void) | undefined;
}

/**
 * The side threads of each agent, for the sidebar. The desktop, also with a joined server, and the web
 * client give their own tasks and tabs. Undefined on a host without side threads.
 */
export function sidebarAgentThreads(input: SidebarAgentThreadsInput): SidebarAgentThreads | undefined {
  const { tasks, tabs } = input;
  if (!tasks.available()) return undefined;
  // A hover, a focus and an open list can all ask for one agent before its first list comes back.
  const reading = new Set<string>();
  return {
    threads: (agentId) => {
      const list = tasks.snapshot(agentId)?.tasks ?? [];
      const hidden = tabs.hidden();
      const waits = input.waits();
      return list
        .filter((task) => task.state !== "closed" && !hidden.has(task.id))
        .map((task) => sideThreadItem(task, taskWaitsFor(task, waits), tasks.unreadCount(task)))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
    openId: (agentId) => {
      if (input.activeAgentId() !== agentId) return undefined;
      const id = tabs.activeId(agentId);
      return id === MAIN_THREAD_ID ? undefined : id;
    },
    // Events keep a read list current, so a list is read once. An agent with running threads and the open
    // agent are read already.
    load: (agentId) => {
      if (tasks.snapshot(agentId) || reading.has(agentId)) return;
      reading.add(agentId);
      void tasks.loadTasks(agentId).finally(() => reading.delete(agentId));
    },
    onOpen: input.openThread,
    onNew: input.onNew,
  };
}
