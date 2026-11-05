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
/** A path to a `SKILL.md` in a `skills` folder. The first group is the skill's folder name. */
const SKILL_FILE = /(?:[^\s'"`;|&<>()]*[\\/])?skills[\\/]([^\\/\s'"`;|&<>()]+)[\\/]SKILL\.md(?![\w.])/gu;
/** A shell command that shows a file. A command that only lists or searches skill files loads none. */
const READ_COMMAND = /(?:^|[\s;&|(])(?:cat|sed|head|tail|nl|bat|less|more|awk|type|Get-Content|gc)\s/u;
/** About four bytes of English text make one token. */
const BYTES_PER_TOKEN = 4;

/**
 * The skills that a finished tool step loaded. Each CLI loads a skill by itself, so the step is the
 * only record of it: a Claude `Skill` call names the skill, and every other CLI reads the skill's
 * `SKILL.md` with a read tool (`filePaths`, or the arguments of an ACP read) or a shell command. A
 * failed step loaded nothing.
 */
export function skillLoads(item: unknown, filePaths: readonly unknown[]): SkillLoad[] {
  if (!isRecord(item)) return [];
  const status = getString(item, "status");
  if (status === "failed" || status === "declined") return [];
  if (item.type === "toolCall" && getString(item, "name") === "Skill") {
    // A plugin skill is `<plugin>:<skill>`; the folder name is the last part.
    const skill = getString(item, "skill")?.split(":").at(-1) ?? "";
    return SKILL_NAME.test(skill) ? [{ skill, path: null }] : [];
  }
  const texts: string[] = [];
  if (item.type === "commandExecution" || (item.type === "toolCall" && getString(item, "name") === "Bash")) {
    const command = getString(item, "command");
    if (command && READ_COMMAND.test(command)) texts.push(command);
  } else if (item.type === "toolCall") {
    for (const path of filePaths) if (typeof path === "string") texts.push(path);
    // An ACP read names its file in the arguments when it sends no location.
    if (getString(item, "toolKind") === "read") {
      for (const value of Object.values(getRecord(item, "arguments") ?? {}))
        if (typeof value === "string") texts.push(value);
    }
  }
  const loads = new Map<string, SkillLoad>();
  for (const text of texts) {
    for (const match of text.matchAll(SKILL_FILE)) {
      const skill = match[1] ?? "";
      if (SKILL_NAME.test(skill) && !loads.has(skill)) loads.set(skill, { skill, path: match[0] });
    }
  }
  return [...loads.values()];
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
  const folders = isAgentProvider(place.provider) ? agentProviderDescriptor(place.provider).skillFolders : [];
  return [
    ...(place.workspace ? folders.map((folder) => join(place.workspace ?? "", folder, load.skill, "SKILL.md")) : []),
    join(homeSkillRoot(), load.skill, "SKILL.md"),
    join(homedir(), ".claude", "skills", load.skill, "SKILL.md"),
  ];
}
