import { win32 } from "node:path";
import type { RequestError } from "@agentclientprotocol/sdk";
import { enableCursorMcpServers } from "./cursor-mcp-disabled";
import { isRecord } from "./protocol";

/**
 * What one ACP agent does differently from the protocol. `AcpAgentClient` reads each hook at the
 * place that the agent's behavior changes; an absent hook is the protocol's own behavior. Add a hook
 * only for an observed agent version, and name that version where the hook is set.
 */
export interface AcpFlavor {
  /** The `clientInfo` that `initialize` sends. Absent: `OPENBOT_ACP_CLIENT_INFO`. */
  clientInfo?: { name: string; title: string; version: string };
  /**
   * Whether an error names this missing session. `null` gives the decision to the protocol's
   * `-32002` rule. Another error code or another session must never replace a provider session.
   */
  sessionNotFound?(error: RequestError, sessionId: string): boolean | null;
  /**
   * The message of a failed turn, from the redacted failure text. `redact` masks more text, `log`
   * writes a diagnostic that it redacts first, and `model` is the session's model.
   */
  turnFailure?(
    error: unknown,
    detail: string,
    redact: (text: string) => string,
    log: (text: string) => void,
    model: string | null,
  ): string;
  /** The message of a turn that ended with no answer text. Absent: such a turn succeeds. */
  emptyAnswerFailure?(reasoned: boolean): string;
  /**
   * What to do when `session/load` or `session/resume` fails: wait once for a process that still
   * starts, or list the sessions to find out whether this one exists. `null` reports the failure.
   */
  restoreFailure?(error: unknown, method: "load" | "resume"): "wait-for-start" | "list-sessions" | null;
  /** A failed model refresh keeps the last list that the agent gave. */
  keepModelsOnRefreshFailure?: true;
  /**
   * The model belongs to the agent's process, not to one session: a model set moves every session
   * to it. A set of the model the process already runs on is not sent again.
   */
  processWideModel?: true;
  /**
   * The agent frees what a session holds only when its process ends, not at `session/close`. Model
   * discovery then resumes one probe session for each process rather than opening another.
   */
  closeKeepsSession?: true;
  /**
   * Each session gets a process of its own, and an idle session is closed by ending that process.
   * For an agent with `closeKeepsSession`.
   */
  sessionProcesses?: true;
  /** An agent that sends a failed prompt as answer text and ends the turn as a success. */
  sdkHarness?: {
    /** The session whose prompt failed, from a stderr line. */
    failedSession(stderrLine: string): string | undefined;
    /** The start of an answer that is the failure text, when no stderr line came. */
    answerIsFailure: RegExp;
    /** The message of a turn that failed in this way, from the failure text. */
    turnFailure(text: string): string;
    /** The message of an answer chunk that reports an exhausted quota, or `null`. */
    quota(text: string): string | null;
    /** The MCP server whose failed start ended the turn, from the failure text, or `null`. */
    mcpLoadFailure(text: string): { name: string; reason: string } | null;
  };
  /** A stop finishes the turn locally, and the next prompt opens the session again first. */
  cancelLocallyThenResume?: true;
  /** A turn that does not complete marks its open tool calls as stopped. */
  interruptToolsOnStop?: true;
  /** Answer text is shown at once, not only when `session/prompt` answers. */
  streamAnswerBeforePromptReturns?: true;
  /**
   * A model can stream its reasoning between the tokens of one answer, so a thought does not end
   * the answer text. A tool call or the end of the turn still does.
   */
  thoughtsInsideAnswer?: true;
  /**
   * `session/prompt` stays open with no update while background tasks run, so a silent turn is not
   * stalled and OpenBot does not end it (`ACP_TURN_STALL_MS`).
   */
  promptOpenForBackgroundTasks?: true;
  /**
   * The agent answers a finished background task in a turn of its own and sends no session update
   * for it. Only its `session/load` replays that turn. A tool call that leaves a task running ends
   * with `rawOutput.metadata.status` "running" and the task's `sessionID`.
   */
  unsentBackgroundTurns?: true;
  /** Each answer message has its own `messageId`, so text of a new ID is a new message, not more text. */
  messagePerId?: true;
  /**
   * The agent keeps one MCP server of each name for a directory, and a session that opens there
   * replaces the server that the others in it use. Their OpenBot servers then share one token.
   */
  mcpServersPerDirectory?: true;
  /**
   * The agent connects to each MCP server of a session before it answers `session/new` or
   * `session/load`, and leaves out a server that did not load with no error. A session that OpenBot's
   * servers did not reach then fails, as the agent cannot use OpenBot's tools.
   */
  mcpServersLoadWithSession?: true;
  /** Turns OpenBot's servers back on where the agent's own settings for `cwd` turned them off. */
  enableMcpServers?(cwd: string, names: readonly string[]): void;
  /** OpenBot compacts by replacing the session, for an agent that reports `usage_update` and has no compact request. */
  contextCompaction?: "handoff";
  /** A whole answer chunk that is the agent's own transport error, not answer text. OpenBot drops it. */
  noiseChunk?: RegExp;
}

/** The protocol's own behavior: Grok and Cline. */
export const DEFAULT_ACP_FLAVOR: AcpFlavor = {};

/**
 * Cursor puts the missing session in `data.message` and reports only "Invalid params" in `message`.
 * Other invalid parameters must not cause a provider session to be replaced.
 */
export const CURSOR_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error, sessionId) =>
    error.code === -32602 ? isRecord(error.data) && error.data.message === `Session "${sessionId}" not found` : null,
  // Cursor 2026.10.22-27dcf5f sends "\n\nError: RetriableError: WritableIterable is closed" as one
  // chunk after a turn that succeeded, and then ends the turn (#3334). Only the full chunk matches.
  noiseChunk: /^\s*Error: (?:[\w$]+: )?WritableIterable is closed\s*$/u,
  // Cursor 2026.10.22-27dcf5f asks its server for the model list on each model set, and reports a
  // failed request as "Invalid model value" (#3800). One set per change, not one per turn.
  processWideModel: true,
  // Cursor 2026.10.22-27dcf5f leaves out a disabled or blocked server, and the agent turn then
  // finds no OpenBot tools (#3058).
  mcpServersLoadWithSession: true,
  enableMcpServers: enableCursorMcpServers,
};

/**
 * omp 18.8.4 wraps its exact missing-ID error in an internal error (#1690). Other internal failures,
 * including an error for another session, are not lifecycle signals.
 */
function ompSessionNotFound(error: RequestError, sessionId: string): boolean | null {
  return error.code === -32603
    ? isRecord(error.data) && error.data.details === `Unsupported ACP session: ${sessionId}`
    : null;
}

/** Oh My Pi (`omp acp`). Its rules are here when they do not apply to every custom agent. */
const OMP_ACP_FLAVOR: AcpFlavor = { sessionNotFound: ompSessionNotFound };

/**
 * A custom agent without a flavor of its own. It keeps omp's rule: the rule needs the exact session
 * ID, and an agent can reuse omp's error text.
 */
const CUSTOM_ACP_FLAVOR: AcpFlavor = { sessionNotFound: ompSessionNotFound };

const CUSTOM_AGENT_FLAVORS: Readonly<Partial<Record<string, AcpFlavor>>> = { omp: OMP_ACP_FLAVOR };

/**
 * The flavor of a custom agent, from the exact name of its command: `omp`, `/usr/local/bin/omp`
 * and `C:\bin\omp.exe` are Oh My Pi, `omp-dev` is not. A name in the middle of another name never
 * selects a flavor, because a wrong flavor can replace a session.
 */
export function customAgentFlavor(command: string): AcpFlavor {
  const name = win32
    .basename(command)
    .toLowerCase()
    .replace(/\.(?:exe|cmd|bat)$/u, "");
  return CUSTOM_AGENT_FLAVORS[name] ?? CUSTOM_ACP_FLAVOR;
}

const FAILURE_DETAIL_LIMIT = 200;

/** The provider's text after a failure kind. The renderer shows its generic sentence for text over 400 characters. */
export function shownFailureDetail(text: string): string {
  const characters = Array.from(text);
  return characters.length > FAILURE_DETAIL_LIMIT
    ? `${characters.slice(0, FAILURE_DETAIL_LIMIT - 1).join("")}…`
    : characters.join("");
}
