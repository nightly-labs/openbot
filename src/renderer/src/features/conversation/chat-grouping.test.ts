import { describe, expect, it } from "vitest";
import { continuesSenderRun } from "./chat-grouping";

const open = { previousDrawsTime: true, startsDay: false };

function row(author: string, minute: number) {
  return { author, createdAt: new Date(2026, 8, 9, 14, minute).toISOString() };
}

describe("continuesSenderRun", () => {
  it("continues a run of one sender inside the window", () => {
    expect(continuesSenderRun(row("agent", 0), row("agent", 4), open)).toBe(true);
  });

  it("opens a run for the first row of the transcript", () => {
    expect(continuesSenderRun(undefined, row("agent", 0), open)).toBe(false);
  });

  it("opens a run when the sender changes", () => {
    expect(continuesSenderRun(row("you", 0), row("agent", 1), open)).toBe(false);
  });

  it("opens a run after a pause longer than the window", () => {
    expect(continuesSenderRun(row("agent", 0), row("agent", 6), open)).toBe(false);
  });

  it("opens a run under a day separator", () => {
    expect(continuesSenderRun(row("agent", 0), row("agent", 1), { ...open, startsDay: true })).toBe(false);
  });

  it("opens a run under a row that draws no time", () => {
    expect(continuesSenderRun(row("agent", 0), row("agent", 1), { ...open, previousDrawsTime: false })).toBe(false);
  });

  it("opens a run when either row has no stored time", () => {
    expect(continuesSenderRun({ author: "agent" }, row("agent", 1), open)).toBe(false);
    expect(continuesSenderRun(row("agent", 0), { author: "agent" }, open)).toBe(false);
  });
});
