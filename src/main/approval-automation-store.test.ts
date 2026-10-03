import { Effect } from "effect";
// @vitest-environment node

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalAutomation, readApprovalAutomation, writeApprovalAutomation } from "./approval-automation-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("approval automation store", () => {
  it("enables ordinary auto-approval when no preference exists", async () => {
    const root = await temporaryRoot();
    await expect(
      Effect.runPromise(
        readApprovalAutomation(join(root, "automation.json"), []).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).resolves.toEqual({
      turbo: false,
      defaultAutoApprove: true,
      autoApproveOverrides: {},
    });
  });

  it("preserves the released file and gives the new settings precedence after migration", async () => {
    const root = await temporaryRoot();
    const legacyPath = join(root, "openbot-approval-automation-v1.json");
    const path = join(root, "openbot-approval-automation-v2.json");
    const legacy = JSON.stringify({ version: 1, turbo: true, autoApproveAgentIds: ["agent-1"] });
    await writeFile(legacyPath, legacy);
    const initial = await Effect.runPromise(
      readApprovalAutomation(path, ["agent-1", "agent-2"], legacyPath).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(initial).toEqual({
      turbo: true,
      defaultAutoApprove: true,
      autoApproveOverrides: { "agent-1": true, "agent-2": false },
    });
    expect(await readFile(legacyPath, "utf8")).toBe(legacy);
    const changed = { ...initial, turbo: false, autoApproveOverrides: { "agent-1": false, "agent-2": false } };
    await Effect.runPromise(writeApprovalAutomation(path, changed).pipe(Effect.mapError((error) => error.cause)));
    await expect(
      Effect.runPromise(
        readApprovalAutomation(path, ["agent-1", "agent-2"], legacyPath).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).resolves.toEqual(changed);
    expect(await readFile(legacyPath, "utf8")).toBe(legacy);
    await writeFile(path, "{");
    await expect(
      Effect.runPromise(
        readApprovalAutomation(path, ["agent-1"], legacyPath).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).resolves.toEqual({
      turbo: false,
      defaultAutoApprove: false,
      autoApproveOverrides: {},
    });
  });

  // Every unreadable shape has to fail the same way. A file that grants standing consent must not
  // be able to grant it by being corrupt.
  it.each([
    ["not JSON at all", "{"],
    ["a version this build does not know", '{"version":3,"turbo":true,"autoApproveAgentIds":[]}'],
    ["a turbo flag that is not a boolean", '{"version":1,"turbo":"yes","autoApproveAgentIds":[]}'],
    ["an agent list that is not a list", '{"version":1,"turbo":false,"autoApproveAgentIds":"agent-1"}'],
    ["an agent list holding something else", '{"version":1,"turbo":false,"autoApproveAgentIds":[{}]}'],
  ])("falls back to asking when the file holds %s", async (_case, contents) => {
    const root = await temporaryRoot();
    const path = join(root, "automation.json");
    await writeFile(path, `${contents}\n`);
    await expect(
      Effect.runPromise(readApprovalAutomation(path, []).pipe(Effect.mapError((error) => error.cause))),
    ).resolves.toEqual({
      turbo: false,
      defaultAutoApprove: false,
      autoApproveOverrides: {},
    });
  });

  it.each([false, true])("preserves version 1 choices with Turbo %s and enables future agents", async (turbo) => {
    const path = join(await temporaryRoot(), "automation.json");
    await writeFile(path, JSON.stringify({ version: 1, turbo, autoApproveAgentIds: ["agent-1"] }));
    const migrated = await Effect.runPromise(
      readApprovalAutomation(path, ["agent-1", "agent-2"]).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(migrated).toEqual({
      turbo,
      defaultAutoApprove: true,
      autoApproveOverrides: { "agent-1": true, "agent-2": false },
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ version: 2, ...migrated });
    const agents = ["agent-1", "agent-2", "new-agent"];
    const automation = new ApprovalAutomation({
      path,
      initial: await Effect.runPromise(
        readApprovalAutomation(path, agents).pipe(Effect.mapError((error) => error.cause)),
      ),
      knownAgentIds: () => agents,
    });
    await Effect.runPromise(automation.set({ turbo: false }).pipe(Effect.mapError((error) => error.cause)));
    expect(automation.autoApproves("agent-1")).toBe(true);
    expect(automation.autoApproves("agent-2")).toBe(false);
    expect(automation.autoApproves("new-agent")).toBe(true);
  });

  it.each([
    { turbo: true, defaultAutoApprove: true, autoApproveOverrides: { "agent-1": "yes" } },
    { turbo: true, defaultAutoApprove: "yes", autoApproveOverrides: {} },
    { turbo: true, defaultAutoApprove: true, autoApproveOverrides: [] },
  ])("requires approval when version 2 settings are invalid: %j", async (preference) => {
    const path = join(await temporaryRoot(), "automation.json");
    await writeFile(path, JSON.stringify({ version: 2, ...preference }));
    const automation = new ApprovalAutomation({
      path,
      initial: await Effect.runPromise(readApprovalAutomation(path, []).pipe(Effect.mapError((error) => error.cause))),
      knownAgentIds: () => ["agent-1"],
    });
    expect(automation.autoApproves("agent-1")).toBe(false);
    expect(automation.turboEnabled()).toBe(false);
  });

  it("leaves no temporary file behind", async () => {
    const root = await temporaryRoot();
    await Effect.runPromise(
      writeApprovalAutomation(join(root, "automation.json"), {
        turbo: false,
        defaultAutoApprove: false,
        autoApproveOverrides: {},
      }).pipe(Effect.mapError((error) => error.cause)),
    );
    await expect(entries(root)).resolves.toEqual(["automation.json"]);
  });
});

describe("ApprovalAutomation", () => {
  it("keeps an opt-out across restart and Turbo, and lets the user enable it again", async () => {
    const path = join(await temporaryRoot(), "automation.json");
    const agents = ["agent-1"];
    const automation = new ApprovalAutomation({
      path,
      initial: await Effect.runPromise(readApprovalAutomation(path, []).pipe(Effect.mapError((error) => error.cause))),
      knownAgentIds: () => agents,
    });
    expect(automation.autoApproves("agent-1")).toBe(true);
    expect(automation.autoApproves("unknown-agent")).toBe(false);
    agents.push("agent-2");
    expect(automation.autoApproves("agent-2")).toBe(true);
    await Effect.runPromise(
      automation.set({ agentId: "agent-1", autoApprove: false }).pipe(Effect.mapError((error) => error.cause)),
    );
    const restarted = new ApprovalAutomation({
      path,
      initial: await Effect.runPromise(readApprovalAutomation(path, []).pipe(Effect.mapError((error) => error.cause))),
      knownAgentIds: () => agents,
    });
    expect(restarted.autoApproves("agent-1")).toBe(false);
    await Effect.runPromise(restarted.set({ turbo: true }).pipe(Effect.mapError((error) => error.cause)));
    expect(restarted.turboEnabled()).toBe(true);
    expect(restarted.autoApproves("agent-1")).toBe(true);
    await Effect.runPromise(restarted.set({ turbo: false }).pipe(Effect.mapError((error) => error.cause)));
    expect(restarted.autoApproves("agent-1")).toBe(false);
    expect(restarted.autoApproves("agent-2")).toBe(true);
    await Effect.runPromise(
      restarted.set({ agentId: "agent-1", autoApprove: true }).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(restarted.autoApproves("agent-1")).toBe(true);
  });

  it("restores the previous choice after a failed write", async () => {
    const automation = new ApprovalAutomation({
      path: join(await temporaryRoot(), "missing", "automation.json"),
      initial: { turbo: false, defaultAutoApprove: true, autoApproveOverrides: {} },
      knownAgentIds: () => ["agent-1"],
    });
    await expect(
      Effect.runPromise(
        automation.set({ agentId: "agent-1", autoApprove: false }).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).rejects.toThrow();
    expect(automation.autoApproves("agent-1")).toBe(true);
  });

  it("grants and revokes one agent without touching the others", async () => {
    const automation = await open(["agent-1", "agent-2"]);
    await Effect.runPromise(
      automation.set({ agentId: "agent-1", autoApprove: true }).pipe(Effect.mapError((error) => error.cause)),
    );
    await Effect.runPromise(
      automation.set({ agentId: "agent-2", autoApprove: true }).pipe(Effect.mapError((error) => error.cause)),
    );
    await expect(
      Effect.runPromise(
        automation.set({ agentId: "agent-1", autoApprove: false }).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).resolves.toEqual({
      turbo: false,
      defaultAutoApprove: false,
      autoApproveOverrides: { "agent-1": false, "agent-2": true },
    });
    expect(automation.autoApproves("agent-1")).toBe(false);
    expect(automation.autoApproves("agent-2")).toBe(true);
  });

  it("covers every agent while turbo is on, and returns each to its own grant afterwards", async () => {
    const automation = await open(["agent-1", "agent-2"]);
    await Effect.runPromise(
      automation.set({ agentId: "agent-1", autoApprove: true }).pipe(Effect.mapError((error) => error.cause)),
    );
    await Effect.runPromise(automation.set({ turbo: true }).pipe(Effect.mapError((error) => error.cause)));
    expect(automation.autoApproves("agent-2")).toBe(true);
    await Effect.runPromise(automation.set({ turbo: false }).pipe(Effect.mapError((error) => error.cause)));
    expect(automation.autoApproves("agent-1")).toBe(true);
    expect(automation.autoApproves("agent-2")).toBe(false);
  });

  it("drops a grant for an agent that no longer exists", async () => {
    const agents = new Set(["agent-1"]);
    const root = await temporaryRoot();
    const path = join(root, "automation.json");
    const automation = new ApprovalAutomation({
      path,
      initial: { turbo: false, defaultAutoApprove: false, autoApproveOverrides: {} },
      knownAgentIds: () => agents,
    });
    await Effect.runPromise(
      automation.set({ agentId: "agent-1", autoApprove: true }).pipe(Effect.mapError((error) => error.cause)),
    );
    agents.delete("agent-1");
    expect(automation.current()).toEqual({ turbo: false, defaultAutoApprove: false, autoApproveOverrides: {} });
    await Effect.runPromise(automation.set({ turbo: true }).pipe(Effect.mapError((error) => error.cause)));
    await expect(
      Effect.runPromise(readApprovalAutomation(path, []).pipe(Effect.mapError((error) => error.cause))),
    ).resolves.toEqual({
      turbo: true,
      defaultAutoApprove: false,
      autoApproveOverrides: {},
    });
  });

  // Two toggles in flight at once must land in the order they were made, or the file keeps the
  // value the user turned off last.
  it("persists concurrent writes in order", async () => {
    const automation = await open(["agent-1"]);
    const [, last] = await Promise.all([
      Effect.runPromise(automation.set({ turbo: true }).pipe(Effect.mapError((error) => error.cause))),
      Effect.runPromise(automation.set({ turbo: false }).pipe(Effect.mapError((error) => error.cause))),
    ]);
    expect(last).toEqual({ turbo: false, defaultAutoApprove: false, autoApproveOverrides: {} });
    expect(automation.autoApproves("agent-1")).toBe(false);
  });

  it("revokes before deletion and prevents queued grants from surviving recreation", async () => {
    const agents = new Set(["agent-1", "agent-2"]);
    const path = join(await temporaryRoot(), "automation.json");
    const automation = new ApprovalAutomation({
      path,
      initial: { turbo: false, defaultAutoApprove: false, autoApproveOverrides: { "agent-2": true } },
      knownAgentIds: () => agents,
    });
    const pendingGrant = Effect.runPromise(
      automation.set({ agentId: "agent-1", autoApprove: true }).pipe(Effect.mapError((error) => error.cause)),
    );
    const deletion = Effect.runPromise(
      automation
        .deleteAgent("agent-1", () =>
          Effect.promise(async () => {
            expect(automation.autoApproves("agent-1")).toBe(false);
            await expect(
              Effect.runPromise(readApprovalAutomation(path, []).pipe(Effect.mapError((error) => error.cause))),
            ).resolves.toEqual({
              turbo: false,
              defaultAutoApprove: false,
              autoApproveOverrides: { "agent-1": false, "agent-2": true },
            });
            agents.delete("agent-1");
          }),
        )
        .pipe(Effect.mapError((error) => error.cause)),
    );
    await expect(
      Effect.runPromise(
        automation.set({ agentId: "agent-1", autoApprove: true }).pipe(Effect.mapError((error) => error.cause)),
      ),
    ).rejects.toThrow("Cannot grant approval while the agent is being deleted.");
    await Promise.all([pendingGrant, deletion]);
    agents.add("agent-1");
    expect(automation.autoApproves("agent-1")).toBe(false);
    expect(automation.autoApproves("agent-2")).toBe(true);
    const reloaded = new ApprovalAutomation({
      path,
      initial: await Effect.runPromise(readApprovalAutomation(path, []).pipe(Effect.mapError((error) => error.cause))),
      knownAgentIds: () => agents,
    });
    expect(reloaded.autoApproves("agent-1")).toBe(false);
  });

  it("does not delete agent data if revocation cannot be saved", async () => {
    const automation = new ApprovalAutomation({
      path: join(await temporaryRoot(), "missing", "automation.json"),
      initial: { turbo: false, defaultAutoApprove: false, autoApproveOverrides: { "agent-1": true } },
      knownAgentIds: () => ["agent-1"],
    });
    const remove = vi.fn(() => Effect.void);
    await expect(
      Effect.runPromise(automation.deleteAgent("agent-1", remove).pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
});

async function open(agentIds: string[]): Promise<ApprovalAutomation> {
  const root = await temporaryRoot();
  return new ApprovalAutomation({
    path: join(root, "automation.json"),
    initial: { turbo: false, defaultAutoApprove: false, autoApproveOverrides: {} },
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
