import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { HOME_SKILL_ID_PREFIX } from "@openbot/contracts/ipc";
import { Effect, Option, Schema } from "effect";
import { readSkillFrontmatter } from "./skill-frontmatter";

/** The user's own skill folder, which the Agent Skills tools share across CLIs. */
export const HOME_SKILL_FOLDER = ".agents/skills";
const MAX_HOME_SKILLS = 200;
const MAX_SKILL_FILE_BYTES = 256 * 1024;

/** A skill in `~/.agents/skills` whose `SKILL.md` follows the Agent Skills specification. */
export interface HomeSkill {
  slug: string;
  description: string;
  /** The skill folder. It can be a link, as `npx skills` makes. */
  directory: string;
  /** The absolute path of its `SKILL.md`. */
  file: string;
}

class HomeSkillReadFailed extends Schema.TaggedError<HomeSkillReadFailed>()("HomeSkillReadFailed", {
  cause: Schema.Defect(),
}) {}

/** A folder or file that cannot be read counts as missing: the folder belongs to the user, not to OpenBot. */
const optionalRead = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: (cause) => new HomeSkillReadFailed({ cause }) }).pipe(Effect.option);

export function homeSkillRoot(home = homedir()): string {
  return join(home, HOME_SKILL_FOLDER);
}

/**
 * One folder name with no path in it. A chat tag id comes from message text, so its slug is checked
 * before it names a path.
 */
function isHomeSkillSlug(slug: string): boolean {
  return slug !== "" && slug !== "." && slug !== ".." && !/[/\\\0]/u.test(slug);
}

export function homeSkillTagId(slug: string): string {
  return `${HOME_SKILL_ID_PREFIX}${slug}`;
}

/** The slug of a `home:<slug>` tag id, or null for any other id or an unsafe slug. */
export function homeSkillTagSlug(id: string): string | null {
  if (!id.startsWith(HOME_SKILL_ID_PREFIX)) return null;
  const slug = id.slice(HOME_SKILL_ID_PREFIX.length);
  return isHomeSkillSlug(slug) ? slug : null;
}

/**
 * The names in a skill folder that hold a `SKILL.md`, following links. A missing folder has none.
 * Used to leave out a home skill that a provider already reads from another folder.
 */
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

/**
 * The valid skills in `~/.agents/skills`, by slug. OpenBot only reads this folder. A skill whose
 * `SKILL.md` is too large or does not follow the specification is left out, because a provider can
 * skip it too.
 */
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
