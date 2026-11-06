import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { getArray, getString, isRecord } from "../protocol";
import { shownFileCommands } from "./skill-loads";

/** A path that a shell expands to many files. It names no one file. */
const GLOB = /[*?[]/u;
/** A command that reads a file on another computer or in a container, not on this one. */
const REMOTE_COMMAND = /(?:^|[\s;&|('"])(?:ssh|docker|podman|kubectl)\s/u;
/** The characters that a backslash escapes in a double-quoted shell word. */
const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);

/**
 * The files that a finished shell step showed, such as `tail -n 50 ~/Library/…/main.log`, so a chip that
 * names only `main.log` finds a file that the agent read with a shell command. Codex parses its own
 * command into `commandActions`; a Claude `Bash` command is split here. Only absolute and home paths
 * count. A step that failed or did not run read nothing.
 */
export function shellReadPaths(item: unknown): string[] {
  if (!isRecord(item) || getString(item, "status") !== "completed") return [];
  if (item.type === "commandExecution") {
    const cwd = getString(item, "cwd");
    return getArray(item, "commandActions").flatMap((action) => {
      const path = isRecord(action) && action.type === "read" ? getString(action, "path") : null;
      if (!path) return [];
      const expanded = expandHome(path);
      return [isAbsolute(expanded) || !cwd ? expanded : join(cwd, expanded)];
    });
  }
  if (item.type !== "toolCall" || getString(item, "name") !== "Bash") return [];
  // A remote command can hold several commands in quotes, so the whole line is checked before the split.
  const line = getString(item, "command") ?? "";
  if (REMOTE_COMMAND.test(line)) return [];
  return shownFileCommands(line)
    .flatMap(shellWords)
    .map(expandHome)
    .filter((path) => isAbsolute(path) && !GLOB.test(path));
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
  readonly #threads = new Map<string, { agentId: string; paths: string[] }>();

  record(agentId: string, threadId: string, paths: unknown): void {
    if (!Array.isArray(paths)) return;
    const history = this.#threads.get(threadId) ?? { agentId, paths: [] };
    for (const path of paths) {
      if (typeof path !== "string" || !isAbsolute(path)) continue;
      const previous = history.paths.indexOf(path);
      if (previous !== -1) history.paths.splice(previous, 1);
      history.paths.push(path);
      if (history.paths.length > 200) history.paths.shift();
    }
    if (history.paths.length > 0) this.#threads.set(threadId, history);
  }

  paths(agentId: string, threadId: string | null): readonly string[] {
    const history = threadId ? this.#threads.get(threadId) : undefined;
    return history?.agentId === agentId ? history.paths : [];
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
