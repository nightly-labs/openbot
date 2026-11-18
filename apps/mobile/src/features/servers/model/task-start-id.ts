import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
import * as Crypto from "expo-crypto";

const startIds = retryOperationIds(() => Crypto.randomUUID());

/**
 * The client id of one task start. A failed start can still have made its task on the server (the
 * answer got lost), so a retry of the same start, from any screen, sends the same id and gets that
 * task, not a second one. Call `failed` when the start fails.
 */
export function taskStartId(serverId: string, agentId: string, text: string, fileIds: readonly string[] = []) {
  return startIds([serverId, agentId, text, fileIds]);
}
