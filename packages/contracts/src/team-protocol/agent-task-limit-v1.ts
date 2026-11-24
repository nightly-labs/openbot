import { type AdminDecoder, adminRoute, fields, identifier, nullable, type OptionalRouteCodec } from "./admin-wire";

export const AGENT_TASK_LIMIT_CAPABILITY = "agent-task-limit-v1";

export const AGENT_TASK_LIMIT_ROUTES = {
  settings: "/v1/admin/agents/task-limit",
  update: "/v1/admin/agents/task-limit/update",
} as const;

const limit: AdminDecoder = (input) => {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 1 || input > 4)
    throw new Error("Invalid agent task limit.");
  return input;
};
const taskLimit = nullable(limit);
const settings = fields({ taskLimit });

export const AGENT_TASK_LIMIT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_TASK_LIMIT_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_TASK_LIMIT_ROUTES.update, adminRoute(fields({ agentId: identifier, taskLimit }), settings)],
]);
