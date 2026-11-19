import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, fields, identifier, list, type OptionalRouteCodec, string } from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_THREAD_FILES_CAPABILITY = "agent-thread-files-v1";
export const AGENT_THREAD_FILES_ROUTES = {
  start: "/v1/agent-threads/start-with-files",
  send: "/v1/agent-threads/send-with-files",
} as const;

export const AGENT_THREAD_FILES_LIMIT = 10;

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid agent thread request.");
    return decode(input);
  };
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

function taskAnswer(path: string): OptionalRouteCodec["response"] {
  const codec = AGENT_TASKS_CODECS.get(path);
  if (!codec) throw new Error(`No agent-tasks-v1 codec for ${path}.`);
  return codec.response;
}

export const AGENT_THREAD_FILES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_THREAD_FILES_ROUTES.start, { request: start, response: taskAnswer(AGENT_TASKS_ROUTES.start) }],
  [AGENT_THREAD_FILES_ROUTES.send, { request: send, response: taskAnswer(AGENT_TASKS_ROUTES.send) }],
]);
