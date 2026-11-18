/**
 * The key of a chat's background work in the renderer state: the agent's chat (`taskId` null) or one of
 * its threads. The desktop and the web client both read it from the host's runtime snapshot.
 */
export function backgroundWorkKey(agentId: string, taskId: string | null): string {
  return taskId === null ? agentId : `${agentId}/${taskId}`;
}
