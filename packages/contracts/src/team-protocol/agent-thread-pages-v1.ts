// Frozen optional agent-thread-pages-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: a signed-in member who can
// read the side threads of an agent can read the older messages of one of them, page by page. A side
// thread is a task of `agent-tasks-v1`, named by its task id. `beforeMessageId` names a message of the
// thread that the client holds, usually its oldest. The answer has the messages from before it, oldest
// first, in the frozen `agent-tasks-v1` conversation shape, and `hasOlder` says if the thread has more
// before them. `limit` (0 to 100) is a target, not a bound: the host sends whole turns, and adds turns
// until the page has `limit` messages or the next turn does not fit. A page can thus have more or fewer
// messages than `limit`, and never more than 100. A turn of more than 100 messages is split over
// pages. The host can also send fewer so that the answer fits
// one WebRTC frame. A limit of 0 asks only for `hasOlder`. A message that the thread does not hold gives
// no messages and `hasOlder: false`. A host that grants this also grants `agent-tasks-v1`. The host does not ask for a
// role, as for `agent-tasks-v1` reads. A hidden agent, or an agent that the peer cannot see, is not
// found (404). The route is a POST with its ids in the body. Bounds and meaning do not follow IPC
// changes; widening any of it needs a second capability string.
import { isDynamicRecord } from "../runtime-values";
import { type AdminDecoder, adminRoute, boolean, fields, identifier, type OptionalRouteCodec } from "./admin-wire";
import { AGENT_TASKS_CODECS, AGENT_TASKS_ROUTES } from "./agent-tasks-v1";

export const AGENT_THREAD_PAGES_CAPABILITY = "agent-thread-pages-v1";
export const AGENT_THREAD_PAGES_ROUTES = {
  readOlder: "/v1/agent-threads/read-older",
} as const;
/** The most messages that one page of a thread carries. */
export const AGENT_THREAD_PAGE_LIMIT = 100;

const NAMES = ["agentId", "taskId", "beforeMessageId", "limit"];
const limit: AdminDecoder = (input) => {
  if (typeof input !== "number" || !Number.isInteger(input) || input < 0 || input > AGENT_THREAD_PAGE_LIMIT)
    throw new Error("Invalid agent thread page limit.");
  return input;
};
const decodeFields = fields({ agentId: identifier, taskId: identifier, beforeMessageId: identifier, limit });
const readOlder: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => !NAMES.includes(key)))
    throw new Error("Invalid agent thread page request.");
  return decodeFields(input);
};

const read = AGENT_TASKS_CODECS.get(AGENT_TASKS_ROUTES.read)?.response;
if (!read) throw new Error(`No agent-tasks-v1 codec for ${AGENT_TASKS_ROUTES.read}.`);
/** The frozen `agent-tasks-v1` conversation of a task read. */
const conversation: AdminDecoder = (input) => read(200, input);

export const AGENT_THREAD_PAGES_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_THREAD_PAGES_ROUTES.readOlder, adminRoute(readOlder, fields({ conversation, hasOlder: boolean }))],
]);
