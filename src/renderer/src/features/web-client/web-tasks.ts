import { runTeamEffect } from "@openbot/team-client";
import {
  agentTaskControl,
  listAgentTasks,
  readAgentTask,
  sendAgentTaskMessage,
  startAgentTask,
  type TeamApiRequest,
  type TeamRequestError,
} from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { isTaskEvent, type TasksSource } from "../tasks/tasks-port";
import { withoutPreviewUrls } from "./web-agent-threads";
import type { WebWorkspace } from "./web-client-context";

/** The tasks on the web: the `agent-tasks-v1` routes and the task events of the connected host. */
export function webTasksSource(
  workspace: Pick<WebWorkspace, "state" | "onHostEvent">,
  hostRequest: (serverId?: string) => TeamApiRequest,
): TasksSource {
  const run = <A>(effect: Effect.Effect<A, TeamRequestError>) =>
    runTeamEffect(effect.pipe(Effect.mapError((error) => error.cause)));

  return {
    list: (agentId, serverId) => run(listAgentTasks(hostRequest(serverId), agentId)),
    read: (input, serverId) => run(readAgentTask(hostRequest(serverId), input).pipe(Effect.map(withoutPreviewUrls))),
    start: (input, serverId) => run(startAgentTask(hostRequest(serverId), input)),
    send: (input, serverId) => run(sendAgentTaskMessage(hostRequest(serverId), input)),
    stop: (input, serverId) => run(agentTaskControl(hostRequest(serverId), "stop", input)),
    close: (input, serverId) => run(agentTaskControl(hostRequest(serverId), "close", input)),
    reopen: (input, serverId) => run(agentTaskControl(hostRequest(serverId), "reopen", input)),
    onEvent: (serverId, apply, reload) =>
      workspace.onHostEvent((event) => {
        if (workspace.state.host?.hostId !== serverId) return;
        // A snapshot comes after a reconnect: a task can change while the host is away.
        if (event.type === "runtime-snapshot") reload();
        else if (event.type === "agent-task-conversation")
          apply({ ...event, snapshot: withoutPreviewUrls(event.snapshot) });
        else if (isTaskEvent(event)) apply(event);
      }),
  };
}
