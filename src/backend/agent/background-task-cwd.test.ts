import { describe, expect, it } from "vitest";
import { resolveBackgroundTaskCwd } from "./background-task-cwd";

describe("resolveBackgroundTaskCwd", () => {
  it("uses the workspace when the caller gives no folder", () => {
    expect(resolveBackgroundTaskCwd("/agents/one", undefined)).toBe("/agents/one");
  });

  it("resolves a folder inside the workspace", () => {
    expect(resolveBackgroundTaskCwd("/agents/one", "downloads")).toBe("/agents/one/downloads");
    expect(resolveBackgroundTaskCwd("/agents/one", "a/../b")).toBe("/agents/one/b");
  });

  it("refuses a folder that leaves the workspace", () => {
    expect(resolveBackgroundTaskCwd("/agents/one", "..")).toBeNull();
    expect(resolveBackgroundTaskCwd("/agents/one", "../two")).toBeNull();
    expect(resolveBackgroundTaskCwd("/agents/one", "/etc")).toBeNull();
  });

  it("does not treat a sibling with the same prefix as inside", () => {
    expect(resolveBackgroundTaskCwd("/agents/one", "../one-other")).toBeNull();
  });
});
