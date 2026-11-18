import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { getArray, getString, isRecord } from "../protocol";
import { COMMAND_SEPARATOR, shownFileCommands } from "./skill-loads";

/** A path that a shell expands to many files. It names no one file. */
const GLOB = /[*?[]/u;
/** A command that reads a file on another computer or in a container, not on this one. */
const REMOTE_COMMAND = /(?:^|[\s;&|('"])(?:ssh|docker|podman|kubectl)\s/u;
/** The characters that a backslash escapes in a double-quoted shell word. */
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);
/** A shell command that works in a folder, lists one or searches one. Its absolute operands name the folders. */
const FOLDER_COMMANDS = new Set([
  "cd",
  "pushd",
  "ls",
  "dir",
  "find",
  "fd",
  "tree",
  "grep",
  "rg",
  "Set-Location",
  "Get-ChildItem",
]);
/** A thread keeps this many files and this many folders. A folder costs a lookup on each link that misses. */
const FILE_LIMIT = 200;
const FOLDER_LIMIT = 50;

/**
 * The files that a finished shell step showed, such as `tail -n 50 ~/Library/…/main.log`, so a chip that
 * names only `main.log` finds a file that the agent read with a shell command. Codex parses its own
 * command into `commandActions`; a Claude `Bash` command is split here. Only absolute and home paths
 * count. A step that failed or did not run read nothing.
 */
export function shellReadPaths(item: unknown): string[] {
  if (!isRecord(item) || getString(item, "status") !== "completed") return [];
  if (item.type === "commandExecution") return actionPaths(item, ["read"]);
  if (item.type !== "toolCall" || getString(item, "name") !== "Bash") return [];
  // A remote command can hold several commands in quotes, so the whole line is checked before the split.
  const line = getString(item, "command") ?? "";
  if (REMOTE_COMMAND.test(line)) return [];
  return localPaths(shownFileCommands(line).flatMap(shellWords));
}

/**
 * The folders where a finished step worked, such as `/tmp/kskills` after `ls /tmp/kskills`, so a chip
 * that names `build-app.md` from that list finds the file. A Codex command gives its working folder and
 * the folders that it listed or searched; a Claude `Bash` command is split here. Only absolute and
 * home paths count.
 */
export function shellWorkFolders(item: unknown): string[] {
  if (!isRecord(item) || getString(item, "status") !== "completed") return [];
  if (item.type === "commandExecution") {
    const cwd = getString(item, "cwd");
    return [...(cwd ? [cwd] : []), ...actionPaths(item, ["listFiles", "search"])].filter((path) => isAbsolute(path));
  }
  if (item.type !== "toolCall" || getString(item, "name") !== "Bash") return [];
  const line = getString(item, "command") ?? "";
  if (REMOTE_COMMAND.test(line)) return [];
  return localPaths(
    line.split(COMMAND_SEPARATOR).flatMap((command) => {
      const [name = "", ...operands] = shellWords(command.trim());
      return FOLDER_COMMANDS.has(name) ? operands.filter((operand) => !operand.startsWith("-")) : [];
    }),
  );
}

/** The paths of the Codex command actions of these types. A relative path starts at the command's folder. */
function actionPaths(item: unknown, types: readonly string[]): string[] {
  const cwd = getString(item, "cwd");
  return getArray(item, "commandActions").flatMap((action) => {
    const path =
      isRecord(action) && typeof action.type === "string" && types.includes(action.type)
        ? getString(action, "path")
        : null;
    if (!path) return [];
    const expanded = expandHome(path);
    return [isAbsolute(expanded) || !cwd ? expanded : join(cwd, expanded)];
  });
}

/** The shell words that name one absolute or home path. A glob names no one file. */
function localPaths(words: readonly string[]): string[] {
  return words.map(expandHome).filter((path) => isAbsolute(path) && !GLOB.test(path));
}

function expandHome(path: string): string {
  return path.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/)/u, homedir());
}

/** The words of one shell command, with quotes and backslash escapes removed. */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;
  let started = false;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] ?? "";
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && DOUBLE_QUOTE_ESCAPES.has(command[index + 1] ?? ""))
        word += command[++index];
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === "\\" && index + 1 < command.length) {
      word += command[++index];
      started = true;
    } else if (/\s/u.test(char)) {
      if (started || word) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
    }
  }
  if (started || word) words.push(word);
  return words;
}

/** Owns local, in-memory tool paths. These paths never enter conversation events or storage. */
export class ThreadFileHistory {
  readonly #threads = new Map<string, { agentId: string; paths: string[]; folders: string[] }>();

  record(agentId: string, threadId: string, paths: unknown, folders: unknown = []): void {
    const history = this.#threads.get(threadId) ?? { agentId, paths: [], folders: [] };
    const recordedPaths = append(history.paths, paths, FILE_LIMIT);
    const recordedFolders = append(history.folders, folders, FOLDER_LIMIT);
    if (!recordedPaths && !recordedFolders) return;
    // The thread that recorded last goes to the end, so the threads stay in the order of their work.
    this.#threads.delete(threadId);
    this.#threads.set(threadId, history);
  }

  /**
   * The paths of all threads of the agent, oldest first. A chip does not name its thread, and a channel
   * runs the agent in a thread of its own. The paths of `threadId` come last, so its files win.
   */
  paths(agentId: string, threadId: string | null): readonly string[] {
    return this.#entries(agentId, threadId, "paths");
  }

  /** The folders where the agent worked, in the same order as {@link paths}. */
  folders(agentId: string, threadId: string | null): readonly string[] {
    return this.#entries(agentId, threadId, "folders");
  }

  #entries(agentId: string, threadId: string | null, kind: "paths" | "folders"): readonly string[] {
    const preferred = threadId ? this.#threads.get(threadId) : undefined;
    const others = [...this.#threads]
      .filter(([id, history]) => id !== threadId && history.agentId === agentId)
      .flatMap(([, history]) => history[kind]);
    return preferred?.agentId === agentId ? [...others, ...preferred[kind]] : others;
  }

  /** A deleted thread, such as a deleted channel, gives no file to a link in another thread. */
  forgetThread(threadId: string): void {
    this.#threads.delete(threadId);
  }

  forgetAgent(agentId: string): void {
    for (const [threadId, history] of this.#threads) {
      if (history.agentId === agentId) this.#threads.delete(threadId);
    }
  }

  clear(): void {
    this.#threads.clear();
  }
}

/** Adds the absolute paths to the end of `list`, newest last and without repeats. */
function append(list: string[], paths: unknown, limit: number): boolean {
  if (!Array.isArray(paths)) return false;
  let recorded = false;
  for (const path of paths) {
    if (typeof path !== "string" || !isAbsolute(path)) continue;
    const previous = list.indexOf(path);
    if (previous !== -1) list.splice(previous, 1);
    list.push(path);
    if (list.length > limit) list.shift();
    recorded = true;
  }
  return recorded;
}
