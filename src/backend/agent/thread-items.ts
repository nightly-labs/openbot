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
import {
  GEMINI_INVALID_ARGUMENT,
  isImageCountDiagnostic,
  isImageTooLargeDiagnostic,
  isImageTooSmallDiagnostic,
  isImageUnreadableDiagnostic,
  isRequestBodyLimitDiagnostic,
  isUnreadableContentDiagnostic,
} from "./provider-diagnostics";
import { stepLabel } from "./step-labels";
import { BUILTIN_TOOL_CATALOG } from "./tool-catalog";

export function isNonActionableCodexWarning(message: string): boolean {
  return (
    message.startsWith("Skill descriptions were shortened to fit") ||
    message.startsWith("Exceeded skills context budget") ||
    message.startsWith("Falling back from WebSockets to HTTPS transport.") ||
    message.startsWith("Under-development features enabled:") ||
    message.startsWith("Configured service tier ") ||
    message.startsWith("Codex could not update marketplace") ||
    message.startsWith("This session was recorded with model ") ||
    message.startsWith("`[features].multi_agent` is deprecated.")
  );
}

export function isArchivedThreadError(error: unknown): boolean {
  return error instanceof AppServerError && /\bis archived\b/i.test(error.message);
}

export function isCodexMissingRollout(error: unknown): boolean {
  if (!(error instanceof AppServerError)) return false;
  if (/^invalid paginated history lineage for \S+: missing source rollout$/.test(error.message)) return true;
  return error.code === -32600 && error.message.startsWith("thread not loaded:");
}

export function isCodexRolloutPending(error: unknown): boolean {
  if (!(error instanceof AppServerError)) return false;
  if (error.code === -32600) return error.message.includes(" is not materialized yet");
  return (
    error.code === -32601 &&
    (error.message === "list_turns is not supported yet" || error.message === "paginated_threads is not supported yet")
  );
}

function isCodexMissingThreadError(error: unknown): boolean {
  return (
    error instanceof AppServerError &&
    (/thread not found:/i.test(error.message) || /\bno rollout found\b/i.test(error.message))
  );
}

export function isCodexCompactionRefusal(error: unknown): boolean {
  return (
    error instanceof AppServerError &&
    error.code === -32603 &&
    error.message.startsWith("failed to submit turn input: ActiveTurnNotSteerable { turn_kind: Compact")
  );
}

export function isCodexThreadInUse(error: unknown): boolean {
  return (
    error instanceof AppServerError && error.code === -32600 && error.message.includes("already has an active writer")
  );
}

function isForeignReasoningError(message: string): boolean {
  return /\bencrypted_content\b.*\bnot issued to this caller\b/i.test(message);
}

function isBlankHistoryText(message: string): boolean {
  return /\btext content blocks must (?:contain non-whitespace text|be non-empty)\b/i.test(message);
}

function isCodexUnstoredItem(provider: AgentProvider, message: string): boolean {
  return provider === "codex" && /\bItems are not persisted when `?store`? is set to false\b/i.test(message);
}

function isCodexBareBadRequest(provider: AgentProvider, message: string): boolean {
  return (
    provider === "codex" &&
    /^(?:[^{]*\b400 Bad Request:\s*)?\{\s*"detail"\s*:\s*"Bad Request"\s*\}(?:,\s*url:.*)?$/.test(message.trim())
  );
}

function isCodexRefusedAudio(provider: AgentProvider, message: string): boolean {
  return provider === "codex" && /\bAudio input is not (?:available|supported)\b/i.test(message);
}

function isRejectedOpenCodeRequest(provider: AgentProvider, message: string): boolean {
  return (
    provider === "opencode" &&
    /\bthe request contains invalid parameters\b|\bInternal error: Invalid request parameters\b/i.test(message)
  );
}

function isRejectedAntigravityRequest(provider: AgentProvider, message: string): boolean {
  return provider === "antigravity" && GEMINI_INVALID_ARGUMENT.test(message);
}

function isClearedAntigravityHistory(provider: AgentProvider, message: string): boolean {
  return (
    provider === "antigravity" && /\bno renderable messages\b|\ball steps in trajectory are cleared\b/i.test(message)
  );
}

function isUnencodableAntigravityHistory(provider: AgentProvider, message: string): boolean {
  return provider === "antigravity" && /\bcontains invalid UTF-8\b/.test(message);
}

function isStuckAcpTurn(provider: AgentProvider, message: string): boolean {
  return (provider === "mistral" || provider === "acp") && /\bA turn is already running\b/.test(message);
}

function isFailedOpenCodeCompaction(provider: AgentProvider, message: string): boolean {
  return (
    provider === "opencode" &&
    /\bCompaction summary did not match the required template\b|\bCompaction produced no summary\b|\bCompaction summary reached the output token limit\b/i.test(
      message,
    )
  );
}

function isUnsendableOpenCodeMedia(provider: AgentProvider, message: string): boolean {
  return (
    provider === "opencode" &&
    /\bMedia strings must be base64\b|\bLocal file references must be read with Media\.file\b/i.test(message)
  );
}

function isMuseMcpStartupFault(provider: AgentProvider, message: string): boolean {
  return provider === "muse" && /\bMCP startup audit failed\b/i.test(message);
}

function isMissingClaudeSession(provider: AgentProvider, message: string): boolean {
  return provider === "claude" && /\bNo conversation found with session ID\b/.test(message);
}

function isClaudeContextOverflow(provider: AgentProvider, message: string): boolean {
  return provider === "claude" && /^Prompt is too long\b/.test(message);
}

export function refusedSessionFailure(provider: AgentProvider, message: string): string | null {
  if (isForeignReasoningError(message))
    return sourceText("error.provider.foreignReasoning", { provider: providerLabel(provider) });
  if (isBlankHistoryText(message))
    return sourceText("error.provider.blankHistoryText", { provider: providerLabel(provider) });
  if (isCodexUnstoredItem(provider, message)) return sourceText("error.provider.codexHistoryItemMissing");
  if (isCodexBareBadRequest(provider, message))
    return sourceText("error.provider.codexRequestRefused", { provider: providerLabel(provider) });
  if (isCodexRefusedAudio(provider, message)) return sourceText("error.provider.codexAudioRefused");
  if (isImageTooSmallDiagnostic(message))
    return sourceText("error.provider.imageTooSmall", { provider: providerLabel(provider) });
  if (isImageTooLargeDiagnostic(message))
    return sourceText("error.provider.imageTooLarge", { provider: providerLabel(provider) });
  if (isImageCountDiagnostic(message))
    return sourceText("error.provider.imageCountLimit", { provider: providerLabel(provider) });
  if (isImageUnreadableDiagnostic(message) || isUnsendableOpenCodeMedia(provider, message))
    return sourceText("error.provider.imageUnreadable", { provider: providerLabel(provider) });
  if (isRequestBodyLimitDiagnostic(message))
    return sourceText("error.provider.requestTooLarge", { provider: providerLabel(provider) });
  if (provider === "opencode" && isUnreadableContentDiagnostic(message))
    return sourceText("error.provider.opencodeUnreadableContent");
  if (isRejectedOpenCodeRequest(provider, message)) return sourceText("error.provider.opencodeSessionRejected");
  if (isRejectedAntigravityRequest(provider, message)) return sourceText("error.provider.antigravitySessionRejected");
  if (isClearedAntigravityHistory(provider, message) || isUnencodableAntigravityHistory(provider, message))
    return sourceText("error.provider.antigravityHistoryUnreadable");
  if (isStuckAcpTurn(provider, message))
    return sourceText("error.provider.acpTurnStuck", { provider: providerLabel(provider) });
  if (isFailedOpenCodeCompaction(provider, message)) return sourceText("error.provider.opencodeCompactionFailed");
  if (isMuseMcpStartupFault(provider, message)) return sourceText("error.provider.museMcpStartupFault");
  if (isMissingClaudeSession(provider, message)) return sourceText("error.provider.claudeSessionMissing");
  if (isClaudeContextOverflow(provider, message)) return sourceText("error.provider.claudeContextFull");
  return null;
}

export function isMissingProviderSessionError(error: unknown, provider: AgentProvider): boolean {
  if (error instanceof RequestError) return false;
  if (provider === "claude") return error instanceof MissingClaudeSessionError;
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

export interface ToolUsage {
  kind: ToolUsageKind;
  server?: string;
  tool?: string;
  failed: boolean;
}

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
  if (mcp[2].includes("__")) return { kind: "mcp", failed };
  return { kind: "mcp", server: mcp[1], tool: mcp[2], failed };
}

function bridgedTool(item: ThreadItem) {
  const name = bridgedToolName(item);
  return name ? BUILTIN_TOOL_CATALOG.find((entry) => entry.name === name) : undefined;
}

const TOOL_RESULT_PROGRESS = sourceText("status.agent.toolResultReviewing");

export function openBotTool(item: ThreadItem): string | null {
  const bridged = bridgedToolName(item);
  if (bridged) return bridged.startsWith("openbot.") ? bridged.slice("openbot.".length) : null;
  if (item.type === "toolCall") return /^mcp__openbot__(.+)$/u.exec(getString(item, "name") ?? "")?.[1] ?? null;
  if (item.type === "mcpToolCall" && getString(item, "server") !== "openbot") return null;
  return item.type === "dynamicToolCall" || item.type === "mcpToolCall" ? getString(item, "tool") : null;
}

function browserTool(item: ThreadItem): string | null {
  const bridged = bridgedTool(item);
  if (bridged) return bridged.namespace === OPENBOT_BROWSER_NAMESPACE ? bridged.tool : null;
  if (item.type === "toolCall") {
    return /^mcp__openbot_browser__(.+)$/u.exec(getString(item, "name") ?? "")?.[1] ?? null;
  }
  if (item.type !== "dynamicToolCall" || getString(item, "namespace") !== OPENBOT_BROWSER_NAMESPACE) return null;
  return getString(item, "tool");
}

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

export function toolTraceDetail(item: ThreadItem): { command: string | null; recipientAgentIds: string[] | null } {
  const command = getString(item, "command");
  const recipients = openBotTool(item) === "send_message" ? messageRecipients(item) : [];
  return { command, recipientAgentIds: recipients.length > 0 ? recipients : null };
}

export function toolFailed(item: ThreadItem): boolean {
  const status = getString(item, "status");
  const exitCode = item.exitCode;
  return status === "failed" || status === "declined" || (typeof exitCode === "number" && exitCode !== 0);
}

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

const FAILURE_WINDOW = CONVERSATION_TRACE_TEXT_LIMIT * 16;

function isShellCommand(item: ThreadItem): boolean {
  const tool = item.type === "dynamicToolCall" && !getString(item, "namespace") ? getString(item, "tool") : undefined;
  return toolUsage(item)?.kind === "command" || tool === "bash" || tool === "powershell";
}

export function toolFailureText(item: ThreadItem, redact: (text: string) => string): string | null {
  return getString(item, "status") === "failed" ? boundedResultText(item, redact) : null;
}

export function toolResultText(item: ThreadItem, redact: (text: string) => string): string | null {
  return toolFailed(item) ? null : boundedResultText(item, redact);
}

export function toolCallName(item: ThreadItem): string | null {
  const bridged = bridgedToolName(item);
  if (bridged) return bridged;
  const usage = toolUsage(item);
  if (usage?.server && usage.tool) return `${usage.server}.${usage.tool}`;
  return getString(item, "tool") ?? getString(item, "name");
}

function boundedResultText(item: ThreadItem, redact: (text: string) => string): string | null {
  const raw = resultText(item);
  if (!raw) return null;
  const tail = isShellCommand(item);
  const window = raw.length <= FAILURE_WINDOW ? raw : tail ? raw.slice(-FAILURE_WINDOW) : raw.slice(0, FAILURE_WINDOW);
  const text = redact(window).trim();
  const limit = CONVERSATION_TRACE_TEXT_LIMIT;
  if (text.length <= limit) return text || null;
  return tail
    ? `…${text.slice(1 - limit).replace(/^[\uDC00-\uDFFF]/u, "")}`
    : `${text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, "")}…`;
}

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
  if (getString(item, "server") === COMPUTER_USE_MCP_SERVER_NAME || descriptor.includes(COMPUTER_USE_MCP_SERVER_NAME)) {
    return sourceText(completed ? "status.computerUse.progressDeciding" : "status.computerUse.progressActing");
  }
  const openBot = openBotTool(item);
  if (openBot === "search_memories" || openBot === "list_memories") {
    return completed ? null : sourceText("status.agent.memoriesSearching");
  }
  if (openBot === "history_search" || openBot === "history_read") {
    return completed ? null : sourceText("status.agent.chatsSearching");
  }
  if (openBot === "remember" || openBot === "forget_memory" || openBot === "set_memory_inclusion") {
    return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.memoriesUpdating");
  }
  if (openBot === "set_backdrop") return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.backdropSetting");
  if (openBot === "read_local_skill") return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.skillReading");
  if (openBot === "send_feedback") return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.feedbackSending");
  if (openBot === "withdraw_feedback")
    return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.feedbackWithdrawing");
  const skill = getString(item, "name") === "Skill" ? getString(item, "skill") : null;
  if (skill) return completed ? TOOL_RESULT_PROGRESS : sourceText("status.agent.skillUsing", { name: skill });
  if (descriptor.includes("capture_screen")) {
    return sourceText(completed ? "status.agent.screenCaptureReviewing" : "status.agent.screenCaptureProgress");
  }
  const browser = browserTool(item);
  if (browser !== null) {
    return completed ? sourceText("status.agent.browserReviewing") : browserProgressText(browser);
  }
  const description = completed ? null : getString(item, "description")?.trim();
  if (description) return redactText(description);
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

const READING_OPENBOT_TOOLS = new Set([
  "search_memories",
  "list_memories",
  "read_local_skill",
  "history_search",
  "history_read",
]);

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
