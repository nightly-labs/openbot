import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENT_PROVIDER_DESCRIPTORS,
  agentProviderCliName,
  agentProviderDescriptor,
} from "@openbot/contracts/agent-providers";
import { type AgentSummary, type InstalledSkill, SKILL_DESCRIPTION_MAX_LENGTH } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { HOME_SKILL_FOLDER, homeSkillTagId, listHomeSkills } from "../backend/home-skills";
import { readSkillFrontmatter } from "../backend/skill-frontmatter";
import { type ArchiveOperationError, archiveCall, archiveResult } from "./archive-effects";
import { OWNERSHIP_MARKER } from "./managed-skill-service";

const WORKSPACE_SKILL_FOLDERS = [
  ...new Set(AGENT_PROVIDER_DESCRIPTORS.flatMap((descriptor) => descriptor.skillFolders)),
];
const MAX_SKILLS_PER_FOLDER = 200;
const MAX_SKILL_FILE_BYTES = 256 * 1024;

export const listFolderSkills = Effect.fn("SkillFolder.listFolderSkills")(function* (
  agent: Pick<AgentSummary, "provider" | "workspacePath">,
  exclude: ReadonlySet<string>,
): Effect.fn.Return<InstalledSkill[], ArchiveOperationError> {
  const reads = agentProviderDescriptor(agent.provider).skillFolders;
  const skills: InstalledSkill[] = [];
  for (const [slug, folders] of yield* skillFoldersEffect(agent.workspacePath, exclude)) {
    const readable = folders.find((folder) => reads.includes(folder));
    const folder = readable ?? folders[0] ?? reads[0];
    const skill = yield* readFolderSkillEffect(agent.workspacePath, folder, slug);
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
});

export const listHomeFolderSkills = Effect.fn("SkillFolder.listHomeFolderSkills")(function* (
  exclude: ReadonlySet<string>,
) {
  return (yield* listHomeSkills())
    .filter((skill) => !exclude.has(skill.slug))
    .map(
      (skill): InstalledSkill => ({
        skillId: homeSkillTagId(skill.slug),
        slug: skill.slug,
        name: skill.slug,
        installedVersion: 1,
        availableVersion: 1,
        state: "installed",
        enabled: true,
        origin: "workspace",
        description: skill.description,
        location: `~/${HOME_SKILL_FOLDER}/${skill.slug}`,
      }),
    );
});

const skillFoldersEffect = Effect.fn("SkillFolder.skillFolders")(function* (
  root: string,
  exclude: ReadonlySet<string>,
): Effect.fn.Return<Map<string, string[]>, ArchiveOperationError> {
  const found = new Map<string, string[]>();
  for (const folder of WORKSPACE_SKILL_FOLDERS) {
    let entries: Dirent[];
    try {
      entries = archiveResult(
        yield* Effect.result(archiveCall(() => readdir(join(root, folder), { withFileTypes: true }))),
      );
    } catch {
      continue;
    }
    const names = entries
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith(".") && !name.includes(".openbot-") && !exclude.has(name))
      .sort()
      .slice(0, MAX_SKILLS_PER_FOLDER);
    for (const name of names) {
      const directory = join(root, folder, name);
      try {
        if (!archiveResult(yield* Effect.result(archiveCall(() => stat(directory)))).isDirectory()) continue;
        if (archiveResult(yield* Effect.result(pathExistsEffect(join(directory, OWNERSHIP_MARKER))))) continue;
        if (!archiveResult(yield* Effect.result(pathExistsEffect(join(directory, "SKILL.md"))))) continue;
      } catch {
        continue;
      }
      found.set(name, [...(found.get(name) ?? []), folder]);
    }
  }
  return found;
});

const readFolderSkillEffect = Effect.fn("SkillFolder.readFolderSkill")(function* (
  workspace: string,
  folder: string,
  slug: string,
): Effect.fn.Return<InstalledSkill, ArchiveOperationError> {
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
    if (archiveResult(yield* Effect.result(archiveCall(() => stat(file)))).size > MAX_SKILL_FILE_BYTES)
      return { ...skill, problem: sourceText("error.skill.markdownTooLarge") };
    text = archiveResult(yield* Effect.result(archiveCall(() => readFile(file, "utf8"))));
  } catch {
    return { ...skill, problem: sourceText("error.skill.markdownUnreadable") };
  }
  const checked = readSkillFrontmatter(text, slug);
  if (checked.problem === undefined) return { ...skill, description: checked.description };
  return {
    ...skill,
    ...(checked.description === undefined ? {} : { description: checked.description }),
    problem:
      checked.problem === "descriptionLength"
        ? sourceText("error.skill.descriptionLength", { limit: SKILL_DESCRIPTION_MAX_LENGTH })
        : checked.problem === "nameMismatch"
          ? sourceText("error.skill.nameMismatch", { slug })
          : checked.problem === "frontmatterMissing"
            ? sourceText("error.skill.frontmatterMissing")
            : sourceText("error.skill.frontmatterInvalid"),
  };
});

const pathExistsEffect = Effect.fn("SkillFolder.pathExists")(function* (
  path: string,
): Effect.fn.Return<boolean, ArchiveOperationError> {
  try {
    archiveResult(yield* Effect.result(archiveCall(() => lstat(path))));
    return true;
  } catch {
    return false;
  }
});
