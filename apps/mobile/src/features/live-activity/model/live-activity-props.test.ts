import type { DynamicIslandApprovalItem, DynamicIslandPresentation } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { liveActivityButtons, liveActivityProps, liveActivityTapAction } from "./live-activity-props";

const agent = { id: "agent-1", name: "Ada", avatarSeed: "ada", avatarHue: null, avatarUrl: null };

describe("Live Activity buttons", () => {
  it("offers Approve only when the activity shows the whole command", () => {
    const labels = (item: Partial<DynamicIslandApprovalItem>, command: string | null) =>
      liveActivityButtons(approval(item, command)).map((button) => button.label);

    expect(labels({}, "npm test")).toEqual(["Decline", "Approve"]);
    expect(labels({ truncated: true }, "npm test")).toEqual(["Decline"]);
    expect(labels({}, `echo ${"x".repeat(200)}`)).toEqual(["Decline"]);
    const fileChange = { ...approval({}, "npm test").item.approval, kind: "file-change" as const };
    expect(labels({ approval: fileChange }, "npm test")).toEqual(["Decline"]);
  });

  it("answers one question with its options, and leaves steps and secrets to the chat", () => {
    const question = {
      id: "deploy",
      header: "Deploy",
      question: "Deploy now?",
      isSecret: false,
      options: [
        { label: "Yes", description: "" },
        { label: "No", description: "" },
      ],
    };
    const prompt = (questions: (typeof question)[]): DynamicIslandPresentation => ({
      serverId: "server-1",
      mode: "question",
      remainingCount: 0,
      item: { requestId: "request-1", agent, title: "Deploy", detail: "Deploy now?", questions },
    });

    expect(liveActivityButtons(prompt([question])).map((button) => button.action)).toEqual([
      {
        type: "answer-prompt",
        serverId: "server-1",
        agentId: "agent-1",
        requestId: "request-1",
        answers: { deploy: ["Yes"] },
      },
      {
        type: "answer-prompt",
        serverId: "server-1",
        agentId: "agent-1",
        requestId: "request-1",
        answers: { deploy: ["No"] },
      },
    ]);
    expect(liveActivityButtons(prompt([question, { ...question, id: "region" }]))).toEqual([]);
    expect(liveActivityButtons(prompt([{ ...question, isSecret: true }]))).toEqual([]);
  });

  it("lists the chats with unread replies only when there is more than one", () => {
    const message: DynamicIslandPresentation = {
      serverId: "server-1",
      mode: "message",
      unreadCount: 3,
      message: { agent, messageId: "message-1", text: "Hej!", createdAt: "2026-09-24T10:00:00.000Z" },
    };
    const row = (name: string) => ({ name, count: 1, avatar: "", url: `openbot://live-activity?action=${name}` });
    const rows = (count: number) =>
      liveActivityProps(message, {
        avatar: "",
        buttons: [],
        agents: Array.from({ length: count }, (_, i) => row(`a${i}`)),
        agentCount: count,
      })?.agents.map((agent) => agent.name);

    expect(rows(1)).toEqual([]);
    expect(rows(2)).toEqual(["a0", "a1"]);
    expect(rows(6)).toEqual(["a0", "a1", "a2", "a3"]);
  });

  it("clears a failed task only from its button, as the desktop does", () => {
    const failed: DynamicIslandPresentation = {
      serverId: "server-1",
      mode: "failed",
      item: { turnId: "turn-1", agent, title: "Task failed", detail: null },
    };

    expect(liveActivityTapAction(failed)).toEqual({ type: "open-agent", serverId: "server-1", agentId: "agent-1" });
    expect(liveActivityButtons(failed).map((button) => button.action)).toEqual([
      { type: "open-failure", serverId: "server-1", agentId: "agent-1", turnId: "turn-1" },
    ]);
  });
});

function approval(
  item: Partial<DynamicIslandApprovalItem>,
  command: string | null,
): Extract<DynamicIslandPresentation, { mode: "approval" }> {
  return {
    serverId: "server-1",
    mode: "approval",
    remainingCount: 0,
    item: {
      requestId: 7,
      agent,
      title: "Command needs review",
      detail: command,
      truncated: false,
      approval: { kind: "command", command, cwd: null, reason: null, grantRoot: null, permissions: null },
      ...item,
    },
  };
}
