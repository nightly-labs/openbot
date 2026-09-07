// Which stacks a command selects is its whole blast radius. `dev:stop` signals
// processes that belong to whatever else runs on this machine - four agents in
// four worktrees, in the case this was written for - so it stays inside the
// checkout it was run from until the developer names another one. `dev:status`
// is the opposite: the stack holding the port this worktree wanted is a
// sibling's, and a report that hid it would answer nothing.
import { describe, expect, it } from "vitest";
import type { DevStackRecord } from "./dev-automation/stack-registry";
import { devStackScope, parseDevStackInvocation, selectDevStacks } from "./dev-stack";

function stack(projectRoot: string, supervisorPid: number): DevStackRecord {
  return {
    services: ["app"],
    projectRoot,
    supervisorPid,
    startedAt: 1_000,
    ports: [{ name: "app-renderer", port: 5_173 }],
    processes: [],
  };
}

const here = stack("/worktrees/one", 4_242);
const sibling = stack("/worktrees/two", 5_252);

function selectFor(args: string[]): DevStackRecord[] {
  const invocation = parseDevStackInvocation(args);
  return selectDevStacks([here, sibling], devStackScope(invocation, "/worktrees/one"));
}

describe("what a dev-stack command acts on", () => {
  it("stops this worktree's stack and leaves the sibling running", () => {
    expect(selectFor(["stop"])).toEqual([here]);
  });

  it("stops a sibling only when it is named", () => {
    expect(selectFor(["stop", "--pid=5252"])).toEqual([sibling]);
    expect(selectFor(["stop", "--all"])).toEqual([here, sibling]);
  });

  it("reports every stack on the machine, because the one holding your port is a sibling's", () => {
    expect(selectFor(["status"])).toEqual([here, sibling]);
  });

  it("forgets records the same way it stops them: this worktree, unless told otherwise", () => {
    expect(selectFor(["forget"])).toEqual([here]);
    expect(selectFor(["forget", "--all"])).toEqual([here, sibling]);
  });

  it("refuses a command it does not have", () => {
    expect(() => parseDevStackInvocation(["kill"])).toThrow("status|stop|forget");
  });
});
