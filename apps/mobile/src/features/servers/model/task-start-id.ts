import { retryOperationIds } from "@openbot/team-client/retry-operation-id";
import * as Crypto from "expo-crypto";

const startIds = retryOperationIds(() => Crypto.randomUUID());

export function taskStartId(serverId: string, agentId: string, text: string, fileIds: readonly string[] = []) {
  return startIds([serverId, agentId, text, fileIds]);
}
