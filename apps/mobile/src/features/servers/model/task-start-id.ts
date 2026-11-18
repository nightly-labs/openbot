import * as Crypto from "expo-crypto";

/** The client ids of task starts that failed, by the start they sent. */
const failedStarts = new Map<string, string>();

/**
 * The client id of one task start. A failed start can still have made its task on the server (the
 * answer got lost), so a retry of the same start, from any screen, sends the same id and gets that
 * task, not a second one. Call `failed` when the start fails.
 */
export function taskStartId(serverId: string, agentId: string, text: string, fileIds: readonly string[] = []) {
  const key = JSON.stringify([serverId, agentId, text, fileIds]);
  const id = failedStarts.get(key) ?? Crypto.randomUUID();
  failedStarts.delete(key);
  return { id, failed: () => void failedStarts.set(key, id) };
}
