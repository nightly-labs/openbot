// A provider whose CLI does not read `.agents/skills` (Kiro reads `.kiro/skills`) gets the skills of that
// workspace folder in its developer instructions, by the path of each `SKILL.md`.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listWorkspaceSkills, SKILL_OWNERSHIP_MARKER } from "../home-skills";
import { homeSkillInstructions } from "./developer-instructions";

let workspace: string;

async function skill(folder: string, slug: string, description: string, extra: Record<string, string> = {}) {
  const directory = join(workspace, folder, slug);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "SKILL.md"), `---\nname: ${slug}\ndescription: ${description}\n---\nBody.\n`);
  for (const [name, text] of Object.entries(extra)) await writeFile(join(directory, name), text);
}

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "openbot-unread-skills-"));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("listWorkspaceSkills", () => {
  it("lists the valid skills of the folder, also the ones that OpenBot owns", async () => {
    await skill(".agents/skills", "release-notes", "Write release notes.");
    await skill(".agents/skills", "host-site", "Host a site.", { [SKILL_OWNERSHIP_MARKER]: "{}" });
    const skills = await Effect.runPromise(listWorkspaceSkills(join(workspace, ".agents", "skills")));
    expect(skills.map((entry) => entry.slug).sort()).toEqual(["host-site", "release-notes"]);
    expect(skills.find((entry) => entry.slug === "release-notes")).toMatchObject({
      description: "Write release notes.",
      file: join(workspace, ".agents", "skills", "release-notes", "SKILL.md"),
    });
  });

  it("leaves out an install in progress, a folder with no SKILL.md and a skill that breaks the format", async () => {
    await skill(".agents/skills", ".openbot-stage-abc", "Half written.");
    await mkdir(join(workspace, ".agents", "skills", "empty"), { recursive: true });
    await skill(".agents/skills", "wrong-name", "Name differs.");
    await writeFile(
      join(workspace, ".agents", "skills", "wrong-name", "SKILL.md"),
      "---\nname: another\ndescription: Name differs.\n---\n",
    );
    expect(await Effect.runPromise(listWorkspaceSkills(join(workspace, ".agents", "skills")))).toEqual([]);
  });

  it("gives no skill for a folder that does not exist", async () => {
    expect(await Effect.runPromise(listWorkspaceSkills(join(workspace, "missing")))).toEqual([]);
  });
});

describe("homeSkillInstructions", () => {
  const release = {
    slug: "release-notes",
    description: "Write   release\nnotes.",
    directory: "/w/.agents/skills/release-notes",
    file: "/w/.agents/skills/release-notes/SKILL.md",
  };

  it("names the folder, and each skill with the path of its SKILL.md", () => {
    expect(homeSkillInstructions([release], "the .agents/skills folder of your workspace")).toEqual([
      "The user's own skills are in the .agents/skills folder of your workspace, and your CLI does not load them. When a task matches the description of one, or the user names it, read its SKILL.md first and follow it:",
      "- release-notes: Write release notes. (/w/.agents/skills/release-notes/SKILL.md)",
    ]);
  });

  it("keeps the text that a home skill had before the folder was a parameter", () => {
    expect(homeSkillInstructions([release], "~/.agents/skills")[0]).toContain("skills are in ~/.agents/skills, and");
  });

  it("adds nothing when there is no skill", () => {
    expect(homeSkillInstructions([], "~/.agents/skills")).toEqual([]);
  });
});
