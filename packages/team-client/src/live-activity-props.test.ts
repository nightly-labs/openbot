import type { DynamicIslandApprovalItem, DynamicIslandPresentation } from "@openbot/contracts/ipc";
import { mobileTranslateFor } from "@openbot/i18n/mobile";
import { describe, expect, it } from "vitest";
import {
  LIVE_ACTIVITY_LIST_URL,
  liveActivityButtons,
  liveActivityProps,
  liveActivityView,
  readLiveActivityLink,
} from "./live-activity-props";
import { LIVE_ACTIVITY_SECRET_BYTES, liveActivityKeys } from "./live-activity-seal";

const t = mobileTranslateFor("en");
const text = { t, agentColor: () => "#8b5cf6" };
const keys = liveActivityKeys(new Uint8Array(LIVE_ACTIVITY_SECRET_BYTES).fill(7));
const agent = { id: "agent-1", name: "Ada", avatarSeed: "ada", avatarHue: null, avatarUrl: null };

describe("Live Activity buttons", () => {
  it("offers Approve only when the activity shows the whole command", () => {
    const labels = (item: Partial<DynamicIslandApprovalItem>, command: string | null) =>
      liveActivityButtons(approval(item, command), t).map((button) => button.label);

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

    expect(liveActivityButtons(prompt([question]), t).map((button) => button.action)).toEqual([
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
    expect(liveActivityButtons(prompt([question, { ...question, id: "region" }]), t)).toEqual([]);
    expect(liveActivityButtons(prompt([{ ...question, isSecret: true }]), t)).toEqual([]);
  });

  it("lists the chats with unread replies only when there is more than one", () => {
    const message: DynamicIslandPresentation = {
      serverId: "server-1",
      mode: "message",
      unreadCount: 3,
      message: { agent, messageId: "message-1", text: "Hej!", createdAt: "2026-09-24T10:00:00.000Z" },
    };
    const row = (name: string) => ({ name, count: 1, avatar: "", url: `openbot://live-activity?agent=${name}` });
    const view = (count: number) =>
      liveActivityProps(
        message,
        {
          avatar: "",
          tapUrl: LIVE_ACTIVITY_LIST_URL,
          buttons: [],
          agents: Array.from({ length: count }, (_, i) => row(`a${i}`)),
          agentCount: count,
        },
        text,
      );
    const rows = (count: number) => view(count)?.agents.map((agent) => agent.name);

    expect(rows(1)).toEqual([]);
    // One agent's count takes its color. A count for several agents is white.
    expect(view(1)?.compactTint).toBe("#8b5cf6");
    expect(view(2)?.compactTint).toBe("#FFFFFF");
    expect(rows(2)).toEqual(["a0", "a1"]);
    expect(rows(6)).toEqual(["a0", "a1", "a2", "a3"]);
  });

  it("clears a failed task only from its button, as the desktop does", () => {
    const failed: DynamicIslandPresentation = {
      serverId: "server-1",
      mode: "failed",
      item: { turnId: "turn-1", agent, title: "Task failed", detail: null },
    };

    const props = liveActivityView(failed, {
      ...text,
      avatar: () => "",
      unreadAgents: [],
      actionKey: keys.action,
    });

    expect(props && readLiveActivityLink(props.tapUrl, keys.action)).toEqual({
      type: "open",
      serverId: "server-1",
      agentId: "agent-1",
    });
    expect(props?.buttons.map((button) => readLiveActivityLink(button.url, keys.action))).toEqual([
      {
        type: "action",
        action: { type: "open-failure", serverId: "server-1", agentId: "agent-1", turnId: "turn-1" },
        command: null,
      },
    ]);
  });
});

describe("Live Activity links", () => {
  it("accepts an answer only with the signature of the phone key, as any app can open the link", () => {
    const presentation = approval({}, "npm test");
    const input = { ...text, avatar: () => "", unreadAgents: [], actionKey: keys.action };
    const [, approve] = liveActivityView(presentation, input)?.buttons ?? [];
    const url = approve?.url ?? "";

    expect(readLiveActivityLink(url, keys.action)).toEqual({
      type: "action",
      action: { type: "respond-approval", serverId: "server-1", agentId: "agent-1", requestId: 7, decision: "accept" },
      command: "npm test",
    });
    const other = liveActivityKeys(new Uint8Array(LIVE_ACTIVITY_SECRET_BYTES).fill(8));
    expect(readLiveActivityLink(url, other.action)).toEqual({ type: "list" });
    expect(readLiveActivityLink(url, null)).toEqual({ type: "list" });
    const changed = new URL(url);
    changed.searchParams.set("action", (changed.searchParams.get("action") ?? "").replace("accept", "decline"));
    expect(readLiveActivityLink(changed.toString(), keys.action)).toEqual({ type: "list" });
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
