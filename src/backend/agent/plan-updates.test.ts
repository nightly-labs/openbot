import { conversationPlanText, parseConversationPlanText } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import {
  acpPlanSteps,
  foldClaudePlanCall,
  foldClaudePlanResult,
  newClaudePlanState,
  planFromNotification,
} from "./plan-updates";

describe("plan updates", () => {
  it("replaces the Claude list on each TodoWrite", () => {
    const state = newClaudePlanState();
    foldClaudePlanCall(state, {
      id: "call-1",
      name: "TodoWrite",
      input: { todos: [{ content: "Old", status: "completed" }] },
    });
    const steps = foldClaudePlanCall(state, {
      id: "call-2",
      name: "TodoWrite",
      input: {
        todos: [
          { content: "Read the notes", status: "completed", activeForm: "Reading the notes" },
          { content: "Add the column", status: "in_progress", activeForm: "Adding the column" },
        ],
      },
    });
    expect(steps).toEqual([
      { step: "Read the notes", status: "completed", activeText: "Reading the notes" },
      { step: "Add the column", status: "inProgress", activeText: "Adding the column" },
    ]);
  });

  it("follows a Claude task from TaskCreate to its task id, then updates and deletes it", () => {
    const state = newClaudePlanState();
    foldClaudePlanCall(state, { id: "use-1", name: "TaskCreate", input: { subject: "First" } });
    foldClaudePlanCall(state, { id: "use-2", name: "TaskCreate", input: { subject: "Second" } });
    foldClaudePlanResult(state, "use-1", { task: { id: "1" } }, "");
    foldClaudePlanResult(state, "use-2", undefined, "Task #2 created successfully");

    expect(
      foldClaudePlanCall(state, { id: "use-3", name: "TaskUpdate", input: { taskId: "1", status: "in_progress" } }),
    ).toEqual([
      { step: "First", status: "inProgress" },
      { step: "Second", status: "pending" },
    ]);
    expect(
      foldClaudePlanCall(state, { id: "use-4", name: "TaskUpdate", input: { taskId: "2", status: "deleted" } }),
    ).toEqual([{ step: "First", status: "inProgress" }]);
    expect(foldClaudePlanCall(state, { id: "use-5", name: "TaskUpdate", input: { taskId: "9" } })).toBeNull();
    expect(foldClaudePlanCall(state, { id: "use-6", name: "Bash", input: { command: "ls" } })).toBeNull();
  });

  it("maps the Codex and ACP plans to one shape", () => {
    expect(
      planFromNotification({
        threadId: "thread",
        turnId: "turn",
        explanation: "Ship it",
        plan: [
          { step: "Build", status: "completed" },
          { step: "Test", status: "inProgress" },
          { step: "  ", status: "pending" },
          { step: "Release", status: "unknown" },
        ],
      }),
    ).toEqual({
      explanation: "Ship it",
      steps: [
        { id: "0", text: "Build", status: "completed" },
        { id: "1", text: "Test", status: "inProgress" },
        { id: "3", text: "Release", status: "pending" },
      ],
    });
    expect(planFromNotification({ plan: [] })).toBeNull();
    expect(
      acpPlanSteps([
        { content: "Read", status: "in_progress", priority: "high" },
        { content: 3, status: "pending" },
      ]),
    ).toEqual([{ step: "Read", status: "inProgress" }]);
  });

  it("gives back the same plan from its checklist text", () => {
    const plan = {
      explanation: "Migration",
      steps: [
        { id: "0", text: "Read the notes", status: "completed" as const },
        { id: "1", text: "Run the tests", status: "pending" as const },
      ],
    };
    expect(parseConversationPlanText(conversationPlanText(plan))).toEqual(plan);
    expect(parseConversationPlanText("Some answer\n- not a checklist")).toBeNull();
  });
});
