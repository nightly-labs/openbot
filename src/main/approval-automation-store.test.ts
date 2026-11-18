import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readApprovalAutomation } from "./approval-automation-store";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "openbot-approval-"));
  path = join(dir, "openbot-approval-automation-v3.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readApprovalAutomation", () => {
  it("keeps auto-approve on for a half-written file instead of denying every agent", async () => {
    await writeFile(path, '{"version":3,"defaultAutoApprove":true,', "utf8");

    const value = await Effect.runPromise(readApprovalAutomation(path, ["agent-a"]));

    expect(value.defaultAutoApprove).toBe(true);
    expect(value.autoApproveOverrides).toEqual({});
  });

  it("still denies everything for a file that parses but is not a preference", async () => {
    await writeFile(path, '["not", "a", "preference"]', "utf8");

    const value = await Effect.runPromise(readApprovalAutomation(path, ["agent-a"]));

    expect(value.defaultAutoApprove).toBe(false);
    expect(value.autoApproveOverrides).toEqual({});
  });

  it("reads a valid file as written", async () => {
    await writeFile(
      path,
      JSON.stringify({ version: 3, defaultAutoApprove: false, autoApproveOverrides: { "agent-a": true } }),
      "utf8",
    );

    const value = await Effect.runPromise(readApprovalAutomation(path, ["agent-a"]));

    expect(value.defaultAutoApprove).toBe(false);
    expect(value.autoApproveOverrides).toEqual({ "agent-a": true });
  });

  it("keeps the product default when the file is missing", async () => {
    const value = await Effect.runPromise(readApprovalAutomation(path, ["agent-a"]));

    expect(value.defaultAutoApprove).toBe(true);
  });
});
