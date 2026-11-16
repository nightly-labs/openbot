import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";
import { AGENT_QUEUE_TASK_CAPABILITY } from "@openbot/contracts/team-protocol/agent-queue-task-v1";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import {
  AGENT_THREAD_BRANCHES_CAPABILITY,
  withAgentThreadBranches,
} from "@openbot/contracts/team-protocol/agent-thread-branches-v1";
import { AGENT_THREAD_FILES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-files-v1";
import { AGENT_THREAD_PAGES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-pages-v1";
import {
  AGENT_THREAD_QUEUE_CAPABILITY,
  AGENT_THREAD_QUEUE_ROUTES,
  isAgentThreadQueues,
  withAgentThreadQueues,
} from "@openbot/contracts/team-protocol/agent-thread-queue-v1";
import { AGENT_THREAD_READS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREAD_REPLIES_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-replies-v1";
import { AGENT_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { MESSAGE_DELETE_CAPABILITY, MESSAGE_DELETE_ROUTES } from "@openbot/contracts/team-protocol/message-delete-v1";
import { MESSAGE_PINS_CAPABILITY } from "@openbot/contracts/team-protocol/message-pins-v1";
import { runTeamEffect } from "@openbot/team-client";
import {
  agentTaskControl,
  branchAgentThread,
  cancelQueuedMessage,
  deleteAgentThread,
  listAgentTasks,
  listAgentThreadBranches,
  markAgentThreadRead,
  readAgentTask,
  readAgentThreadAround,
  readAgentThreadPage,
  renameAgentThread,
  runQueuedMessageAsAgentTask,
  sendAgentTaskMessage,
  startAgentTask,
  steerQueuedMessage,
  type TeamApiRequest,
  type TeamRequestError,
} from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { onCleanup, untrack } from "solid-js";
import type { AgentTasksPort } from "../agent-tasks/agent-tasks-port";
import { createAgentTasks, isAgentTaskEvent } from "../agent-tasks/agent-tasks-state";
import { createAgentThreadTabs } from "../agent-threads/agent-thread-tabs";
import type { WebWorkspace } from "./web-client-context";

/** The host names attachment previews with the desktop `openbot-attachment:` scheme, which a browser cannot load. */
export function withoutPreviewUrls(snapshot: ConversationSnapshot): ConversationSnapshot {
  return {
    ...snapshot,
    messages: snapshot.messages.map((message) =>
      message.attachments
        ? { ...message, attachments: message.attachments.map((attachment) => ({ ...attachment, previewUrl: null })) }
        : message,
    ),
  };
}

const decodeThreadQueues = guardedDecoder(isAgentThreadQueues, "agent thread queue response");

/**
 * The side threads of one host: the `agent-tasks-v1` routes, rename and delete through
 * `agent-threads-v1`, branches through `agent-thread-branches-v1` when `branchable` is true, and the
 * queue of each thread through `agent-thread-queue-v1` when `queued` is true. The branch links and the
 * queues are read after the tasks, so that each listed task has them. Each call reads the request
 * again: it fails once the tab leaves the host.
 */
function webAgentTasksPort(
  request: () => TeamApiRequest,
  branchable: () => boolean,
  queued: () => boolean,
): AgentTasksPort {
  const run = async <A>(call: (request: TeamApiRequest) => Effect.Effect<A, TeamRequestError>) =>
    runTeamEffect(call(request()).pipe(Effect.mapError((error) => error.cause)));
  const readQueues = (agentId: string) =>
    request()("POST", AGENT_THREAD_QUEUE_ROUTES.list, decodeThreadQueues, { agentId });
  const queue: NonNullable<AgentTasksPort["queue"]> = {
    cancelQueuedMessage: (input) => run((host) => cancelQueuedMessage(host, input)),
    steerQueuedMessage: (input) => run((host) => steerQueuedMessage(host, input)),
    // The panel of a thread orders only its own queue. The response is empty.
    reorderQueue: async ({ agentId, taskId, deliveryIds }) => {
      if (taskId === undefined) return;
      await request()("POST", AGENT_THREAD_QUEUE_ROUTES.reorder, () => undefined, { agentId, taskId, deliveryIds });
    },
  };
  return {
    listTasks: async (agentId) => {
      // An effect callback can ask for the list: the capabilities are input here, not dependencies.
      const snapshot = await run((host) =>
        untrack(branchable)
          ? Effect.gen(function* () {
              const tasks = yield* listAgentTasks(host, agentId);
              return withAgentThreadBranches(tasks, yield* listAgentThreadBranches(host, agentId));
            })
          : listAgentTasks(host, agentId),
      );
      return untrack(queued) ? withAgentThreadQueues(snapshot, await readQueues(agentId)) : snapshot;
    },
    // The panel of a thread shows its queue actions only while the host serves `agent-thread-queue-v1`.
    get queue() {
      return queued() ? queue : undefined;
    },
    readTask: (input) => run((host) => readAgentTask(host, input).pipe(Effect.map(withoutPreviewUrls))),
    readTaskPage: (input) =>
      run((host) =>
        readAgentThreadPage(host, input).pipe(
          Effect.map((page) => ({ ...page, conversation: withoutPreviewUrls(page.conversation) })),
        ),
      ),
    readTaskAround: (input) =>
      run((host) =>
        readAgentThreadAround(host, input).pipe(
          Effect.map((part) => ({ ...part, conversation: withoutPreviewUrls(part.conversation) })),
        ),
      ),
    startTask: (input) => run((host) => startAgentTask(host, input)),
    sendToTask: (input) => run((host) => sendAgentTaskMessage(host, input)),
    stopTask: (input) => run((host) => agentTaskControl(host, "stop", input)),
    closeTask: (input) => run((host) => agentTaskControl(host, "close", input)),
    reopenTask: (input) => run((host) => agentTaskControl(host, "reopen", input)),
    renameTask: (input) => run((host) => renameAgentThread(host, input)),
    deleteTask: (input) => run((host) => deleteAgentThread(host, input)),
    markTaskRead: (input) => run((host) => markAgentThreadRead(host, input)),
    branchTask: (input) => run((host) => branchAgentThread(host, input)),
    // The menu item shows only while the host serves `agent-queue-task-v1`.
    runQueuedMessageAsTask: (input) => run((host) => runQueuedMessageAsAgentTask(host, input)),
    // The response is empty.
    deleteTaskMessage: async ({ agentId, taskId, messageId }) => {
      await request()("POST", MESSAGE_DELETE_ROUTES.task, () => undefined, { agentId, taskId, messageId });
    },
  };
}

/**
 * The side threads and thread tabs of the connected host. Make it in an owner of that host: when the
 * owner ends, it stops listening. A delete that waits for its Undo time then fails, because the tab
 * has left the host. The thread stays archived, and the next connection to the host finishes the delete.
 */
export function createWebAgentThreads(options: {
  workspace: Pick<WebWorkspace, "state" | "onHostEvent">;
  hostId: string;
  request: () => TeamApiRequest;
}) {
  const { workspace, hostId } = options;
  const branchable = () => workspace.state.capabilities.includes(AGENT_THREAD_BRANCHES_CAPABILITY);
  const queued = () => workspace.state.capabilities.includes(AGENT_THREAD_QUEUE_CAPABILITY);
  const port = webAgentTasksPort(options.request, branchable, queued);
  const tasks = createAgentTasks({
    port: () => port,
    activeAgentId: () => workspace.state.selectedId ?? undefined,
    queuedMessageMovable: () => workspace.state.capabilities.includes(AGENT_QUEUE_TASK_CAPABILITY),
    available: () => workspace.state.capabilities.includes(AGENT_TASKS_CAPABILITY),
    editable: () => workspace.state.capabilities.includes(AGENT_THREADS_CAPABILITY),
    readable: () => workspace.state.capabilities.includes(AGENT_THREAD_READS_CAPABILITY),
    branchable,
    filesAccepted: () => workspace.state.capabilities.includes(AGENT_THREAD_FILES_CAPABILITY),
    repliable: () => workspace.state.capabilities.includes(AGENT_THREAD_REPLIES_CAPABILITY),
    messageDeletable: () => workspace.state.capabilities.includes(MESSAGE_DELETE_CAPABILITY),
    pageable: () => workspace.state.capabilities.includes(AGENT_THREAD_PAGES_CAPABILITY),
    aroundReadable: () => workspace.state.capabilities.includes(MESSAGE_PINS_CAPABILITY),
    // A reconnect sends a runtime snapshot, which reads the threads again.
    reloadKey: () => null,
  });
  const tabs = createAgentThreadTabs({
    serverId: () => hostId,
    activeAgentId: () => workspace.state.selectedId ?? undefined,
    tasks,
  });
  onCleanup(
    workspace.onHostEvent((event) => {
      if (workspace.state.host?.hostId !== hostId) return;
      // A thread can change while the host is away.
      if (event.type === "runtime-snapshot") tasks.reload();
      else if (event.type === "agent-task-conversation")
        tasks.applyEvent({ ...event, snapshot: withoutPreviewUrls(event.snapshot) });
      else if (isAgentTaskEvent(event)) tasks.applyEvent(event);
    }),
  );
  return { tasks, tabs };
}
