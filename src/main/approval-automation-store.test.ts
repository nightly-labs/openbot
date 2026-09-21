// @vitest-environment node

import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalAutomation, readApprovalAutomation, writeApprovalAutomation } from "./approval-automation-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("approval automation store", () => {
  it("asks about everything when no preference exists", async () => {
    const root = await temporaryRoot();
    await expect(readApprovalAutomation(join(root, "automation.json"))).resolves.toEqual({
      turbo: false,
      autoApproveAgentIds: [],
    });
  });

  // Every unreadable shape has to fail the same way. A file that grants standing consent must not
  // be able to grant it by being corrupt.
  it.each([
    ["not JSON at all", "{"],
    ["a version this build does not know", '{"version":2,"turbo":true,"autoApproveAgentIds":[]}'],
    ["a turbo flag that is not a boolean", '{"version":1,"turbo":"yes","autoApproveAgentIds":[]}'],
    ["an agent list that is not a list", '{"version":1,"turbo":false,"autoApproveAgentIds":"agent-1"}'],
    ["an agent list holding something else", '{"version":1,"turbo":false,"autoApproveAgentIds":[{}]}'],
  ])("falls back to asking when the file holds %s", async (_case, contents) => {
    const root = await temporaryRoot();
    const path = join(root, "automation.json");
    await writeFile(path, `${contents}\n`);
    await expect(readApprovalAutomation(path)).resolves.toEqual({ turbo: false, autoApproveAgentIds: [] });
  });

  it("round trips a grant", async () => {
    const root = await temporaryRoot();
    const path = join(root, "automation.json");
    await writeApprovalAutomation(path, { turbo: true, autoApproveAgentIds: ["agent-1"] });
    await expect(readApprovalAutomation(path)).resolves.toEqual({ turbo: true, autoApproveAgentIds: ["agent-1"] });
  });

  it("leaves no temporary file behind", async () => {
    const root = await temporaryRoot();
    await writeApprovalAutomation(join(root, "automation.json"), { turbo: false, autoApproveAgentIds: [] });
    await expect(entries(root)).resolves.toEqual(["automation.json"]);
  });
});

describe("ApprovalAutomation", () => {
  it("grants and revokes one agent without touching the others", async () => {
    const automation = await open(["agent-1", "agent-2"]);
    await automation.set({ agentId: "agent-1", autoApprove: true });
    await automation.set({ agentId: "agent-2", autoApprove: true });
    await expect(automation.set({ agentId: "agent-1", autoApprove: false })).resolves.toEqual({
      turbo: false,
      autoApproveAgentIds: ["agent-2"],
    });
    expect(automation.autoApproves("agent-1")).toBe(false);
    expect(automation.autoApproves("agent-2")).toBe(true);
  });

  it("covers every agent while turbo is on, and returns each to its own grant afterwards", async () => {
    const automation = await open(["agent-1", "agent-2"]);
    await automation.set({ agentId: "agent-1", autoApprove: true });
    await automation.set({ turbo: true });
    expect(automation.autoApproves("agent-2")).toBe(true);
    await automation.set({ turbo: false });
    expect(automation.autoApproves("agent-1")).toBe(true);
    expect(automation.autoApproves("agent-2")).toBe(false);
  });

  it("drops a grant for an agent that no longer exists", async () => {
    const agents = new Set(["agent-1"]);
    const root = await temporaryRoot();
    const path = join(root, "automation.json");
    const automation = new ApprovalAutomation({
      path,
      initial: { turbo: false, autoApproveAgentIds: [] },
      knownAgentIds: () => agents,
    });
    await automation.set({ agentId: "agent-1", autoApprove: true });
    agents.delete("agent-1");
    expect(automation.current()).toEqual({ turbo: false, autoApproveAgentIds: [] });
    await automation.set({ turbo: true });
    await expect(readApprovalAutomation(path)).resolves.toEqual({ turbo: true, autoApproveAgentIds: [] });
  });

  // Two toggles in flight at once must land in the order they were made, or the file keeps the
  // value the user turned off last.
  it("persists concurrent writes in order", async () => {
    const automation = await open(["agent-1"]);
    const [, last] = await Promise.all([automation.set({ turbo: true }), automation.set({ turbo: false })]);
    expect(last).toEqual({ turbo: false, autoApproveAgentIds: [] });
    expect(automation.autoApproves("agent-1")).toBe(false);
  });

  it("revokes before deletion and prevents queued grants from surviving recreation", async () => {
    const agents = new Set(["agent-1", "agent-2"]);
    const path = join(await temporaryRoot(), "automation.json");
    const automation = new ApprovalAutomation({
      path,
      initial: { turbo: false, autoApproveAgentIds: ["agent-2"] },
      knownAgentIds: () => agents,
    });
    const pendingGrant = automation.set({ agentId: "agent-1", autoApprove: true });
    const deletion = automation.deleteAgent("agent-1", async () => {
      expect(automation.autoApproves("agent-1")).toBe(false);
      await expect(readApprovalAutomation(path)).resolves.toEqual({
        turbo: false,
        autoApproveAgentIds: ["agent-2"],
      });
      agents.delete("agent-1");
    });
    await expect(automation.set({ agentId: "agent-1", autoApprove: true })).rejects.toThrow(
      "Cannot grant approval while the agent is being deleted.",
    );
    await Promise.all([pendingGrant, deletion]);
    agents.add("agent-1");
    expect(automation.autoApproves("agent-1")).toBe(false);
    expect(automation.autoApproves("agent-2")).toBe(true);
    const reloaded = new ApprovalAutomation({
      path,
      initial: await readApprovalAutomation(path),
      knownAgentIds: () => agents,
    });
    expect(reloaded.autoApproves("agent-1")).toBe(false);
  });

  it("does not delete agent data if revocation cannot be saved", async () => {
    const automation = new ApprovalAutomation({
      path: join(await temporaryRoot(), "missing", "automation.json"),
      initial: { turbo: false, autoApproveAgentIds: ["agent-1"] },
      knownAgentIds: () => ["agent-1"],
    });
    const remove = vi.fn(async () => undefined);
    await expect(automation.deleteAgent("agent-1", remove)).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
});

async function open(agentIds: string[]): Promise<ApprovalAutomation> {
  const root = await temporaryRoot();
  return new ApprovalAutomation({
    path: join(root, "automation.json"),
    initial: { turbo: false, autoApproveAgentIds: [] },
    knownAgentIds: () => agentIds,
  });
}

async function entries(root: string): Promise<string[]> {
  return (await readdir(root)).sort();
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-approval-automation-"));
  roots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
