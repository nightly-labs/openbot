import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { agentProviderDescriptor, isAgentProvider } from "@openbot/contracts/agent-providers";
import { Effect, Option, Schema } from "effect";
import { homeSkillRoot } from "../home-skills";
import { getRecord, getString, isRecord } from "../protocol";

export interface SkillLoad {
  skill: string;
  path: string | null;
}

const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const PLUGIN_SKILL_NAME = /^(?=.{1,128}$)[A-Za-z0-9][A-Za-z0-9._-]*:[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const OPENBOT_SKILL_PLUGINS = /^(?:openbot|agents):/u;
const SKILL_PATH = /^(?:.*[\\/])?skills[\\/]([^\\/]+)[\\/]SKILL\.md$/u;
const SKILL_FILE_IN_COMMAND =
  /(?<![^\s'"`;|&<>()=])(?:[^\s'"`;|&<>()]*[\\/])?skills[\\/]([^\\/\s'"`;|&<>()]+)[\\/]SKILL\.md(?![\w.])/gu;
const READ_COMMAND = /(?:^|[\s;&|('"])(?:cat|sed|head|tail|nl|bat|less|more|awk|type|Get-Content|gc)\s/u;
const SED_IN_PLACE = /(?:^|[\s;&|('"])sed\s(?:.*\s)?-(?:[A-Za-z]*i|-in-place)/u;
export const COMMAND_SEPARATOR = /&&|\|\||[;|\n]/u;
const BYTES_PER_TOKEN = 4;

export function skillLoads(item: unknown, filePaths: readonly unknown[], provider: string): SkillLoad[] {
  if (!isRecord(item)) return [];
  const status = getString(item, "status");
  if (status === "failed" || status === "declined") return [];
  const name = item.type === "toolCall" ? getString(item, "name") : null;
  if (provider === "opencode" && name === "skill" && status === "completed") {
    const skill = getString(getRecord(item, "arguments"), "id");
    return skill && SKILL_NAME.test(skill) ? [{ skill, path: null }] : [];
  }
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
    const paths = [...filePaths, ...Object.values(getRecord(item, "arguments") ?? {})];
    for (const path of paths) {
      if (typeof path !== "string") continue;
      const match = SKILL_PATH.exec(path);
      if (match) add(match[1] ?? "", path);
    }
  }
  return [...loads.values()];
}

export function shownFileCommands(line: string): string[] {
  return line
    .split(COMMAND_SEPARATOR)
    .filter((command) => READ_COMMAND.test(command) && !SED_IN_PLACE.test(command))
    .map((command) => command.split(">", 1)[0] ?? "");
}

class SkillFileUnreadable extends Schema.TaggedError<SkillFileUnreadable>()("SkillFileUnreadable", {
  cause: Schema.Defect(),
}) {}

export interface SkillLoadPlace {
  cwd: string | null;
  workspace: string | null;
  provider: string;
}

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
  if (load.skill.includes(":")) return [];
  const folders = isAgentProvider(place.provider) ? agentProviderDescriptor(place.provider).skillFolders : [];
  return [
    ...(place.workspace ? folders.map((folder) => join(place.workspace ?? "", folder, load.skill, "SKILL.md")) : []),
    join(homeSkillRoot(), load.skill, "SKILL.md"),
    join(homedir(), ".claude", "skills", load.skill, "SKILL.md"),
  ];
}
