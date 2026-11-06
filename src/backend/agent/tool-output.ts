import { COMPUTER_USE_MCP_SERVER_NAME } from "@openbot/contracts/ipc";
import { isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { getArray, getRecord, getString, isRecord, type ThreadItem } from "../protocol";

/** The most output one live progress line shows. The tail is what a reader needs during a long command. */
const LIVE_OUTPUT_LIMIT = 120;

/** Running command steps kept for the once-a-second check. */
const LIVE_COMMAND_STEPS = 64;

/** ANSI CSI and OSC sequences, which a terminal uses for color and a progress line. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are the input that this rule must match.
const ANSI_ESCAPE = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/gu;

/**
 * Whether this tool item runs a shell command. The descriptor is the same one that the activity
 * line already groups by, so a browser, computer-use, memory or file tool never matches.
 */
export function isCommandTool(item: ThreadItem): boolean {
  const descriptor = [
    item.type,
    getString(item, "name"),
    getString(item, "title"),
    getString(item, "tool"),
    getString(item, "toolKind"),
  ]
    .filter(isString)
    .join(" ")
    .toLowerCase();
  if (getString(item, "server") === COMPUTER_USE_MCP_SERVER_NAME || descriptor.includes(COMPUTER_USE_MCP_SERVER_NAME))
    return false;
  if (item.type.toLowerCase().includes("commandexecution") || item.type.toLowerCase().includes("usershell"))
    return true;
  return /(^|[\s:._/-])(bash|shell|sh|zsh|fish|cmd|powershell|pwsh|terminal|command|execute|exec|run_command|run_terminal_cmd)(?=$|[\s:._/-])/u.test(
    descriptor,
  );
}

function nonEmpty(value: string | null): string | null {
  return value !== null && value.trim() !== "" ? value : null;
}

function contentText(content: unknown): string | null {
  const parts = getArray({ content }, "content").flatMap((part) => {
    const text = isRecord(part) ? nonEmpty(getString(part, "text")) : null;
    return text === null ? [] : [text];
  });
  return parts.length === 0 ? null : parts.join("\n");
}

function resultText(result: unknown): string | null {
  if (isString(result)) return result;
  if (!isRecord(result)) return null;
  const direct = [
    nonEmpty(getString(result, "aggregatedOutput")),
    nonEmpty(getString(result, "output")),
    nonEmpty(getString(result, "text")),
    nonEmpty(getString(result, "result")),
    nonEmpty(getString(result, "stdout")),
    nonEmpty(getString(result, "stderr")),
  ].find((value) => value !== null);
  if (direct) return direct;
  const metadata = getRecord(result, "metadata");
  return metadata
    ? ([
        nonEmpty(getString(metadata, "aggregatedOutput")),
        nonEmpty(getString(metadata, "output")),
        nonEmpty(getString(metadata, "stdout")),
      ].find((value) => value !== null) ?? null)
    : null;
}

/** The output text that a provider put on a tool item, from the fields that providers use. */
function toolOutput(item: ThreadItem): string | null {
  return (
    nonEmpty(getString(item, "aggregatedOutput")) ??
    resultText(item.result) ??
    nonEmpty(getString(item, "output")) ??
    contentText(item.content) ??
    null
  );
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * The last meaningful line of a command's output. A carriage-return progress line keeps its last
 * segment (curl and wget redraw the same line with `\r`), and a multi-line result keeps its tail.
 * The value is redacted before it is cut, so a cut cannot leave a part of a secret.
 */
export function toolOutputTail(item: ThreadItem): string | null {
  const output = toolOutput(item);
  if (output === null) return null;
  const text = output.replace(ANSI_ESCAPE, "").replace(/\r\n/gu, "\n");
  const progress = text.split("\r").findLast((part) => part.trim() !== "") ?? "";
  const lines = progress
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter((line) => line !== "");
  const tail = lines.at(-1);
  if (!tail) return null;
  return clip(redactText(tail), LIVE_OUTPUT_LIMIT);
}

/** The exit code that a provider gave for a command, from the item or its result metadata. */
export function toolExitCode(item: ThreadItem): number | null {
  if (isNumber(item.exitCode)) return item.exitCode;
  for (const value of [item.result, getRecord(item, "metadata"), getRecord(item.result, "metadata")]) {
    if (!isRecord(value)) continue;
    for (const key of ["exitCode", "exit"]) {
      const code = value[key];
      if (isNumber(code)) return code;
    }
  }
  return null;
}

/**
 * The line that the activity indicator shows for a command tool. While the command runs, it is the
 * output tail. When the provider reports an exit code, the completed line names it; a non-zero code
 * keeps the existing failure text. Without an exit code, null lets the existing generic text show.
 *
 * This text is transient: turn progress sends it to clients and nothing writes it to the trace.
 */
export function toolCommandProgress(item: ThreadItem, completed: boolean): string | null {
  if (!isCommandTool(item)) return null;
  if (!completed) return toolOutputTail(item);
  const exitCode = toolExitCode(item);
  if (exitCode === null) return null;
  const failed = item.status === "failed" || item.status === "declined" || exitCode !== 0;
  return failed
    ? sourceText("status.agent.toolStepFailedWithExit", { code: exitCode })
    : sourceText("status.agent.commandFinished", { code: exitCode });
}

/**
 * Decides which live command lines reach the renderer. The first line of a step shows at once,
 * later lines at most once a second, and the completed line always shows. A provider that sends
 * many output chunks then cannot make the renderer render every chunk.
 */
export class CommandProgressThrottle {
  readonly #lines = new Map<string, { text: string; at: number }>();

  clear(): void {
    this.#lines.clear();
  }

  next(key: string, text: string, completed: boolean, now = Date.now()): string | null {
    if (completed) {
      this.#lines.delete(key);
      return text;
    }
    const previous = this.#lines.get(key);
    if (previous?.text === text) return null;
    if (previous !== undefined && now - previous.at < 1_000) return null;
    this.#lines.delete(key);
    this.#lines.set(key, { text, at: now });
    for (const oldest of this.#lines.keys()) {
      if (this.#lines.size <= LIVE_COMMAND_STEPS) break;
      this.#lines.delete(oldest);
    }
    return text;
  }
}
