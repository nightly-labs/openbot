// Frozen optional workflows-github-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: it adds GitHub triggers and
// GitHub outputs to `workflows-v1`, whose routes and grants stay as they are. A host that advertises
// it runs a trigger node with `trigger: "github"` and an output node with `target: "github"`; their
// settings cross in the open node fields of `workflows-v1`. A GitHub output acts as the host's GitHub
// App bot, so only an owner or admin can add a GitHub trigger or a GitHub output, or change one, as
// only they can for an output that posts to a messaging place; a member can run one that is there.
// A member who reads a workflow reads its GitHub event history: for each event, the item number,
// its title, the event name and what the host did with it. The event body does not cross. The
// repository list, labels and people of the host's GitHub connection go only to an owner or admin,
// as they show what the host's GitHub sign-in reaches. A run with the last event needs the chat level
// for each agent of the workflow, as `workflows-v1` start-run does. Widening any of it needs a second
// capability string.
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire";
import { WORKFLOWS_CODECS, WORKFLOWS_ROUTES } from "./workflows-v1";

export const WORKFLOWS_GITHUB_CAPABILITY = "workflows-github-v1";

export const WORKFLOWS_GITHUB_ROUTES = {
  catalog: "/v1/workflows/github/catalog",
  options: "/v1/workflows/github/options",
  history: "/v1/workflows/github/history",
  runLastEvent: "/v1/workflows/github/run-last-event",
} as const;

/** The most repositories, events and run items that one answer carries. */
const REPOSITORIES = 1_000;
const DELIVERIES = 2_000;
const RUNS = 500;
const OPTIONS = 500;

const timestamp = string(64);
/** `owner/name`; the host checks the characters. */
const repository = string(140);
/**
 * An event, an outcome or a reason. A newer host can add one in this capability, so the decoder
 * accepts any short name and the client maps a name it does not know.
 */
const token: AdminDecoder = (value) => {
  if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9.-]{0,31}$/u.test(value))
    throw new Error("Invalid GitHub workflow value.");
  return value;
};
const itemNumber: AdminDecoder = (value) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error("Invalid GitHub item number.");
  return value;
};
const item = fields({ repository, number: itemNumber, pullRequest: boolean, title: string(1_024) });
const delivery = fields({
  id: identifier,
  nodeId: identifier,
  event: token,
  item: nullable(item),
  receivedAt: timestamp,
  outcome: token,
  reason: nullable(token),
  runId: nullable(identifier),
});
const history = fields({
  deliveries: list(delivery, DELIVERIES),
  runs: list(fields({ runId: identifier, item }), RUNS),
});
const catalog = fields({
  connected: boolean,
  repositories: list(
    fields({ fullName: repository, private: boolean, canWrite: boolean, events: boolean }),
    REPOSITORIES,
  ),
});
const color: AdminDecoder = (value) => {
  if (typeof value !== "string" || !/^[0-9a-fA-F]{6}$/u.test(value)) throw new Error("Invalid GitHub label colour.");
  return value;
};
const options = fields({
  labels: list(fields({ name: string(100), color }), OPTIONS),
  people: list(string(39), OPTIONS),
});

/** The frozen `workflows-v1` run of a start. */
function runAnswer(): OptionalRouteCodec["response"] {
  const start = WORKFLOWS_CODECS.get(WORKFLOWS_ROUTES.startRun);
  if (!start) throw new Error("No workflows-v1 codec for the run start.");
  return start.response;
}

export const WORKFLOWS_GITHUB_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOWS_GITHUB_ROUTES.catalog, adminRoute(empty, catalog)],
  [WORKFLOWS_GITHUB_ROUTES.options, adminRoute(fields({ repository }), options)],
  [WORKFLOWS_GITHUB_ROUTES.history, adminRoute(fields({ workflowId: identifier }), history)],
  [
    WORKFLOWS_GITHUB_ROUTES.runLastEvent,
    {
      request: fields({ workflowId: identifier, nodeId: identifier, requestId: identifier }),
      response: runAnswer(),
    },
  ],
]);
