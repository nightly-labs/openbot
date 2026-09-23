import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentProviderId } from "@openbot/contracts/ipc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listFolderSkills } from "./skill-folder-discovery";

let root = "";
let workspacePath = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-skill-folders-"));
  workspacePath = join(root, "workspace");
  await mkdir(workspacePath);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeSkill(base: string, folder: string, slug: string, content: string): Promise<string> {
  const directory = join(base, folder, slug);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), content);
  return directory;
}

function list(provider: AgentProviderId, exclude: string[] = []) {
  return listFolderSkills({ provider, workspacePath }, new Set(exclude));
}

describe("listFolderSkills", () => {
  it("lists a workspace skill and names the folder a provider does not read", async () => {
    await writeSkill(
      workspacePath,
      ".agents/skills",
      "deploy",
      "---\nname: deploy\ndescription: Deploys the site.\n---\n",
    );

    await expect(list("codex")).resolves.toEqual([
      expect.objectContaining({
        skillId: "workspace:deploy",
        origin: "workspace",
        location: ".agents/skills/deploy",
        description: "Deploys the site.",
      }),
    ]);
    expect((await list("codex"))[0]?.problem).toBeUndefined();
    await expect(list("claude")).resolves.toEqual([
      expect.objectContaining({
        problem: "Claude Code does not read .agents/skills. Copy this folder to .claude/skills.",
      }),
    ]);
  });

  it("leaves out skills OpenBot installed, installs in progress and folders without SKILL.md", async () => {
    const content = "---\nname: notes\ndescription: Notes.\n---\n";
    await writeSkill(workspacePath, ".agents/skills", "notes", content);
    const managed = await writeSkill(workspacePath, ".agents/skills", "openbot-data", content);
    await writeFile(join(managed, ".openbot-managed.json"), "{}");
    await writeSkill(workspacePath, ".agents/skills", "notes.openbot-stage-1", content);
    await mkdir(join(workspacePath, ".agents/skills/empty"), { recursive: true });

    await expect(list("codex", ["notes"])).resolves.toEqual([]);
  });

  it("reports a SKILL.md that does not follow the Agent Skills specification", async () => {
    await writeSkill(workspacePath, ".agents/skills", "bare", "# No frontmatter\n");
    await writeSkill(workspacePath, ".agents/skills", "renamed", "---\nname: Other\ndescription: Renamed.\n---\n");
    await writeSkill(
      workspacePath,
      ".agents/skills",
      "wordy",
      `---\nname: wordy\ndescription: ${"a".repeat(1025)}\n---\n`,
    );

    const problems = Object.fromEntries((await list("codex")).map((skill) => [skill.slug, skill.problem]));
    expect(problems).toEqual({
      bare: "SKILL.md must begin with YAML frontmatter.",
      renamed: 'SKILL.md needs "name: renamed", the same as its folder name.',
      wordy: "SKILL.md needs a description of 1 to 1024 characters.",
    });
  });

  it("follows a linked skill folder, as `npx skills` makes", async () => {
    const shared = await writeSkill(root, "shared", "review", "---\nname: review\ndescription: Reviews code.\n---\n");
    await mkdir(join(workspacePath, ".claude/skills"), { recursive: true });
    await symlink(shared, join(workspacePath, ".claude/skills/review"));

    await expect(list("claude")).resolves.toEqual([
      expect.objectContaining({ location: ".claude/skills/review", description: "Reviews code." }),
    ]);
    expect((await list("claude"))[0]?.problem).toBeUndefined();
  });
});
