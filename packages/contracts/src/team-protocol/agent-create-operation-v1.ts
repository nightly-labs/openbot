import { isDynamicRecord, isString } from "../runtime-values";
import { isUuidV4 } from "../validation";

export const AGENT_CREATE_OPERATION_CAPABILITY = "agent-create-operation-v1";

export function decodeAgentCreateOperation(source: unknown): { operationId?: string } {
  if (!isDynamicRecord(source) || source.operationId === undefined) return {};
  if (!isString(source.operationId) || !isUuidV4(source.operationId)) throw new Error("Invalid operation id.");
  return { operationId: source.operationId };
}
