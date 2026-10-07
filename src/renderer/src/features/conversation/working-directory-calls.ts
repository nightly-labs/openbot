import type { ServerSummary } from "@openbot/contracts/ipc";
import { AGENT_WORKING_DIRECTORY_CAPABILITY } from "@openbot/contracts/team-protocol/agent-working-directory-v1";
import type { WorkingDirectoryCalls } from "@openbot/ui/features/conversation/WorkingDirectorySettings";
import { serverCanAdminister } from "../servers/server-capabilities";
import type { ConversationRuntime } from "./conversation-runtime";

export function workingDirectoryCalls(
  server: ServerSummary | undefined,
  runtime: ConversationRuntime | undefined,
): WorkingDirectoryCalls | undefined {
  if (server?.kind !== "local" && !serverCanAdminister(server, AGENT_WORKING_DIRECTORY_CAPABILITY)) return undefined;
  if (runtime) return runtime.admin?.workingDirectory;
  const api = window.openbot.agent;
  return {
    getWorkingDirectory: (agentId) => api.getWorkingDirectory(agentId, server?.id),
    setWorkingDirectory: (input) => api.setWorkingDirectory(input, server?.id),
    browseWorkingDirectory: (input) => api.browseWorkingDirectory(input, server?.id),
    ...(server?.kind === "local"
      ? { chooseWorkingDirectory: (agentId: string) => api.chooseWorkingDirectory(agentId) }
      : {}),
  };
}
