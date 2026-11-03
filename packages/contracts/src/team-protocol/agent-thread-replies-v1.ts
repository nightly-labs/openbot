// Frozen optional agent-thread-replies-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member who can
// send a message to an agent can send a reply to a message of one of its side threads. A side thread is
// a task of `agent-tasks-v1`, named by its task id. `replyToMessageId` names the message that the reply
// quotes. The host keeps it with the message, and the agent and the thread show the quoted message
// when the thread has it; the host does not refuse an id that the thread does not have. The message
// has text, attachment drafts from `POST /v1/attachments` (at most 10, as for `agent-thread-files-v1`),
// or both. A host that grants this also grants `agent-tasks-v1` and `agent-thread-files-v1`. The host
// does not ask for a role, as for `agent-tasks-v1`, and records the member as the sender. A hidden
// agent, or an agent that the peer cannot see, is not found (404). The answer is the frozen
// `agent-tasks-v1` send receipt. The route is a POST with its ids in the body. Bounds and meaning do
// not follow IPC changes; widening any of it needs a second capability string.
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";
import { AGENT_THREAD_FILES_LIMIT } from "./agent-thread-files-v1";

export const AGENT_THREAD_REPLIES_CAPABILITY = "agent-thread-replies-v1";
export const AGENT_THREAD_REPLIES_ROUTES = {
  send: "/v1/agent-threads/send-reply",
} as const;

const NAMES = ["agentId", "taskId", "text", "attachmentDraftIds", "replyToMessageId", "clientMessageId"];
const decodeFields = fields(
  {
    agentId: identifier,
    taskId: identifier,
    text: string(100_000),
    attachmentDraftIds: list(identifier, AGENT_THREAD_FILES_LIMIT),
    replyToMessageId: identifier,
  },
  { clientMessageId: identifier },
);
/** Only the known fields, and text or a file. */
const send: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !NAMES.includes(key)))
    throw new Error("Invalid agent thread request.");
  const value = decodeFields(input);
  if (!isDynamicRecord(value) || typeof value.text !== "string" || !Array.isArray(value.attachmentDraftIds))
    throw new Error("Invalid agent thread request.");
  if (!value.text.trim() && value.attachmentDraftIds.length === 0) throw new Error("Invalid agent thread request.");
  return value;
};

const receipt = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.send)?.response;
if (!receipt) throw new Error(`No agent-tasks-v1 codec for ${AGENT_TASKS_ROUTES.send}.`);

export const AGENT_THREAD_REPLIES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_THREAD_REPLIES_ROUTES.send, { request: send, response: receipt }],
]);
