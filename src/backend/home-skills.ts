import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { HOME_SKILL_ID_PREFIX } from "@openbot/contracts/ipc";
import { Effect, Option, Schema } from "effect";
import { readSkillFrontmatter } from "./skill-frontmatter";

export const HOME_SKILL_FOLDER = ".agents/skills";
const MAX_HOME_SKILLS = 200;
export const SKILL_OWNERSHIP_MARKER = ".openbot-managed.json";
const MAX_SKILL_FILE_BYTES = 256 * 1024;

export interface HomeSkill {
  slug: string;
  description: string;
  directory: string;
  file: string;
}

class HomeSkillReadFailed extends Schema.TaggedError<HomeSkillReadFailed>()("HomeSkillReadFailed", {
  cause: Schema.Defect(),
}) {}

const optionalRead = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => new HomeSkillReadFailed({ cause }) }).pipe(Effect.option);

export function homeSkillRoot(home = homedir()): string {
  return join(home, HOME_SKILL_FOLDER);
}

function isHomeSkillSlug(slug: string): boolean {
  return slug !== "" && slug !== "." && slug !== ".." && !/[/\\\0]/u.test(slug);
}

export function homeSkillTagId(slug: string): string {
  return `${HOME_SKILL_ID_PREFIX}${slug}`;
}

export function homeSkillTagSlug(id: string): string | null {
  if (!id.startsWith(HOME_SKILL_ID_PREFIX)) return null;
  const slug = id.slice(HOME_SKILL_ID_PREFIX.length);
  return isHomeSkillSlug(slug) ? slug : null;
}

export const skillFolderNames = Effect.fn("HomeSkills.folderNames")(function* (directory: string) {
  const entries = yield* optionalRead(() => readdir(directory));
  if (Option.isNone(entries)) return new Set<string>();
  const names = new Set<string>();
  for (const name of entries.value.filter((entry) => !entry.startsWith(".")).sort()) {
    const file = yield* optionalRead(() => stat(join(directory, name, "SKILL.md")));
    if (Option.isSome(file) && file.value.isFile()) names.add(name);
  }
  return names;
});

export const userSkillFolderNames = Effect.fn("HomeSkills.userFolderNames")(function* (directory: string) {
  const names: string[] = [];
  for (const name of yield* skillFolderNames(directory)) {
    if (name.includes(".openbot-")) continue;
    const marker = yield* optionalRead(() => stat(join(directory, name, SKILL_OWNERSHIP_MARKER)));
    if (Option.isNone(marker)) names.push(name);
  }
  return names;
});

export const listHomeSkills = Effect.fn("HomeSkills.list")(function* () {
  const root = homeSkillRoot();
  const skills: HomeSkill[] = [];
  for (const slug of [...(yield* skillFolderNames(root))].slice(0, MAX_HOME_SKILLS)) {
    const directory = join(root, slug);
    const file = join(directory, "SKILL.md");
    const size = yield* optionalRead(() => stat(file));
    if (Option.isNone(size) || size.value.size > MAX_SKILL_FILE_BYTES) continue;
    const text = yield* optionalRead(() => readFile(file, "utf8"));
    if (Option.isNone(text)) continue;
    const checked = readSkillFrontmatter(text.value, slug);
    if (checked.problem === undefined) skills.push({ slug, description: checked.description, directory, file });
  }
  return skills;
});
