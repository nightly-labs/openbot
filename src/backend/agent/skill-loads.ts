import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import { Effect, Option, Schema } from "effect";
import { homeSkillRoot } from "../home-skills";
import { getRecord, getString, isRecord } from "../protocol";

/** One skill that a finished tool step loaded. */
export interface SkillLoad {
  /** The skill's folder name. */
  skill: string;
  /** The `SKILL.md` that the step read, as the step wrote it. Null when only the name is known. */
  path: string | null;
}

/** A folder name that can name a skill: no path, no glob and no shell variable. */
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
/** A skill of another Claude plugin, `<plugin>:<skill>`. Its folder is not known, so it has no size. */
const PLUGIN_SKILL_NAME = /^(?=.{1,128}$)[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/u;
/** The plugins through which OpenBot gives Claude the workspace skills and the user's own skills. */
const OPENBOT_SKILL_PLUGINS = /^(?:openbot|agents):/u;
/** A whole path to a `SKILL.md` in a `skills` folder. The first group is the skill's folder name. */
const SKILL_PATH = /^(?:.*[\\/])?skills[\\/]([^\\/]+)[\\/]SKILL\.md$/u;
/** A path to a `SKILL.md` in a shell command. It starts after a separator, so `myskills/` is not a match. */
const SKILL_FILE_IN_COMMAND =
  /(?<![^\s'"`;|&<>()=])(?:[^\s'"`;|&<>()]*[\\/])?skills[\\/]([^\\/\s'"`;|&<>()]+)[\\/]SKILL\.md(?![\w.])/gu;
/** A shell command that shows a file. A command that only lists or searches skill files loads none. */
const READ_COMMAND = /(?:^|[\s;&|('"])(?:cat|sed|head|tail|nl|bat|less|more|awk|type|Get-Content|gc)\s/u;
/** A `sed` that edits the file in place, which shows nothing. */
const SED_IN_PLACE = /(?:^|[\s;&|('"])sed\s(?:.*\s)?-(?:[A-Za-z]*i|-in-place)/u;
/** The separators of the commands in one shell line. */
const COMMAND_SEPARATOR = /&&|\|\||[;|\n]/u;
/** About four bytes of English text make one token. */
const BYTES_PER_TOKEN = 4;

/**
 * The skills that a finished tool step loaded. Each CLI loads a skill by itself, so the step is the
 * only record of it: a Claude `Skill` call names the skill, and every other CLI reads the skill's
 * `SKILL.md` with a read tool (`filePaths`, or the arguments of an ACP read) or a shell command. A
 * failed step loaded nothing, and a step that writes or edits the file loads nothing.
 */
export function skillLoads(item: unknown, filePaths: readonly unknown[]): SkillLoad[] {
  if (!isRecord(item)) return [];
  const status = getString(item, "status");
  if (status === "failed" || status === "declined") return [];
  const name = item.type === "toolCall" ? getString(item, "name") : null;
  if (name === "Skill") {
    const skill = (getString(item, "skill") ?? "").replace(OPENBOT_SKILL_PLUGINS, "");
    return SKILL_NAME.test(skill) || PLUGIN_SKILL_NAME.test(skill) ? [{ skill, path: null }] : [];
  }
  const loads = new Map<string, SkillLoad>();
  const add = (skill: string, path: string) => {
    if (SKILL_NAME.test(skill) && !loads.has(skill)) loads.set(skill, { skill, path });
  };
  if (item.type === "commandExecution" || name === "Bash") {
    for (const command of shownFileCommands(getString(item, "command") ?? ""))
      for (const match of command.matchAll(SKILL_FILE_IN_COMMAND)) add(match[1] ?? "", match[0]);
  } else if (name === "Read" || (item.type === "toolCall" && getString(item, "toolKind") === "read")) {
    // An ACP read names its file in the arguments when it sends no location.
    const paths = [...filePaths, ...Object.values(getRecord(item, "arguments") ?? {})];
    for (const path of paths) {
      if (typeof path !== "string") continue;
      const match = SKILL_PATH.exec(path);
      if (match) add(match[1] ?? "", path);
    }
  }
  return [...loads.values()];
}

/**
 * The commands of a shell line that show a file, each cut before its first output redirection, so a
 * file that a command writes is not a load.
 */
function shownFileCommands(line: string): string[] {
  return line
    .split(COMMAND_SEPARATOR)
    .filter((command) => READ_COMMAND.test(command) && !SED_IN_PLACE.test(command))
    .map((command) => command.split(">", 1)[0] ?? "");
}

class SkillFileUnreadable extends Schema.TaggedError<SkillFileUnreadable>()("SkillFileUnreadable", {
  cause: Schema.Defect(),
}) {}

/** Where a step ran: its working folder, the agent's workspace and its provider's skill folders. */
export interface SkillLoadPlace {
  cwd: string | null;
  workspace: string | null;
  provider: string;
}

/**
 * The estimated tokens that a load added to the context, from the size of its `SKILL.md`. A load
 * that names only the skill looks in the workspace skill folders of its provider, then in the
 * user's own skill folders. Null when no file is found: the skill folder belongs to the user.
 */
export const skillLoadTokens = Effect.fn("SkillLoads.tokens")(function* (load: SkillLoad, place: SkillLoadPlace) {
  for (const file of skillFileCandidates(load, place)) {
    const info = yield* Effect.tryPromise({
      try: () => stat(file),
      catch: (cause) => new SkillFileUnreadable({ cause }),
    }).pipe(Effect.option);
    if (Option.isSome(info) && info.value.isFile()) return Math.ceil(info.value.size / BYTES_PER_TOKEN);
  }
  return null;
});

function skillFileCandidates(load: SkillLoad, place: SkillLoadPlace): string[] {
  if (load.path !== null) {
    const path = load.path.startsWith("~/") ? join(homedir(), load.path.slice(2)) : load.path;
    if (isAbsolute(path)) return [path];
    const base = place.cwd ?? place.workspace;
    return base ? [join(base, path)] : [];
  }
  // A skill of another plugin is in that plugin's folder, which OpenBot does not know.
  if (load.skill.includes(":")) return [];
  const folders = isAgentProvider(place.provider) ? agentProviderDescriptor(place.provider).skillFolders : [];
  return [
    ...(place.workspace ? folders.map((folder) => join(place.workspace ?? "", folder, load.skill, "SKILL.md")) : []),
    join(homeSkillRoot(), load.skill, "SKILL.md"),
    join(homedir(), ".claude", "skills", load.skill, "SKILL.md"),
  ];
}
