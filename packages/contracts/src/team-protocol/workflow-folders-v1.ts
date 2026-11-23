import { isDynamicRecord } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
} from "./admin-wire";

export const WORKFLOW_FOLDERS_CAPABILITY = "workflow-folders-v1";
export const WORKFLOW_FOLDERS_ROUTES = {
  read: "/v1/workflow-folders",
  actions: "/v1/workflow-folders/actions",
} as const;

const FOLDER_LIMIT = 200;
const NAME_LIMIT = 80;
const PLACEMENT_LIMIT = 10_000;
const ACTION_WORKFLOW_LIMIT = 1_000;

const name: AdminDecoder = (input) => {
  if (typeof input !== "string" || input.length === 0 || input.length > NAME_LIMIT)
    throw new Error("Invalid workflow folder name.");
  return input;
};
const placement: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).length > PLACEMENT_LIMIT)
    throw new Error("Invalid workflow folder placement.");
  return Object.fromEntries(
    Object.entries(input).map(([workflowId, folderId]) => [identifier(workflowId), identifier(folderId)]),
  );
};
const folder = fields({ id: identifier, name });
const workflowIds = list(identifier, ACTION_WORKFLOW_LIMIT);
const snapshot = fields({ revision: count, folders: list(folder, FOLDER_LIMIT), placement });

const exact =
  (names: string[], decode: AdminDecoder): AdminDecoder =>
  (input) => {
    if (!isDynamicRecord(input) || Object.keys(input).some((key) => !names.includes(key)))
      throw new Error("Invalid workflow folder request.");
    return decode(input);
  };
const type = (value: string) => oneOf(value);
const actions = new Map<string, AdminDecoder>([
  [
    "create",
    exact(
      ["type", "id", "name", "workflowIds"],
      fields({ type: type("create"), id: identifier, name }, { workflowIds }),
    ),
  ],
  ["rename", exact(["type", "folderId", "name"], fields({ type: type("rename"), folderId: identifier, name }))],
  ["delete", exact(["type", "folderId"], fields({ type: type("delete"), folderId: identifier }))],
  [
    "place",
    exact(
      ["type", "workflowIds", "folderId"],
      fields({ type: type("place"), workflowIds, folderId: nullable(identifier) }),
    ),
  ],
]);
const action: AdminDecoder = (input) => {
  const decode = isDynamicRecord(input) && typeof input.type === "string" ? actions.get(input.type) : undefined;
  if (!decode) throw new Error("Invalid workflow folder action.");
  return decode(input);
};

export const WORKFLOW_FOLDERS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [WORKFLOW_FOLDERS_ROUTES.read, adminRoute(empty, snapshot)],
  [WORKFLOW_FOLDERS_ROUTES.actions, adminRoute(action, snapshot)],
]);

export type WorkflowFoldersEvent = { type: "workflow-folders-changed" };

export function workflowFoldersEvent(value: unknown): WorkflowFoldersEvent | null {
  if (!isDynamicRecord(value) || value.type !== "workflow-folders-changed") return null;
  return { type: "workflow-folders-changed" };
}
