// Frozen optional agent-threads-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member who can
// send a message to an agent can also rename and delete its side threads. A side thread is a task of
// `agent-tasks-v1`, and its id is the same task id. A host that grants this also grants
// `agent-tasks-v1`; the list, read, start, send, stop, archive (close) and restore (reopen) routes stay
// there. The host does not ask for a role, as for `agent-tasks-v1`. A hidden agent, or an agent that
// the peer cannot see, is not found (404). A rename is one line of 1 to 120 characters after trim, and
// the title then no longer follows the first message. A delete removes the thread, its conversation,
// its attachments and its queued messages for good; the host refuses it while a turn of that thread
// runs. The agent's own chat is not a task, so neither route can name it. Every route is a POST with
// its ids in the body. The host sends `agent-tasks-changed` after each change. Bounds and meaning do
// not follow IPC changes; widening any of it needs a second capability string.
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
