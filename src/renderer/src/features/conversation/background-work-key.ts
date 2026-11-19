export function backgroundWorkKey(agentId: string, taskId: string | null): string {
  return taskId === null ? agentId : `${agentId}/${taskId}`;
}
