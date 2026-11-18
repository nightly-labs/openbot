import { isDynamicRecord, isString } from "../runtime-values";
import { isUuidV4 } from "../validation";

// Frozen optional agent-create-operation-v1 contract.
//
// What it grants, recorded here because freezing it makes it permanent: the body of `POST /v1/agents`
// can have `operationId`, a UUID v4 that the client makes for one create. When the answer of a create
// gets lost, the client sends the same create again with the same `operationId`. Within one day, the
// host then answers with the agent that the first create made, as the released route answers, and
// makes no second agent and sends no second initial message. The id is scoped to the member who sends
// it. When the first create failed, or its agent or its initial message was deleted, the host makes a
// new agent. A host that sends it reads the field; a client sends the field only to a host that sends
// it. Without it, each create makes a new agent, as before. The response keeps the frozen shape. A
// protocol 9 capability only. Widening any of it needs a second capability string.

export const AGENT_CREATE_OPERATION_CAPABILITY = "agent-create-operation-v1";

/** The `operationId` of an agent create request, read off the raw body. A malformed one fails closed. */
export function decodeAgentCreateOperation(source: unknown): { operationId?: string } {
  if (!isDynamicRecord(source) || source.operationId === undefined) return {};
  if (!isString(source.operationId) || !isUuidV4(source.operationId)) throw new Error("Invalid operation id.");
  return { operationId: source.operationId };
}
