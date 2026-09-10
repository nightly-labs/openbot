import type { MobileWorkspaceContextValue } from "../workspace/model/workspace-types";
import { attachmentSizeBucket } from "./events";
import { mobileAnalytics } from "./mobile-analytics";

/** Instrument user commands, never background reads or host lifecycle broadcasts. */
export function trackWorkspaceActions(workspace: MobileWorkspaceContextValue): MobileWorkspaceContextValue {
  const run = mobileAnalytics.operation.bind(mobileAnalytics);
  const agentProperties = (id: string) => {
    const agent = workspace.agents.find((candidate) => candidate.id === id);
    return { provider: agent?.provider, model: agent?.model, reasoning_effort: agent?.reasoningEffort };
  };
  return {
    ...workspace,
    createAgent: (input) => run("agent_action", { action: "create" }, () => workspace.createAgent(input)),
    updateAgent: (input, serverId) =>
      run("agent_action", { action: "update", ...agentProperties(input.agentId) }, () =>
        workspace.updateAgent(input, serverId),
      ),
    deleteAgent: (id) =>
      run("agent_action", { action: "delete", ...agentProperties(id) }, () => workspace.deleteAgent(id)),
    duplicateAgent: (id) =>
      run("agent_action", { action: "duplicate", ...agentProperties(id) }, () => workspace.duplicateAgent(id)),
    sendMessage: (id, text, attachments = [], reply = null) =>
      run(
        "message_send",
        {
          ...agentProperties(id),
          channel: "agent",
          server_kind: "remote",
          attachment_count: attachments.length,
          is_reply: reply !== null,
        },
        () => workspace.sendMessage(id, text, attachments, reply),
      ),
    respondToPrompt: (id, input) =>
      run("agent_input_action", { kind: "prompt", decision: "answered" }, () => workspace.respondToPrompt(id, input)),
    uploadAttachment: (id, input) =>
      run(
        "attachment_action",
        {
          action: "upload",
          attachment_count: 1,
          size_bucket: attachmentSizeBucket(Math.floor((input.base64.length * 3) / 4)),
        },
        () => workspace.uploadAttachment(id, input),
      ),
    discardAttachment: (id, attachment) =>
      run("attachment_action", { action: "remove", attachment_count: 1 }, () =>
        workspace.discardAttachment(id, attachment),
      ),
    saveAgentMemory: (id, text, server, memory) =>
      run("memory_action", { action: memory ? "update" : "create" }, () =>
        workspace.saveAgentMemory(id, text, server, memory),
      ),
    deleteAgentMemory: (id, memory, server) =>
      run("memory_action", { action: "delete" }, () => workspace.deleteAgentMemory(id, memory, server)),
    createAgentRoutine: (input, server) =>
      run("routine_action", { action: "create", trigger_type: input.schedule.kind }, () =>
        workspace.createAgentRoutine(input, server),
      ),
    updateAgentRoutine: (input, server) =>
      run("routine_action", { action: "update", trigger_type: input.schedule?.kind }, () =>
        workspace.updateAgentRoutine(input, server),
      ),
    deleteAgentRoutine: (id, routine, server) =>
      run("routine_action", { action: "delete" }, () => workspace.deleteAgentRoutine(id, routine, server)),
    addRemoteServer: (input) =>
      run("team_action", { action: "server_joined", server_kind: "remote" }, () => workspace.addRemoteServer(input)),
    leaveServer: (id) =>
      run("team_action", { action: "server_left", server_kind: "remote" }, () => workspace.leaveServer(id)),
    selectServer: (id) => {
      workspace.selectServer(id);
      mobileAnalytics.track("team_action", { action: "server_selected", server_kind: "remote", result: "succeeded" });
    },
    toggleAgentPin: (id) => {
      const result = workspace.toggleAgentPin(id);
      mobileAnalytics.track("conversation_action", {
        action: workspace.pinnedAgentIds.includes(id) ? "unpin" : "pin",
        result: result === "error" ? "failed" : "succeeded",
      });
      return result;
    },
  };
}
