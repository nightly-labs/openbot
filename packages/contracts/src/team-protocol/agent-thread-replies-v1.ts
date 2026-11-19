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
