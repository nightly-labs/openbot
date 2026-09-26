import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { type AgentProviderId, agentProviderCliName } from "@openbot/contracts/agent-providers";
import { type AgentSummary, type InstalledSkill, SKILL_DESCRIPTION_MAX_LENGTH } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { parse as parseYaml } from "yaml";
import { OWNERSHIP_MARKER } from "./managed-skill-service";

/**
 * The workspace skill folders each provider CLI reads by itself. OpenBot writes only `.agents/skills`
 * and `.claude/skills`. An agent keeps its workspace when its provider changes, so a skill can stay
 * in a folder the new provider does not read.
 * Sources: the Codex "build skills" guide, the Claude Code skills guide, the opencode skills guide and
 * the skill paths in Google's Antigravity ACP server.
 */
const PROVIDER_SKILL_FOLDERS: Record<AgentProviderId, readonly [string, ...string[]]> = {
  codex: [".agents/skills"],
  claude: [".claude/skills"],
  grok: [".agents/skills"],
  opencode: [".opencode/skills", ".agents/skills", ".claude/skills"],
  antigravity: [".gemini/skills", ".agents/skills"],
};

/** A skill in one of these workspace folders is listed even when the agent's provider does not read it. */
const WORKSPACE_SKILL_FOLDERS = [".agents/skills", ".claude/skills", ".opencode/skills", ".gemini/skills"] as const;
const MAX_SKILLS_PER_FOLDER = 200;
const MAX_SKILL_FILE_BYTES = 256 * 1024;

/**
 * Lists the skills a user or an agent put in a workspace skill folder without OpenBot. OpenBot reads
 * these folders and never writes to them. `exclude` holds the folder names in the lock file, which
 * the installed list already shows.
 */
export async function listFolderSkills(
  agent: Pick<AgentSummary, "provider" | "workspacePath">,
  exclude: ReadonlySet<string>,
): Promise<InstalledSkill[]> {
  const reads = PROVIDER_SKILL_FOLDERS[agent.provider];
  const skills: InstalledSkill[] = [];
  for (const [slug, folders] of await skillFolders(agent.workspacePath, exclude)) {
    const readable = folders.find((folder) => reads.includes(folder));
    const folder = readable ?? folders[0] ?? WORKSPACE_SKILL_FOLDERS[0];
    const skill = await readFolderSkill(agent.workspacePath, folder, slug);
    skills.push(
      readable || skill.problem
        ? skill
        : {
            ...skill,
            problem: sourceText("error.skill.folderNotRead", {
              provider: agentProviderCliName(agent.provider),
              folder,
              target: reads[0],
            }),
          },
    );
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

/** Maps each skill folder name to the skill folders that hold it, in the order given. */
async function skillFolders(root: string, exclude: ReadonlySet<string>): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (const folder of WORKSPACE_SKILL_FOLDERS) {
    let entries: Dirent[];
    try {
      entries = await readdir(join(root, folder), { withFileTypes: true });
    } catch {
      continue;
    }
    const names = entries
      .map((entry) => entry.name)
      // `.openbot-stage-` and `.openbot-backup-` folders are an install in progress.
      .filter((name) => !name.startsWith(".") && !name.includes(".openbot-") && !exclude.has(name))
      .sort()
      .slice(0, MAX_SKILLS_PER_FOLDER);
    for (const name of names) {
      const directory = join(root, folder, name);
      try {
        // `stat` follows a link: `npx skills` links each skill folder to one shared copy.
        if (!(await stat(directory)).isDirectory()) continue;
        if (await pathExists(join(directory, OWNERSHIP_MARKER))) continue;
        // A folder without SKILL.md is not a skill, and a provider skips it too.
        if (!(await pathExists(join(directory, "SKILL.md")))) continue;
      } catch {
        continue;
      }
      found.set(name, [...(found.get(name) ?? []), folder]);
    }
  }
  return found;
}

async function readFolderSkill(workspace: string, folder: string, slug: string): Promise<InstalledSkill> {
  const directory = join(workspace, folder, slug);
  const skill: InstalledSkill = {
    skillId: `workspace:${slug}`,
    slug,
    name: slug,
    installedVersion: 1,
    availableVersion: 1,
    state: "installed",
    enabled: true,
    origin: "workspace",
    location: `${folder}/${slug}`,
  };
  let text: string;
  try {
    const file = join(directory, "SKILL.md");
    if ((await stat(file)).size > MAX_SKILL_FILE_BYTES)
      return { ...skill, problem: sourceText("error.skill.markdownTooLarge") };
    text = await readFile(file, "utf8");
  } catch {
    return { ...skill, problem: sourceText("error.skill.markdownUnreadable") };
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)?.[1];
  if (frontmatter === undefined) return { ...skill, problem: sourceText("error.skill.frontmatterMissing") };
  let metadata: unknown;
  try {
    metadata = parseYaml(frontmatter);
  } catch {
    return { ...skill, problem: sourceText("error.skill.frontmatterInvalid") };
  }
  if (!isDynamicRecord(metadata)) return { ...skill, problem: sourceText("error.skill.frontmatterInvalid") };
  const description = isString(metadata.description) ? metadata.description.trim() : "";
  if (!description || description.length > SKILL_DESCRIPTION_MAX_LENGTH)
    return {
      ...skill,
      problem: sourceText("error.skill.descriptionLength", { limit: SKILL_DESCRIPTION_MAX_LENGTH }),
    };
  if (metadata.name !== slug)
    return { ...skill, description, problem: sourceText("error.skill.nameMismatch", { slug }) };
  return { ...skill, description };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
