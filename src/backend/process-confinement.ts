import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { workspaceTemporaryPaths } from "./agent/workspace-sandbox";
import { isPathInside } from "./path-containment";

/**
 * The folders one Workspace only agent may write: its workspace and the shared folder. The temporary
 * folders and the provider's state are added to them.
 *
 * Grok, OpenCode, Antigravity, Cursor and Cline take no sandbox per session, so a Workspace only
 * agent on them gets a provider process of its own, and OpenBot starts that process inside an
 * operating system sandbox. The whole process is confined: the file edit tools, the shell, and every
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
  const dataHome = env.CURSOR_DATA_DIR?.trim() || join(home, ".cursor");
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
 * time it reads one, and a read stops with EPERM when it cannot make that folder.
 */
export function piStatePaths(env: NodeJS.ProcessEnv = process.env, home = homedir()): ProviderStatePaths {
  const agentDirectory = piAgentDirectory(env, home);
  return {
    writable: [join(agentDirectory, "sessions")],
    protected: [],
    lockFolders: ["auth.json", "settings.json", "trust.json"].map((name) => join(agentDirectory, `${name}.lock`)),
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
  ".pi",
  ".muse",
  // Antigravity reads project skills from `.gemini` and its customizations from these four.
  ".gemini",
  ".agents",
  ".agent",
  "_agents",
  "_agent",
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
  if (platform === "darwin") {
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
          excluded,
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

function unavailable(tool: string): string {
  return sourceText("error.agent.workspaceOnlyToolMissing", { tool });
}

/**
 * Writes are denied, then allowed in the writable folders, then denied again in the protected paths:
 * in a Seatbelt profile the last rule that matches wins. `file-write-data` allows writes in an
 * existing file, not its removal, a rename or a link in its place. A lock folder allows every write
 * on the folder itself, but a create there only of a folder. A folder that holds an excluded folder
 * cannot be removed or renamed, because the excluded folder would move with it out of its rule.
 * Everything else stays open, as the Access setting says: reads, the network and process starts.
 */
function seatbeltProfile(
  writable: readonly string[],
  protectedPaths: readonly string[],
  inProjects: ProviderStatePaths["protectedInProjects"],
  contents: readonly string[],
  lockFolders: readonly string[],
  excluded: readonly string[],
): string {
  const writableReal = unique(writable.flatMap(realPaths));
  const allowed = writableReal.map((path) => `(subpath ${sbplString(path)})`);
  const holders = unique(
    excluded.flatMap(realPaths).flatMap((folder) => writableReal.flatMap((root) => holderFolders(root, folder))),
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
    ...(holders.length > 0 ? [`(deny file-write-unlink ${holders.join(" ")})`] : []),
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
