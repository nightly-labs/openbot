import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Option, Schema } from "effect";
import { openCodeDatabasePath, readOpenCodeDatabase } from "./opencode-usage";

const logger = createOpenBotLogger("opencode-agent-defaults");

type OpenCodeAction = "allow" | "ask" | "deny";

const OPENCODE_AGENT_DEFAULTS = {
  question: "deny",
  opencode_list_mcp_resources: "deny",
  opencode_read_mcp_resource: "deny",
} as const satisfies Readonly<Record<string, OpenCodeAction>>;

const OPENCODE_APPROVAL_TOOLS = [
  { tool: "bash", names: ["bash", "shell"] },
  { tool: "edit", names: ["edit", "write", "patch"] },
] as const;

type ApprovalDefaults = Partial<Record<(typeof OPENCODE_APPROVAL_TOOLS)[number]["tool"], "ask">>;

const OPENCODE_SKILL_DEFAULTS = { report: "deny", opencode: "deny" } as const satisfies Readonly<
  Record<string, OpenCodeAction>
>;

const OPENCODE_WEB_SEARCH_DEFAULT = { provider: "random" } as const;

const WEB_SEARCH_ANSWER_KEY = "websearch:provider";

const GLOBAL_CONFIG_FILES = ["config.json", "opencode.json", "opencode.jsonc"] as const;

const DEFAULTS_FILE = "openbot-agent-defaults.json";

const APPROVAL_DEFAULTS_FILE = "openbot-agent-approval-defaults.json";

interface UserRules {
  readonly tools: string[];
  readonly skills: string[];
  readonly webSearch: boolean;
  readonly allTools: boolean;
}

function matches(pattern: string, name: string): boolean {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${source}$`, "u").test(name);
}

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
  return mapOutsideStrings(out, (part) => part.replace(/,(\s*[}\]])/g, "$1"));
}

const PermissionRules = Schema.Struct({
  permission: Schema.optional(
    Schema.Union([
      Schema.String,
      Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Record(Schema.String, Schema.String)])),
    ]),
  ),
  permissions: Schema.optional(
    Schema.Array(Schema.Struct({ action: Schema.String, resource: Schema.optional(Schema.String) })),
  ),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)),
});
type PermissionRules = typeof PermissionRules.Type;

const UserConfig = Schema.Struct({
  ...PermissionRules.fields,
  websearch: Schema.optional(Schema.Unknown),
  agent: Schema.optional(Schema.Record(Schema.String, PermissionRules)),
  agents: Schema.optional(Schema.Record(Schema.String, PermissionRules)),
});

const decodeUserConfig = Schema.decodeUnknownOption(Schema.fromJsonString(UserConfig));

function collectRules(config: PermissionRules, rules: { tools: string[]; skills: string[]; allTools: boolean }): void {
  const addTool = (pattern: string) => {
    if (pattern !== "*") rules.tools.push(pattern);
    else rules.allTools = true;
  };
  const { permission } = config;
  if (typeof permission === "string") rules.allTools = true;
  else if (permission) {
    for (const [tool, rule] of Object.entries(permission)) {
      if (tool !== "skill") addTool(tool);
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

const warnedFiles = new Set<string>();

function globalConfigFolders(env: NodeJS.ProcessEnv, home: string): string[] {
  const folders = [join(env.XDG_CONFIG_HOME?.trim() || join(home, ".config"), "opencode")];
  const configDirectory = env.OPENCODE_CONFIG_DIR?.trim();
  if (configDirectory && !folders.includes(configDirectory)) folders.push(configDirectory);
  return folders;
}

function readUserRules(env: NodeJS.ProcessEnv, home: string): UserRules | null {
  const rules: { tools: string[]; skills: string[]; webSearch: boolean; allTools: boolean } = {
    tools: [],
    skills: [],
    webSearch: false,
    allTools: false,
  };
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

type ToolDefaults = Partial<typeof OPENCODE_AGENT_DEFAULTS> & ApprovalDefaults;

interface DefaultsLayer {
  readonly permission?: ToolDefaults & {
    readonly skill?: Partial<typeof OPENCODE_SKILL_DEFAULTS>;
  };
  readonly websearch?: typeof OPENCODE_WEB_SEARCH_DEFAULT;
}

function approvalDefaults(
  rules: UserRules,
  named: (patterns: readonly string[], name: string) => boolean,
): ApprovalDefaults {
  if (rules.allTools) return {};
  return Object.fromEntries(
    OPENCODE_APPROVAL_TOOLS.filter(({ names }) => !names.some((name) => named(rules.tools, name))).map(({ tool }) => [
      tool,
      "ask",
    ]),
  );
}

function defaultsLayer(rules: UserRules, webSearch: boolean, asksBeforeChanges: boolean): DefaultsLayer | null {
  const named = (patterns: readonly string[], name: string) => patterns.some((pattern) => matches(pattern, name));
  const tools: ToolDefaults = {
    ...Object.fromEntries(Object.entries(OPENCODE_AGENT_DEFAULTS).filter(([tool]) => !named(rules.tools, tool))),
    ...(asksBeforeChanges ? approvalDefaults(rules, named) : {}),
  };
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

export function openCodeAgentDefaultsEnv(
  stateDirectory: string | undefined,
  env: NodeJS.ProcessEnv,
  cliVersion: string,
  approvals: "provider-asks" | "confined",
  home = homedir(),
): Record<string, string> {
  if (!stateDirectory || env.OPENCODE_CONFIG?.trim()) return {};
  const rules = readUserRules(env, home);
  const secondMajor = Number.parseInt(cliVersion, 10) >= 2;
  const webSearch = secondMajor && rules?.webSearch === false && hasWebSearchAnswer(env, home) === false;
  const asksBeforeChanges = secondMajor && approvals === "provider-asks";
  const layer = rules && defaultsLayer(rules, webSearch, asksBeforeChanges);
  if (!layer) return {};
  const folder = join(stateDirectory, "opencode");
  const file = join(folder, asksBeforeChanges ? APPROVAL_DEFAULTS_FILE : DEFAULTS_FILE);
  const content = `${JSON.stringify(layer, null, 2)}\n`;
  try {
    if (readTextOrNull(file) !== content) {
      mkdirSync(folder, { recursive: true });
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
