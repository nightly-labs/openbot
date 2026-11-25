import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, adminRoute, empty, fields, identifier, type OptionalRouteCodec } from "./admin-wire";

export const AGENT_THREADS_CAPABILITY = "agent-threads-v1";
export const AGENT_THREADS_ROUTES = {
  rename: "/v1/agent-threads/rename",
  delete: "/v1/agent-threads/delete",
} as const;

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent thread request.");
    return decode(input);
  };
const title: AdminDecoder = (input) => {
  if (typeof input !== "string") throw new Error("Invalid agent thread title.");
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 120 || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(trimmed))
    throw new Error("Invalid agent thread title.");
  return trimmed;
};
const rename = exact(["agentId", "taskId", "title"], fields({ agentId: identifier, taskId: identifier, title }));
const agentThread = exact(["agentId", "taskId"], fields({ agentId: identifier, taskId: identifier }));

export const AGENT_THREADS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_THREADS_ROUTES.rename, adminRoute(rename, empty)],
  [AGENT_THREADS_ROUTES.delete, adminRoute(agentThread, empty)],
]);
