import { describe, expect, it } from "vitest";
import type { ThreadItem } from "../protocol";
import { toolProgressText } from "./thread-items";
import {
  CommandProgressThrottle,
  isCommandTool,
  toolCommandProgress,
  toolExitCode,
  toolOutputTail,
} from "./tool-output";

function command(overrides: Partial<ThreadItem> = {}): ThreadItem {
  return { type: "commandExecution", id: "item-1", status: "inProgress", ...overrides };
}

describe("toolOutputTail", () => {
  it("removes ANSI colors and keeps the last carriage-return segment", () => {
    const item = command({ result: "download 1%\r\u001B[32mdownload 42%\u001B[0m\r\n" });
    expect(toolOutputTail(item)).toBe("download 42%");
  });

  it("drops blank lines and keeps the last meaningful line", () => {
    expect(toolOutputTail(command({ result: "first\n\n  \nsecond\n\n" }))).toBe("second");
  });

  it("collapses whitespace so one progress line stays on one line", () => {
    expect(toolOutputTail(command({ result: "a\t  b\n c   d " }))).toBe("c d");
  });

  it("truncates to 120 characters with an ellipsis", () => {
    const tail = toolOutputTail(command({ result: "x".repeat(140) }));
    expect(tail).toHaveLength(120);
    expect(tail?.endsWith("…")).toBe(true);
  });

  it("reads aggregatedOutput from the item and from result metadata", () => {
    expect(toolOutputTail(command({ aggregatedOutput: "from item" }))).toBe("from item");
    expect(toolOutputTail(command({ result: { metadata: { output: "from metadata" } } }))).toBe("from metadata");
  });

  it("returns null without output", () => {
    expect(toolOutputTail(command())).toBeNull();
  });
});

describe("toolExitCode", () => {
  it("reads a top-level exit code and one in result metadata", () => {
    expect(toolExitCode(command({ exitCode: 0 }))).toBe(0);
    expect(toolExitCode(command({ result: { metadata: { exitCode: 3 } } }))).toBe(3);
  });

  it("prefers the item exit code", () => {
    expect(toolExitCode(command({ exitCode: 2, result: { exitCode: 9 } }))).toBe(2);
  });

  it("returns null when the provider gives no exit code", () => {
    expect(toolExitCode(command())).toBeNull();
  });
});

describe("toolCommandProgress", () => {
  it("shows the output tail while a command runs", () => {
    expect(toolCommandProgress(command({ result: "one\ntwo" }), false)).toBe("two");
  });

  it("names exit 0 on success", () => {
    expect(toolCommandProgress(command({ status: "completed", exitCode: 0 }), true)).toBe("Command finished · exit 0");
  });

  it("keeps the failure text and adds exit 3", () => {
    const text = toolCommandProgress(command({ status: "failed", exitCode: 3 }), true);
    expect(text).toContain("A tool step failed");
    expect(text).toContain("exit 3");
  });

  it("treats a non-zero code as a failure even when the status is completed", () => {
    expect(toolCommandProgress(command({ status: "completed", exitCode: 3 }), true)).toContain("A tool step failed");
  });

  it("falls back to the generic text when the provider gives no exit code", () => {
    const item = command({ status: "completed" });
    expect(toolCommandProgress(item, true)).toBeNull();
    expect(toolProgressText(item, true)).not.toBeNull();
  });

  it("does not treat a non-command tool as a command", () => {
    const item: ThreadItem = { type: "mcpToolCall", name: "browser_click", status: "completed" };
    expect(isCommandTool(item)).toBe(false);
    expect(toolCommandProgress(item, true)).toBeNull();
  });

  it("recognizes a shell tool and excludes computer use", () => {
    expect(isCommandTool({ type: "mcpToolCall", name: "bash" })).toBe(true);
    expect(isCommandTool({ type: "mcpToolCall", name: "computer_use", server: "computer-use" })).toBe(false);
  });
});

describe("CommandProgressThrottle", () => {
  it("shows the first line at once and at most one later line a second", () => {
    const throttle = new CommandProgressThrottle();
    expect(throttle.next("turn:item", "1%", false, 1_000)).toBe("1%");
    expect(throttle.next("turn:item", "2%", false, 1_500)).toBeNull();
    expect(throttle.next("turn:item", "3%", false, 2_000)).toBe("3%");
  });

  it("always shows the completed line and starts fresh after it", () => {
    const throttle = new CommandProgressThrottle();
    expect(throttle.next("turn:item", "1%", false, 1_000)).toBe("1%");
    expect(throttle.next("turn:item", "done", true, 1_100)).toBe("done");
    expect(throttle.next("turn:item", "next", false, 1_200)).toBe("next");
  });

  it("keeps separate steps apart", () => {
    const throttle = new CommandProgressThrottle();
    expect(throttle.next("turn:first", "1%", false, 1_000)).toBe("1%");
    expect(throttle.next("turn:second", "2%", false, 1_100)).toBe("2%");
  });
});
