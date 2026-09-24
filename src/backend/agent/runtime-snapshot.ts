import {
  AGENT_RUNTIME_PERMISSION_PATHS_LIMIT,
  AGENT_RUNTIME_QUESTION_DESCRIPTION_LIMIT,
  AGENT_RUNTIME_QUESTION_HEADER_LIMIT,
  AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT,
  AGENT_RUNTIME_TEXT_LIMIT,
  type AgentApproval,
  type AgentPromptQuestion,
  type AgentRuntimeSnapshot,
  type AgentSummary,
} from "@openbot/contracts/ipc";
import type { MailboxStore } from "../mailbox-store";
import type { OpenBotDatabase } from "../openbot-database";
import type { AttentionRegistry } from "./attention-registry";
import type { ConversationRuntime } from "./conversation-runtime";
import type { TurnLifecycle } from "./turn-lifecycle";

export function compactRuntimeQuestion(
  question: AgentPromptQuestion,
): AgentRuntimeSnapshot["pendingPrompts"][number]["questions"][number] {
  return {
    id: question.id,
    header: question.header.slice(0, AGENT_RUNTIME_QUESTION_HEADER_LIMIT),
    question: question.question.slice(0, AGENT_RUNTIME_TEXT_LIMIT),
    isSecret: question.isSecret,
    options:
      question.options?.map((option) => ({
        label: option.label,
        description: option.description.slice(0, AGENT_RUNTIME_QUESTION_DESCRIPTION_LIMIT),
      })) ?? null,
  };
}

export function compactRuntimeApproval(approval: AgentApproval): AgentRuntimeSnapshot["pendingApprovals"][number] {
  const pathTruncated = (path: string) => path.length > AGENT_RUNTIME_TEXT_LIMIT;
  return {
    ...approval,
    truncated:
      [approval.command, approval.cwd, approval.reason, approval.grantRoot].some(
        (value) => value !== null && value.length > AGENT_RUNTIME_TEXT_LIMIT,
      ) ||
      Boolean(
        approval.permissions &&
          (approval.permissions.fileSystem.read.length > AGENT_RUNTIME_PERMISSION_PATHS_LIMIT ||
            approval.permissions.fileSystem.write.length > AGENT_RUNTIME_PERMISSION_PATHS_LIMIT ||
            approval.permissions.fileSystem.read.some(pathTruncated) ||
            approval.permissions.fileSystem.write.some(pathTruncated)),
      ),
    command: approval.command?.slice(0, AGENT_RUNTIME_TEXT_LIMIT) ?? null,
    cwd: approval.cwd?.slice(0, AGENT_RUNTIME_TEXT_LIMIT) ?? null,
    reason: approval.reason?.slice(0, AGENT_RUNTIME_TEXT_LIMIT) ?? null,
    grantRoot: approval.grantRoot?.slice(0, AGENT_RUNTIME_TEXT_LIMIT) ?? null,
    permissions: approval.permissions
      ? {
          fileSystem: {
            read: approval.permissions.fileSystem.read
              .slice(0, AGENT_RUNTIME_PERMISSION_PATHS_LIMIT)
              .map((path) => path.slice(0, AGENT_RUNTIME_TEXT_LIMIT)),
            write: approval.permissions.fileSystem.write
              .slice(0, AGENT_RUNTIME_PERMISSION_PATHS_LIMIT)
              .map((path) => path.slice(0, AGENT_RUNTIME_TEXT_LIMIT)),
          },
          network: approval.permissions.network,
        }
      : null,
  };
}

export function fitRuntimeSnapshot(snapshot: AgentRuntimeSnapshot): AgentRuntimeSnapshot {
  if (runtimeSnapshotBytes(snapshot) <= AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) return snapshot;

  snapshot.agents = snapshot.agents.map((agent) => ({ ...agent, preview: "", avatarUrl: null }));
  if (runtimeSnapshotBytes(snapshot) <= AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) return snapshot;

  snapshot.work = [];
  if (runtimeSnapshotBytes(snapshot) <= AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) return snapshot;

  snapshot.latestMessages = snapshot.latestMessages.map((message) => ({ ...message, text: "" }));
  if (runtimeSnapshotBytes(snapshot) <= AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) return snapshot;

  snapshot.pendingPrompts = snapshot.pendingPrompts.map((prompt) => ({
    ...prompt,
    questions: prompt.questions.map((question) => ({
      ...question,
      header: question.header.slice(0, 40),
      question: question.question.slice(0, 80),
      options: question.options?.map((option) => ({ label: option.label, description: "" })) ?? null,
    })),
  }));
  snapshot.pendingApprovals = snapshot.pendingApprovals.map((approval) => ({
    ...approval,
    truncated: true,
    command: approval.command?.slice(0, 80) ?? null,
    cwd: approval.cwd?.slice(0, 80) ?? null,
    reason: approval.reason?.slice(0, 80) ?? null,
    grantRoot: approval.grantRoot?.slice(0, 80) ?? null,
    permissions: approval.permissions
      ? { fileSystem: { read: [], write: [] }, network: approval.permissions.network }
      : null,
  }));
  if (runtimeSnapshotBytes(snapshot) <= AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) return snapshot;

  while (
    runtimeSnapshotBytes(snapshot) > AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT &&
    snapshot.pendingPrompts.length + snapshot.pendingApprovals.length + snapshot.pendingBrowserTakeovers.length > 0
  ) {
    snapshot.attentionComplete = false;
    if (snapshot.pendingBrowserTakeovers.length > 0) snapshot.pendingBrowserTakeovers.pop();
    else if (snapshot.pendingApprovals.length > 0) snapshot.pendingApprovals.pop();
    else snapshot.pendingPrompts.pop();
  }
  if (runtimeSnapshotBytes(snapshot) <= AGENT_RUNTIME_SNAPSHOT_BYTES_LIMIT) return snapshot;

  snapshot.agents = snapshot.agents.map((agent) => ({
    ...agent,
    name: agent.name.slice(0, 40),
    preview: "",
    avatarSeed: agent.id,
    avatarUrl: null,
  }));
  return snapshot;
}

export function runtimeSnapshotBytes(snapshot: AgentRuntimeSnapshot): number {
  return Buffer.byteLength(JSON.stringify({ type: "runtime-snapshot", snapshot }));
}

export interface RuntimeSnapshotSources {
  agents: AgentSummary[];
  conversation: Pick<ConversationRuntime, "snapshot">;
  database: Pick<OpenBotDatabase, "readConversationRuntime">;
  mailbox: Pick<MailboxStore, "listRuntimeWork">;
  turn: Pick<TurnLifecycle, "failedTurns">;
  attention: Pick<AttentionRegistry, "runtimeAttention">;
}

/** The runtime view of every agent: active turns, queued work, latest messages and attention. */
export function buildRuntimeSnapshot({
  agents,
  conversation,
  database,
  mailbox,
  turn,
  attention,
}: RuntimeSnapshotSources): AgentRuntimeSnapshot {
  const runtimeAgents: AgentRuntimeSnapshot["agents"] = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    notifications: agent.notifications,
    preview: agent.preview.slice(0, AGENT_RUNTIME_TEXT_LIMIT),
    updatedAt: agent.updatedAt,
    avatarSeed: agent.avatarSeed,
    avatarHue: agent.avatarHue,
    avatarUrl: agent.avatarUrl,
  }));
  const activeTurns: AgentRuntimeSnapshot["activeTurns"] = [];
  const latestMessages: AgentRuntimeSnapshot["latestMessages"] = [];
  for (const agent of agents) {
    const live = conversation.snapshot(agent.id);
    const liveLatest = [...(live?.messages ?? [])]
      .reverse()
      .find(
        (message) =>
          (message.author === "assistant" || message.author === "agent") &&
          message.itemType !== "commentary" &&
          message.itemType !== "question_prompt" &&
          message.itemType !== "agent_attachment",
      );
    const persisted =
      !live || !liveLatest
        ? database.readConversationRuntime(agent.id, agent.threadId)
        : { activeTurnId: null, latestMessage: null };
    const activeTurnId = live ? live.activeTurnId : persisted.activeTurnId;
    if (activeTurnId && agent.threadId) {
      activeTurns.push({ agentId: agent.id, threadId: agent.threadId, turnId: activeTurnId });
    }
    const latest = liveLatest ?? persisted.latestMessage;
    if (latest) {
      latestMessages.push({
        agentId: agent.id,
        id: latest.id,
        text: latest.text.slice(0, AGENT_RUNTIME_TEXT_LIMIT),
        createdAt: latest.createdAt,
      });
    }
  }
  return fitRuntimeSnapshot({
    agents: runtimeAgents,
    activeTurns,
    work: mailbox.listRuntimeWork(
      agents.map((agent) => agent.id),
      turn.failedTurns(),
    ),
    latestMessages,
    ...attention.runtimeAttention(),
    failedTurns: [...turn.failedTurns()].map(([agentId, turnId]) => ({ agentId, turnId })),
  });
}
