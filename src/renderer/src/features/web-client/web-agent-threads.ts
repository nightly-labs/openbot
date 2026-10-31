import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { AGENT_TASKS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-tasks-v1";
import {
  AGENT_THREAD_BRANCHES_CAPABILITY,
  withAgentThreadBranches,
} from "@openbot/contracts/team-protocol/agent-thread-branches-v1";
import { AGENT_THREAD_READS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-thread-reads-v1";
import { AGENT_THREADS_CAPABILITY } from "@openbot/contracts/team-protocol/agent-threads-v1";
import { runTeamEffect } from "@openbot/team-client";
import {
  agentTaskControl,
  branchAgentThread,
  deleteAgentThread,
  listAgentTasks,
  listAgentThreadBranches,
  markAgentThreadRead,
  readAgentTask,
  renameAgentThread,
  sendAgentTaskMessage,
  startAgentTask,
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

/**
 * The side threads of one host: the `agent-tasks-v1` routes, rename and delete through
 * `agent-threads-v1`, and branches through `agent-thread-branches-v1` when `branchable` is true. The
 * branch links are read after the tasks, so that each listed branch has its link. Each call reads the
 * request again: it fails once the tab leaves the host.
 */
function webAgentTasksPort(request: () => TeamApiRequest, branchable: () => boolean): AgentTasksPort {
  const run = async <A>(call: (request: TeamApiRequest) => Effect.Effect<A, TeamRequestError>) =>
    runTeamEffect(call(request()).pipe(Effect.mapError((error) => error.cause)));
  return {
    listTasks: (agentId) =>
      run((host) =>
        // An effect callback can ask for the list: the capability is input here, not a dependency.
        untrack(branchable)
          ? Effect.gen(function* () {
              const snapshot = yield* listAgentTasks(host, agentId);
              return withAgentThreadBranches(snapshot, yield* listAgentThreadBranches(host, agentId));
            })
          : listAgentTasks(host, agentId),
      ),
    readTask: (input) => run((host) => readAgentTask(host, input).pipe(Effect.map(withoutPreviewUrls))),
    startTask: (input) => run((host) => startAgentTask(host, input)),
    sendToTask: (input) => run((host) => sendAgentTaskMessage(host, input)),
    stopTask: (input) => run((host) => agentTaskControl(host, "stop", input)),
    closeTask: (input) => run((host) => agentTaskControl(host, "close", input)),
    reopenTask: (input) => run((host) => agentTaskControl(host, "reopen", input)),
    renameTask: (input) => run((host) => renameAgentThread(host, input)),
    deleteTask: (input) => run((host) => deleteAgentThread(host, input)),
    markTaskRead: (input) => run((host) => markAgentThreadRead(host, input)),
    branchTask: (input) => run((host) => branchAgentThread(host, input)),
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
  const port = webAgentTasksPort(options.request, branchable);
  const tasks = createAgentTasks({
    port: () => port,
    activeAgentId: () => workspace.state.selectedId ?? undefined,
    local: () => false,
    available: () => workspace.state.capabilities.includes(AGENT_TASKS_CAPABILITY),
    editable: () => workspace.state.capabilities.includes(AGENT_THREADS_CAPABILITY),
    readable: () => workspace.state.capabilities.includes(AGENT_THREAD_READS_CAPABILITY),
    branchable,
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
