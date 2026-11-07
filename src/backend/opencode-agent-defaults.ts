// The OpenCode rules that OpenBot sets only where the user's own config is silent.
//
// OpenCode 2.2.6 merges its config layers in this order: the global folder, the `OPENCODE_CONFIG`
// file, the project's `opencode.json`, and then `OPENCODE_CONFIG_CONTENT`. Permission rules form one
// ordered list, and the last rule that matches wins (`opencode debug agents`). A rule in
// `OPENCODE_CONFIG_CONTENT`, where `opencode-config.ts` writes, beats every rule of the user. These
// rules only remove prompt weight, so they go in the `OPENCODE_CONFIG` file: a project rule comes after
// them. A rule in the user's global config comes before them, so a rule that a global name or pattern
// matches is left out of the file. The global catch-all `"*"` only sets how OpenCode asks for tools.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Option, Schema } from "effect";

const logger = createOpenBotLogger("opencode-agent-defaults");

type OpenCodeAction = "allow" | "ask" | "deny";

/**
 * What each rule removes from one request, measured with `scripts/opencode-prompt-settings-bench.ts`
 * on OpenCode 2.2.6 (o200k tokens of a one-reply request, 5,987 before and 5,288 with all rules):
 *
 * - `question`, 311: OpenBot has its own `ask_user` tool, which the user answers in the chat.
 * - `opencode_list_mcp_resources` and `opencode_read_mcp_resource`, 102: OpenBot's MCP servers serve
 *   tools, not resources. With them gone, the Code Mode catalog shows one more OpenBot tool.
 * - the `report` and `opencode` skills, 286: they file OpenCode bug reports and answer questions
 *   about OpenCode itself. Other skills stay.
 */
const OPENCODE_AGENT_DEFAULTS = {
  question: "deny",
  opencode_list_mcp_resources: "deny",
  opencode_read_mcp_resource: "deny",
} as const satisfies Readonly<Record<string, OpenCodeAction>>;

const OPENCODE_SKILL_DEFAULTS = { report: "deny", opencode: "deny" } as const satisfies Readonly<
  Record<string, OpenCodeAction>
>;

/** The global config files that OpenCode reads, in its own order. */
const GLOBAL_CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"] as const;

const DEFAULTS_FILE = "openbot-agent-defaults.json";

/**
 * The tool and skill patterns that the user's global config sets a rule for. A bare `*` for all tools
 * is not kept: it sets how OpenCode asks for every tool, and is not a choice about these tools.
 */
interface UserRules {
  readonly tools: string[];
  readonly skills: string[];
}

/** True when an OpenCode wildcard pattern (`*` and `?`) matches the whole name. */
function matches(pattern: string, name: string): boolean {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${source}$`, "u").test(name);
}

/**
 * Removes the comments and the trailing commas that OpenCode accepts in its config, so that
 * `JSON.parse` reads it. Text in strings stays unchanged.
 */
function stripJsonc(text: string): string {
  let out = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(index, end + 1);
      index = end + 1;
    } else if (char === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
    } else if (char === "/" && text[index + 1] === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      out += char;
      index += 1;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * The parts of a global config file that can name a rule. Other keys are ignored. A shape that OpenCode
 * itself refuses fails to decode, and then OpenBot adds no rule.
 */
const UserConfig = Schema.Struct({
  permission: Schema.optional(
    Schema.Union([
      Schema.String,
      Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
    ]),
  ),
  // OpenCode 2 adds `permissions`, an ordered list of rules, and still reads the older keys.
  permissions: Schema.optional(
    Schema.Array(Schema.Struct({ action: Schema.String, resource: Schema.optional(Schema.String) })),
  ),
  // The deprecated `tools` switches still turn a tool on or off.
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
});
type UserConfig = typeof UserConfig.Type;

const decodeUserConfig = Schema.decodeUnknownOption(Schema.fromJsonString(UserConfig));

/** Adds the patterns that one global config file sets a rule for. */
function collectRules(config: UserConfig, rules: { tools: string[]; skills: string[] }): void {
  const addTool = (pattern: string) => {
    if (pattern !== "*") rules.tools.push(pattern);
  };
  // A string `permission`, such as "allow", is the same catch-all as `"*"`.
  const { permission } = config;
  if (permission && typeof permission !== "string") {
    for (const [tool, rule] of Object.entries(permission)) {
      if (tool !== "skill") addTool(tool);
      // A string rule for `skill` is a choice about every skill.
      else if (typeof rule === "string") rules.skills.push("*");
      else rules.skills.push(...Object.keys(rule));
    }
  }
  for (const rule of config.permissions ?? []) {
    if (rule.action !== "skill") addTool(rule.action);
    else rules.skills.push(rule.resource ?? "*");
  }
  for (const tool of Object.keys(config.tools ?? {})) addTool(tool);
}

/**
 * The names that the user's global config sets a rule for, or null when a file cannot be decoded:
 * then OpenBot cannot know what the user set, and adds no rule.
 */
function readUserRules(env: NodeJS.ProcessEnv, home: string): UserRules | null {
  const folder = join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "opencode");
  const rules: { tools: string[]; skills: string[] } = { tools: [], skills: [] };
  for (const name of GLOBAL_CONFIG_FILES) {
    let text: string;
    try {
      text = readFileSync(join(folder, name), "utf8");
    } catch {
      continue;
    }
    const config = decodeUserConfig(stripJsonc(text));
    if (Option.isNone(config)) {
      logger.warn("OpenBot could not read an OpenCode config file, so it adds no prompt rules.", { file: name });
      return null;
    }
    collectRules(config.value, rules);
  }
  return rules;
}

/** One layer under OpenCode's `permission` key. */
interface DefaultsLayer {
  readonly permission: Partial<typeof OPENCODE_AGENT_DEFAULTS> & {
    readonly skill?: Partial<typeof OPENCODE_SKILL_DEFAULTS>;
  };
}

/** The rules that no pattern of the user's global config matches, or null when there are none. */
function defaultsLayer(rules: UserRules): DefaultsLayer | null {
  const named = (patterns: readonly string[], name: string) => patterns.some((pattern) => matches(pattern, name));
  const tools: Partial<typeof OPENCODE_AGENT_DEFAULTS> = Object.fromEntries(
    Object.entries(OPENCODE_AGENT_DEFAULTS).filter(([tool]) => !named(rules.tools, tool)),
  );
  const skill: Partial<typeof OPENCODE_SKILL_DEFAULTS> = Object.fromEntries(
    Object.entries(OPENCODE_SKILL_DEFAULTS).filter(([id]) => !named(rules.skills, id)),
  );
  if (Object.keys(tools).length === 0 && Object.keys(skill).length === 0) return null;
  return { permission: { ...tools, ...(Object.keys(skill).length > 0 ? { skill } : {}) } };
}

/**
 * The `OPENCODE_CONFIG` entry for an agent's OpenCode process, or nothing. Read at each spawn, like
 * the other layers, so a change to the user's config reaches the next process.
 *
 * A user who sets `OPENCODE_CONFIG` keeps that file, and OpenBot then adds no rule. Without a folder of
 * its own, OpenBot also adds none.
 */
export function openCodeAgentDefaultsEnv(
  stateDirectory: string | undefined,
  env: NodeJS.ProcessEnv,
  home = homedir(),
): Record<string, string> {
  if (!stateDirectory || env.OPENCODE_CONFIG?.trim()) return {};
  const rules = readUserRules(env, home);
  const layer = rules && defaultsLayer(rules);
  if (!layer) return {};
  const folder = join(stateDirectory, "opencode");
  const file = join(folder, DEFAULTS_FILE);
  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(file, `${JSON.stringify(layer, null, 2)}\n`);
  } catch (cause) {
    logger.warn("OpenBot could not write its OpenCode prompt rules.", toLogValue(cause));
    return {};
  }
  return { OPENCODE_CONFIG: file };
}
