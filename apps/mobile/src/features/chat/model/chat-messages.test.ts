import type { ConversationMessage } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { latestReadableMessage, projectChatMessages } from "./chat-messages";

function planMessage(text: string, status: ConversationMessage["status"], plan?: ConversationMessage["plan"]) {
  return {
    id: "plan",
    turnId: "turn",
    author: "assistant",
    itemType: "plan",
    text,
    createdAt: "2026-09-28T10:00:00.000Z",
    status,
    ...(plan ? { plan } : {}),
  } satisfies ConversationMessage;
}

const answer = {
  id: "answer",
  turnId: "turn",
  author: "assistant",
  text: "Done.",
  createdAt: "2026-09-28T09:59:00.000Z",
  status: "completed",
} satisfies ConversationMessage;

describe("mobile plan messages", () => {
  it("reads the task list from the checklist text of a restored plan", () => {
    const [plan] = projectChatMessages([planMessage("Fix the build\n\n- [x] Read logs\n- [ ] Patch", "completed")]);
    expect(plan).toEqual({
      id: "plan",
      kind: "plan",
      heading: "Fix the build",
      explanation: null,
      stopped: false,
      steps: [
        { id: "0", text: "Read logs", state: "done" },
        { id: "1", text: "Patch", state: "pending" },
      ],
    });
  });

  it("shows the running step while the plan streams, and drops a cut last line", () => {
    const structured = projectChatMessages([
      planMessage("- [ ] Test", "streaming", {
        explanation: null,
        steps: [{ id: "a", text: "Test", activeText: "Running tests", status: "inProgress" }],
      }),
    ]);
    const cut = projectChatMessages([planMessage("- [x] Read logs\n- [", "streaming")]);
    expect([structured[0], cut[0]].map((item) => (item?.kind === "plan" ? item.steps : item?.kind))).toEqual([
      [{ id: "a", text: "Running tests", state: "active" }],
      [{ id: "0", text: "Read logs", state: "done" }],
    ]);
  });

  it("keeps text that is not a checklist as an ordinary message", () => {
    const [item] = projectChatMessages([planMessage("Some answer\n- not a checklist", "completed")]);
    expect(item?.kind === "message" && item.body).toBe("Some answer\n- not a checklist");
  });

  it("marks an interrupted plan as stopped and does not use a plan as the latest message", () => {
    const messages = [answer, planMessage("- [ ] Patch", "interrupted")];
    const plan = projectChatMessages(messages).find((item) => item.kind === "plan");
    expect([plan?.kind === "plan" && plan.stopped, latestReadableMessage(messages)?.id]).toEqual([true, "answer"]);
  });
});
