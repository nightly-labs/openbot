import {
  isRemoteWorkspaceCachePreference,
  isSaveRemoteConversationInput,
  isSaveRemoteWorkspaceInput,
  type RemoteWorkspaceCachePreference,
  type SaveRemoteConversationInput,
  type SaveRemoteWorkspaceInput,
} from "@openbot/contracts/ipc";

// Only a malformed payload reaches these errors, so they stay English.

export function parseRemoteWorkspaceCachePreference(input: unknown): RemoteWorkspaceCachePreference {
  if (!isRemoteWorkspaceCachePreference(input)) throw new Error("Saved copy preference is required.");
  return { enabled: input.enabled };
}

export function parseSaveRemoteWorkspace(input: unknown): SaveRemoteWorkspaceInput {
  if (!isSaveRemoteWorkspaceInput(input)) throw new Error("Saved copy workspace is invalid.");
  return {
    serverId: input.serverId,
    memberId: input.memberId,
    agents: input.agents,
    reads: input.reads,
    layout: input.layout,
  };
}

export function parseSaveRemoteConversation(input: unknown): SaveRemoteConversationInput {
  if (!isSaveRemoteConversationInput(input)) throw new Error("Saved copy conversation is invalid.");
  return { serverId: input.serverId, agentId: input.agentId, messages: input.messages };
}
