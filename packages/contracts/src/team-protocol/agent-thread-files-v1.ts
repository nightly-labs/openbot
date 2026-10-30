// Frozen optional agent-thread-files-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member who can
// send a message to an agent can start a side thread, or send to one, with files. A side thread is a
// task of `agent-tasks-v1`, named by its task id. A host that grants this also grants `agent-tasks-v1`,
// whose `start` and `send` routes stay text only. The files are attachment drafts that the member
// uploaded with `POST /v1/attachments`, at most 10, as for `POST /v1/agents/:id/messages`; the message
// then can have no text. The host does not ask for a role, as for `agent-tasks-v1`, and records the
// member as the sender. A hidden agent, or an agent that the peer cannot see, is not found (404). The
// answers are the frozen `agent-tasks-v1` answers: `start` answers the new task, `send` the receipt.
// Every route is a POST with its ids in the body. Bounds and meaning do not follow IPC changes;
// widening any of it needs a second capability string.
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_THREAD_FILES_CAPABILITY = "agent-thread-files-v1";
export const AGENT_THREAD_FILES_ROUTES = {
  start: "/v1/agent-threads/start-with-files",
  send: "/v1/agent-threads/send-with-files",
} as const;

/** The most attachment drafts that one message carries. */
export const AGENT_THREAD_FILES_LIMIT = 10;

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent thread request.");
    return decode(input);
  };
/** A message has text, files, or both. */
const message =
  (decode: AdminDecoder): AdminDecoder =>
  (input) => {
    const value = decode(input);
    if (!isDynamicRecord(value) || typeof value.text !== "string" || !Array.isArray(value.attachmentDraftIds))
      throw new Error("Invalid agent thread request.");
    if (!value.text.trim() && value.attachmentDraftIds.length === 0) throw new Error("Invalid agent thread request.");
    return value;
  };
const text = string(100_000);
const drafts = list(identifier, AGENT_THREAD_FILES_LIMIT);
const start = exact(
  ["agentId", "text", "attachmentDraftIds", "clientMessageId"],
  message(fields({ agentId: identifier, text, attachmentDraftIds: drafts }, { clientMessageId: identifier })),
);
const send = exact(
  ["agentId", "taskId", "text", "attachmentDraftIds", "clientMessageId"],
  message(
    fields(
      { agentId: identifier, taskId: identifier, text, attachmentDraftIds: drafts },
      { clientMessageId: identifier },
    ),
  ),
);

/** The frozen `agent-tasks-v1` answer of a route. */
function taskAnswer(path: string): OptionalRouteCodec["response"] {
  const codec = AGENT_TASKS_CODECS.get(path);
  if (!codec) throw new Error(`No agent-tasks-v1 codec for ${path}.`);
  return codec.response;
}

export const AGENT_THREAD_FILES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_THREAD_FILES_ROUTES.start, { request: start, response: taskAnswer(AGENT_TASKS_ROUTES.start) }],
  [AGENT_THREAD_FILES_ROUTES.send, { request: send, response: taskAnswer(AGENT_TASKS_ROUTES.send) }],
]);
