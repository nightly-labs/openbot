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

const REPOSITORIES = 1_000;
const DELIVERIES = 2_000;
const RUNS = 500;
const OPTIONS = 500;

const timestamp = string(64);
const repository = string(140);
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
