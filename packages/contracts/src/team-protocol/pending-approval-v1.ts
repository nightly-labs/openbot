import { type AgentApproval, isAgentApproval } from "../ipc-approvals";
import { isDynamicRecord, isString } from "../runtime-values";
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire";

export const PENDING_APPROVAL_CAPABILITY = "pending-approval-v1";

export const PENDING_APPROVAL_ROUTES = {
  read: "/v1/agent-approvals/read",
} as const;

const requestId: AdminDecoder = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (isString(value) && value.length > 0 && value.length <= 128) return value;
  throw new Error("Invalid approval request ID.");
};

const paths = list(string(4_096), 100);

const approval = fields({
  requestId,
  agentId: identifier,
  threadId: identifier,
  turnId: identifier,
  kind: oneOf("command", "file-change", "permissions"),
  command: nullable(string(100_000)),
  cwd: nullable(string(4_096)),
  reason: nullable(string(100_000)),
  grantRoot: nullable(string(4_096)),
  permissions: nullable(fields({ fileSystem: fields({ read: paths, write: paths }), network: boolean })),
});

export const PENDING_APPROVAL_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [PENDING_APPROVAL_ROUTES.read, adminRoute(fields({ agentId: identifier, requestId }), fields({ approval }))],
]);

export function decodePendingApprovalResponse(value: unknown): AgentApproval {
  if (!isDynamicRecord(value) || !isAgentApproval(value.approval)) throw new Error("Invalid pending approval.");
  return value.approval;
}
