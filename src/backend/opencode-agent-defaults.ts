// The OpenCode settings that OpenBot sets only where the user's own config is silent.
//
// OpenCode 2.2.6 merges its config layers in this order: the global folder, the `OPENCODE_CONFIG`
// file, the project's `opencode.json`, and then `OPENCODE_CONFIG_CONTENT`. Permission rules form one
// ordered list, and the last rule that matches wins (`opencode debug agents`). A rule in
// `OPENCODE_CONFIG_CONTENT`, where `opencode-config.ts` writes, beats every rule of the user. These
// rules only remove prompt weight, so they go in the `OPENCODE_CONFIG` file: a project rule comes after
// them. A rule in the user's global config comes before them, so a rule that a global name or pattern
// matches is left out of the file. The global catch-all `"*"` only sets how OpenCode asks for tools.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Option, Schema } from "effect";
import { openCodeDatabasePath, readOpenCodeDatabase } from "./opencode-usage";

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

/**
 * The answer "Allow search via …" to the question that OpenCode 2 asks before its first web search.
 * OpenCode fails the search with "Web search cancelled" when nobody answers in a minute, and an agent
 * in a Slack, Discord, Telegram or WhatsApp chat cannot show the question, so each search there
 * failed (#11315). The `websearch` setting, which OpenCode reads since 2.0.0, gives the answer, and a
 * later config layer, such as the project's, still wins. A setting beats the answer that OpenCode
 * saved, so OpenBot leaves it out when an answer is saved.
 */
const OPENCODE_WEB_SEARCH_DEFAULT = { provider: "random" } as const;

/** The key under which OpenCode 2 saves that answer in its `kv` table. */
const WEB_SEARCH_ANSWER_KEY = "websearch:provider";

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
  /** The global config sets `websearch`. */
  readonly webSearch: boolean;
}

/** True when an OpenCode wildcard pattern (`*` and `?`) matches the whole name. */
function matches(pattern: string, name: string): boolean {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${source}$`, "u").test(name);
}

/** Copies `text` and gives each part outside a string to `outside`. Strings stay unchanged. */
function mapOutsideStrings(text: string, outside: (part: string) => string): string {
  let out = "";
  let start = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '"') {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
    out += outside(text.slice(start, index)) + text.slice(index, end + 1);
    start = index = end + 1;
  }
  return out + outside(text.slice(start));
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
  // With the comments gone, a quote starts or ends a string.
  return mapOutsideStrings(out, (part) => part.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * The parts of a global config file that can name a rule. Other keys are ignored. A shape that OpenCode
 * itself refuses fails to decode, and then OpenBot adds no rule.
 */
const PermissionRules = Schema.Struct({
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
type PermissionRules = typeof PermissionRules.Type;

// A rule of an agent, in `agent` or `agents`, counts for every agent: OpenBot does not know which
// agent the user starts.
const UserConfig = Schema.Struct({
  ...PermissionRules.fields,
  websearch: Schema.optional(Schema.Unknown),
  agent: Schema.optional(Schema.Record(Schema.String, PermissionRules)),
  agents: Schema.optional(Schema.Record(Schema.String, PermissionRules)),
});

const decodeUserConfig = Schema.decodeUnknownOption(Schema.fromJsonString(UserConfig));

/** Adds the patterns that one global config file, or one agent in it, sets a rule for. */
function collectRules(config: PermissionRules, rules: { tools: string[]; skills: string[] }): void {
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

/** The config files that a warning was logged for, so that each spawn does not log it again. */
const warnedFiles = new Set<string>();

/**
 * The global config folders. `OPENCODE_CONFIG_DIR` takes the place of the XDG folder in OpenCode
 * 2.2.6, and is also read as an extra folder; OpenBot reads both, so that it sees every user rule.
 */
function globalConfigFolders(env: NodeJS.ProcessEnv, home: string): string[] {
  const folders = [join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "opencode")];
  const configDirectory = env.OPENCODE_CONFIG_DIR?.trim();
  if (configDirectory && !folders.includes(configDirectory)) folders.push(configDirectory);
  return folders;
}

/**
 * The names that the user's global config sets a rule for, or null when a file cannot be decoded:
 * then OpenBot cannot know what the user set, and adds no rule.
 */
function readUserRules(env: NodeJS.ProcessEnv, home: string): UserRules | null {
  const rules: { tools: string[]; skills: string[]; webSearch: boolean } = { tools: [], skills: [], webSearch: false };
  for (const folder of globalConfigFolders(env, home)) {
    for (const name of GLOBAL_CONFIG_FILES) {
      const file = join(folder, name);
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const config = decodeUserConfig(stripJsonc(text));
      if (Option.isNone(config)) {
        if (!warnedFiles.has(file))
          logger.warn("OpenBot could not read an OpenCode config file, so it adds no prompt rules.", { file: name });
        warnedFiles.add(file);
        return null;
      }
      collectRules(config.value, rules);
      if (config.value.websearch !== undefined) rules.webSearch = true;
      for (const agent of [...Object.values(config.value.agent ?? {}), ...Object.values(config.value.agents ?? {})])
        collectRules(agent, rules);
    }
  }
  return rules;
}

function readTextOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Whether OpenCode's database holds an answer to the web search question, or null when OpenBot cannot
 * read it. A database or a `kv` table that does not exist yet holds none.
 */
function hasWebSearchAnswer(env: NodeJS.ProcessEnv, home: string): boolean | null {
  const path = openCodeDatabasePath(env, home);
  if (!path || !existsSync(path)) return false;
  try {
    return readOpenCodeDatabase(path, (database) => {
      if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'kv'").get()) return false;
      return database.prepare("SELECT 1 FROM kv WHERE key = ?").get(WEB_SEARCH_ANSWER_KEY) !== undefined;
    });
  } catch (cause) {
    logger.warn("OpenBot could not read OpenCode's web search answer.", toLogValue(cause));
    return null;
  }
}

/** One config layer: rules under OpenCode's `permission` key, and the web search answer. */
interface DefaultsLayer {
  readonly permission?: Partial<typeof OPENCODE_AGENT_DEFAULTS> & {
    readonly skill?: Partial<typeof OPENCODE_SKILL_DEFAULTS>;
  };
  readonly websearch?: typeof OPENCODE_WEB_SEARCH_DEFAULT;
}

/**
 * The rules that no pattern of the user's global config matches, and the web search answer when
 * `webSearch` asks for it. Null when there is nothing to set.
 */
function defaultsLayer(rules: UserRules, webSearch: boolean): DefaultsLayer | null {
  const named = (patterns: readonly string[], name: string) => patterns.some((pattern) => matches(pattern, name));
  const tools: Partial<typeof OPENCODE_AGENT_DEFAULTS> = Object.fromEntries(
    Object.entries(OPENCODE_AGENT_DEFAULTS).filter(([tool]) => !named(rules.tools, tool)),
  );
  const skill: Partial<typeof OPENCODE_SKILL_DEFAULTS> = Object.fromEntries(
    Object.entries(OPENCODE_SKILL_DEFAULTS).filter(([id]) => !named(rules.skills, id)),
  );
  const hasRules = Object.keys(tools).length > 0 || Object.keys(skill).length > 0;
  if (!hasRules && !webSearch) return null;
  return {
    ...(hasRules ? { permission: { ...tools, ...(Object.keys(skill).length > 0 ? { skill } : {}) } } : {}),
    ...(webSearch ? { websearch: OPENCODE_WEB_SEARCH_DEFAULT } : {}),
  };
}

/**
 * The `OPENCODE_CONFIG` entry for an agent's OpenCode process, or nothing. Read at each spawn, like
 * the other layers, so a change to the user's config reaches the next process.
 *
 * A user who sets `OPENCODE_CONFIG` keeps that file, and OpenBot then adds no rule. Without a folder of
 * its own, OpenBot also adds none. Only OpenCode 2 gets the web search answer: OpenCode 1 has no web
 * search question, and OpenCode 1.0 refuses a config key that it does not know.
 */
export function openCodeAgentDefaultsEnv(
  stateDirectory: string | undefined,
  env: NodeJS.ProcessEnv,
  cliVersion: string,
  home = homedir(),
): Record<string, string> {
  if (!stateDirectory || env.OPENCODE_CONFIG?.trim()) return {};
  const rules = readUserRules(env, home);
  const webSearch =
    Number.parseInt(cliVersion, 10) >= 2 && rules?.webSearch === false && hasWebSearchAnswer(env, home) === false;
  const layer = rules && defaultsLayer(rules, webSearch);
  if (!layer) return {};
  const folder = join(stateDirectory, "opencode");
  const file = join(folder, DEFAULTS_FILE);
  const content = `${JSON.stringify(layer, null, 2)}\n`;
  try {
    if (readTextOrNull(file) !== content) {
      mkdirSync(folder, { recursive: true });
      // A process that starts while another spawn writes reads the old file or the new one, never a
      // partial one.
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, content);
      renameSync(temporary, file);
    }
  } catch (cause) {
    logger.warn("OpenBot could not write its OpenCode prompt rules.", toLogValue(cause));
    return {};
  }
  return { OPENCODE_CONFIG: file };
}
