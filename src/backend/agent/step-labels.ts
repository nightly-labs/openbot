import { homedir } from "node:os";
import { basename } from "node:path";
import { isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { bridgedToolName, getArray, getRecord, getString, isRecord, type ThreadItem } from "../protocol";

const QUOTE_LIMIT = 48;
const SHELL_WRAPPER = /^(?:\S*\/)?(?:ba|z|da)?sh\s+-l?c\s+['"]?/u;
const PREFIX_WORDS = new Set(["sudo", "time", "nice", "command", "exec", "env", "nohup", "timeout", "&"]);
const READ_PROGRAMS = new Set(["cat", "head", "tail", "less", "more", "bat", "sed", "awk", "jq", "wc", "file", "stat"]);
const LIST_PROGRAMS = new Set(["ls", "find", "fd", "tree", "mdfind", "locate"]);
const SEARCH_PROGRAMS = new Set(["rg", "grep", "ag", "ack", "git-grep"]);
const PROCESS_PROGRAMS = new Set(["ps", "top", "htop", "lsof", "pgrep", "vm_stat", "iostat", "uptime", "pmset"]);

export function stepLabel(item: ThreadItem): string | null {
  const actions = codexActionLabel(item);
  if (actions) return actions;
  const type = item.type.toLowerCase();
  const name = (getString(item, "name") ?? "").toLowerCase();
  const query = getString(item, "query") ?? getString(item, "pattern");
  if (query && (type === "websearch" || name === "websearch"))
    return sourceText("status.agent.webSearching", { query: quote(query) });
  const searched = webSearchQuery(item);
  if (searched) return sourceText("status.agent.webSearching", { query: quote(searched) });
  const url = getString(item, "url");
  const host = url ? urlHost(url) : null;
  if (host) return sourceText("status.agent.urlFetching", { host });
  const path = getString(item, "path");
  if (path && name === "read") return sourceText("status.agent.fileReading", { name: fileName(path) });
  if (query && (name === "grep" || name === "glob"))
    return sourceText("status.agent.textSearching", { query: quote(query) });
  const command = shellCommand(item);
  return command ? commandLabel(command) : null;
}

function webSearchQuery(item: ThreadItem): string | null {
  if (bridgedToolName(item) !== "openbot.web_search") return null;
  return getString(getRecord(getRecord(item, "arguments"), "arguments"), "query");
}

function codexActionLabel(item: ThreadItem): string | null {
  if (item.type !== "commandExecution") return null;
  const action = getArray(item, "commandActions").find(isRecord);
  if (!action) return null;
  const path = getString(action, "path");
  switch (action.type) {
    case "read": {
      const name = getString(action, "name") ?? path;
      return name ? sourceText("status.agent.fileReading", { name: fileName(name) }) : null;
    }
    case "listFiles":
      return path
        ? sourceText("status.agent.filesListing", { path: shownPath(path) })
        : sourceText("status.agent.filesLooking");
    case "search": {
      const query = getString(action, "query");
      return query ? sourceText("status.agent.textSearching", { query: quote(query) }) : null;
    }
    default:
      return null;
  }
}

function shellCommand(item: ThreadItem): string | null {
  const command = getString(item, "command");
  if (command) return command;
  if (getString(item, "toolKind") !== "execute") return null;
  const input = getRecord(item, "arguments");
  const value = input?.command ?? input?.cmd;
  if (isString(value)) return value;
  return Array.isArray(value) && value.every(isString) ? value.join(" ") : null;
}

function commandLabel(line: string): string | null {
  const command = line.trim().replace(SHELL_WRAPPER, "");
  for (const part of command.split(/&&|\|\||;|\n/u)) {
    const words = (part.split("|")[0] ?? "").match(/(?:'[^']*'|"[^"]*"|\S)+/gu) ?? [];
    while (words.length > 0 && (PREFIX_WORDS.has(words[0] ?? "") || /^[A-Z_][A-Z0-9_]*=/u.test(words[0] ?? "")))
      words.shift();
    const program = basename((words[0] ?? "").replace(/['"]/gu, ""));
    if (!program || program === "cd" || program === "export" || program === "set" || program === "source") continue;
    return programLabel(program, words.slice(1));
  }
  return null;
}

function programLabel(program: string, args: string[]): string {
  if (program === "du") return sourceText("status.agent.folderSizesMeasuring");
  if (program === "df") return sourceText("status.agent.diskSpaceChecking");
  if (PROCESS_PROGRAMS.has(program)) return sourceText("status.agent.processesChecking");
  if (SEARCH_PROGRAMS.has(program)) return sourceText("status.agent.filesSearchingText");
  if (LIST_PROGRAMS.has(program)) {
    const path = args.find((arg) => !arg.startsWith("-"));
    return path && program !== "find"
      ? sourceText("status.agent.filesListing", { path: shownPath(path) })
      : sourceText("status.agent.filesLooking");
  }
  if (READ_PROGRAMS.has(program)) {
    const path = args.filter((arg) => !arg.startsWith("-") && /[./]/u.test(arg)).at(-1);
    return path
      ? sourceText("status.agent.fileReading", { name: fileName(path) })
      : sourceText("status.agent.filesReading");
  }
  if (program === "git") {
    const sub = args.find((arg) => !arg.startsWith("-"));
    return sub && ["status", "log", "diff", "show", "blame", "branch"].includes(sub)
      ? sourceText("status.agent.gitChecking")
      : sourceText("status.agent.commandRunning", { program: "git" });
  }
  if (program === "curl" || program === "wget") {
    const host = args.map(urlHost).find(isString);
    return host
      ? sourceText("status.agent.urlFetching", { host })
      : sourceText("status.agent.commandRunning", { program });
  }
  return sourceText("status.agent.commandRunning", { program: quote(program) });
}

function urlHost(value: string): string | null {
  try {
    const url = new URL(value.replace(/^['"]|['"]$/gu, ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}

function fileName(path: string): string {
  return quote(basename(path.replace(/^['"]|['"]$/gu, "")) || path);
}

function shownPath(path: string): string {
  const home = homedir();
  const clean = path.replace(/^['"]|['"]$/gu, "");
  return quote(clean === home ? "~" : clean.startsWith(`${home}/`) ? `~${clean.slice(home.length)}` : clean);
}

function quote(value: string): string {
  const redacted = redactText(value.trim());
  return redacted.length > QUOTE_LIMIT ? `${redacted.slice(0, QUOTE_LIMIT - 1)}…` : redacted;
}
