// Frozen optional agent-queue-task-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can send a
// message to an agent can move one message that waits in the queue of the agent's own chat into a new
// side thread, where it starts beside the chat. This is "Run as a new thread" on a queued message. A
// host that grants this also grants `agent-tasks-v1`, and the answer is the frozen task of an
// `agent-tasks-v1` start. The host does not ask for a role, as for a task start or for a cancel of a
// queued message. A hidden agent, or an agent that the peer cannot see, is not found (404). A message
// that is not queued for that agent, and a message of a channel, are refused (409) with the host's
// message. The host sends `agent-tasks-changed` and the queue change after the move. The route is a
// POST with its ids in the body. Widening any of it needs a second capability string.
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, fields, identifier, type OptionalRouteCodec } from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_QUEUE_TASK_CAPABILITY = "agent-queue-task-v1";
export const AGENT_QUEUE_TASK_ROUTES = {
  run: "/v1/agent-tasks/from-queued-message",
} as const;

const KEYS = ["agentId", "deliveryId"];
const requestFields = fields({ agentId: identifier, deliveryId: identifier });
/** A key outside the contract is refused, not dropped. */
const request: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !KEYS.includes(key)))
    throw new Error("Invalid queued message task request.");
  return requestFields(input);
};

/** The frozen `agent-tasks-v1` task of a start. That codec also reads the error envelope. */
function taskAnswer(): OptionalRouteCodec["response"] {
  const start = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.start);
  if (!start) throw new Error("No agent-tasks-v1 codec for the task start.");
  return start.response;
}

export const AGENT_QUEUE_TASK_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_QUEUE_TASK_ROUTES.run, { request, response: taskAnswer() }],
]);
