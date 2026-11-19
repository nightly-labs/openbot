import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { workspaceTemporaryPaths } from "./agent/workspace-sandbox";
import { isPathInside } from "./path-containment";

export interface ProcessConfinement {
  readonly writableRoots: readonly string[];
  readonly excludedFolders?: readonly string[];
}

export interface ProviderStatePaths {
  readonly writable: readonly string[];
  readonly protected: readonly string[];
  readonly protectedInProjects?: { readonly folders: readonly string[]; readonly names: readonly string[] };
  readonly writableContents?: readonly string[];
  readonly lockFolders?: readonly string[];
}

export interface SpawnTarget {
  command: string;
  args: string[];
  windowsVerbatimArguments: boolean;
}

class ProcessConfinementUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessConfinementUnavailableError";
  }
}

const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

export function grokHomeDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.GROK_HOME?.trim() || join(home, ".grok");
}

export function grokStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const grokHome = grokHomeDirectory(env, home);
  return {
    writable: [grokHome],
    protected: [
      "config.toml",
      "managed_config.toml",
      "sandbox.toml",
      "trusted_folders.toml",
      "hooks",
      "hooks-paths",
      "installed-plugins",
      "marketplace-cache",
      "skills",
      "commands",
      "agents",
      "bin",
      "bundled",
    ].map((name) => join(grokHome, name)),
  };
}

export function openCodeStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  return {
    writable: [
      openCodeDataDirectory(env, home),
      join(env.XDG_STATE_HOME?.trim() || join(home, ".local/state"), "opencode"),
      OPENCODE_CONFINED_CACHE,
    ],
    protected: [],
  };
}

const OPENCODE_CONFINED_CACHE = join(tmpdir(), "openbot-confined-cache");

export function openCodeDataDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(env.XDG_DATA_HOME?.trim() || join(home, ".local/share"), "opencode");
}

export function antigravityStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const geminiHome = env.GEMINI_HOME?.trim() || join(home, ".gemini");
  const acp = join(geminiHome, "antigravity-acp");
  return {
    writable: [acp, join(geminiHome, "artifacts"), join(geminiHome, "config", "projects")],
    protected: [join(acp, "settings.json"), join(acp, "trusted_workspaces.json")],
  };
}

export function cursorStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const xdgConfig = env.XDG_CONFIG_HOME?.trim();
  const userConfig = env.CURSOR_CONFIG_DIR?.trim() || (xdgConfig ? join(xdgConfig, "cursor") : join(home, ".cursor"));
  const dataHome = cursorDataHome(env, home);
  const fixedHome = join(home, ".cursor");
  const settings = [
    "cli-config.json",
    "permissions.json",
    "acp-config.json",
    "mcp.json",
    "hooks.json",
    "sandbox.json",
    "argv.json",
    "extensions",
    "plugins",
    "skills",
    "skills-cursor",
    "agents",
    "commands",
    "rules",
  ];
  return {
    writable: unique([cursorConfinedConfig(home), dataHome, fixedHome, CURSOR_CONFINED_CACHE]),
    writableContents: keychainLockFiles(),
    protected: unique([userConfig, dataHome, fixedHome].flatMap((root) => settings.map((name) => join(root, name)))),
    protectedInProjects: {
      folders: unique([dataHome, fixedHome].map((root) => join(root, "projects"))),
      names: [".workspace-trusted", "mcp-approvals.json"],
    },
  };
}

export function cursorDataHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.CURSOR_DATA_DIR?.trim() || join(home, ".cursor");
}

const CURSOR_CONFINED_CACHE = join(tmpdir(), "openbot-confined-cursor-cache");

let keychainLockFile: string | undefined;

function keychainLockFiles(): string[] {
  if (process.platform !== "darwin") return [];
  keychainLockFile ??= join(
    execFileSync("/usr/bin/getconf", ["DARWIN_USER_CACHE_DIR"], { encoding: "utf8" }).trim(),
    "mds",
    "mds.lock",
  );
  mkdirSync(dirname(keychainLockFile), { recursive: true, mode: 0o700 });
  closeSync(openSync(keychainLockFile, "a"));
  return [keychainLockFile];
}

function cursorConfinedConfig(home: string): string {
  return join(home, ".cursor", "openbot-confined");
}

export function cursorConfinedEnv(home = homedir()): Readonly<Record<string, string>> {
  return { CURSOR_CONFIG_DIR: cursorConfinedConfig(home), NODE_COMPILE_CACHE: CURSOR_CONFINED_CACHE };
}

export function clineStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const path = (name: string) => env[name]?.trim() || undefined;
  const clineHome = path("CLINE_DIR") ?? join(home, ".cline");
  const data = path("CLINE_DATA_DIR") ?? join(clineHome, "data");
  const db = path("CLINE_DB_DATA_DIR") ?? join(data, "db");
  const connectors = path("CLINE_CONNECTOR_DATA_DIR") ?? join(data, "connectors");
  const databases = [
    path("CLINE_CONNECTORS_DB_PATH") ?? join(db, "connectors.db"),
    path("CLINE_CRON_DB_PATH") ?? join(db, "cron.db"),
    path("CLINE_TASKS_DB_PATH") ?? join(db, "tasks.db"),
  ];
  return {
    writable: unique([data, db, path("CLINE_SESSION_DATA_DIR") ?? join(data, "sessions")]),
    protected: unique([
      path("CLINE_GLOBAL_SETTINGS_PATH") ?? join(data, "settings", "global-settings.json"),
      path("CLINE_MCP_SETTINGS_PATH") ?? join(data, "settings", "cline_mcp_settings.json"),
      connectors,
      path("CLINE_CONNECTOR_SETTINGS_PATH") ?? join(connectors, "settings.json"),
      ...databases.flatMap((file) => [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]),
    ]),
  };
}

export function hermesHome(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = env.HERMES_HOME?.trim();
  const root = configured
    ? configured === "~" || configured.startsWith("~/")
      ? join(home, configured.slice(1))
      : configured
    : platform === "win32"
      ? join(env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local"), "hermes")
      : join(home, ".hermes");
  return basename(dirname(root)) === "profiles" ? root : hermesActiveProfile(root);
}

function hermesActiveProfile(root: string): string {
  let name: string;
  try {
    name = readFileSync(join(root, "active_profile"), "utf8")
      .replace(/^\uFEFF/, "")
      .trim()
      .toLowerCase();
  } catch {
    return root;
  }
  if (name === "" || name === "default" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) return root;
  const profile = join(root, "profiles", name);
  return existsSync(profile) ? profile : root;
}

export function hermesStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const root = hermesHome(env, home);
  return {
    writable: [root],
    protected: [
      "hermes-agent",
      "hermes-setup",
      "config.yaml",
      ".env",
      "SOUL.md",
      "skills",
      "skill-bundles",
      "hooks",
      "cron",
      "scripts",
      "plugins",
      "desktop-plugins",
      "relay-plugins.toml",
      "profiles",
      "active_profile",
      "pairing",
      "platforms",
      "installs",
      "bootstrap-cache",
      "tools",
    ].map((name) => join(root, name)),
  };
}

export function kimiHomeDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.KIMI_SHARE_DIR?.trim() || join(home, ".kimi");
}

export function kimiStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const kimiHome = kimiHomeDirectory(env, home);
  return {
    writable: unique([kimiHome, join(home, ".kimi", "plans")]),
    protected: ["config.toml", "config.json", "mcp.json", "plugins", "skills", "bin"].map((name) =>
      join(kimiHome, name),
    ),
  };
}

/** The settings, sessions and logs folder of Kiro CLI. */
export function kiroHomeDirectory(home = homedir()): string {
  return join(home, ".kiro");
}

/**
 * The folder where Kiro CLI keeps its sign-in and history (`data.sqlite3`) and the runtime that it
 * downloads. macOS was read on a real install, and Linux is `~/.local/share/kiro-cli` in the Docker
 * documentation of Kiro. For Windows, two sources disagree between `%APPDATA%` and `%LOCALAPPDATA%`, and
 * no Windows computer was available: `%LOCALAPPDATA%` is the guess. The confinement runs on macOS only.
 */
export function kiroDataDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "darwin") return join(home, "Library", "Application Support", "kiro-cli");
  if (platform === "win32") return join(env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local"), "kiro-cli");
  return join(env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"), "kiro-cli");
}

/**
 * Kiro CLI writes its sessions, session index, logs and caches in `~/.kiro`, and its sign-in, history
 * and downloaded runtime in its data folder. The settings and MCP servers, the agents, the steering
 * files, the skills, the powers, the extensions and the environment file are in `~/.kiro` too, and
 * every other Kiro process loads them, so they stay read-only. Whether the CLI also writes the AWS
 * folders of an IAM Identity Center sign-in was not checked, so those folders stay closed.
 */
export function kiroStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const kiroHome = kiroHomeDirectory(home);
  return {
    writable: [kiroHome, kiroDataDirectory(env, home)],
    protected: [
      "settings",
      "agents",
      "steering",
      "skills",
      "powers",
      "extensions",
      "hooks",
      "argv.json",
      "kiro.env",
    ].map((name) => join(kiroHome, name)),
  };
}

export function mistralHomeDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.VIBE_HOME?.trim() || join(home, ".vibe");
}

export function mistralStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const vibeHome = mistralHomeDirectory(env, home);
  makeMistralTrustedFolders(vibeHome);
  return {
    writable: [vibeHome],
    writableContents: keychainLockFiles(),
    protected: [
      "config.toml",
      ".env",
      "trusted_folders.toml",
      "hooks.toml",
      "AGENTS.md",
      "tools",
      "skills",
      "skills.toml",
      "skills-registry-cache",
      "agents",
      "prompts",
      "plugins",
      "projects.toml",
      "local_projects.toml",
      "managed_config_cache.json",
      "model_catalog_cache.json",
      "connector_bootstrap_cache.json",
    ].map((name) => join(vibeHome, name)),
  };
}

function makeMistralTrustedFolders(vibeHome: string): void {
  mkdirSync(vibeHome, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(join(vibeHome, "trusted_folders.toml"), "trusted = []\nuntrusted = []\n", {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
}

export function devinDataDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"), "devin");
}

export function devinStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const data = devinDataDirectory(env, home);
  return {
    writable: [
      join(data, "cli"),
      join(data, "mcp"),
      join(env.XDG_CACHE_HOME?.trim() || join(home, ".cache"), "devin"),
      join(home, ".devin", "plans"),
    ],
    protected: [join(data, "cli", "plugins")],
  };
}

export function customAgentStatePaths(): ProviderStatePaths {
  return { writable: [], protected: [] };
}

export function piAgentDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.PI_CODING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
}

export function piStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const agentDirectory = piAgentDirectory(env, home);
  return {
    writable: [join(agentDirectory, "sessions")],
    protected: [],
    lockFolders: ["auth.json", "settings.json", "trust.json", "models-store.json"].map((name) =>
      join(agentDirectory, `${name}.lock`),
    ),
  };
}

export function museStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const root = join(env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"), "muse");
  return {
    writable: [
      join(root, "sessions"),
      join(root, "logs"),
      ...["", "-wal", "-shm", "-journal"].map((suffix) => join(root, `session-index.db${suffix}`)),
    ],
    protected: [],
  };
}

export function codexHomeDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.CODEX_HOME?.trim() || join(home, ".codex");
}

export function copilotHomeDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.COPILOT_HOME?.trim() || join(home, ".copilot");
}

export function copilotStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const copilotHome = copilotHomeDirectory(env, home);
  makeCopilotConfig(copilotHome);
  return {
    writable: [copilotHome, COPILOT_CONFINED_CACHE],
    writableContents: keychainLockFiles(),
    protected: [
      "config.json",
      "config",
      "settings.json",
      "mcp-config.json",
      "lsp-config.json",
      "permissions-config.json",
      "mcp-oauth-config",
      "mcp-oauth-config.json",
      "copilot-instructions.md",
      "instructions",
      "hooks",
      "skills",
      "agents",
      "plugins",
      "installed-plugins",
      "extensions",
      "pkg",
    ].map((name) => join(copilotHome, name)),
  };
}

function makeCopilotConfig(copilotHome: string): void {
  mkdirSync(copilotHome, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(
      join(copilotHome, "config.json"),
      `${JSON.stringify({ firstLaunchAt: new Date().toISOString() }, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
}

const COPILOT_CONFINED_CACHE = join(tmpdir(), "openbot-confined-copilot-cache");

export const COPILOT_CONFINED_ENV: Readonly<Record<string, string>> = {
  COPILOT_CACHE_HOME: COPILOT_CONFINED_CACHE,
  COPILOT_PKG_CACHE_HOME: join(COPILOT_CONFINED_CACHE, "pkg"),
};

export const OPENCODE_CONFINED_ENV: Readonly<Record<string, string>> = {
  XDG_CACHE_HOME: OPENCODE_CONFINED_CACHE,
  npm_config_cache: join(OPENCODE_CONFINED_CACHE, "npm-cache"),
  NPM_CONFIG_CACHE: join(OPENCODE_CONFINED_CACHE, "npm-cache"),
};

const PROJECT_SETTINGS = [
  ".claude",
  ".codex",
  ".grok",
  ".opencode",
  "opencode.json",
  "opencode.jsonc",
  ".cursor",
  ".cline",
  ".clinerules",
  ".kimi",
  ".vibe",
  ".devin",
  ".windsurf",
  ".pi",
  ".muse",
  ".gemini",
  ".agents",
  ".agent",
  "_agents",
  "_agent",
  ".mcp.json",
  ".github/mcp.json",
  ".github/copilot",
  ".github/hooks",
  ".github/skills",
  ".github/agents",
];

export function confineSpawnTarget(
  target: SpawnTarget,
  confinement: ProcessConfinement,
  state: ProviderStatePaths,
  platform: NodeJS.Platform = process.platform,
): SpawnTarget {
  const writable = [...confinement.writableRoots, ...state.writable, ...workspaceTemporaryPaths(platform)];
  const excluded = confinement.excludedFolders ?? [];
  const protectedPaths = [
    ...state.protected,
    ...excluded,
    ...confinement.writableRoots.flatMap((root) => PROJECT_SETTINGS.map((name) => join(root, name))),
  ];
  const held = [
    ...excluded,
    ...confinement.writableRoots.flatMap((root) =>
      PROJECT_SETTINGS.filter((name) => name.includes("/")).map((name) => join(root, name)),
    ),
  ];
  if (canConfineProcesses(platform)) {
    if (!existsSync(SANDBOX_EXEC)) throw new ProcessConfinementUnavailableError(unavailable("macOS sandbox-exec"));
    return {
      command: SANDBOX_EXEC,
      args: [
        "-p",
        seatbeltProfile(
          writable,
          protectedPaths,
          state.protectedInProjects,
          state.writableContents ?? [],
          state.lockFolders ?? [],
          held,
        ),
        target.command,
        ...target.args,
      ],
      windowsVerbatimArguments: false,
    };
  }
  throw new ProcessConfinementUnavailableError(sourceText("error.agent.workspaceOnlyMacOnly"));
}

export function canConfineProcesses(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

function unavailable(tool: string): string {
  return sourceText("error.agent.workspaceOnlyToolMissing", { tool });
}

function seatbeltProfile(
  writable: readonly string[],
  protectedPaths: readonly string[],
  inProjects: ProviderStatePaths["protectedInProjects"],
  contents: readonly string[],
  lockFolders: readonly string[],
  held: readonly string[],
): string {
  const writableReal = unique(writable.flatMap(realPaths));
  const allowed = writableReal.map((path) => `(subpath ${sbplString(path)})`);
  const holders = unique(
    held.flatMap(realPaths).flatMap((folder) => writableReal.flatMap((root) => holderFolders(root, folder))),
  ).map((path) => `(literal ${sbplString(path)})`);
  const files = unique(contents.flatMap(realPaths)).map((path) => `(literal ${sbplString(path)})`);
  const locks = unique(lockFolders.flatMap(realPaths)).map((path) => `(literal ${sbplString(path)})`);
  const names = inProjects?.names.map(regexText).join("|");
  const denied = [
    ...unique(protectedPaths.flatMap(realPaths)).map(
      (path) => `(literal ${sbplString(path)}) (subpath ${sbplString(path)})`,
    ),
    ...(names
      ? unique(inProjects?.folders.flatMap(realPaths) ?? []).map(
          (folder) => `(regex ${sbplString(`^${regexText(folder)}/(.+/)?(${names})(/|$)`)})`,
        )
      : []),
  ];
  return [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${allowed.join(" ")})`,
    ...(files.length > 0 ? [`(allow file-write-data ${files.join(" ")})`] : []),
    ...(locks.length > 0
      ? [
          `(allow file-write* ${locks.join(" ")})`,
          `(deny file-write-create (require-all (require-any ${locks.join(" ")}) (require-not (vnode-type DIRECTORY))))`,
        ]
      : []),
    '(allow file-write* (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/ptmx") (literal "/dev/dtracehelper") (regex #"^/dev/ttys[0-9]+$") (regex #"^/dev/fd/"))',
    ...(denied.length > 0 ? [`(deny file-write* ${denied.join(" ")})`] : []),
    ...(holders.length > 0 ? [`(deny file-write-unlink file-write-create ${holders.join(" ")})`] : []),
    "",
  ].join("\n");
}

function holderFolders(root: string, folder: string): string[] {
  const holders: string[] = [];
  let parent = dirname(folder);
  while (parent !== folder && isPathInside(root, parent)) {
    holders.push(parent);
    folder = parent;
    parent = dirname(parent);
  }
  return holders;
}

function realPaths(path: string): string[] {
  const absolute = resolve(path);
  return unique([absolute, resolveExisting(absolute)]);
}

function resolveExisting(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(resolveExisting(parent), basename(path));
  }
}

function regexText(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sbplString(value: string): string {
  return JSON.stringify(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
