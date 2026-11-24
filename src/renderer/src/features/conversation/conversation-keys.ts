export function agentConversationKey(serverId: string, agentId: string): string {
  return `${serverId}\0${agentId}`;
}

export function agentMessageKey(agentId: string, messageId: string): string {
  return `${agentId}\0${messageId}`;
}

export function composerDraftKey(target: { agentId: string; serverId: string }): string {
  return target.serverId === "local" ? target.agentId : `${target.serverId}:${target.agentId}`;
}

export function threadDraftKey(target: { agentId: string; serverId: string }, threadId: string): string {
  return `${composerDraftKey(target)}\0${threadId}`;
}

export function deleteAgentMessageBodies(messages: Map<string, string>, agentId: string): void {
  const prefix = `${agentId}\0`;
  for (const key of messages.keys()) {
    if (key.startsWith(prefix)) messages.delete(key);
  }
}

export function promptRequestKey(turnId: string | undefined, requestId: string | number | undefined): string | null {
  if (!turnId || requestId === undefined) return null;
  return JSON.stringify([turnId, String(requestId)]);
}

export function messagePromptRequestKey(message: {
  turnId?: string | undefined;
  questionPrompt?: { requestId: string | number } | undefined;
}): string | null {
  return promptRequestKey(message.turnId, message.questionPrompt?.requestId);
}
