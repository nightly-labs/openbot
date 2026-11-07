import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { workspaceTemporaryPaths } from "./agent/workspace-sandbox";
import { isPathInside } from "./path-containment";

/**
 * The folders one Workspace only agent may write: its workspace and the shared folder. The temporary
 * folders and the provider's state are added to them.
 *
 * Grok, OpenCode, Antigravity, Cursor, Cline, Kimi and Devin take no sandbox per session, so a
 * Workspace only agent on them gets a provider process of its own, and OpenBot starts that process
 * inside an operating system sandbox. The whole process is confined: the file edit tools, the shell, and every
 * command and MCP server it starts. Nothing inside the process can take the sandbox away. Only macOS
 * has the sandbox now: on Linux and Windows the process does not start, and the user must choose
 * Full access.
 */
export interface ProcessConfinement {
  readonly writableRoots: readonly string[];
  /** Folders in the writable roots that the user excluded. They are denied like the protected paths. */
  readonly excludedFolders?: readonly string[];
}

/** What a provider must write to run, and what in there it must not write. */
export interface ProviderStatePaths {
  readonly writable: readonly string[];
  /**
   * Files and folders in `writable` that load code or settings for the provider processes that are
   * not confined. A confined agent that wrote them would reach outside at the next start of one.
   */
  readonly protected: readonly string[];
  /**
   * Folders in `writable` that hold a folder for each project, and the file names in there, at any
   * depth, that trust a project or approve its MCP servers for the processes that are not confined.
   */
  readonly protectedInProjects?: { readonly folders: readonly string[]; readonly names: readonly string[] };
  /**
   * Files outside `writable` that the provider writes in, and that processes that are not confined
   * open too. Only their contents are writable: a confined agent that replaced one with a link would
   * send those processes' writes outside.
   */
  readonly writableContents?: readonly string[];
  /**
   * Lock folders outside `writable` that the provider makes beside a file each time it reads that
   * file. The confined process can make, touch and remove each folder, but not write in it or put a
   * file or a link in its place. The file beside it stays read-only.
   */
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

/** Grok keeps its sign-in, sessions and caches in `GROK_HOME`, and its hooks and settings too. */
export function grokStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const grokHome = env.GROK_HOME?.trim() || join(home, ".grok");
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

/**
 * OpenCode keeps its sessions under the XDG data and state folders. Its settings folder is not in the
 * list, so it stays read-only. Its cache holds the npm packages and the language servers that every
 * OpenCode process runs, so a confined process gets a cache of its own: `OPENCODE_CONFINED_ENV`.
 */
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

/** OpenCode's data folder: its sessions, its database (`opencode.db`) and its `auth.json`. */
export function openCodeDataDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(env.XDG_DATA_HOME?.trim() || join(home, ".local/share"), "opencode");
}

/**
 * The Antigravity server keeps its sign-in, sessions and harness files in `antigravity-acp` under
 * the Gemini home, and hook scratch files in `artifacts`. The shared `config` folder, with the
 * global hooks, skills and MCP servers, is not in the list, so it stays read-only. `settings.json`
 * selects the sign-in and `trusted_workspaces.json` trusts folders for every other process.
 */
export function antigravityStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const geminiHome = env.GEMINI_HOME?.trim() || join(home, ".gemini");
  const acp = join(geminiHome, "antigravity-acp");
  return {
    writable: [acp, join(geminiHome, "artifacts")],
    protected: [join(acp, "settings.json"), join(acp, "trusted_workspaces.json")],
  };
}

/**
 * The Cursor CLI keeps its settings in its config folder, and its sessions, project data and, on
 * macOS, the sign-in file `auth.json` in `~/.cursor`, which the Cursor editor shares.
 * `cli-config.json` holds the command permissions and approval mode that the user's own CLI runs
 * with, and the CLI writes it when a session picks its model, so a confined process gets a config
 * folder of its own:
 * `cursorConfinedEnv`. The user's settings files, and the folders that hold extensions, plugins,
 * skills, agents, commands and rules, load code or settings in the editor and in every other CLI
 * process, so they stay read-only. So do the trust and MCP approval files of each project in
 * `projects`. The sessions stay in the shared data folder, so a thread continues when the agent
 * changes between Workspace only and Full access. On macOS the CLI reads its sign-in from the login
 * Keychain with `security`, which must write a lock file first: `keychainLockFiles`.
 */
export function cursorStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const xdgConfig = env.XDG_CONFIG_HOME?.trim();
  const userConfig = env.CURSOR_CONFIG_DIR?.trim() || (xdgConfig ? join(xdgConfig, "cursor") : join(home, ".cursor"));
  const dataHome = cursorDataHome(env, home);
  // `auth.json` and the `sandbox.json` and `hooks.json` files are always in `~/.cursor` on macOS.
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

/** The Cursor CLI's data folder, which holds its sessions and the project data in `projects`. */
export function cursorDataHome(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.CURSOR_DATA_DIR?.trim() || join(home, ".cursor");
}

const CURSOR_CONFINED_CACHE = join(tmpdir(), "openbot-confined-cursor-cache");

let keychainLockFile: string | undefined;

/**
 * `security` takes `mds/mds.lock` in the user's cache folder (`DARWIN_USER_CACHE_DIR`, not
 * `TMPDIR`) before it reads the login Keychain. When the sandbox denies that write, the read fails,
 * and Cursor 2026.10.22 answers each session with "Authentication required" although it is signed
 * in. Only the contents of the lock file are writable: the module directory beside it lists the
 * security modules that the user's other processes load. The confined process cannot create the
 * file, so OpenBot makes it when it is missing, as `security` would.
 */
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

/** The config folder of every confined Cursor process. Only confined processes read it. */
function cursorConfinedConfig(home: string): string {
  return join(home, ".cursor", "openbot-confined");
}

/**
 * The environment of a confined Cursor process: its own config folder and its own compile cache, as
 * the launcher keeps that cache outside the folders above.
 */
export function cursorConfinedEnv(home = homedir()): Readonly<Record<string, string>> {
  return { CURSOR_CONFIG_DIR: cursorConfinedConfig(home), NODE_COMPILE_CACHE: CURSOR_CONFINED_CACHE };
}

/**
 * The Cline CLI keeps its sign-in, sessions, caches and logs in its data folder, `~/.cline/data`.
 * Its agents, skills, plugins, hooks and schedules are outside that folder, in `~/.cline` and
 * `~/Documents/Cline`, so they stay read-only. In the data folder, the global settings, the MCP
 * servers, the connectors and the cron and task databases start commands or set approvals for every
 * other Cline process, so they stay read-only too. The sessions stay in the shared data folder, so a
 * thread continues when the agent changes between Workspace only and Full access.
 */
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

/**
 * The folder where Hermes Agent keeps its sign-ins, settings, sessions and memories: `HERMES_HOME`,
 * else `~/.hermes`, or `%LOCALAPPDATA%\hermes` on Windows. OpenBot shares it with the user's own Hermes.
 * When the user selected a profile with `hermes profile use <name>`, it is `<root>/profiles/<name>`.
 */
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

/** Hermes 0.21.5 reads `<root>/active_profile` at each start and then uses that profile's folder. */
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

/**
 * Hermes writes its sessions, memories, sign-in refreshes, caches and logs across its whole folder.
 * Its install, settings, `.env`, identity, skills, hooks, schedules, plugins, profiles and the tools
 * it downloads load code, commands or instructions for every other Hermes process, so they stay
 * read-only.
 */
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

/**
 * The Kimi Code CLI keeps its sign-in, sessions, logs and caches in `KIMI_SHARE_DIR`, `~/.kimi` by
 * default, and writes its plans in `~/.kimi/plans`. Its settings and hooks (`config.toml`), MCP
 * servers, plugins, skills and downloaded tools are in that folder too, and every other Kimi process
 * loads them, so they stay read-only.
 */
/** The state directory of the Python Kimi CLI: `$KIMI_SHARE_DIR`, or `~/.kimi`. */
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

/** The home folder of Mistral Vibe: `$VIBE_HOME`, or `~/.vibe`. */
export function mistralHomeDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.VIBE_HOME?.trim() || join(home, ".vibe");
}

/**
 * Mistral Vibe 3.1.0 writes its session logs, history, caches, locks and the folders that it trusts
 * in its home folder. Its settings and MCP servers (`config.toml`), the saved API key (`.env`), the
 * trusted folders, hooks, instructions, tools, skills, agents, prompts and plugins are in that folder
 * too, and every other Vibe process loads them, so they stay read-only. The admin settings cache is a
 * settings layer, so it stays read-only too. On macOS the CLI reads the API key of a sign-in from the
 * login Keychain with `security` (`keychainLockFiles`).
 */
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
      "connector_bootstrap_cache.json",
    ].map((name) => join(vibeHome, name)),
  };
}

/**
 * At each start, Mistral Vibe 3.1.0 writes an empty `trusted_folders.toml` when the file is missing.
 * When it cannot, it stops, and a confined process cannot write that file. Thus OpenBot makes the
 * file when it is missing, with the same contents.
 */
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

/** The folder of Devin's sign-in and sessions: `$XDG_DATA_HOME/devin`, on macOS too. */
export function devinDataDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return join(env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"), "devin");
}

/**
 * Devin CLI 3000.11.234 writes its sessions, session locks and logs in `devin/cli` of the XDG data
 * folder, its MCP sign-ins in `devin/mcp`, its caches in the XDG cache folder and its plans in
 * `~/.devin/plans`. Its settings and MCP servers in the XDG config folder, its sign-in and its
 * plugins load settings or code for every other Devin process, so they stay read-only.
 */
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

/**
 * A custom agent keeps its state where it wants, and OpenBot cannot know where. A Workspace only
 * custom agent gets no state folder: an agent that must write in its home folder to run needs Full
 * access.
 */
export function customAgentStatePaths(): ProviderStatePaths {
  return { writable: [], protected: [] };
}

/** The folder where Pi keeps its sign-in, settings and sessions. */
export function piAgentDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.PI_CODING_AGENT_DIR?.trim() || join(home, ".pi", "agent");
}

/**
 * Pi can write sessions, but cannot change the sign-in, settings or extensions a later full-access
 * run loads. Pi 1.4.0 takes a lock folder beside `auth.json`, `settings.json` and `trust.json` each
 * time it reads one, and a read stops with EPERM when it cannot make that folder. Pi also locks its
 * saved model catalog, `models-store.json`, to read it. Without that lock Pi lists the catalog of
 * its release, which does not have the models that OpenBot's refresh saved (#4926). The catalog
 * itself stays read-only.
 */
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

/** Only session data is writable. Muse settings, credentials, hooks, and plugins stay read-only. */
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

/** The home folder of the GitHub Copilot CLI: `$COPILOT_HOME`, or `~/.copilot`. */
export function copilotHomeDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.COPILOT_HOME?.trim() || join(home, ".copilot");
}

/**
 * GitHub Copilot CLI 1.0.105 writes its sessions, session database, command history and logs in its
 * home folder. Its settings, trusted folders, MCP servers, hooks, skills, agents, plugins and
 * instructions are in that folder too, and every other Copilot process loads them, so they stay
 * read-only. On macOS the CLI reads its sign-in from the login Keychain with `security`
 * (`keychainLockFiles`). The CLI runs JavaScript that it unpacks into a cache folder, so a confined
 * process gets a cache of its own: `COPILOT_CONFINED_ENV`.
 */
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

/**
 * At its first start, GitHub Copilot CLI 1.0.105 writes `firstLaunchAt` in `config.json`. When it
 * cannot, it stops with no message, and a confined process cannot write that file. Thus OpenBot makes
 * the file when it is missing, with the same value. The CLI keeps the other values in it.
 */
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

/**
 * The environment of a confined Copilot process: its own cache, apart from the one outside. Both
 * variables are set, because the package cache variable comes first when the user's own environment
 * sets it.
 */
export const COPILOT_CONFINED_ENV: Readonly<Record<string, string>> = {
  COPILOT_CACHE_HOME: COPILOT_CONFINED_CACHE,
  COPILOT_PKG_CACHE_HOME: join(COPILOT_CONFINED_CACHE, "pkg"),
};

/** The environment of a confined OpenCode process: its own cache, apart from the one outside. */
export const OPENCODE_CONFINED_ENV: Readonly<Record<string, string>> = { XDG_CACHE_HOME: OPENCODE_CONFINED_CACHE };

/**
 * The project settings of every provider, in each root, whatever the provider of this process. A
 * process that is not confined and starts in that folder later loads them and runs their hooks,
 * plugins and commands: a Full access session of any provider, or the provider's CLI in a terminal.
 * A Workspace only Claude session ignores `.claude/settings*.json`, and Codex keeps `.codex` read-only
 * in its own sandbox for the same reason. A whole folder is denied, because a folder renamed to
 * `.claude` would bring a settings file past a rule for the file alone.
 */
const PROJECT_SETTINGS = [
  ".claude",
  ".codex",
  ".grok",
  ".opencode",
  "opencode.json",
  "opencode.jsonc",
  // Cursor reads its project rules, MCP servers, hooks and skills from `.cursor`.
  ".cursor",
  // Cline reads its project rules, workflows, hooks, skills and agents from these two.
  ".cline",
  ".clinerules",
  // Kimi reads its project skills and instructions from `.kimi`.
  ".kimi",
  // Mistral Vibe reads its project settings, MCP servers, hooks, tools, skills, agents and prompts
  // from `.vibe`.
  ".vibe",
  // Devin reads its project settings, MCP servers, hooks and skills from `.devin`, and Windsurf
  // rules and hooks from `.windsurf`.
  ".devin",
  ".windsurf",
  ".pi",
  ".muse",
  // Antigravity reads project skills from `.gemini` and its customizations from these four.
  ".gemini",
  ".agents",
  ".agent",
  "_agents",
  "_agent",
  // GitHub Copilot reads MCP servers from `.mcp.json` and `.github/mcp.json`, and its project
  // settings, hooks, skills and agents from `.github`. The rest of `.github`, such as the workflows,
  // stays writable, so `.github` itself cannot be removed, renamed or made (`seatbeltProfile`).
  ".mcp.json",
  ".github/mcp.json",
  ".github/copilot",
  ".github/hooks",
  ".github/skills",
  ".github/agents",
];

/**
 * The command that starts `target` inside the sandbox. It throws when this computer cannot make the
 * sandbox, because a Workspace only agent must not run with full access.
 */
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
  // A protected path in a writable folder must not move out of its rule with that folder.
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
  // bubblewrap on Linux cannot deny a protected file that does not exist yet, such as a new
  // `opencode.json`, so Linux fails closed until it can.
  throw new ProcessConfinementUnavailableError(sourceText("error.agent.workspaceOnlyMacOnly"));
}

/** Whether `confineSpawnTarget` can make a sandbox on this platform. Only macOS has one now. */
export function canConfineProcesses(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin";
}

function unavailable(tool: string): string {
  return sourceText("error.agent.workspaceOnlyToolMissing", { tool });
}

/**
 * Writes are denied, then allowed in the writable folders, then denied again in the protected paths:
 * in a Seatbelt profile the last rule that matches wins. `file-write-data` allows writes in an
 * existing file, not its removal, a rename or a link in its place. A lock folder allows every write
 * on the folder itself, but a create there only of a folder. A folder that holds an excluded folder
 * or a protected project path cannot be removed or renamed, because that path would move with it
 * out of its rule. When that folder does not exist, it cannot be made: a folder renamed or linked
 * into its place would bring a protected path with no write on that path, such as `.github/mcp.json`.
 * Everything else stays open, as the Access setting says: reads, the network and process starts.
 */
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
  // `utimes`, which refreshes a lock, has no file-write operation of its own, so the folder gets
  // `file-write*`.
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

/** `root` and each folder below it that holds `folder`, or none when `folder` is not inside `root`. */
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

/**
 * The path as written and as the kernel sees it. Seatbelt matches the real path, so `/tmp` must also
 * be given as `/private/tmp`, and a folder that does not exist yet is resolved through its parent.
 */
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
