// Frozen optional pending-approval-v1 wire contract. The codec reads its bounds from literals, not IPC limits.
//
// What it grants, recorded here because freezing it makes it permanent: a member who can answer an
// approval of an agent (the `chat` level) can read the whole copy of one approval that the agent waits
// on. The runtime snapshot cuts each text of an approval to 240 characters, so a client that did not
// get the `approval` event, such as a phone that connects later, cannot show it all. The whole copy is
// the copy that the `approval` event carries. The host refuses an agent that the client cannot see, a
// request that is not pending, and a request of another agent. Widening it needs a second capability
// string.
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

/** A provider request ID: an identifier or a finite number, as the `approval` event carries it. */
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

/** The approval in a host answer, as the client type. The transport has already run it through the codec above. */
export function decodePendingApprovalResponse(value: unknown): AgentApproval {
  if (!isDynamicRecord(value) || !isAgentApproval(value.approval)) throw new Error("Invalid pending approval.");
  return value.approval;
}
