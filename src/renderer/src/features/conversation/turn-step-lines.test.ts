import { describe, expect, it } from "vitest";
import { appendTurnStepLine } from "./turn-step-lines";

describe("appendTurnStepLine", () => {
  it("replaces the line of the same tool step", () => {
    let lines = appendTurnStepLine({}, "turn-1", "curl 1%", "tool:item-1", 10);
    lines = appendTurnStepLine(lines, "turn-1", "curl 2%", "tool:item-1", 20);
    expect(lines["turn-1"]).toEqual([{ id: "tool:item-1", text: "curl 2%", at: 10 }]);
  });

  it("keeps the place of the replaced line", () => {
    let lines = appendTurnStepLine({}, "turn-1", "first", "tool:item-1");
    lines = appendTurnStepLine(lines, "turn-1", "other");
    lines = appendTurnStepLine(lines, "turn-1", "first updated", "tool:item-1");
    expect(lines["turn-1"]?.map((line) => line.text)).toEqual(["first updated", "other"]);
  });

  it("adds a later line with a numeric id that does not collide with a step id", () => {
    let lines = appendTurnStepLine({}, "turn-1", "first");
    lines = appendTurnStepLine(lines, "turn-1", "curl 1%", "tool:item-1");
    lines = appendTurnStepLine(lines, "turn-1", "later");
    const ids = lines["turn-1"]?.map((line) => line.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("does not change the value when the step text is the same", () => {
    const lines = appendTurnStepLine({}, "turn-1", "same", "tool:item-1");
    expect(appendTurnStepLine(lines, "turn-1", "same", "tool:item-1")).toBe(lines);
  });
});
