import type { AgentMessage } from "@openbot/ui/data";
import { MAIN_THREAD_ID } from "@openbot/ui/features/conversation/threads/thread-types";
import { AgentWorkPane } from "@openbot/ui/features/tasks/AgentWork";
import { createEffect, createMemo } from "solid-js";
import { useTurns } from "../../turns";
import { useAgentTasks } from "../agent-tasks/agent-tasks-context";
import { useAgentThreads } from "../agent-threads/agent-threads-context";
import { useAgents } from "../agents/agents-context";
import { useConversation } from "../conversation/conversation-context";
import { type AgentWorkMessage, buildAgentWork } from "./agent-work-tree";

function fromChat(message: AgentMessage): AgentWorkMessage {
  return { ...message, text: message.body };
}

/**
 * The work of one agent, in the Work pane of its side panel: its main chat and open threads, with the
 * subagents and the teammates that each one started. A chat or thread row opens it in the chat, and
 * the tree stays beside it.
 */
export function AgentWorkView(props: { agentId: string }) {
  const { agentList } = useAgents();
  const { conversations, loadLatestAgentMessages } = useConversation();
  const { activeTurns, failedTurns } = useTurns();
  const agentTasks = useAgentTasks();
  const agentThreads = useAgentThreads();

  const chatOf = (agentId: string) => (conversations[agentId]?.messages ?? []).map(fromChat);
  const openTasks = (agentId: string) =>
    (agentTasks.snapshot(agentId)?.tasks ?? []).filter((task) => task.state !== "closed");

  const nodes = createMemo(() => {
    const agentId = props.agentId;
    return buildAgentWork({
      agentId,
      chat: chatOf(agentId),
      chatRunning: Boolean(activeTurns()[agentId]),
      chatFailed: failedTurns()[agentId] !== undefined,
      tasks: openTasks(agentId).map((task) => ({
        task,
        messages: agentTasks.conversation(task.id)?.messages ?? [],
      })),
      messagesOf: chatOf,
    });
  });

  // The list of threads, once for each agent whose work shows.
  createEffect(
    () => props.agentId,
    (agentId) => {
      if (!agentTasks.snapshot(agentId)) void agentTasks.loadTasks(agentId);
    },
  );

  // The messages of each open thread. A thread that the chat opened is already read.
  const unreadTasks = createMemo(() =>
    openTasks(props.agentId)
      .filter((task) => !agentTasks.conversation(task.id))
      .map((task) => task.id)
      .join("\n"),
  );
  createEffect(
    () => ({ agentId: props.agentId, ids: unreadTasks() }),
    ({ agentId, ids }) => {
      if (ids === "") return;
      for (const taskId of ids.split("\n")) agentTasks.openTask(agentId, taskId);
    },
  );

  // The latest messages of each teammate, where the sessions that it started for the agent show.
  const unreadTeammates = createMemo(() => {
    const ids = new Set<string>();
    const visit = (list: ReturnType<typeof nodes>) => {
      for (const node of list) {
        if (node.kind === "teammate" && !conversations[node.agentId]?.loaded && !conversations[node.agentId]?.loading) {
          ids.add(node.agentId);
        }
        visit(node.children);
      }
    };
    visit(nodes());
    return [...ids].sort().join("\n");
  });
  createEffect(unreadTeammates, (ids) => {
    if (ids === "") return;
    // A teammate whose messages do not load shows its request without the sessions under it.
    for (const agentId of ids.split("\n")) void loadLatestAgentMessages(agentId).catch(() => undefined);
  });

  return (
    <AgentWorkPane
      agentId={props.agentId}
      agents={agentList()}
      nodes={nodes()}
      onOpen={(node) => agentThreads.open(props.agentId, node.kind === "task" ? node.id : MAIN_THREAD_ID)}
    />
  );
}
