import { RequestError } from "@agentclientprotocol/sdk";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  type AgentStepActivity,
  agentProviderName,
  COMPUTER_USE_MCP_SERVER_NAME,
  CONVERSATION_TRACE_TEXT_LIMIT,
  DEFAULT_PROVIDER_ACCOUNT_ID,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import {
  type AgentProvider,
  MissingClaudeSessionError,
  MissingPiSessionError,
  RequestTimeoutError,
} from "../agent-client";
import { AppServerError } from "../app-server-client";
import { OPENBOT_BROWSER_NAMESPACE } from "../browser-tools";
import {
  bridgedToolName,
  type DynamicToolCallParams,
  getArray,
  getRecord,
  getString,
  isRecord,
  reasoningText,
  type ThreadItem,
} from "../protocol";
import { isImageCountDiagnostic, isImageTooLargeDiagnostic, isImageTooSmallDiagnostic } from "./provider-diagnostics";
import { stepLabel } from "./step-labels";
import { BUILTIN_TOOL_CATALOG } from "./tool-catalog";

export function isNonActionableCodexWarning(message: string): boolean {
  return (
    message.startsWith("Skill descriptions were shortened to fit") ||
    // Codex sends this when it changes transport, and the same turn continues over HTTPS
    // (`codex-rs/core/src/responses_retry.rs`). A final failure comes as an `error` (#2559).
    message.startsWith("Falling back from WebSockets to HTTPS transport.") ||
    // Codex sends this on each thread start when the user turned on a feature such as
    // `async_compaction` in `config.toml` (`codex-rs/features/src/lib.rs`). The turn continues, and
    // the text has the config path, so the banner replaced it with "could not continue".
    message.startsWith("Under-development features enabled:") ||
    // Codex sends this on each session start when its config asks for a tier, such as `priority`,
    // that the model does not list (`codex-rs/core/src/session/mod.rs`). Codex leaves the tier out
    // and the turn continues at the standard speed, so the banner showed a false error (#6827).
    message.startsWith("Configured service tier ") ||
    // Codex sends this once at start when it cannot update a marketplace from `config.toml`, such as
    // a Git source on a computer without Git (`codex-rs/core-plugins/src/manager.rs`). It has no
    // thread, the chat works, and the plugins stay at their version, so it showed a false
    // "Provider error" toast (#6976). The text covers `marketplace `name`:` and `marketplaces:`.
    message.startsWith("Codex could not update marketplace")
  );
}

export function isArchivedThreadError(error: unknown): boolean {
  return error instanceof AppServerError && /\bis archived\b/i.test(error.message);
}

/**
 * The Codex process has no saved rollout for this unloaded thread in its `CODEX_HOME`: the thread
 * never saved a turn, or it belongs to another provider account. Codex 0.163.0 answers
 * `thread/turns/list` with this error then, and with the history of a thread that has a rollout.
 */
export function isCodexMissingRollout(error: unknown): boolean {
  return error instanceof AppServerError && error.code === -32600 && error.message.startsWith("thread not loaded:");
}

/**
 * The first turn of a new thread starts and is not saved yet, so there is no history to read now.
 * Codex 0.165.0 answers `thread/turns/list` with `is not materialized yet` then, and while that
 * turn is saved, with one of the `is not supported yet` errors (#3609). Unlike a missing rollout,
 * the history is readable once the turn is saved.
 */
export function isCodexRolloutPending(error: unknown): boolean {
  if (!(error instanceof AppServerError)) return false;
  if (error.code === -32600) return error.message.includes(" is not materialized yet");
  return (
    error.code === -32601 &&
    (error.message === "list_turns is not supported yet" || error.message === "paginated_threads is not supported yet")
  );
}

/**
 * Codex has no rollout for this id. A new session is the recovery. Codex 0.163.0 answers
 * `thread/resume` with `no rollout found`, and `turn/start` on an unloaded thread with `thread not found`.
 */
function isCodexMissingThreadError(error: unknown): boolean {
  return (
    error instanceof AppServerError &&
    (/thread not found:/i.test(error.message) || /\bno rollout found\b/i.test(error.message))
  );
}

/**
 * Codex refused `turn/start` because a compaction turn runs on the thread. Codex 0.160.1 answers a
 * `NotSubmitted` input with this internal error, so the input did not reach the turn and the caller
 * can queue it again for when the compaction ends.
 */
export function isCodexCompactionRefusal(error: unknown): boolean {
  return (
    error instanceof AppServerError &&
    error.code === -32603 &&
    error.message.startsWith("failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact")
  );
}

/**
 * Another Codex app that uses the same Codex folder, such as the Codex desktop app, has this thread
 * open and holds its writer lock. Codex refuses `thread/resume` with this error then, and the lock
 * stays until that app closes the thread (#6666). A new session would split the chat from the one
 * that app shows, so the session stays.
 */
export function isCodexThreadInUse(error: unknown): boolean {
  return (
    error instanceof AppServerError && error.code === -32600 && error.message.includes("already has an active writer")
  );
}

/**
 * The provider refused the session's own history. Grok keeps the `encrypted_content` of each
 * reasoning item in its session and sends it back on every request, and xAI accepts it only from
 * the caller it was issued to. After a sign-in to another account or a new API key, each turn of
 * that session fails the same way, so only a new session, given the OpenBot transcript, recovers.
 */
function isForeignReasoningError(message: string): boolean {
  return /\bencrypted_content\b.*\bnot issued to this caller\b/i.test(message);
}

/**
 * OpenCode's model gateway answers a request that it does not accept with one generic 400 that
 * names no field. A session that grew too long for its model, often after the agent moved to
 * another model on the same session, fails each turn this way, and OpenCode does not compact it
 * (#2351). Venice answers "Invalid request parameters", and OpenCode keeps only that text of its
 * reply, also when the session holds more images than Venice accepts (#6702). Only a new session,
 * given the OpenBot transcript, recovers.
 */
function isRejectedOpenCodeRequest(provider: AgentProvider, message: string): boolean {
  return (
    provider === "opencode" &&
    /\bthe request contains invalid parameters\b|\bInternal error: Invalid request parameters\b/i.test(message)
  );
}

/**
 * Muse stores a failed MCP startup audit in the session, and `session/resume` cannot clear it. Each
 * later turn of that session fails in milliseconds, even after the failed server is removed
 * (#2369). Only a new session, given the OpenBot transcript, recovers.
 */
function isMuseMcpStartupFault(provider: AgentProvider, message: string): boolean {
  return provider === "muse" && /\bMCP startup audit failed\b/i.test(message);
}

/**
 * OpenBot names a new Claude session before the CLI writes it, and a first turn that stops before
 * that write, such as on a terms prompt, leaves a session that does not exist. The CLI then refuses
 * each resume of it, and so does a session file lost with a changed config folder (#5365).
 */
function isMissingClaudeSession(provider: AgentProvider, message: string): boolean {
  return provider === "claude" && /\bNo conversation found with session ID\b/.test(message);
}

/**
 * Claude Code compacts a session that is too long for the model before it gives up, and then ends
 * each later turn of that session with this text, also after a restart (#6596).
 */
function isClaudeContextOverflow(provider: AgentProvider, message: string): boolean {
  return provider === "claude" && /^Prompt is too long\b/.test(message);
}

/**
 * The failure to show when the provider refused the session's own history, or null when it did
 * not. Each turn of a refused session fails the same way, so the caller closes the session.
 */
export function refusedSessionFailure(provider: AgentProvider, message: string): string | null {
  if (isForeignReasoningError(message))
    return sourceText("error.provider.foreignReasoning", { provider: providerLabel(provider) });
  if (isImageTooSmallDiagnostic(message))
    return sourceText("error.provider.imageTooSmall", { provider: providerLabel(provider) });
  if (isImageTooLargeDiagnostic(message))
    return sourceText("error.provider.imageTooLarge", { provider: providerLabel(provider) });
  if (isImageCountDiagnostic(message))
    return sourceText("error.provider.imageCountLimit", { provider: providerLabel(provider) });
  if (isRejectedOpenCodeRequest(provider, message)) return sourceText("error.provider.opencodeSessionRejected");
  if (isMuseMcpStartupFault(provider, message)) return sourceText("error.provider.museMcpStartupFault");
  if (isMissingClaudeSession(provider, message)) return sourceText("error.provider.claudeSessionMissing");
  if (isClaudeContextOverflow(provider, message)) return sourceText("error.provider.claudeContextFull");
  return null;
}

export function isMissingProviderSessionError(error: unknown, provider: AgentProvider): boolean {
  // ACP clients convert confirmed missing-session responses before this boundary.
  // Provider diagnostics can mention missing resources without proving that this session is gone.
  if (error instanceof RequestError) return false;
  if (provider === "claude") return error instanceof MissingClaudeSessionError;
  // Pi and the key-only providers that run in the Pi CLI.
  if (error instanceof MissingPiSessionError) return true;
  if (provider === "codex") return isCodexMissingThreadError(error);
  if (
    (provider !== "grok" &&
      provider !== "opencode" &&
      provider !== "antigravity" &&
      provider !== "cursor" &&
      provider !== "cline" &&
      provider !== "kimi" &&
      provider !== "devin" &&
      provider !== "copilot" &&
      provider !== "mistral" &&
      provider !== "hermes" &&
      provider !== "acp") ||
    !(error instanceof Error)
  ) {
    return false;
  }
  return (
    /\bunknown grok session\b/i.test(error.message) ||
    /\bsession\b.*\b(?:not found|does not exist|unknown)\b/i.test(error.message) ||
    /\b(?:not found|unknown)\b.*\bsession\b/i.test(error.message)
  );
}

export function isRequestTimeout(error: unknown, method: string): error is RequestTimeoutError {
  return error instanceof RequestTimeoutError && error.method === method;
}

export function isDynamicToolCall(value: unknown): value is DynamicToolCallParams {
  return (
    isRecord(value) &&
    isString(value.threadId) &&
    isString(value.turnId) &&
    isString(value.callId) &&
    (isString(value.namespace) || value.namespace === null) &&
    isString(value.tool) &&
    "arguments" in value
  );
}

export function toThreadItem(value: DynamicRecord): ThreadItem | null {
  const type = getString(value, "type");
  if (type === "reasoning") {
    const id = getString(value, "id");
    return {
      type: "agentMessage",
      ...(id === null ? {} : { id }),
      phase: "commentary",
      text: reasoningText(value),
    };
  }
  return type ? { ...value, type } : null;
}

/** What a tool step was, in the closed set product analytics reports. */
type ToolUsageKind =
  | "command"
  | "file_change"
  | "file_read"
  | "web_search"
  | "web_fetch"
  | "mcp"
  | "image_generation"
  | "video_generation"
  | "subagent"
  | "other";

/**
 * One finished tool step. `server` and `tool` are the provider's raw names, not yet safe to send:
 * the main process keeps them only for OpenBot's own servers and catalog plugins.
 */
export interface ToolUsage {
  kind: ToolUsageKind;
  server?: string;
  tool?: string;
  failed: boolean;
}

/** A tool step and the turn it ran in. */
export interface ToolUsageSignal extends ToolUsage {
  agentId: string;
  turnId: string;
}

const CODEX_ITEM_KINDS = new Map<string, ToolUsageKind>([
  ["commandExecution", "command"],
  ["fileChange", "file_change"],
  ["imageView", "file_read"],
  ["webSearch", "web_search"],
  ["imageGeneration", "image_generation"],
  ["image_generation_call", "image_generation"],
  ["videoGeneration", "video_generation"],
  ["collabAgentToolCall", "subagent"],
]);

const CLAUDE_TOOL_KINDS = new Map<string, ToolUsageKind>([
  ["Bash", "command"],
  ["BashOutput", "command"],
  ["KillShell", "command"],
  ["Read", "file_read"],
  ["Glob", "file_read"],
  ["Grep", "file_read"],
  ["LS", "file_read"],
  ["NotebookRead", "file_read"],
  ["Edit", "file_change"],
  ["MultiEdit", "file_change"],
  ["Write", "file_change"],
  ["NotebookEdit", "file_change"],
  ["WebSearch", "web_search"],
  ["WebFetch", "web_fetch"],
  ["Task", "subagent"],
  ["Agent", "subagent"],
]);

const ACP_TOOL_KINDS = new Map<string, ToolUsageKind>([
  ["execute", "command"],
  ["read", "file_read"],
  ["search", "file_read"],
  ["edit", "file_change"],
  ["delete", "file_change"],
  ["move", "file_change"],
  ["fetch", "web_fetch"],
]);

/**
 * Classifies a completed tool item for analytics, or answers `null` for an item that is not a tool.
 *
 * Codex names its item types; Claude names a built-in tool or `mcp__<server>__<tool>`; an ACP agent
 * sends a free-text title, so only its `toolKind` enum is read and the title never is.
 */
export function toolUsage(item: ThreadItem): ToolUsage | null {
  const status = getString(item, "status");
  const failed = status === "failed" || status === "declined";
  const bridged = bridgedTool(item);
  if (bridged) return { kind: "mcp", server: bridged.namespace, tool: bridged.tool, failed };
  const codexKind = CODEX_ITEM_KINDS.get(item.type);
  if (codexKind) return { kind: codexKind, failed };
  if (item.type === "mcpToolCall") {
    const server = getString(item, "server");
    const tool = getString(item, "tool");
    return { kind: "mcp", ...(server ? { server } : {}), ...(tool ? { tool } : {}), failed };
  }
  if (item.type === "dynamicToolCall") {
    const namespace = getString(item, "namespace");
    const tool = getString(item, "tool");
    return namespace
      ? { kind: "mcp", server: namespace, ...(tool ? { tool } : {}), failed }
      : { kind: "other", failed };
  }
  if (item.type !== "toolCall") return null;
  const acpKind = getString(item, "toolKind");
  if (acpKind !== null) return { kind: ACP_TOOL_KINDS.get(acpKind) ?? "other", failed };
  const name = getString(item, "name") ?? "";
  const claudeKind = CLAUDE_TOOL_KINDS.get(name);
  if (claudeKind) return { kind: claudeKind, failed };
  const mcp = /^mcp__(.+?)__(.+)$/u.exec(name);
  if (!mcp?.[1] || !mcp[2]) return { kind: "other", failed };
  // A server name can contain `__`, so `mcp__openbot__acme__list` does not show where the server
  // name stops. Such a step keeps no names: a user's server must never pass as a built-in one.
  if (mcp[2].includes("__")) return { kind: "mcp", failed };
  return { kind: "mcp", server: mcp[1], tool: mcp[2], failed };
}

/** The built-in tool that a `tool_call` bridge item calls. A name outside the catalog is model text and stays out. */
function bridgedTool(item: ThreadItem) {
  const name = bridgedToolName(item);
  return name ? BUILTIN_TOOL_CATALOG.find((entry) => entry.name === name) : undefined;
}

const TOOL_RESULT_PROGRESS = sourceText("status.agent.toolResultReviewing");

/**
 * The OpenBot tool that an item calls, or null for any other tool: a Codex, Pi or Muse item names
 * it, a Claude item names it `mcp__openbot__<tool>`, and a `tool_call` bridge item names it in its
 * arguments. A tool of another MCP server with the same name is not OpenBot's.
 */
function openBotTool(item: ThreadItem): string | null {
  const bridged = bridgedToolName(item);
  if (bridged) return bridged.startsWith("openbot.") ? bridged.slice("openbot.".length) : null;
  if (item.type === "toolCall") return /^mcp__openbot__(.+)$/u.exec(getString(item, "name") ?? "")?.[1] ?? null;
  if (item.type === "mcpToolCall" && getString(item, "server") !== "openbot") return null;
  return item.type === "dynamicToolCall" || item.type === "mcpToolCall" ? getString(item, "tool") : null;
}

/**
 * The OpenBot browser tool that an item calls, or null for any other tool: a `tool_call` bridge item
 * names it in its arguments, a Codex item names its namespace, and a Claude item names it
 * `mcp__openbot_browser__<tool>` (`claudeBridgedToolName`).
 */
function browserTool(item: ThreadItem): string | null {
  const bridged = bridgedTool(item);
  if (bridged) return bridged.namespace === OPENBOT_BROWSER_NAMESPACE ? bridged.tool : null;
  if (item.type === "toolCall") {
    return /^mcp__openbot_browser__(.+)$/u.exec(getString(item, "name") ?? "")?.[1] ?? null;
  }
  if (item.type !== "dynamicToolCall" || getString(item, "namespace") !== OPENBOT_BROWSER_NAMESPACE) return null;
  return getString(item, "tool");
}

/** The text of a running browser step. Its completed text is the same for each tool. */
function browserProgressText(tool: string): string {
  switch (tool) {
    case "open":
    case "navigate":
      return sourceText("status.agent.browserOpening");
    case "snapshot":
    case "screenshot":
    case "status":
    case "list_tabs":
    case "wait_for":
      return sourceText("status.agent.browserReading");
    case "click":
      return sourceText("status.agent.browserClicking");
    case "type":
    case "fill_fields":
    case "press":
      return sourceText("status.agent.browserTyping");
    default:
      return sourceText("status.agent.browserActing");
  }
}

/**
 * The agents that a `send_message` item went to. A bridge item holds the tool's arguments in its own
 * arguments, and some providers send them as JSON text.
 */
function messageRecipients(item: ThreadItem): string[] {
  let value = bridgedToolName(item) ? getRecord(item, "arguments")?.arguments : item.arguments;
  if (isString(value)) {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return getArray(value, "recipientAgentIds")
    .filter(isString)
    .filter((id) => id.length > 0 && id.length <= INPUT_LIMITS.identifier)
    .slice(0, INPUT_LIMITS.messageRecipients);
}

/** What the trace keeps of a tool step: its shell command, and the agents that an OpenBot message went to. */
export function toolTraceDetail(item: ThreadItem): { command: string | null; recipientAgentIds: string[] | null } {
  const command = getString(item, "command");
  const recipients = openBotTool(item) === "send_message" ? messageRecipients(item) : [];
  return { command, recipientAgentIds: recipients.length > 0 ? recipients : null };
}

/** Whether a finished tool item failed: its status says so, or its command ended with an exit code other than 0. */
export function toolFailed(item: ThreadItem): boolean {
  const status = getString(item, "status");
  const exitCode = item.exitCode;
  return status === "failed" || status === "declined" || (typeof exitCode === "number" && exitCode !== 0);
}

/** The fields that hold the text of a tool result, in the order a failure is read from them. */
const RESULT_TEXT_KEYS = [
  "error",
  "aggregatedOutput",
  "stderr",
  "message",
  "output",
  "text",
  "content",
  "contentItems",
  "result",
] as const;

/** The readable text in a provider's tool result. Records and lists are read a few levels deep. */
function resultText(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  if (isString(value)) return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map((entry) => resultText(entry, depth + 1)).filter(isString);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  if (!isRecord(value)) return null;
  for (const key of RESULT_TEXT_KEYS) {
    const text = resultText(value[key], depth + 1);
    if (text) return text;
  }
  return null;
}

/**
 * The part of a failed result that is redacted. It is much longer than the kept text, so a secret
 * that this first cut divides stays out of the kept text, and a large output is not read in full.
 */
const FAILURE_WINDOW = CONVERSATION_TRACE_TEXT_LIMIT * 16;

/** Whether a tool step runs a shell command: a Codex command, a command tool, or Pi's `bash` tool. */
function isShellCommand(item: ThreadItem): boolean {
  return (
    toolUsage(item)?.kind === "command" ||
    (item.type === "dynamicToolCall" && !getString(item, "namespace") && getString(item, "tool") === "bash")
  );
}

/**
 * The error text of a tool step that failed, for the step's "Show error" output. `redact` runs before
 * the cut, because a cut through a secret leaves a part that no rule recognizes. A command keeps the
 * end of its output, where the error is; other tools keep the start.
 */
export function toolFailureText(item: ThreadItem, redact: (text: string) => string): string | null {
  if (getString(item, "status") !== "failed") return null;
  const raw = resultText(item);
  if (!raw) return null;
  const tail = isShellCommand(item);
  const window = raw.length <= FAILURE_WINDOW ? raw : tail ? raw.slice(-FAILURE_WINDOW) : raw.slice(0, FAILURE_WINDOW);
  const text = redact(window).trim();
  const limit = CONVERSATION_TRACE_TEXT_LIMIT;
  if (text.length <= limit) return text || null;
  // A cut between the two halves of a surrogate pair leaves half a character, which goes.
  return tail
    ? `…${text.slice(1 - limit).replace(/^[\uDC00-\uDFFF]/u, "")}`
    : `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, "")}…`;
}

/** Whether an item is a tool step: a tool call, a command, a file change, a web search or a computer action. */
export function isToolItem(item: ThreadItem): boolean {
  return /(tool.*call|commandexecution|filechange|websearch|computeraction)/u.test(item.type.toLowerCase());
}

export function toolProgressText(item: ThreadItem, completed: boolean): string | null {
  if (!isToolItem(item)) return null;
  if (completed && getString(item, "status") === "failed") {
    return sourceText("status.agent.toolStepFailed");
  }

  const descriptor = [
    item.type,
    getString(item, "name"),
    getString(item, "title"),
    getString(item, "tool"),
    bridgedTool(item)?.name,
  ]
    .filter(isString)
    .join(" ")
    .toLowerCase();
  // Before the generic words below, because a driver tool such as `get_window_state` matches them.
  // The completed text is what the user reads while the model decides the next action, so a long
  // wait after it is the model, not the driver.
  if (getString(item, "server") === COMPUTER_USE_MCP_SERVER_NAME || descriptor.includes(COMPUTER_USE_MCP_SERVER_NAME)) {
    return sourceText(completed ? "status.computerUse.progressDeciding" : "status.computerUse.progressActing");
  }
  // OpenBot's own memory and skill tools, before the generic words too. A memory search reports what
  // it found itself, while it runs, so its end adds no line.
  const openBot = openBotTool(item);
  if (openBot === "search_memories" || openBot === "list_memories") {
    return completed ? null : sourceText("status.agent.memoriesSearching");
  }
  if (openBot === "remember" || openBot === "forget_memory" || openBot === "set_memory_inclusion") {
    return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.memoriesUpdating");
  }
  if (openBot === "read_local_skill") return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.skillReading");
  // Its name has `send`, a word of the agent words below.
  if (openBot === "send_feedback") return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.feedbackSending");
  const skill = getString(item, "name") === "Skill" ? getString(item, "skill") : null;
  if (skill) return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.skillUsing", { name: skill });
  if (descriptor.includes("capture_screen")) {
    return sourceText(completed ? "status.agent.screenCaptureReviewing" : "status.agent.screenCaptureProgress");
  }
  // Before the generic words too: each browser tool name contains `browser`, which is a web search word.
  const browser = browserTool(item);
  if (browser !== null) {
    return completed ? sourceText("status.agent.browserReviewing") : browserProgressText(browser);
  }
  // The model's own label of the step, such as "Show folder sizes in home", tells the user more than
  // the generic words below. It can quote a path or a value, so it is redacted like the trace's command.
  const description = completed ? null : getString(item, "description")?.trim();
  if (description) return redactText(description);
  // Next, a label from what the step does, such as "Reading main.ts…", for a provider that sends no label.
  const label = completed ? null : stepLabel(item);
  if (label) return label;
  if (/(search|browser|fetch|navigate|open_url|web)/u.test(descriptor)) {
    return completed ? sourceText("status.agent.sourcesReviewing") : sourceText("status.agent.sourcesSearching");
  }
  if (/(read|find|list|get|inspect|snapshot)/u.test(descriptor)) {
    return completed
      ? sourceText("status.agent.informationReviewing")
      : sourceText("status.agent.informationGathering");
  }
  if (/(test|check|lint|build|verify)/u.test(descriptor)) {
    return completed ? sourceText("status.agent.workReviewing") : sourceText("status.agent.workChecking");
  }
  if (/(write|edit|patch|create|update|delete|move|filechange)/u.test(descriptor)) {
    return completed ? sourceText("status.agent.changesReviewing") : sourceText("status.agent.changesMaking");
  }
  if (/(agent|delegate|message|send)/u.test(descriptor)) {
    return completed ? sourceText("status.agent.agentResponseReviewing") : sourceText("status.agent.agentCoordinating");
  }
  // Last, so that a command with a title such as "Run the tests" keeps the text above. A command that
  // never returns then reads as a command, not as an unknown step (#5485). Pi names its shell tool `bash`.
  if (!completed && isShellCommand(item)) {
    return sourceText("status.agent.commandRunningUnnamed");
  }
  return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.toolStepWorking");
}

const TOOL_USAGE_ACTIVITIES: Readonly<Record<ToolUsageKind, AgentStepActivity>> = {
  command: "running",
  file_change: "editing",
  file_read: "reading",
  web_search: "searching",
  web_fetch: "browsing",
  mcp: "working",
  image_generation: "editing",
  video_generation: "editing",
  subagent: "delegating",
  other: "working",
};

/** OpenBot tools that only read: memories, skills and chat history. */
const READING_OPENBOT_TOOLS = new Set([
  "search_memories",
  "list_memories",
  "read_local_skill",
  "history_search",
  "history_read",
]);

/**
 * What a tool step does, for the `activity` of its `turn-progress` event, or null for an item that is
 * not a tool step. An ended step is `reviewing`: the model now reads its result.
 */
export function toolActivity(item: ThreadItem, completed: boolean): AgentStepActivity | null {
  if (!isToolItem(item)) return null;
  if (completed) return "reviewing";
  if (browserTool(item) !== null) return "browsing";
  const openBot = openBotTool(item);
  if (openBot === "send_message") return "delegating";
  if (openBot === "web_search") return "searching";
  if (READING_OPENBOT_TOOLS.has(openBot ?? "")) return "reading";
  return TOOL_USAGE_ACTIVITIES[toolUsage(item)?.kind ?? "other"];
}

/** The provider account after the first that an agent runs on, or null for the provider's own sign-in. */
export function agentProviderAccount(agent: { providerAccountId?: string | undefined }): string | null {
  const accountId = agent.providerAccountId;
  return accountId && accountId !== DEFAULT_PROVIDER_ACCOUNT_ID ? accountId : null;
}

export function providerForAgent(agent: { provider: AgentProvider }): AgentProvider {
  return agent.provider;
}

export function providerLabel(provider: AgentProvider): string {
  return agentProviderName(provider);
}
