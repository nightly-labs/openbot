import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, fields, identifier, type OptionalRouteCodec } from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_QUEUE_TASK_CAPABILITY = "agent-queue-task-v1";
export const AGENT_QUEUE_TASK_ROUTES = {
  run: "/v1/agent-tasks/from-queued-message",
} as const;

const KEYS = ["agentId", "deliveryId"];
const requestFields = fields({ agentId: identifier, deliveryId: identifier });
const request: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !KEYS.includes(key)))
    throw new Error("Invalid queued message task request.");
  return requestFields(input);
};

function taskAnswer(): OptionalRouteCodec["response"] {
  const start = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.start);
  if (!start) throw new Error("No agent-tasks-v1 codec for the task start.");
  return start.response;
}

export const AGENT_QUEUE_TASK_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_QUEUE_TASK_ROUTES.run, { request, response: taskAnswer() }],
]);
