import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CentralAuthManager } from "./central-auth-manager";
import { LocalSkillLibrary } from "./local-skill-library";
import { localSkillTools } from "./local-skill-tools";
import { SkillMarketplaceService } from "./skill-marketplace-service";

let root: string;
let agents: AgentSummary[];
let library: LocalSkillLibrary;
let service: SkillMarketplaceService;
const network = vi.fn(async () => {
  throw new Error("Unexpected network request");
});
const markdown = (body: string) =>
  `---\nname: Weekly summary\ndescription: Summarize the week.\nexample-prompt: Summarize this week.\n---\n${body}`;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-local-skills-"));
  agents = ["writer", "reader"].map((id) => ({
    id,
    name: id,
    provider: "codex",
    title: "",
    description: "",
    notifications: true,
    model: "gpt-5.6-luna",
    reasoningEffort: "medium",
    threadId: null,
    workspacePath: join(root, id),
    preview: "",
    updatedAt: null,
    avatarSeed: id,
    avatarHue: null,
    avatarUrl: null,
  }));
  for (const agent of agents) await mkdir(join(agent.workspacePath, "draft"), { recursive: true });
  await writeFile(join(agents[0].workspacePath, "draft/SKILL.md"), markdown("First version"));
  library = new LocalSkillLibrary(join(root, "library"), () => agents);
  const auth = new CentralAuthManager({
    apiUrl: "http://127.0.0.1:3100",
    storagePath: join(root, "auth"),
    encrypt: (value) => Buffer.from(value),
    decrypt: (value) => value.toString(),
    fetch: network,
  });
  service = new SkillMarketplaceService(
    auth,
    () => agents,
    async () => undefined,
    library,
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  network.mockClear();
});

describe("local skill library", () => {
  it("creates offline, installs for the author, and retains revisions across restarts", async () => {
    const first = await localSkillTools(service).create({ agentId: "writer", sourcePath: "draft" });
    expect(first.examplePrompt).toBe("Summarize this week.");
    expect(await readFile(join(agents[0].workspacePath, ".agents/skills/weekly-summary/SKILL.md"), "utf8")).toContain(
      "First version",
    );
    expect(await readFile(join(agents[0].workspacePath, ".claude/skills/weekly-summary/SKILL.md"), "utf8")).toContain(
      "First version",
    );
    expect(await service.listInstalled("reader")).toEqual([]);
    await writeFile(join(agents[0].workspacePath, "draft/SKILL.md"), markdown("Second version"));
    const second = await library.revise("writer", first.id, 1, "draft");
    const restarted = new LocalSkillLibrary(library.root, () => agents);
    expect((await restarted.list())[0].version).toBe(2);
    expect((await restarted.get(first.id, 1)).instructions).toBe("First version");
    expect((await service.listInstalled("writer"))[0]).toMatchObject({
      installedVersion: 1,
      availableVersion: 2,
      state: "update-available",
    });
    await service.installLocal({ agentId: "reader", skillId: first.id, revision: 1 });
    await service.setEnabled({ agentId: "reader", skillId: first.id, enabled: false });
    await service.install({ agentId: "reader", skillId: first.id });
    expect((await service.listInstalled("reader"))[0]).toMatchObject({
      installedVersion: second.version,
      enabled: false,
    });
    await service.setEnabled({ agentId: "reader", skillId: first.id, enabled: true });
    expect(await readFile(join(agents[1].workspacePath, ".claude/skills/weekly-summary/SKILL.md"), "utf8")).toContain(
      "Second version",
    );
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects stale and concurrent revisions without changing installed files", async () => {
    const first = await library.create("writer", "draft");
    const results = await Promise.allSettled([
      library.revise("writer", first.id, 1, "draft"),
      library.revise("writer", first.id, 1, "draft"),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(library.revise("writer", first.id, 1, "draft")).rejects.toThrow("Read its latest revision");
    expect((await library.get(first.id)).version).toBe(2);
  });

  it("ignores interrupted staging directories and preserves previous revisions", async () => {
    const first = await library.create("writer", "draft");
    await mkdir(join(library.root, first.id, ".stage-interrupted"));
    await writeFile(join(library.root, first.id, ".stage-interrupted/bundle.zip"), "partial");
    await mkdir(join(library.root, "local-skill-22222222-2222-4222-8222-222222222222", ".stage-interrupted"), {
      recursive: true,
    });
    expect((await new LocalSkillLibrary(library.root, () => agents).list()).map((skill) => skill.id)).toEqual([
      first.id,
    ]);
    await writeFile(join(agents[0].workspacePath, "draft/SKILL.md"), "invalid");
    await expect(library.revise("writer", first.id, 1, "draft")).rejects.toThrow("frontmatter");
    expect((await library.get(first.id)).version).toBe(1);
    expect(await readdir(join(library.root, first.id))).not.toContain("2");
  });

  it.each(["../reader/draft", "/tmp/skill", "draft/../draft", "draft\\other"])(
    "rejects an unsafe source %s",
    async (sourcePath) => {
      await expect(library.create("writer", sourcePath)).rejects.toThrow();
    },
  );

  it("rejects root and nested symbolic links", async () => {
    await symlink(join(agents[0].workspacePath, "draft"), join(agents[0].workspacePath, "link"));
    await expect(library.create("writer", "link")).rejects.toThrow("symbolic links");
    await symlink(join(agents[1].workspacePath, "draft"), join(agents[0].workspacePath, "draft/link"));
    await expect(library.create("writer", "draft")).rejects.toThrow("symbolic links");
  });

  it("protects modified and extra installed files and rejects folder collisions", async () => {
    const skill = await localSkillTools(service).create({ agentId: "writer", sourcePath: "draft" });
    const extra = join(agents[0].workspacePath, ".agents/skills/weekly-summary/custom.md");
    await writeFile(extra, "user content");
    await expect(service.installLocal({ agentId: "writer", skillId: skill.id, revision: 1 })).rejects.toThrow(
      "local changes",
    );
    expect(await readFile(extra, "utf8")).toBe("user content");
    await mkdir(join(agents[1].workspacePath, ".agents/skills/weekly-summary"), { recursive: true });
    await writeFile(join(agents[1].workspacePath, ".agents/skills/weekly-summary/SKILL.md"), "unmanaged");
    await expect(service.installLocal({ agentId: "reader", skillId: skill.id, revision: 1 })).rejects.toThrow(
      "unmanaged",
    );
  });

  it("rejects symlinked install destinations without writing outside the workspace", async () => {
    const skill = await library.create("writer", "draft");
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(agents[1].workspacePath, ".agents"));
    await expect(service.installLocal({ agentId: "reader", skillId: skill.id, revision: 1 })).rejects.toThrow(
      "symbolic links",
    );
    expect(await readdir(outside)).toEqual([]);
  });

  it("removes obsolete files when updating a disabled skill", async () => {
    const source = join(agents[0].workspacePath, "draft");
    await writeFile(join(source, "old.md"), "old reference");
    const first = await localSkillTools(service).create({ agentId: "writer", sourcePath: "draft" });
    await service.setEnabled({ agentId: "writer", skillId: first.id, enabled: false });
    await rm(join(source, "old.md"));
    await library.revise("writer", first.id, 1, "draft");
    await service.install({ agentId: "writer", skillId: first.id });
    expect((await service.listInstalled("writer"))[0]).toMatchObject({
      enabled: false,
      installedVersion: 2,
      state: "installed",
    });
    await expect(
      readFile(join(agents[0].workspacePath, ".openbot/skills-disabled/weekly-summary/old.md")),
    ).rejects.toThrow();
  });

  it("supports old metadata and rejects invalid metadata or oversized folders", async () => {
    const path = join(agents[0].workspacePath, "draft/SKILL.md");
    await writeFile(path, "---\nname: Old skill\ndescription: An older bundle.\n---\nInstructions");
    expect((await library.create("writer", "draft")).examplePrompt).toBeUndefined();
    await writeFile(path, "---\nname: ''\ndescription: Missing name.\n---\nInstructions");
    await expect(library.create("writer", "draft")).rejects.toThrow("valid name");
    await writeFile(path, markdown("Valid"));
    await writeFile(join(agents[0].workspacePath, "draft/large.txt"), Buffer.alloc(10 * 1024 * 1024));
    await expect(library.create("writer", "draft")).rejects.toThrow("under 10 MB");
  });

  it("does not overwrite a damaged installation record", async () => {
    const skill = await library.create("writer", "draft");
    const directory = join(agents[0].workspacePath, ".openbot");
    await mkdir(directory);
    const path = join(directory, "skills-lock.json");
    await writeFile(path, "damaged record");
    await expect(service.installLocal({ agentId: "writer", skillId: skill.id, revision: 1 })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("damaged record");
  });

  it("leaves a created revision available when installation cannot complete", async () => {
    await mkdir(join(agents[0].workspacePath, ".agents/skills/weekly-summary"), { recursive: true });
    await expect(localSkillTools(service).create({ agentId: "writer", sourcePath: "draft" })).rejects.toThrow(
      "was saved as revision 1",
    );
    expect(await library.list()).toHaveLength(1);
    await expect(library.create("writer", "draft")).rejects.toThrow("already exists");
  });
});
