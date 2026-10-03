import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSummary } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CentralAuthManager } from "./central-auth-manager";
import { LocalSkillLibrary } from "./local-skill-library";
import { localSkillTools } from "./local-skill-tools";
import { SkillMarketplaceService } from "./skill-marketplace-service";

let root: string;
let agents: [AgentSummary, AgentSummary];
let library: LocalSkillLibrary;
let service: SkillMarketplaceService;
const network = vi.fn(async () => {
  throw new Error("Unexpected network request");
});
const markdown = (body: string) =>
  `---\nname: Weekly summary\ndescription: Summarize the week.\nexample-prompt: Summarize this week.\n---\n${body}`;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-local-skills-"));
  const testAgent = (id: string): AgentSummary => ({
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
  });
  agents = [testAgent("writer"), testAgent("reader")];
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
    () => Effect.void,
    library,
  );
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  network.mockClear();
});

describe("local skill library", () => {
  it("creates offline, installs for the author, and retains revisions across restarts", async () => {
    const first = await Effect.runPromise(
      localSkillTools(service)
        .create({ agentId: "writer", sourcePath: "draft" })
        .pipe(Effect.mapError((error) => error.cause)),
    );
    expect(first.examplePrompt).toBe("Summarize this week.");
    expect(await readFile(join(agents[0].workspacePath, ".agents/skills/weekly-summary/SKILL.md"), "utf8")).toContain(
      "First version",
    );
    expect(await readFile(join(agents[0].workspacePath, ".claude/skills/weekly-summary/SKILL.md"), "utf8")).toContain(
      "First version",
    );
    expect(
      await Effect.runPromise(service.listInstalled("reader").pipe(Effect.mapError((error) => error.cause))),
    ).toEqual([]);
    await writeFile(join(agents[0].workspacePath, "draft/SKILL.md"), markdown("Second version"));
    const second = await Effect.runPromise(
      library.revise("writer", first.id, 1, "draft").pipe(Effect.mapError((error) => error.cause)),
    );
    const restarted = new LocalSkillLibrary(library.root, () => agents);
    expect((await Effect.runPromise(restarted.list().pipe(Effect.mapError((error) => error.cause))))[0]?.version).toBe(
      2,
    );
    expect(
      (await Effect.runPromise(restarted.get(first.id, 1).pipe(Effect.mapError((error) => error.cause)))).instructions,
    ).toBe("First version");
    expect(
      (await Effect.runPromise(service.listInstalled("writer").pipe(Effect.mapError((error) => error.cause))))[0],
    ).toMatchObject({
      installedVersion: 1,
      availableVersion: 2,
      state: "update-available",
    });
    await Effect.runPromise(
      service
        .installLocal({ agentId: "reader", skillId: first.id, revision: 1 })
        .pipe(Effect.mapError((error) => error.cause)),
    );
    await Effect.runPromise(
      service
        .setEnabled({ agentId: "reader", skillId: first.id, enabled: false })
        .pipe(Effect.mapError((error) => error.cause)),
    );
    await Effect.runPromise(
      service.install({ agentId: "reader", skillId: first.id }).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(
      (await Effect.runPromise(service.listInstalled("reader").pipe(Effect.mapError((error) => error.cause))))[0],
    ).toMatchObject({
      installedVersion: second.version,
      enabled: false,
    });
    await Effect.runPromise(
      service
        .setEnabled({ agentId: "reader", skillId: first.id, enabled: true })
        .pipe(Effect.mapError((error) => error.cause)),
    );
    expect(await readFile(join(agents[1].workspacePath, ".claude/skills/weekly-summary/SKILL.md"), "utf8")).toContain(
      "Second version",
    );
    expect(network).not.toHaveBeenCalled();
  });

  it("rejects stale and concurrent revisions without changing installed files", async () => {
    const first = await Effect.runPromise(
      library.create("writer", "draft").pipe(Effect.mapError((error) => error.cause)),
    );
    const results = await Promise.allSettled([
      Effect.runPromise(library.revise("writer", first.id, 1, "draft").pipe(Effect.mapError((error) => error.cause))),
      Effect.runPromise(library.revise("writer", first.id, 1, "draft").pipe(Effect.mapError((error) => error.cause))),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    await expect(
      Effect.runPromise(library.revise("writer", first.id, 1, "draft").pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow("Read its latest revision");
    expect((await Effect.runPromise(library.get(first.id).pipe(Effect.mapError((error) => error.cause)))).version).toBe(
      2,
    );
  });

  it("ignores interrupted staging directories and preserves previous revisions", async () => {
    const first = await Effect.runPromise(
      library.create("writer", "draft").pipe(Effect.mapError((error) => error.cause)),
    );
    await mkdir(join(library.root, first.id, ".stage-interrupted"));
    await writeFile(join(library.root, first.id, ".stage-interrupted/bundle.zip"), "partial");
    await mkdir(join(library.root, "local-skill-22222222-2222-4222-8222-222222222222", ".stage-interrupted"), {
      recursive: true,
    });
    expect(
      (
        await Effect.runPromise(
          new LocalSkillLibrary(library.root, () => agents).list().pipe(Effect.mapError((error) => error.cause)),
        )
      ).map((skill) => skill.id),
    ).toEqual([first.id]);
    await writeFile(join(agents[0].workspacePath, "draft/SKILL.md"), "invalid");
    await expect(
      Effect.runPromise(library.revise("writer", first.id, 1, "draft").pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow("frontmatter");
    expect((await Effect.runPromise(library.get(first.id).pipe(Effect.mapError((error) => error.cause)))).version).toBe(
      1,
    );
    expect(await readdir(join(library.root, first.id))).not.toContain("2");
  });

  it.each(["../reader/draft", "/tmp/skill", "draft/../draft", "draft\\other"])(
    "rejects an unsafe source %s",
    async (sourcePath) => {
      await expect(
        Effect.runPromise(library.create("writer", sourcePath).pipe(Effect.mapError((error) => error.cause))),
      ).rejects.toThrow();
    },
  );

  it("rejects root and nested symbolic links", async () => {
    await symlink(join(agents[0].workspacePath, "draft"), join(agents[0].workspacePath, "link"));
    await expect(
      Effect.runPromise(library.create("writer", "link").pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow("symbolic links");
    await symlink(join(agents[1].workspacePath, "draft"), join(agents[0].workspacePath, "draft/link"));
    await expect(
      Effect.runPromise(library.create("writer", "draft").pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow("symbolic links");
  });

  it("protects modified and extra installed files and rejects folder collisions", async () => {
    const skill = await Effect.runPromise(
      localSkillTools(service)
        .create({ agentId: "writer", sourcePath: "draft" })
        .pipe(Effect.mapError((error) => error.cause)),
    );
    const extra = join(agents[0].workspacePath, ".agents/skills/weekly-summary/custom.md");
    await writeFile(extra, "user content");
    await expect(
      Effect.runPromise(
        service
          .installLocal({ agentId: "writer", skillId: skill.id, revision: 1 })
          .pipe(Effect.mapError((error) => error.cause)),
      ),
    ).rejects.toThrow("local changes");
    expect(await readFile(extra, "utf8")).toBe("user content");
    await mkdir(join(agents[1].workspacePath, ".agents/skills/weekly-summary"), { recursive: true });
    await writeFile(join(agents[1].workspacePath, ".agents/skills/weekly-summary/SKILL.md"), "unmanaged");
    await expect(
      Effect.runPromise(
        service
          .installLocal({ agentId: "reader", skillId: skill.id, revision: 1 })
          .pipe(Effect.mapError((error) => error.cause)),
      ),
    ).rejects.toThrow("unmanaged");
  });

  it("rejects symlinked install destinations without writing outside the workspace", async () => {
    const skill = await Effect.runPromise(
      library.create("writer", "draft").pipe(Effect.mapError((error) => error.cause)),
    );
    const outside = join(root, "outside");
    await mkdir(outside);
    await symlink(outside, join(agents[1].workspacePath, ".agents"));
    await expect(
      Effect.runPromise(
        service
          .installLocal({ agentId: "reader", skillId: skill.id, revision: 1 })
          .pipe(Effect.mapError((error) => error.cause)),
      ),
    ).rejects.toThrow("symbolic links");
    expect(await readdir(outside)).toEqual([]);
  });

  it("removes obsolete files when updating a disabled skill", async () => {
    const source = join(agents[0].workspacePath, "draft");
    await writeFile(join(source, "old.md"), "old reference");
    const first = await Effect.runPromise(
      localSkillTools(service)
        .create({ agentId: "writer", sourcePath: "draft" })
        .pipe(Effect.mapError((error) => error.cause)),
    );
    await Effect.runPromise(
      service
        .setEnabled({ agentId: "writer", skillId: first.id, enabled: false })
        .pipe(Effect.mapError((error) => error.cause)),
    );
    await rm(join(source, "old.md"));
    await Effect.runPromise(
      library.revise("writer", first.id, 1, "draft").pipe(Effect.mapError((error) => error.cause)),
    );
    await Effect.runPromise(
      service.install({ agentId: "writer", skillId: first.id }).pipe(Effect.mapError((error) => error.cause)),
    );
    expect(
      (await Effect.runPromise(service.listInstalled("writer").pipe(Effect.mapError((error) => error.cause))))[0],
    ).toMatchObject({
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
    expect(
      (await Effect.runPromise(library.create("writer", "draft").pipe(Effect.mapError((error) => error.cause))))
        .examplePrompt,
    ).toBeUndefined();
    await writeFile(path, "---\nname: ''\ndescription: Missing name.\n---\nInstructions");
    await expect(
      Effect.runPromise(library.create("writer", "draft").pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow("valid name");
    await writeFile(path, markdown("Valid"));
    await writeFile(join(agents[0].workspacePath, "draft/large.txt"), Buffer.alloc(10 * 1024 * 1024));
    await expect(
      Effect.runPromise(library.create("writer", "draft").pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow("under 10 MB");
  });

  it("does not overwrite a damaged installation record", async () => {
    const skill = await Effect.runPromise(
      library.create("writer", "draft").pipe(Effect.mapError((error) => error.cause)),
    );
    const directory = join(agents[0].workspacePath, ".openbot");
    await mkdir(directory);
    const path = join(directory, "skills-lock.json");
    await writeFile(path, "damaged record");
    await expect(
      Effect.runPromise(
        service
          .installLocal({ agentId: "writer", skillId: skill.id, revision: 1 })
          .pipe(Effect.mapError((error) => error.cause)),
      ),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("damaged record");
  });

  it("leaves a created revision available when installation cannot complete", async () => {
    await mkdir(join(agents[0].workspacePath, ".agents/skills/weekly-summary"), { recursive: true });
    await expect(
      Effect.runPromise(
        localSkillTools(service)
          .create({ agentId: "writer", sourcePath: "draft" })
          .pipe(Effect.mapError((error) => error.cause)),
      ),
    ).rejects.toThrow("was saved as revision 1");
    expect(await Effect.runPromise(library.list().pipe(Effect.mapError((error) => error.cause)))).toHaveLength(1);
    await expect(
      Effect.runPromise(library.create("writer", "draft").pipe(Effect.mapError((error) => error.cause))),
    ).rejects.toThrow("already exists");
  });
});
