import { execFile, spawn } from "node:child_process";
import { randomUUID, type UUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import {
  type CanUseTool,
  createSdkMcpServer,
  type ElicitationResult,
  type ModelInfo,
  type OnElicitation,
  type Options,
  type PermissionResult,
  query,
  type SDKUserMessage,
  type SessionMessage,
  type Settings,
  type SpawnedProcess,
  type SpawnOptions,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { attachmentMimeTypeForName } from "@openbot/contracts/attachment-files";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import { type AgentContextCategoryUsage, agentProviderName, defaultProviderModel } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { classifyFailure } from "@openbot/telemetry";
import { Deferred, Effect, Exit, Fiber, Option, Scope } from "effect";
import { z } from "zod";
import { advertisedZodShape } from "./agent/advertised-json-schema";
import { isTurnContextBlock } from "./agent/developer-instructions";
import {
  type ClaudePlanState,
  foldClaudePlanCall,
  foldClaudePlanResult,
  newClaudePlanState,
  PLAN_UPDATED_METHOD,
  type PlanUpdateStep,
  startClaudePlanTurn,
} from "./agent/plan-updates";
import { isBalanceDiagnostic, isPlanLimitDiagnostic, isSpentBalanceDiagnostic } from "./agent/provider-diagnostics";
import { ROUTINE_NO_UPDATE_TOOL } from "./agent/routine-quiet-runs";
import {
  endSubagentTurn,
  foldClaudeSubagentCall,
  foldClaudeSubagentMessage,
  foldClaudeSubagentResult,
  foldClaudeTaskMessage,
  newSubagentState,
  SUBAGENTS_UPDATED_METHOD,
  type SubagentChange,
  type SubagentState,
  stopSubagents,
} from "./agent/subagent-updates";
import { claudeBridgedToolName, DIRECT_BROWSER_TOOL_DEFINITIONS, visibleToolDefinitions } from "./agent/tool-catalog";
import { TurnContext } from "./agent/turn-context";
import { USAGE_LIMIT_METHOD } from "./agent/usage-limit-gate";
import {
  type AgentProvider,
  MissingClaudeSessionError,
  ProviderTurnActiveError,
  RequestTimeoutError,
} from "./agent-client";
import { OPENBOT_BROWSER_NAMESPACE } from "./browser-tools";
import { CHANNEL_TOOL_DEFINITIONS } from "./channel-tools";
import { claudeContextCategories } from "./claude-context-categories";
import {
  CLAUDE_NO_RESPONSE_TEXT,
  type ClaudeHistoryOptions,
  claudeHistoryFromMessages,
  claudeHistoryReader,
  claudeTaskTurnId,
  isClaudeNoResponsePlaceholder,
} from "./claude-history";
import { readClaudeStoredSignIn } from "./claude-stored-sign-in";
import {
  CLAUDE_WORKSPACE_MANAGED_SETTINGS,
  claudeExcludedWriteMessage,
  claudeHomeSkillPlugin,
  claudeWorkspaceHooks,
  claudeWorkspaceSandbox,
  claudeWorkspaceSkillPlugin,
  claudeWriteInExcluded,
  claudeWriteOutsideRoots,
} from "./claude-workspace-sandbox";
import {
  type ClaudeCliInfo,
  claudeTakesPromptSnapshotFlag,
  cliLaunchPath,
  cliPathEnvironment,
  cliSpawnTarget,
} from "./cli";
import {
  isClaudeCompactionSummary,
  isClaudeInterruptMarker,
  isClaudeLocalCommand,
  isClaudeTaskNotification,
} from "./conversation-snapshots";
import { runCauseEffect } from "./effect-boundary";
import { skillFolderNames } from "./home-skills";
import { IdleThreadPool } from "./idle-thread-pool";
import { MCP_STDIO_PROBE_TIMEOUT_MS } from "./mcp-probe";
import {
  agentMcpServers,
  type ClaudeMcpServer,
  claudeMcpServers,
  computerUseParam,
  type McpDropReporter,
  type McpEndpointSource,
  type McpServerSource,
  type McpToolRuntimeSource,
  mcpAgentParam,
  usableMcpServers,
} from "./mcp-provider-shapes";
import { MAX_RUNS, untakenRunId } from "./message-run-ids";
import { PendingServerRequests } from "./pending-server-requests";
import {
  type AccountRateLimitsReadResult,
  type AccountRateLimitWindowResult,
  type AccountReadResult,
  type AppServerNotification,
  type AppServerRequest,
  CLAUDE_API_KEY_ACCOUNT_TYPE,
  CLAUDE_CLI_API_KEY_ACCOUNT_TYPE,
  getArray,
  getRecord,
  getString,
  isRecord,
  type RequestId,
  type ResponseDecoder,
  type RpcError,
  type ThreadItem,
  type ThreadResponse,
  type TurnResponse,
} from "./protocol";
import {
  type ProviderClientOperationError,
  providerCall,
  providerFailure,
  providerResult,
  providerSync,
  requiredString,
  toProviderClientOperationError,
} from "./provider-client-effects";
import type { ReadProviderHistory } from "./provider-history";
import { endProcessGroupOnExit, PROVIDER_PROCESS_GROUP } from "./provider-process-group";

const execFileAsync = promisify(execFile);
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const CLAUDE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ClaudeEffort = (typeof CLAUDE_EFFORTS)[number];
const CLAUDE_NATIVE_SCHEDULING = [
  "CronCreate",
  "CronDelete",
  "CronList",
  "ScheduleWakeup",
  "RemoteTrigger",
  "Skill(schedule)",
  "Skill(loop)",
];
const CLAUDE_DUPLICATE_TOOLS = ["ListAgents", "Workflow", "Skill(workflow-authoring)"];
export const CLAUDE_HOST_TOOLS = [
  "ReportFindings",
  "DesignSync",
  "PushNotification",
  "Agent(statusline-setup)",
  "Agent(claude-code-guide)",
  "Agent(claude)",
];

export const CLAUDE_UNFIT_SKILLS = [
  "deep-research",
  "design",
  "design-sync",
  "doctor",
  "fewer-permission-prompts",
  "keybindings-help",
  "loop",
  "plugin-authoring",
  "schedule",
  "send-to-project",
  "update-config",
  "workflow-authoring",
];
const CLAUDE_NAME_ONLY_SKILLS = [
  "batch",
  "claude-api",
  "code-review",
  "dataviz",
  "debug",
  "init",
  "run",
  "run-skill-generator",
  "security-review",
  "simplify",
  "verify",
];
const claudeFlagSettings = Effect.fn("claudeFlagSettings")(function* (
  userSettings: DynamicRecord,
  configDirectory: string,
  cwd: string,
  sources: NonNullable<Options["settingSources"]>,
  processEnvironment: NodeJS.ProcessEnv,
  excludedInstructionFiles: readonly string[],
) {
  const projectFiles = [
    ...(sources.includes("project") ? [join(cwd, ".claude", "settings.json")] : []),
    ...(sources.includes("local") ? [join(cwd, ".claude", "settings.local.json")] : []),
  ];
  const projectSettings = yield* Effect.forEach(projectFiles, readClaudeSettingsFile);
  const ownSettings = [...(sources.includes("user") ? [userSettings] : []), ...projectSettings];
  const envFiles = sources.includes("user") ? [userSettings, ...projectSettings] : [...projectSettings, userSettings];
  const environmentValue = (name: string) =>
    envFiles
      .map((file) => (isDynamicRecord(file.env) ? file.env[name] : undefined))
      .filter(isString)
      .at(-1) ?? processEnvironment[name];
  const firstPartyApi = CLAUDE_OTHER_API_VARIABLES.every((name) => !environmentValue(name));
  const ownSkills = new Set([
    ...(sources.includes("user") ? yield* skillFolderNames(join(configDirectory, "skills")) : []),
    ...(sources.includes("project") ? yield* skillFolderNames(join(cwd, ".claude", "skills")) : []),
  ]);
  const ownOverride = (skill: string) =>
    ownSettings.some((file) => isDynamicRecord(file.skillOverrides) && Object.hasOwn(file.skillOverrides, skill));
  const overrides: Array<[string, "off" | "name-only"]> = [
    ...CLAUDE_UNFIT_SKILLS.map((skill): [string, "off"] => [skill, "off"]),
    ...CLAUDE_NAME_ONLY_SKILLS.map((skill): [string, "name-only"] => [skill, "name-only"]),
  ];
  const ownAttribution = ownSettings.some((file) => "attribution" in file || "includeCoAuthoredBy" in file);
  const memoryExcludes = sources.includes("project")
    ? [
        ...(sources.includes("user") ? [] : claudeHomeMemoryFiles()),
        ...claudeWorkspaceInstructionExcludes(cwd, excludedInstructionFiles),
      ]
    : [];
  const settings: Settings = {
    ...(ownAttribution ? {} : { attribution: { commit: "", pr: "" } }),
    disableRemoteControl: true,
    skillOverrides: Object.fromEntries(overrides.filter(([skill]) => !ownSkills.has(skill) && !ownOverride(skill))),
    ...(firstPartyApi && isClaudeAutoToolSearch(environmentValue("ENABLE_TOOL_SEARCH"))
      ? { env: { ENABLE_TOOL_SEARCH: "true" } }
      : {}),
    ...(memoryExcludes.length > 0 ? { claudeMdExcludes: memoryExcludes } : {}),
  };
  return { settings, firstPartyApi };
});

function claudeHomeMemoryFiles(): string[] {
  const userFolder = join(homedir(), ".claude");
  return [join(userFolder, "CLAUDE.md"), join(userFolder, "rules", "**")];
}

const CLAUDE_EXCLUDE_PATTERN_CHARACTERS = /[*?[\]{}()!]/g;

function claudeWorkspaceInstructionExcludes(cwd: string, fileNames: readonly string[]): string[] {
  return fileNames.map((fileName) => join(cwd, fileName).replace(CLAUDE_EXCLUDE_PATTERN_CHARACTERS, "?"));
}

const CLAUDE_OTHER_API_VARIABLES = [
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_GATEWAY",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
  "CLAUDE_CODE_USE_MANTLE",
];

function isClaudeAutoToolSearch(value: string | undefined): boolean {
  if (value === "auto") return true;
  if (!value?.startsWith("auto:")) return false;
  const percent = Number.parseInt(value.slice("auto:".length), 10);
  return Number.isNaN(percent) || (percent > 0 && percent < 100);
}

const TOOL_DESCRIPTION_LIMIT = 120;
const LABELLED_TOOLS: ReadonlySet<string> = new Set(["Bash", "Task", "Agent"]);

const OPENBOT_CLAUDE_CLIENT = {
  CLAUDE_AGENT_SDK_CLIENT_APP: "openbot/0.1.0",
  CLAUDE_CODE_ARTIFACT: "0",
  CLAUDE_CODE_ENTRYPOINT: "openbot",
};
const CLAUDE_TERMINAL_CHANNEL_TOOLS: readonly string[] = [
  "mcp__openbot__channel_result",
  "mcp__openbot__channel_reply",
];
const CLAUDE_TERMINAL_NO_UPDATE_TOOL = `mcp__openbot__${ROUTINE_NO_UPDATE_TOOL}`;

function claudeTerminalTools(channelTools: boolean): readonly string[] {
  return channelTools
    ? [CLAUDE_TERMINAL_NO_UPDATE_TOOL, ...CLAUDE_TERMINAL_CHANNEL_TOOLS]
    : [CLAUDE_TERMINAL_NO_UPDATE_TOOL];
}

function terminalToolRefusal(namespace: string, name: string, content: CallToolResult["content"]): boolean {
  if (namespace !== "openbot" || !claudeTerminalTools(true).includes(`mcp__openbot__${name}`)) return false;
  const [first] = content;
  if (first?.type !== "text") return false;
  try {
    const value = JSON.parse(first.text);
    if (!isRecord(value)) return false;
    return name === ROUTINE_NO_UPDATE_TOOL ? value.status !== "quiet" : value.accepted === false;
  } catch {
    return false;
  }
}
function withClaudeClientLabels(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...environment,
    ...OPENBOT_CLAUDE_CLIENT,
    ...(environment.ANTHROPIC_API_KEY ? { CLAUDE_CODE_ENTRYPOINT: "sdk-ts" } : {}),
  };
}
const CLAUDE_MCP_USER_AGENT = "claude-code-mcp-client";
const CLAUDE_SESSION_TITLE = "OpenBot";

interface ClientEvents {
  notification: [notification: AppServerNotification];
  request: [request: AppServerRequest];
  exit: [error: Error];
  diagnostic: [message: string];
}

interface ThreadConfig {
  cwd: string;
  model?: string | undefined;
  effort?: string | undefined;
  developerInstructions: string;
  additionalDirectories: string[];
  persistSession: boolean;
  profileGeneration: boolean;
  outputSchema: DynamicRecord | null;
  computerUse: boolean;
  channelTools: boolean;
  workspaceOnly: boolean;
  excludedFolders: string[];
  excludedInstructionFiles: string[];
  agentId: string | null;
}

interface ActiveTurn {
  id: string;
  itemId: string;
  reasoningItemId: string;
  text: string;
  seenText: string;
  publishedText: string;
  lastNarration: { id: string; text: string } | null;
  narrationCount: number;
  stopHookBlocked: boolean;
  thinking: string;
  thinkingStarted: boolean;
  thinkingBlocks: Map<string, string>;
  thinkingTail: string | null;
  thinkingSnapshotCounts: Map<string, number>;
  thinkingSnapshots: Set<string>;
  assistantMessages: Map<string, string>;
  toolCalls: Map<string, { name: string; input: Record<string, string> }>;
  usageLimit: { resetsAt: number | null; text: string | null } | null;
  ranTools: boolean;
  authenticationFailed: boolean;
  balanceSpent: boolean;
  billingFailed: boolean;
  retrying: boolean;
  sandboxBlockedWarned: boolean;
  unprompted: boolean;
  prompt: { requestedId: string | null; message: SDKUserMessage; retries: number } | null;
  messageIds: Set<string>;
  untakenSteerIds: Set<string>;
  hostToolCalls: Set<AbortController>;
  promptStarted: boolean;
  lastActivityAt: number;
  stalled: boolean;
  hostRequests: number;
  personRequests: number;
  stopRequested: boolean;
}

interface ThreadRuntime {
  id: string;
  firstPartyApi: boolean;
  usageCounterId: string;
  usageCost: number;
  resumedUsage: boolean;
  requestUsage: Map<string, { model: string; usage: unknown }>;
  contextRequest: number;
  compacting: boolean;
  config: ThreadConfig;
  appliedEffort: string | undefined;
  appliedFastMode: boolean | undefined;
  fastModeDisabledReason: string | null;
  input: AsyncMessageQueue;
  query: ClaudeQuery;
  activeTurn: ActiveTurn | null;
  consume: Fiber.Fiber<void, ProviderClientOperationError> | null;
  idleRelease: ReturnType<typeof setTimeout> | null;
  idleSince: number;
  plan: ClaudePlanState;
  subagents: SubagentState;
  backgroundTasks: number;
  awaitsResultTurn: boolean;
  taskTurns: Map<string, string | typeof SUBAGENT_OWNED_TASK>;
  endedTaskTurns: (string | null)[];
  subagentLimit: { resetsAt: number | null; text: string } | null;
  lastOutputAt: number;
  answered: boolean;
  promptIds: Set<string>;
  nextTurnId: string | null;
  streamMessage: { id: string | null; thinkingBlocks: Map<number, string> };
  mcpConfigFile: string | null;
  settingsFile: string | null;
  stderr: ClaudeStderrTail;
}

const CLAUDE_FAST_SERVICE_TIER = "fast";

const AUTH_STATUS_TIMEOUT_MS = 20_000;

const CLAUDE_THREAD_IDLE_RELEASE_MS = 5 * 60_000;

const CLAUDE_IDLE_THREAD_LIMIT = 1;

const CLAUDE_BACKGROUND_QUIET_RELEASE_MS = 30 * 60_000;

const CLAUDE_STOP_CONFIRM_MS = 10_000;

const CLAUDE_COMPACT_COMMAND = "/compact";

const CLAUDE_CACHE_TTL_MS = { short: 5 * 60_000, long: 60 * 60_000 } as const;

const CLAUDE_TURN_STALL_MS = 15 * 60_000;

const CLAUDE_TOOL_STALL_MS = 60 * 60_000;

const CLAUDE_STALL_CHECK_MS = 60_000;

const TAKEN_PROMPT_LIMIT = 1_000;

const SKIPPED_PROMPT_RETRIES = MAX_RUNS + 1;

const CLAUDE_STOP_HOOK_FEEDBACK = "Stop hook feedback:\n";

const SUBAGENT_OWNED_TASK = Symbol("subagent-owned task");

function startedTaskOrigin(
  taskTurns: ReadonlyMap<string, string | typeof SUBAGENT_OWNED_TASK>,
  message: ClaudeStreamMessage,
  turn: ActiveTurn | null,
): string | typeof SUBAGENT_OWNED_TASK | undefined {
  if (message.owned_by_subagent === true) return SUBAGENT_OWNED_TASK;
  const parentOrigin = isString(message.parent_task_id) ? taskTurns.get(message.parent_task_id) : undefined;
  return parentOrigin ?? turn?.id;
}

interface ClaudeStreamMessage {
  type: string;
  parent_tool_use_id?: string | null;
  event?: unknown;
  message?: unknown;
  uuid?: string;
  session_id?: string;
  subtype?: string;
  result?: string;
  errors?: string[];
  terminal_reason?: string;
  modelUsage?: unknown;
  status?: unknown;
  compact_result?: unknown;
  compact_metadata?: unknown;
  context_usage?: unknown;
  total_cost_usd?: number;
  tool_use_result?: unknown;
  structured_output?: unknown;
  is_error?: boolean;
  api_error_status?: number | null;
  error?: string;
  api_error?: string;
  api_error_params?: unknown;
  rate_limit_info?: unknown;
  tasks?: unknown;
  task_id?: unknown;
  parent_task_id?: unknown;
  owned_by_subagent?: unknown;
  run_id?: unknown;
  command_uuid?: unknown;
  state?: unknown;
  user_message_uuid?: string;
  user_message_uuids?: unknown;
  origin?: unknown;
  num_turns?: unknown;
  resume_reason?: string;
  attempt?: unknown;
  max_retries?: unknown;
  error_status?: unknown;
  no_response?: unknown;
  fast_mode_disabled_reason?: unknown;
  mcp_servers?: unknown;
}

interface ClaudeQuery extends AsyncIterable<ClaudeStreamMessage> {
  interrupt(): Promise<unknown>;
  supportedModels(): Promise<ModelInfo[]>;
  getContextUsage?(options: { detail: "summary" }): Promise<unknown>;
  initializationResult?(): Promise<unknown>;
  mcpServerStatus?(): Promise<unknown>;
  setModel(model?: string): Promise<void>;
  applyFlagSettings(settings: { effortLevel?: ClaudeEffort | null; fastMode?: boolean }): Promise<void>;
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?(options?: { skipBehaviors?: boolean }): Promise<unknown>;
  close(): void;
}

type QueryFactory = (params: Parameters<typeof query>[0]) => ClaudeQuery;
type SessionHistoryReader = (sessionId: string, options?: { dir?: string }) => Promise<SessionMessage[]>;
type ClaudeEffortCapability = { supported: ClaudeEffort[]; defaultEffort: ClaudeEffort } | null;

const queryLogger = createOpenBotLogger("claude-query");
const lastAuthStatuses = new Map<string, DynamicRecord>();

function claudeSettingSources(
  config: Pick<ThreadConfig, "profileGeneration" | "workspaceOnly">,
  userSetup: boolean,
): NonNullable<Options["settingSources"]> {
  if (config.profileGeneration) return [];
  const user: NonNullable<Options["settingSources"]> = userSetup ? ["user"] : [];
  return config.workspaceOnly ? user : [...user, "project", "local"];
}

const readClaudeSettingsFile = Effect.fn("readClaudeSettingsFile")(function* (path: string) {
  const text = yield* Effect.tryPromise(() => readFile(path, "utf8")).pipe(Effect.option);
  if (Option.isNone(text)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.value);
  } catch {
    queryLogger.warn("OpenBot reads no values from a Claude settings file: the file is not valid JSON.", { path });
    return {};
  }
  const record: DynamicRecord = isDynamicRecord(parsed) ? parsed : {};
  return record;
});

function withoutReplacedGateway(
  settings: Settings,
  environment: Readonly<Record<string, string>> | undefined,
): Settings {
  if (!environment?.ANTHROPIC_BASE_URL || !settings.env) return settings;
  const replaced = new Set<string>([...CLAUDE_OTHER_API_VARIABLES, "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"]);
  const env = Object.fromEntries(Object.entries(settings.env).filter(([name]) => !replaced.has(name)));
  const { env: _copied, ...rest } = settings;
  return Object.keys(env).length > 0 ? { ...rest, env } : rest;
}

function claudeSignInSettings(parsed: DynamicRecord): Settings {
  const stringSetting = (key: string): string | null => {
    const value = parsed[key];
    return isString(value) ? value : null;
  };
  const apiKeyHelper = stringSetting("apiKeyHelper");
  const proxyAuthHelper = stringSetting("proxyAuthHelper");
  const awsCredentialExport = stringSetting("awsCredentialExport");
  const awsAuthRefresh = stringSetting("awsAuthRefresh");
  const gcpAuthRefresh = stringSetting("gcpAuthRefresh");
  const forceLoginMethod = parsed.forceLoginMethod;
  const forceLoginOrgUUID = parsed.forceLoginOrgUUID;
  const env = isDynamicRecord(parsed.env)
    ? Object.fromEntries(Object.entries(parsed.env).filter((entry): entry is [string, string] => isString(entry[1])))
    : {};
  const settings: Settings = {
    ...(apiKeyHelper ? { apiKeyHelper } : {}),
    ...(proxyAuthHelper ? { proxyAuthHelper } : {}),
    ...(awsCredentialExport ? { awsCredentialExport } : {}),
    ...(awsAuthRefresh ? { awsAuthRefresh } : {}),
    ...(gcpAuthRefresh ? { gcpAuthRefresh } : {}),
    ...(isOneOf(["claudeai", "console", "gateway"] as const, forceLoginMethod) ? { forceLoginMethod } : {}),
    ...(isString(forceLoginOrgUUID) || (Array.isArray(forceLoginOrgUUID) && forceLoginOrgUUID.every(isString))
      ? { forceLoginOrgUUID }
      : {}),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
  return settings;
}

const CLAUDE_LISTED_MODELS = new Set<string>();

export class ClaudeAgentClient extends EventEmitter<ClientEvents> {
  readonly contextCompaction = "native";
  readonly compactsOnDemand = true;
  readonly #cacheTtls = new Map<string, number>();
  readonly turnContext = true;
  readonly userInputNote = true;
  readonly imageInput = (): boolean => true;
  readonly structuredOutput = true;
  #queryRestarts = 0;
  readonly provider: AgentProvider = "claude";
  readonly #cli: ClaudeCliInfo;
  readonly #sdkLaunch: ClaudeSdkLaunch;
  readonly #createQuery: QueryFactory;
  readonly #readSessionMessages: SessionHistoryReader | undefined;
  readonly #requestTimeoutMs: number;
  readonly #mcpServers: McpServerSource;
  readonly #reportMcpDrops: McpDropReporter | undefined;
  readonly #mcpToolRuntimes: McpToolRuntimeSource | undefined;
  readonly #mcpEndpoint: McpEndpointSource | undefined;
  readonly #stateDirectory: string | undefined;
  readonly #agentEnvironment: ((inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>) | undefined;
  readonly #fallbackApiKey: (() => string | null) | undefined;
  readonly #userSetup: () => boolean;
  #onApiKey = false;
  #cliApiKey = false;
  #accountRead = false;
  readonly readHistory: ReadProviderHistory;
  readonly #threads = new IdleThreadPool<ThreadRuntime, ThreadConfig>({
    scope: () => this.#scope,
    releaseAfterMs: CLAUDE_THREAD_IDLE_RELEASE_MS,
    idleLimit: CLAUDE_IDLE_THREAD_LIMIT,
    canRelease: (runtime) => runtime.config.persistSession && runtime.backgroundTasks === 0,
    snapshot: (runtime) => runtime.config,
    dispose: (runtime) => this.#closeRuntime(runtime),
    reopen: (threadId, config) => this.#startThread(threadId, config, true),
  });
  readonly #takenPrompts = new Map<string, Set<string>>();
  readonly #serverRequests = new PendingServerRequests((request) => this.emit("request", request));
  readonly #modelEffortCapabilities = new Map<string, ClaudeEffortCapability>();
  readonly #modelSdkValues = new Map<string, string>();
  readonly #turnContext = new TurnContext();
  readonly #threadResumes = new Map<string, Deferred.Deferred<void, ProviderClientOperationError>>();
  #running = false;
  #scope = Scope.makeUnsafe();
  #weeklyLimitKey = "seven_day";

  constructor(
    cli: ClaudeCliInfo,
    createQuery: QueryFactory = query,
    readSessionMessages?: SessionHistoryReader,
    requestTimeoutMs = 30_000,
    mcpServers: McpServerSource = () => [],
    reportMcpDrops?: McpDropReporter,
    mcpToolRuntimes?: McpToolRuntimeSource,
    mcpEndpoint?: McpEndpointSource,
    stateDirectory?: string,
    agentEnvironment?: (inherited?: NodeJS.ProcessEnv) => Readonly<Record<string, string>>,
    historyIndexDirectory?: string,
    fallbackApiKey?: () => string | null,
    userSetup: () => boolean = () => false,
  ) {
    super();
    this.#cli = cli;
    this.#sdkLaunch = claudeSdkLaunch(cli.executable);
    this.#createQuery = createQuery;
    this.#readSessionMessages = readSessionMessages;
    this.#requestTimeoutMs = requestTimeoutMs;
    this.#mcpServers = mcpServers;
    this.#reportMcpDrops = reportMcpDrops;
    this.#mcpToolRuntimes = mcpToolRuntimes;
    this.#mcpEndpoint = mcpEndpoint;
    this.#stateDirectory = stateDirectory;
    this.#agentEnvironment = agentEnvironment;
    this.#fallbackApiKey = fallbackApiKey;
    this.#userSetup = userSetup;
    const historyEnvironment = agentEnvironment?.();
    const resolvedHistoryIndexDirectory = historyIndexDirectory ?? stateDirectory;
    const historyOptions: ClaudeHistoryOptions = {
      ...(historyEnvironment?.CLAUDE_CONFIG_DIR === undefined
        ? {}
        : { configDirectory: historyEnvironment.CLAUDE_CONFIG_DIR }),
      ...(historyEnvironment?.CLAUDE_CODE_PROJECT_DIR_NAME === undefined
        ? {}
        : { projectDirectoryName: historyEnvironment.CLAUDE_CODE_PROJECT_DIR_NAME }),
      ...(resolvedHistoryIndexDirectory === undefined ? {} : { indexDirectory: resolvedHistoryIndexDirectory }),
    };
    this.readHistory = readSessionMessages
      ? claudeHistoryFromMessages(readSessionMessages)
      : claudeHistoryReader(historyOptions);
  }

  get running(): boolean {
    return this.#running;
  }

  start(): void {
    if (this.#running) return;
    if (this.#scope.state._tag === "Closed") this.#scope = Scope.makeUnsafe();
    this.#running = true;
  }

  readonly stop = Effect.fn("ClaudeAgentClient.stop")(function* (
    this: ClaudeAgentClient,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    this.#running = false;
    const runtimes = this.#threads.clear();
    for (const runtime of runtimes) {
      runtime.input.close();
      runtime.query.close();
    }
    yield* Effect.forEach(
      runtimes,
      (runtime) =>
        Effect.all([removeClaudeQueryFile(runtime.mcpConfigFile), removeClaudeQueryFile(runtime.settingsFile)]),
      { discard: true },
    );
    yield* Effect.forEach(
      runtimes,
      (runtime) => (runtime.consume ? Fiber.join(runtime.consume).pipe(Effect.ignore) : Effect.void),
      { concurrency: "unbounded", discard: true },
    );
    yield* Scope.close(this.#scope, Exit.void);
    this.#serverRequests.rejectAll("Claude session stopped.");
  });

  releaseIdleThreads(): Effect.Effect<void, ProviderClientOperationError> {
    return this.#threads.releaseIdle();
  }

  readonly releaseQuietBackgroundThreads = Effect.fn("ClaudeAgentClient.releaseQuietBackgroundThreads")(function* (
    this: ClaudeAgentClient,
    quietForMs = CLAUDE_BACKGROUND_QUIET_RELEASE_MS,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    const now = Date.now();
    const closed = yield* this.#threads.releaseWhere(
      (runtime) =>
        runtime.config.persistSession && runtime.backgroundTasks > 0 && now - runtime.lastOutputAt >= quietForMs,
    );
    for (const runtime of closed)
      queryLogger.warn("Closed a Claude thread with quiet background work, because memory is low.", {
        threadId: runtime.id,
        backgroundTasks: runtime.backgroundTasks,
        quietForMinutes: Math.floor((now - runtime.lastOutputAt) / 60_000),
      });
  });

  canReleaseProcess(): boolean {
    return !this.runsBackgroundWork();
  }

  runsBackgroundWork(): boolean {
    return [...this.#threads.ids()].some((id) => Boolean(this.#threads.get(id)?.backgroundTasks));
  }

  holdsBackgroundWork(threadId: string): Effect.Effect<boolean, ProviderClientOperationError> {
    return Effect.sync(() => {
      const thread = this.#threads.get(threadId);
      return thread !== undefined && (thread.backgroundTasks > 0 || thread.awaitsResultTurn);
    });
  }

  readonly #reportFailedMcpServers = Effect.fnUntraced(function* (
    this: ClaudeAgentClient,
    runtime: ThreadRuntime,
    message: ClaudeStreamMessage,
  ) {
    const failed = failedClaudeMcpServers(message.mcp_servers);
    if (failed.length === 0) return;
    const query = runtime.query;
    yield* Effect.forkIn(
      providerCall(() => query.mcpServerStatus?.() ?? null).pipe(
        Effect.timeout("2 seconds"),
        Effect.orElseSucceed(() => null),
        Effect.flatMap((rows) =>
          Effect.sync(() => {
            for (const name of failed) {
              const row = Array.isArray(rows) ? rows.find((item) => getString(item, "name") === name) : undefined;
              this.emit("notification", {
                method: "mcpServer/startupStatus/updated",
                params: { name, status: "failed", error: getString(row, "error") ?? "" },
              });
            }
          }),
        ),
      ),
      this.#scope,
    );
  });

  #emitBackgroundWork(runtime: ThreadRuntime, closed = false): void {
    this.emit("notification", {
      method: "openbot/background-work",
      params: { threadId: runtime.id, running: runtime.backgroundTasks > 0, ...(closed ? { closed } : {}) },
    });
  }

  wakesAfterBackgroundWork(threadId: string): Effect.Effect<boolean, ProviderClientOperationError> {
    return this.holdsBackgroundWork(threadId);
  }

  readonly releaseThread = Effect.fn("ClaudeAgentClient.releaseThread")(function* (
    this: ClaudeAgentClient,
    threadId: string,
    resumes = false,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    this.#threads.forget(threadId);
    if (!resumes) {
      this.#turnContext.forget(threadId);
      this.#takenPrompts.delete(threadId);
    }
    const runtime = this.#threads.get(threadId);
    if (!runtime) return;
    yield* this.#threads.close(runtime).pipe(toProviderClientOperationError);
  });

  readonly #closeRuntime = Effect.fn("ClaudeAgentClient.closeRuntime")(function* (
    this: ClaudeAgentClient,
    runtime: ThreadRuntime,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    const turn = runtime.activeTurn;
    runtime.input.close();
    runtime.query.close();
    yield* removeClaudeQueryFile(runtime.mcpConfigFile);
    yield* removeClaudeQueryFile(runtime.settingsFile);
    for (const change of stopSubagents(runtime.subagents, new Date().toISOString()))
      this.#emitSubagents(runtime, change);
    if (runtime.backgroundTasks > 0 || runtime.awaitsResultTurn) {
      runtime.backgroundTasks = 0;
      runtime.awaitsResultTurn = false;
      this.#emitBackgroundWork(runtime, true);
    }
    if (runtime.consume) yield* Fiber.await(runtime.consume);
    if (turn && runtime.activeTurn === turn) {
      for (const [toolCallId, { name }] of turn.toolCalls) this.#emitToolCall(runtime, toolCallId, name, true);
      turn.toolCalls.clear();
      if (turn.stalled)
        yield* this.#completeTurn(
          runtime,
          "failed",
          sourceText("error.agent.turnStalled", { provider: agentProviderName("claude") }),
        );
      else yield* this.#completeTurn(runtime, "interrupted", null);
    }
  });

  readonly #watchStall = Effect.fn("ClaudeAgentClient.watchStall")(function* (
    this: ClaudeAgentClient,
    runtime: ThreadRuntime,
  ) {
    while (this.#threads.get(runtime.id) === runtime) {
      const before = Date.now();
      yield* Effect.sleep(CLAUDE_STALL_CHECK_MS);
      const turn = runtime.activeTurn;
      if (!turn) continue;
      const asleep = Date.now() - before - CLAUDE_STALL_CHECK_MS;
      if (asleep > CLAUDE_STALL_CHECK_MS) turn.lastActivityAt = Math.min(Date.now(), turn.lastActivityAt + asleep);
      const silentFor = Date.now() - turn.lastActivityAt;
      const limit = turn.toolCalls.size > 0 || runtime.compacting ? CLAUDE_TOOL_STALL_MS : CLAUDE_TURN_STALL_MS;
      if (turn.hostRequests > 0 || turn.stopRequested || silentFor < limit || this.#threads.get(runtime.id) !== runtime)
        continue;
      queryLogger.warn("Closed a Claude query that sent nothing past the stall limit.", {
        threadId: runtime.id,
        silentForMinutes: Math.floor(silentFor / 60_000),
        openToolCalls: turn.toolCalls.size,
      });
      turn.stalled = true;
      yield* (runtime.config.persistSession ? this.#threads.releaseNow(runtime) : this.#threads.close(runtime)).pipe(
        Effect.ignore,
      );
      return;
    }
  });

  #awaitHost<A, E, R>(threadId: string, request: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const turn = this.#threads.get(threadId)?.activeTurn ?? null;
        if (turn) turn.hostRequests += 1;
        return turn;
      }),
      () => request,
      (turn) =>
        Effect.sync(() => {
          if (!turn) return;
          turn.hostRequests -= 1;
          turn.lastActivityAt = Date.now();
        }),
    );
  }

  #awaitPerson<A, E, R>(threadId: string, request: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> {
    return Effect.acquireUseRelease(
      Effect.sync(() => {
        const turn = this.#threads.get(threadId)?.activeTurn ?? null;
        if (turn) turn.personRequests += 1;
        return turn;
      }),
      () => this.#awaitHost(threadId, request),
      (turn) =>
        Effect.sync(() => {
          if (turn) turn.personRequests -= 1;
        }),
    );
  }

  readonly #closeIfStopIgnored = Effect.fn("ClaudeAgentClient.closeIfStopIgnored")(function* (
    this: ClaudeAgentClient,
    runtime: ThreadRuntime,
    turn: ActiveTurn,
  ) {
    yield* Effect.forkIn(
      Effect.sleep(CLAUDE_STOP_CONFIRM_MS).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (runtime.activeTurn !== turn || this.#threads.get(runtime.id) !== runtime) return Effect.void;
            queryLogger.warn("Closed a Claude query that did not end its turn after a stop.", {
              threadId: runtime.id,
              waitedMs: CLAUDE_STOP_CONFIRM_MS,
            });
            return runtime.config.persistSession ? this.#threads.releaseNow(runtime) : this.#threads.close(runtime);
          }),
        ),
        Effect.ignore,
      ),
      this.#scope,
    );
  });

  readonly request = Effect.fn("ClaudeAgentClient.request")(function* <T>(
    this: ClaudeAgentClient,
    method: string,
    params: unknown,
    decoder: ResponseDecoder<T>,
    timeoutMs?: number,
  ): Effect.fn.Return<T, ProviderClientOperationError> {
    if (!this.#running) return yield* providerFailure(new Error("Claude Agent SDK is not running."));

    switch (method) {
      case "initialize":
        return yield* providerSync(() => decoder({}));
      case "account/read": {
        const response = yield* this.#readAccountEffect(timeoutMs);
        return yield* providerSync(() => decoder(response));
      }
      case "account/rateLimits/read": {
        const response = yield* this.#readUsageEffect(getString(params, "model"), timeoutMs ?? this.#requestTimeoutMs);
        return yield* providerSync(() => decoder(response));
      }
      case "model/list": {
        const response = { data: yield* this.#listModelsEffect(timeoutMs) };
        return yield* providerSync(() => decoder(response));
      }
      case "plugin/list":
        return yield* providerSync(() => decoder({ marketplaces: [] }));
      case "thread/start": {
        const threadId = randomUUID();
        yield* this.#startThread(threadId, readThreadConfig(params), false);
        this.#turnContext.set(threadId, params, false);
        return yield* providerSync(() => decoder({ thread: { id: threadId } }));
      }
      case "thread/resume": {
        const threadId = yield* providerSync(() => requiredString(params, "threadId"));
        if (!isUuid(threadId)) return yield* providerFailure(new MissingClaudeSessionError(threadId));
        const config = readThreadConfig(params);
        this.#turnContext.set(threadId, params, true);
        const previous = this.#threadResumes.get(threadId);
        const completion = Deferred.makeUnsafe<void, ProviderClientOperationError>();
        this.#threadResumes.set(threadId, completion);
        yield* Effect.gen({ self: this }, function* () {
          if (previous) yield* Deferred.await(previous).pipe(Effect.ignore);
          const exit = yield* Effect.exit(this.#resumeThread(threadId, config));
          yield* Deferred.done(completion, exit);
          if (this.#threadResumes.get(threadId) === completion) this.#threadResumes.delete(threadId);
          yield* exit;
        }).pipe(Effect.uninterruptible);
        return yield* providerSync(() => decoder({ thread: { id: threadId } }));
      }
      case "thread/read": {
        const response = yield* this.#readThreadEffect(requiredString(params, "threadId"));
        return yield* providerSync(() => decoder(response));
      }
      case "turn/start": {
        const response = yield* this.#startTurnEffect(params);
        return yield* providerSync(() => decoder(response));
      }
      case "turn/steer": {
        const response = yield* this.#steerTurnEffect(params);
        return yield* providerSync(() => decoder(response));
      }
      case "turn/interrupt": {
        const threadId = yield* providerSync(() => requiredString(params, "threadId"));
        const turnId = getString(params, "turnId");
        const notRunning = turnId === null ? {} : { turnActive: false };
        if (this.#threads.isReleased(threadId)) return yield* providerSync(() => decoder(notRunning));
        const runtime = yield* providerSync(() => this.#requireThread(threadId));
        const turn = runtime.activeTurn;
        const stopped = turn && turn.id === turnId ? turn : null;
        if (stopped) {
          stopped.stopRequested = true;
          yield* this.#closeIfStopIgnored(runtime, stopped);
        }
        yield* providerCall(() => runtime.query.interrupt()).pipe(
          Effect.catch((failure) =>
            (stopped && (this.#threads.get(runtime.id) !== runtime || runtime.activeTurn !== stopped)) ||
            (!stopped && turnId !== null)
              ? Effect.void
              : Effect.fail(failure),
          ),
        );
        return yield* providerSync(() => decoder(stopped ? {} : notRunning));
      }
      case "thread/compact/start": {
        const threadId = yield* providerSync(() => requiredString(params, "threadId"));
        yield* this.#threads
          .startTurn(threadId, () => this.#openCompaction(threadId))
          .pipe(toProviderClientOperationError);
        return yield* providerSync(() => decoder({}));
      }
      default:
        return yield* providerFailure(new Error(`Claude adapter does not implement ${method}.`));
    }
  });

  promptCacheTtlMs(externalThreadId: string): number | null {
    return this.#cacheTtls.get(externalThreadId) ?? null;
  }

  notify(): void {}

  respond(id: RequestId, result: unknown): void {
    this.#serverRequests.resolve(id, result);
  }

  respondError(id: RequestId, error: RpcError): void {
    this.#serverRequests.reject(id, error);
  }

  #configDirectory(): string {
    return this.#agentEnvironment?.().CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude");
  }

  readonly #probeOptionsEffect = Effect.fn("ClaudeAgentClient.probeOptions")(function* (this: ClaudeAgentClient) {
    const userSetup = this.#userSetup();
    const signInSettings: Settings = userSetup
      ? {}
      : withoutReplacedGateway(
          claudeSignInSettings(yield* readClaudeSettingsFile(join(this.#configDirectory(), "settings.json"))),
          this.#agentEnvironment?.(),
        );
    const stateDirectory = this.#stateDirectory;
    const settingsFile =
      Object.keys(signInSettings).length > 0 && stateDirectory
        ? yield* Effect.acquireRelease(
            writeClaudeFlagSettings(stateDirectory, "probe", signInSettings).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  queryLogger.warn("Claude checks its models and usage without the sign-in settings.", {
                    error: error.cause,
                  });
                  return null;
                }),
              ),
            ),
            removeClaudeQueryFile,
          )
        : null;
    const options: Options = {
      cwd: process.cwd(),
      ...this.#sdkLaunch,
      settingSources: userSetup ? ["user", "project", "local"] : [],
      ...(settingsFile ? { settings: settingsFile } : {}),
      mcpServers: {},
      strictMcpConfig: true,
      persistSession: false,
      env: withClaudeClientLabels({ ...claudeEnvironment(this.#cli), ...this.#environment(this.#onApiKey) }),
    };
    return options;
  });

  readonly #listModelsEffect = Effect.fn("ClaudeAgentClient.listModels")(function* (
    this: ClaudeAgentClient,
    timeoutMs: number | undefined,
  ): Effect.fn.Return<unknown[], ProviderClientOperationError, Scope.Scope> {
    const options = yield* this.#probeOptionsEffect();
    const input = new AsyncMessageQueue();
    const claudeQuery = yield* providerSync(() =>
      this.#createQuery({
        prompt: input,
        options,
      }),
    );
    return yield* Effect.gen({ self: this }, function* () {
      const discovery = providerCall(() => claudeQuery.supportedModels());
      const discovered = yield* timeoutMs === undefined
        ? discovery
        : discovery.pipe(
            Effect.timeoutOrElse({
              duration: timeoutMs,
              orElse: () => Effect.fail(providerFailure(new RequestTimeoutError("Claude", "model/list"))),
            }),
          );
      const models = new Map<string, (typeof discovered)[number]>();
      for (const model of discovered) {
        const id = model.resolvedModel?.trim() || model.value.trim();
        if (!id || models.has(id)) continue;
        models.set(id, model);
      }
      const effortCapabilities = new Map<string, ClaudeEffortCapability>();
      const sdkValues = new Map<string, string>();
      const result = [...models.entries()].map(([id, model]) => {
        const discoveredReasoningEfforts = [
          ...new Set((model.supportedEffortLevels ?? []).filter((effort) => isOneOf(CLAUDE_EFFORTS, effort))),
        ];
        const supportedReasoningEfforts =
          discoveredReasoningEfforts.length > 0 ? discoveredReasoningEfforts : ["medium" as const];
        const defaultReasoningEffort = supportedReasoningEfforts.includes("high")
          ? "high"
          : (supportedReasoningEfforts[0] ?? "medium");
        effortCapabilities.set(
          id,
          model.supportsEffort === false
            ? null
            : { supported: supportedReasoningEfforts, defaultEffort: defaultReasoningEffort },
        );
        sdkValues.set(id, model.value.trim() === "default" ? id : model.value.trim() || id);
        return {
          model: id,
          displayName: model.displayName,
          defaultReasoningEffort,
          supportedReasoningEfforts: supportedReasoningEfforts.map((reasoningEffort) => ({ reasoningEffort })),
          ...(model.supportsFastMode ? { serviceTiers: [{ id: CLAUDE_FAST_SERVICE_TIER, name: "Fast" }] } : {}),
        };
      });
      this.#modelEffortCapabilities.clear();
      this.#modelSdkValues.clear();
      for (const [id, capability] of effortCapabilities) this.#modelEffortCapabilities.set(id, capability);
      for (const [id, value] of sdkValues) this.#modelSdkValues.set(id, value);
      for (const id of sdkValues.keys()) CLAUDE_LISTED_MODELS.add(id);
      return yield* providerSync(() => result);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          input.close();
          claudeQuery.close();
        }),
      ),
    );
  }, Effect.scoped);

  readonly #readUsageEffect = Effect.fn("ClaudeAgentClient.readUsage")(function* (
    this: ClaudeAgentClient,
    model: string | null,
    timeoutMs: number,
  ): Effect.fn.Return<AccountRateLimitsReadResult, ProviderClientOperationError, Scope.Scope> {
    const options = yield* this.#probeOptionsEffect();
    const input = new AsyncMessageQueue();
    const claudeQuery = yield* providerSync(() =>
      this.#createQuery({
        prompt: input,
        options,
      }),
    );
    return yield* Effect.gen({ self: this }, function* () {
      const readUsage = claudeQuery.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (!readUsage) return { rateLimits: null, rateLimitsByLimitId: null };
      const usage = yield* providerCall(() => readUsage.call(claudeQuery, { skipBehaviors: true })).pipe(
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () => Effect.fail(providerFailure(new RequestTimeoutError("Claude", "account/rateLimits/read"))),
        }),
      );
      if (isDynamicRecord(usage) && usage.rate_limits_available === true && !isDynamicRecord(usage.rate_limits))
        return yield* providerFailure(new Error("Claude could not read the plan usage."));
      if (model === defaultProviderModel("claude") && isDynamicRecord(usage) && isDynamicRecord(usage.rate_limits))
        this.#weeklyLimitKey = claudeWeeklyKey(usage.rate_limits, model);
      return yield* providerSync(() => claudeRateLimits(usage, model));
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          input.close();
          claudeQuery.close();
        }),
      ),
    );
  }, Effect.scoped);

  readonly #readAccountEffect = Effect.fn("ClaudeAgentClient.readAccount")(function* (
    this: ClaudeAgentClient,
    requestTimeoutMs = 0,
  ): Effect.fn.Return<AccountReadResult, ProviderClientOperationError> {
    const timeoutMs = Math.max(requestTimeoutMs, AUTH_STATUS_TIMEOUT_MS);
    let status = yield* this.#readAuthStatusEffect(false, timeoutMs);
    const onApiKey = status.loggedIn !== true && Boolean(this.#fallbackApiKey?.());
    if (onApiKey) status = yield* this.#readAuthStatusEffect(true, timeoutMs);
    this.#onApiKey = onApiKey && status.loggedIn === true;
    this.#accountRead = true;
    this.#cliApiKey = status.loggedIn === true && !this.#onApiKey && (yield* this.#billsOwnApiKey(status));
    if (status.loggedIn !== true) return { account: null, requiresOpenaiAuth: false };
    return {
      account: {
        type: this.#onApiKey
          ? CLAUDE_API_KEY_ACCOUNT_TYPE
          : this.#cliApiKey
            ? CLAUDE_CLI_API_KEY_ACCOUNT_TYPE
            : "claude",
        email: isString(status.email) ? status.email : null,
        planType: isString(status.subscriptionType) ? status.subscriptionType : null,
        organization: isString(status.orgId) ? status.orgId : null,
      },
      requiresOpenaiAuth: false,
    };
  });

  readonly #billsOwnApiKey = Effect.fn("ClaudeAgentClient.billsOwnApiKey")(function* (
    this: ClaudeAgentClient,
    status: DynamicRecord,
  ) {
    if (status.apiKeySource !== "ANTHROPIC_API_KEY" && status.apiKeySource !== "apiKeyHelper") return false;
    if (status.apiProvider !== undefined && status.apiProvider !== "firstParty") return false;
    if (status.authMethod !== "api_key" && status.authMethod !== "api_key_helper") return false;
    const environment = { ...claudeEnvironment(this.#cli), ...this.#environment(false) };
    if (this.#environment(false).ANTHROPIC_API_KEY || environment.ANTHROPIC_BASE_URL) return false;
    const settings = yield* readClaudeSettingsFile(
      join(environment.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), "settings.json"),
    );
    return !(isDynamicRecord(settings.env) && settings.env.ANTHROPIC_BASE_URL);
  });

  #decideApiKey(): void {
    if (this.#accountRead || !this.#fallbackApiKey?.()) return;
    const last = lastAuthStatuses.get(this.#environment(false).CLAUDE_CONFIG_DIR ?? "");
    if (last) this.#onApiKey = last.loggedIn !== true;
  }

  readonly #readAuthStatusEffect = Effect.fn("ClaudeAgentClient.readAuthStatus")(function* (
    this: ClaudeAgentClient,
    withApiKey: boolean,
    timeoutMs: number,
  ): Effect.fn.Return<DynamicRecord, ProviderClientOperationError> {
    if (!withApiKey) {
      const stored = yield* readClaudeStoredSignIn({ ...claudeEnvironment(this.#cli), ...this.#environment(false) });
      if (Option.isSome(stored)) {
        lastAuthStatuses.set(this.#environment(false).CLAUDE_CONFIG_DIR ?? "", stored.value);
        return stored.value;
      }
    }
    let stdout: unknown;
    let failure: unknown = null;
    const target = cliSpawnTarget(this.#cli.executable, ["auth", "status", "--json"]);
    try {
      ({ stdout } = providerResult(
        yield* Effect.result(
          providerCall(() =>
            execFileAsync(target.command, target.args, {
              timeout: timeoutMs,
              maxBuffer: 64 * 1024,
              windowsVerbatimArguments: target.windowsVerbatimArguments,
              env: { ...claudeEnvironment(this.#cli), ...this.#environment(withApiKey) },
            }),
          ),
        ),
      ));
    } catch (error) {
      failure = error;
      stdout = isRecord(error) ? error.stdout : undefined;
    }
    const status = parseAuthStatus(stdout);
    if (status && (failure === null || status.loggedIn === false)) {
      if (!withApiKey) lastAuthStatuses.set(this.#environment(false).CLAUDE_CONFIG_DIR ?? "", status);
      return yield* providerSync(() => status);
    }
    if (isDynamicRecord(failure) && failure.killed === true)
      return yield* providerFailure(new RequestTimeoutError("Claude", "account/read"));
    if (failure !== null) return yield* providerFailure(failure);
    queryLogger.warn("Claude exited signed in with an unreadable sign-in status.", {
      outputLength: isString(stdout) ? stdout.length : null,
    });
    const last = withApiKey ? null : lastAuthStatuses.get(this.#environment(false).CLAUDE_CONFIG_DIR ?? "");
    return yield* providerSync(() => (last?.loggedIn === true ? last : { loggedIn: true }));
  });

  #usesApiKey(): boolean {
    return (
      this.#cliApiKey ||
      Boolean({ ...claudeEnvironment(this.#cli), ...this.#environment(this.#onApiKey) }.ANTHROPIC_API_KEY)
    );
  }

  #onClaudeAccount(): boolean {
    const last = lastAuthStatuses.get(this.#environment(false).CLAUDE_CONFIG_DIR ?? "");
    return last?.loggedIn === true && last.authMethod === "claude.ai";
  }

  #environment(withApiKey: boolean): Readonly<Record<string, string>> {
    const key = withApiKey ? this.#fallbackApiKey?.() : null;
    return { ...this.#agentEnvironment?.(), ...(key ? { ANTHROPIC_API_KEY: key } : {}) };
  }

  readonly #resumeThread = Effect.fn("ClaudeAgentClient.resumeThread")(function* (
    this: ClaudeAgentClient,
    threadId: string,
    config: ThreadConfig,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    for (;;) {
      yield* this.#threads.opened(threadId);
      const current = this.#threads.get(threadId);
      if (current && threadConfigKey(current.config, true) === threadConfigKey(config, true)) return;
      if (current) {
        if (current.activeTurn) return yield* providerFailure(new Error(sourceText("error.provider.claudeTurnActive")));
        if (threadConfigKey(current.config, false) === threadConfigKey(config, false)) return;
        queryLogger.info("Restarting a Claude query.", {
          reason: "configuration-change",
          count: ++this.#queryRestarts,
        });
        yield* this.#threads.close(current).pipe(toProviderClientOperationError);
        continue;
      }
      if (
        yield* this.#threads
          .opening(threadId, () => this.#startThread(threadId, config, true))
          .pipe(toProviderClientOperationError)
      )
        return;
    }
  });

  readonly #startThread = Effect.fn("ClaudeAgentClient.startThread")(function* (
    this: ClaudeAgentClient,
    threadId: string,
    config: ThreadConfig,
    resume: boolean,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    this.#decideApiKey();
    const input = new AsyncMessageQueue();
    const appliedEffort = this.#resolveEffort(config.model, config.effort);
    const canUseTool: CanUseTool = (toolName, toolInput, options) =>
      runCauseEffect(
        Effect.gen({ self: this }, function* () {
          if (config.profileGeneration) return { behavior: "deny", message: "Profile generation has no tools." };
          if (config.workspaceOnly) {
            const excluded = yield* claudeWriteInExcluded(toolName, toolInput, config.cwd, config.excludedFolders);
            if (excluded) return { behavior: "deny", message: claudeExcludedWriteMessage(excluded) };
            const outside = yield* claudeWriteOutsideRoots(
              toolName,
              toolInput,
              config.cwd,
              config.additionalDirectories,
            );
            if (outside)
              return yield* this.#requestWriteApprovalEffect(
                threadId,
                outside,
                toolInput,
                options.toolUseID ?? randomUUID(),
              );
          }
          if (toolName !== "AskUserQuestion") {
            return yield* providerCall(
              () => ({ behavior: "allow", updatedInput: toolInput }) satisfies PermissionResult,
            );
          }
          return yield* this.#requestUserInputEffect(threadId, toolInput, options.toolUseID ?? randomUUID());
        }),
      );
    const onElicitation: OnElicitation = (request, { signal }) =>
      runCauseEffect(this.#requestElicitationEffect(threadId, request, signal));
    const usable = config.profileGeneration
      ? null
      : yield* usableMcpServers(
          agentMcpServers(this.#mcpServers(config.agentId), config.computerUse),
          this.#mcpToolRuntimes?.(),
          this.#mcpEndpoint,
          config.agentId,
        ).pipe(toProviderClientOperationError);
    const handoff = usable ? claudeMcpServers(usable, CLAUDE_MCP_USER_AGENT) : null;
    const stateDirectory = this.#stateDirectory;
    const userSetup = !config.profileGeneration && this.#userSetup();
    const skillPlugin =
      config.workspaceOnly && stateDirectory ? yield* claudeWorkspaceSkillPlugin(stateDirectory, config.cwd) : null;
    const configDirectory = this.#configDirectory();
    yield* clearClaudeNeedsAuthMarks(
      configDirectory,
      usable?.flatMap((server) => (server.url ? [server.config.name] : [])) ?? [],
    );
    const userSettingsFile = yield* readClaudeSettingsFile(join(configDirectory, "settings.json"));
    const signInSettings: Settings = userSetup
      ? {}
      : withoutReplacedGateway(claudeSignInSettings(userSettingsFile), this.#agentEnvironment?.());
    const homeSkillPlugin =
      stateDirectory && userSetup
        ? yield* claudeHomeSkillPlugin(stateDirectory, configDirectory, config.cwd).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                queryLogger.warn("Claude starts without the skills in ~/.agents/skills.", { error: error.cause });
                return null;
              }),
            ),
          )
        : null;
    const plugins = [skillPlugin, homeSkillPlugin].filter((plugin) => plugin !== null);
    const launchPath = yield* cliLaunchPath(this.#cli.executable, this.#cli.source);
    const openBotServers = handoff ? this.#createOpenBotServers(threadId, config.channelTools) : {};
    const nodeOptions = this.#agentEnvironment?.().NODE_OPTIONS;
    const mcpConfigFile =
      handoff && stateDirectory && Object.keys(handoff.servers).length > 0
        ? yield* writeClaudeMcpConfig(stateDirectory, threadId, handoff.servers).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                queryLogger.warn("Claude gets its MCP servers on the command line.", { error: error.cause });
                return null;
              }),
            ),
          )
        : null;
    const nodeOptionsSettings: Settings = nodeOptions ? { env: { NODE_OPTIONS: nodeOptions } } : {};
    const settingSources = claudeSettingSources(config, userSetup);
    const cliEnvironment: NodeJS.ProcessEnv = {
      ...claudeEnvironment(this.#cli),
      ...(launchPath ? { PATH: launchPath } : {}),
      ...this.#environment(this.#onApiKey),
    };
    const { settings: openBotSettings, firstPartyApi } = config.profileGeneration
      ? {
          settings: {},
          firstPartyApi: CLAUDE_OTHER_API_VARIABLES.every(
            (name) => !(signInSettings.env?.[name] ?? cliEnvironment[name]),
          ),
        }
      : yield* claudeFlagSettings(
          userSettingsFile,
          configDirectory,
          config.cwd,
          settingSources,
          cliEnvironment,
          config.excludedInstructionFiles,
        );
    const flagSettings: Settings = {
      ...openBotSettings,
      ...nodeOptionsSettings,
      ...(openBotSettings.env || nodeOptionsSettings.env
        ? { env: { ...openBotSettings.env, ...nodeOptionsSettings.env } }
        : {}),
    };
    const sandbox = config.workspaceOnly
      ? claudeWorkspaceSandbox(config.additionalDirectories, config.excludedFolders)
      : null;
    const settingsFile =
      Object.keys(signInSettings).length > 0
        ? stateDirectory
          ? yield* writeClaudeFlagSettings(stateDirectory, threadId, {
              ...signInSettings,
              ...openBotSettings,
              env: { ...signInSettings.env, ...openBotSettings.env, ...nodeOptionsSettings.env },
              ...(sandbox ? { sandbox } : {}),
            }).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  queryLogger.warn("Claude starts without the sign-in settings of its settings file.", {
                    error: error.cause,
                  });
                  return null;
                }),
              ),
            )
          : null
        : null;
    const removeQueryFiles = Effect.all([removeClaudeQueryFile(mcpConfigFile), removeClaudeQueryFile(settingsFile)]);
    if (!this.#running) {
      yield* removeQueryFiles;
      return yield* providerFailure(new Error("Claude Agent SDK is not running."));
    }
    if (handoff) this.#reportMcpDrops?.(this.provider, handoff.dropped);
    const mcpServers = handoff ? { ...(mcpConfigFile ? {} : handoff.servers), ...openBotServers } : {};
    const extraArgs: Record<string, string | null> = {
      ...(claudeTakesPromptSnapshotFlag(this.#cli.version) ? { "system-prompt-snapshot": "off" } : {}),
      ...(mcpConfigFile ? { "mcp-config": mcpConfigFile } : {}),
    };
    const stderr = new ClaudeStderrTail();
    const claudeQuery = yield* providerSync(() =>
      this.#createQuery({
        prompt: input,
        options: {
          cwd: config.cwd,
          ...this.#sdkLaunch,
          ...(this.#sdkLaunch.spawnClaudeCodeProcess || !PROVIDER_PROCESS_GROUP
            ? {}
            : { spawnClaudeCodeProcess: (options: SpawnOptions) => spawnClaudeProcessGroup(options, stderr) }),
          ...(config.model ? { model: this.#sdkModel(config.model) } : {}),
          ...(appliedEffort ? { effort: appliedEffort } : {}),
          ...(resume ? { resume: threadId } : { sessionId: threadId, title: CLAUDE_SESSION_TITLE }),
          systemPrompt: config.profileGeneration
            ? config.developerInstructions
            : { type: "preset", preset: "claude_code", append: config.developerInstructions },
          ...(Object.keys(extraArgs).length ? { extraArgs } : {}),
          ...(config.outputSchema ? { outputFormat: { type: "json_schema", schema: config.outputSchema } } : {}),
          ...(config.profileGeneration
            ? { tools: [] }
            : { disallowedTools: [...CLAUDE_NATIVE_SCHEDULING, ...CLAUDE_DUPLICATE_TOOLS, ...CLAUDE_HOST_TOOLS] }),
          settingSources,
          strictMcpConfig: true,
          permissionMode: "default",
          includePartialMessages: true,
          persistSession: config.persistSession,
          additionalDirectories: config.additionalDirectories,
          canUseTool,
          onElicitation,
          ...(settingsFile
            ? { settings: settingsFile }
            : Object.keys(flagSettings).length > 0
              ? { settings: flagSettings }
              : {}),
          ...(sandbox && !settingsFile ? { sandbox } : {}),
          ...(config.workspaceOnly
            ? {
                hooks: claudeWorkspaceHooks(config.cwd, config.additionalDirectories, config.excludedFolders),
                managedSettings: CLAUDE_WORKSPACE_MANAGED_SETTINGS,
              }
            : {}),
          ...(plugins.length ? { plugins } : {}),
          mcpServers,
          env: {
            ...withClaudeClientLabels(cliEnvironment),
            ...(handoff ? claudeMcpStartupEnvironment(cliEnvironment) : {}),
            ...(resume && cliEnvironment.MCP_CONNECTION_NONBLOCKING === undefined
              ? { MCP_CONNECTION_NONBLOCKING: "0" }
              : {}),
            CLAUDE_CODE_ENABLE_TODO_TOOLS: "1",
            CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
            ...(handoff ? { CLAUDE_CODE_TERMINAL_MCP_TOOLS: claudeTerminalTools(config.channelTools).join(",") } : {}),
          },
        },
      }),
    ).pipe(Effect.onError(() => removeQueryFiles));
    const runtime: ThreadRuntime = {
      id: threadId,
      firstPartyApi,
      usageCounterId: randomUUID(),
      usageCost: 0,
      resumedUsage: resume,
      requestUsage: new Map(),
      contextRequest: 0,
      compacting: false,
      config,
      appliedEffort,
      appliedFastMode: undefined,
      fastModeDisabledReason: null,
      input,
      query: claudeQuery,
      activeTurn: null,
      consume: null,
      idleRelease: null,
      idleSince: 0,
      plan: newClaudePlanState(),
      subagents: newSubagentState(),
      backgroundTasks: 0,
      awaitsResultTurn: false,
      taskTurns: new Map(),
      endedTaskTurns: [],
      subagentLimit: null,
      lastOutputAt: Date.now(),
      answered: false,
      promptIds: (resume && this.#takenPrompts.get(threadId)) || new Set<string>(),
      nextTurnId: null,
      streamMessage: { id: null, thinkingBlocks: new Map<number, string>() },
      mcpConfigFile,
      settingsFile,
      stderr,
    };
    runtime.consume = yield* Effect.forkIn(this.#consume(runtime), this.#scope, { startImmediately: true });
    const initialization = mcpConfigFile ? claudeQuery.initializationResult?.() : undefined;
    if (initialization)
      yield* Effect.forkIn(
        providerCall(() => initialization).pipe(Effect.ignore, Effect.andThen(removeClaudeQueryFile(mcpConfigFile))),
        this.#scope,
      );
    this.#threads.add(runtime);
    if (config.persistSession) this.#takenPrompts.set(threadId, runtime.promptIds);
    yield* Effect.forkIn(this.#watchStall(runtime), this.#scope);
  });

  readonly #startTurnEffect = Effect.fn("ClaudeAgentClient.startTurn")(function* (
    this: ClaudeAgentClient,
    params: unknown,
  ): Effect.fn.Return<TurnResponse, ProviderClientOperationError> {
    const threadId = yield* providerSync(() => requiredString(params, "threadId"));
    return yield* this.#threads
      .startTurn(threadId, () => this.#openTurn(threadId, params))
      .pipe(toProviderClientOperationError);
  });

  readonly #applyFastMode = Effect.fn("ClaudeAgentClient.applyFastMode")(function* (
    runtime: ThreadRuntime,
    params: unknown,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    if (!isRecord(params) || !("serviceTier" in params)) return;
    const fastMode = params.serviceTier === CLAUDE_FAST_SERVICE_TIER;
    if (fastMode === runtime.appliedFastMode) return;
    yield* providerCall(() => runtime.query.applyFlagSettings({ fastMode }));
    runtime.appliedFastMode = fastMode;
  });

  readonly #openTurn = Effect.fn("ClaudeAgentClient.openTurn")(function* (
    this: ClaudeAgentClient,
    threadId: string,
    params: unknown,
  ): Effect.fn.Return<TurnResponse, ProviderClientOperationError> {
    yield* this.#threads.wake(threadId).pipe(toProviderClientOperationError);
    const runtime = yield* providerSync(() => this.#requireThread(threadId));
    if (runtime.activeTurn) return yield* providerFailure(this.#turnActiveError(runtime.activeTurn));
    runtime.contextRequest += 1;

    const requestedModel = getString(params, "model");
    const modelChanged = Boolean(requestedModel && requestedModel !== runtime.config.model);
    if (requestedModel && modelChanged) {
      yield* providerCall(() => runtime.query.setModel(this.#sdkModel(requestedModel)));
      runtime.config.model = requestedModel;
    }
    const requestedEffort = getString(params, "effort");
    const selectedEffort = requestedEffort ?? runtime.config.effort;
    const appliedEffort = this.#resolveEffort(runtime.config.model, selectedEffort);
    if (!appliedEffort) {
      if (runtime.appliedEffort !== undefined)
        yield* providerCall(() => runtime.query.applyFlagSettings({ effortLevel: null }));
      runtime.appliedEffort = undefined;
    } else if (modelChanged || appliedEffort !== runtime.appliedEffort) {
      yield* providerCall(() => runtime.query.applyFlagSettings({ effortLevel: appliedEffort }));
      runtime.appliedEffort = appliedEffort;
    }
    if (requestedEffort) runtime.config.effort = requestedEffort;
    yield* this.#applyFastMode(runtime, params);

    const clientId = getString(params, "clientUserMessageId");
    const requestedTurnId = getString(params, "clientTurnId") ?? clientId;
    const turnId = promptUuid(runtime, requestedTurnId);
    const text = readInputText(params);
    const images = runtime.config.profileGeneration ? yield* readInputImages(params) : [];
    if (runtime.activeTurn) return yield* providerFailure(this.#turnActiveError(runtime.activeTurn));
    const turn = this.#beginTurn(runtime, turnId, false);
    const context = this.#turnContext.take(threadId, text.startsWith("/"));
    takePrompt(runtime, turnId);
    const message: SDKUserMessage = {
      type: "user",
      message: {
        role: "user",
        content:
          context.length > 0 || images.length > 0
            ? [...context.map((block) => ({ type: "text" as const, text: block })), { type: "text", text }, ...images]
            : text,
      },
      parent_tool_use_id: null,
      uuid: turnId,
      session_id: threadId,
    };
    turn.prompt = { requestedId: requestedTurnId ?? null, message, retries: 0 };
    turn.messageIds.add(turnId);
    runtime.input.push(message);
    return { turn: { id: turnId, status: "inProgress" } };
  });

  readonly #openCompaction = Effect.fn("ClaudeAgentClient.openCompaction")(function* (
    this: ClaudeAgentClient,
    threadId: string,
  ): Effect.fn.Return<TurnResponse, ProviderClientOperationError> {
    yield* this.#threads.wake(threadId).pipe(toProviderClientOperationError);
    const runtime = yield* providerSync(() => this.#requireThread(threadId));
    if (runtime.activeTurn) return yield* providerFailure(this.#turnActiveError(runtime.activeTurn));
    runtime.contextRequest += 1;
    const turnId = randomUUID();
    const turn = this.#beginTurn(runtime, turnId, false);
    takePrompt(runtime, turnId);
    turn.messageIds.add(turnId);
    runtime.input.push({
      type: "user",
      message: { role: "user", content: CLAUDE_COMPACT_COMMAND },
      parent_tool_use_id: null,
      uuid: turnId,
      session_id: threadId,
    });
    return { turn: { id: turnId, status: "inProgress" } };
  });

  #turnActiveError(turn: ActiveTurn): Error {
    return turn.unprompted
      ? new ProviderTurnActiveError("Claude")
      : new Error("The Claude thread already has an active turn.");
  }

  #beginTurn(runtime: ThreadRuntime, turnId: string, unprompted: boolean): ActiveTurn {
    const turn: ActiveTurn = {
      id: turnId,
      itemId: `${turnId}:assistant`,
      reasoningItemId: `${turnId}:reasoning`,
      text: "",
      seenText: "",
      publishedText: "",
      lastNarration: null,
      narrationCount: 0,
      stopHookBlocked: false,
      thinking: "",
      thinkingStarted: false,
      thinkingBlocks: new Map<string, string>(),
      thinkingTail: null,
      thinkingSnapshotCounts: new Map<string, number>(),
      thinkingSnapshots: new Set<string>(),
      assistantMessages: new Map<string, string>(),
      toolCalls: new Map<string, { name: string; input: Record<string, string> }>(),
      usageLimit: null,
      ranTools: false,
      authenticationFailed: false,
      balanceSpent: false,
      billingFailed: false,
      retrying: false,
      sandboxBlockedWarned: false,
      unprompted,
      prompt: null,
      messageIds: new Set<string>(),
      untakenSteerIds: new Set<string>(),
      hostToolCalls: new Set<AbortController>(),
      promptStarted: false,
      lastActivityAt: Date.now(),
      stalled: false,
      hostRequests: 0,
      personRequests: 0,
      stopRequested: false,
    };
    const continues =
      unprompted && !runtime.endedTaskTurns.includes(null) ? runtime.endedTaskTurns.filter(isString) : [];
    runtime.endedTaskTurns = [];
    if (!unprompted) runtime.subagentLimit = null;
    runtime.activeTurn = turn;
    runtime.nextTurnId = null;
    runtime.awaitsResultTurn = false;
    startClaudePlanTurn(runtime.plan);
    this.#threads.holdForTurn(runtime);
    this.emit("notification", {
      method: "turn/started",
      params: {
        threadId: runtime.id,
        turn: { id: turnId, status: "inProgress" },
        ...(unprompted ? { unprompted } : {}),
        ...(continues.length > 0 ? { continues } : {}),
      },
    });
    return turn;
  }

  #noteEndedTask(runtime: ThreadRuntime, message: ClaudeStreamMessage, taskId: string, origin: string | null): void {
    const turn = runtime.activeTurn;
    if (!turn) {
      runtime.endedTaskTurns.push(origin);
      if (isString(message.run_id))
        runtime.nextTurnId = claudeTaskTurnId(
          isString(message.session_id) ? message.session_id : runtime.id,
          taskId,
          message.run_id,
        );
    } else if (turn.unprompted && origin !== turn.id)
      this.emit("notification", {
        method: "openbot/turn-continues",
        params: { threadId: runtime.id, turnId: turn.id, continues: origin },
      });
  }

  #holdSubagentLimit(runtime: ThreadRuntime, message: ClaudeStreamMessage): void {
    const text = messageText(message.message);
    const refusal = claudeUsageLimitRefusal(message);
    if (isSpentBalanceDiagnostic(text) || (!refusal && !isPlanLimitDiagnostic(text))) return;
    if (runtime.activeTurn && !runtime.activeTurn.unprompted) return;
    runtime.subagentLimit = {
      resetsAt: refusal?.resetsAt ?? null,
      text: text || sourceText("error.provider.usageLimitReached"),
    };
  }

  #outputTurn(runtime: ThreadRuntime): ActiveTurn {
    return runtime.activeTurn ?? this.#beginTurn(runtime, runtime.nextTurnId ?? randomUUID(), true);
  }

  readonly #steerTurnEffect = Effect.fn("ClaudeAgentClient.steerTurn")(function* (
    this: ClaudeAgentClient,
    params: unknown,
  ): Effect.fn.Return<{ turnId: string }, ProviderClientOperationError> {
    const threadId = yield* providerSync(() => requiredString(params, "threadId"));
    const runtime = yield* providerSync(() => this.#requireThread(threadId));
    const expectedTurnId = yield* providerSync(() => requiredString(params, "expectedTurnId"));
    if (!runtime.activeTurn || runtime.activeTurn.id !== expectedTurnId) {
      return yield* providerFailure(new Error("The active Claude turn changed before steering was accepted."));
    }
    const clientId = getString(params, "clientUserMessageId");
    const messageId = promptUuid(runtime, clientId);
    takePrompt(runtime, messageId);
    runtime.activeTurn.messageIds.add(messageId);
    const stopsRunningTools = runtime.activeTurn.toolCalls.size > 0 && runtime.activeTurn.personRequests === 0;
    if (stopsRunningTools) runtime.activeTurn.untakenSteerIds.add(messageId);
    runtime.input.push({
      type: "user",
      message: { role: "user", content: readInputText(params) },
      parent_tool_use_id: null,
      uuid: messageId,
      session_id: threadId,
      ...(stopsRunningTools ? { priority: "now" as const } : {}),
    });
    return { turnId: runtime.activeTurn.id };
  });

  readonly #promptLifecycle = Effect.fn("ClaudeAgentClient.promptLifecycle")(function* (
    this: ClaudeAgentClient,
    runtime: ThreadRuntime,
    uuid: unknown,
    state: unknown,
  ) {
    const turn = runtime.activeTurn;
    const prompt = turn?.prompt;
    if (!turn || !prompt || uuid !== prompt.message.uuid) return;
    if (state === "started") turn.promptStarted = true;
    if (state !== "completed" || turn.promptStarted) return;
    if (prompt.retries >= SKIPPED_PROMPT_RETRIES) {
      queryLogger.warn("Claude skipped a message with each new id.", { threadId: runtime.id, retries: prompt.retries });
      yield* this.#completeTurn(runtime, "failed", sourceText("error.provider.acpNoAnswer", { provider: "Claude" }));
      return;
    }
    const retryId = promptUuid(runtime, prompt.requestedId ?? turn.id);
    takePrompt(runtime, retryId);
    prompt.message = { ...prompt.message, uuid: retryId };
    turn.messageIds.add(retryId);
    prompt.retries += 1;
    queryLogger.warn("Claude skipped a message that its session holds, so it goes again with a new id.", {
      threadId: runtime.id,
      retries: prompt.retries,
    });
    try {
      runtime.input.push(prompt.message);
    } catch {}
  });

  readonly #consume = Effect.fn("ClaudeAgentClient.consume")(function* (
    this: ClaudeAgentClient,
    runtime: ThreadRuntime,
  ): Effect.fn.Return<void, ProviderClientOperationError> {
    try {
      let complete = false;
      providerResult(
        yield* Effect.result(
          Effect.acquireUseRelease(
            providerSync(() => runtime.query[Symbol.asyncIterator]()),
            (iterator) =>
              Effect.gen({ self: this }, function* () {
                for (;;) {
                  const next = yield* providerCall(() => iterator.next());
                  if (next.done) {
                    complete = true;
                    break;
                  }
                  yield* this.#handleMessage(runtime, next.value);
                }
              }),
            (iterator) => (complete ? Effect.void : providerCall(() => iterator.return?.()).pipe(Effect.asVoid)),
          ),
        ),
      );
      if (this.#running && this.#threads.get(runtime.id) === runtime) {
        this.#fail(new Error("Claude session stream ended unexpectedly."));
      }
    } catch (caught) {
      if (!this.#running || this.#threads.get(runtime.id) !== runtime) return;
      yield* this.#endFailedQuery(runtime, runtime.stderr.addTo(caught));
    }
  });

  readonly #endFailedQuery = Effect.fn("ClaudeAgentClient.endFailedQuery")(function* (
    this: ClaudeAgentClient,
    runtime: ThreadRuntime,
    error: unknown,
  ) {
    const noSandbox = CLAUDE_SANDBOX_UNAVAILABLE.test(String(error));
    if (!noSandbox && !runtime.answered) {
      if (runtime.activeTurn) yield* this.#completeTurn(runtime, "failed", error);
      this.#fail(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    queryLogger.warn(
      noSandbox ? "Claude cannot start its sandbox for a Workspace only thread." : "A Claude query failed.",
      { threadId: runtime.id, error: redactText(String(error)) },
    );
    yield* runtime.config.persistSession
      ? this.#threads.releaseNow(runtime)
      : Effect.forkIn(this.#threads.close(runtime), this.#scope, { startImmediately: true });
    const turn = runtime.activeTurn;
    if (!turn) return;
    for (const [toolCallId, { name }] of turn.toolCalls) this.#emitToolCall(runtime, toolCallId, name, true);
    turn.toolCalls.clear();
    yield* this.#completeTurn(runtime, "failed", error);
  });

  #emitTurnProgress(runtime: ThreadRuntime, turn: ActiveTurn, detail: string): void {
    this.emit("notification", {
      method: "openbot/turn-progress",
      params: { threadId: runtime.id, turnId: turn.id, detail },
    });
  }

  #fail(error: Error): void {
    if (!this.#running) return;
    this.#running = false;
    this.emit("exit", error);
  }

  readonly #handleMessage = Effect.fn("ClaudeAgentClient.handleMessage")(function* (
    this: ClaudeAgentClient,
    runtime: ThreadRuntime,
    message: ClaudeStreamMessage,
  ) {
    runtime.lastOutputAt = Date.now();
    if (runtime.activeTurn) runtime.activeTurn.lastActivityAt = runtime.lastOutputAt;
    runtime.answered = true;
    if (message.type === "command_lifecycle") {
      yield* this.#promptLifecycle(runtime, message.command_uuid, message.state);
      return;
    }
    if (
      runtime.activeTurn &&
      message.parent_tool_use_id === null &&
      (message.type === "stream_event" || message.type === "assistant")
    )
      runtime.activeTurn.promptStarted = true;
    if (message.type === "assistant") {
      const id = getString(message.message, "id");
      const model = getString(message.message, "model");
      if (runtime.resumedUsage && id && model && isRecord(message.message))
        runtime.requestUsage.set(id, { model, usage: message.message.usage });
      const cacheTtl = message.parent_tool_use_id ? null : claudeCacheWriteTtlMs(message.message);
      if (cacheTtl !== null) this.#cacheTtls.set(runtime.id, cacheTtl);
    }
    if (message.type === "system" && message.subtype === "init") yield* this.#reportFailedMcpServers(runtime, message);
    if (message.type === "system" && message.subtype === "status") {
      const status =
        message.status === "compacting"
          ? "running"
          : message.compact_result === "success"
            ? "completed"
            : message.compact_result === "failed"
              ? "failed"
              : null;
      if (status) runtime.compacting = status === "running";
      if (status)
        this.emit("notification", { method: "openbot/context-compaction", params: { threadId: runtime.id, status } });
      return;
    }
    if (message.type === "system" && message.subtype === "api_retry") {
      const turn = runtime.activeTurn;
      if (!turn || typeof message.attempt !== "number" || typeof message.max_retries !== "number") return;
      turn.retrying = true;
      this.#emitTurnProgress(
        runtime,
        turn,
        sourceText(
          message.error_status === null && !message.no_response
            ? "status.provider.retryUnreachable"
            : "status.provider.retryServerError",
          {
            provider: "Claude",
            attempt: message.attempt,
            maxAttempts: message.max_retries,
          },
        ),
      );
      return;
    }
    if (
      (message.type === "stream_event" || message.type === "assistant") &&
      !message.error &&
      runtime.activeTurn?.retrying
    ) {
      runtime.activeTurn.retrying = false;
      this.#emitTurnProgress(
        runtime,
        runtime.activeTurn,
        sourceText("status.provider.retryRecovered", { provider: "Claude" }),
      );
    }
    if (message.type === "system" && message.subtype === "background_tasks_changed") {
      const before = runtime.backgroundTasks;
      runtime.backgroundTasks = Array.isArray(message.tasks)
        ? message.tasks.filter((task) => !(isRecord(task) && task.ambient === true)).length
        : 0;
      if (before > 0 !== runtime.backgroundTasks > 0 || runtime.backgroundTasks > before)
        this.#emitBackgroundWork(runtime);
      if (!runtime.activeTurn) {
        if (before === 0 && runtime.backgroundTasks > 0) this.#threads.holdForTurn(runtime);
        else if (before > 0 && runtime.backgroundTasks === 0) {
          runtime.awaitsResultTurn = true;
          this.#threads.awaitOwnTurn(runtime);
        }
      }
      return;
    }
    if (message.type === "system" && message.subtype?.startsWith("task_") && isString(message.task_id)) {
      const turn = runtime.activeTurn;
      if (message.subtype === "task_started") {
        const origin = startedTaskOrigin(runtime.taskTurns, message, turn);
        if (origin !== undefined) runtime.taskTurns.set(message.task_id, origin);
      } else if (message.subtype === "task_notification") {
        const owner = runtime.taskTurns.get(message.task_id);
        runtime.taskTurns.delete(message.task_id);
        if (owner !== SUBAGENT_OWNED_TASK) this.#noteEndedTask(runtime, message, message.task_id, owner ?? null);
      }
    }
    if (message.type === "system" && message.subtype?.startsWith("task_")) {
      this.#emitSubagents(runtime, foldClaudeTaskMessage(runtime.subagents, message, new Date().toISOString()));
      return;
    }
    if (message.type === "system" && message.subtype === "compact_boundary") {
      runtime.compacting = false;
      this.#turnContext.resend(runtime.id);
      this.emit("notification", {
        method: "openbot/context-compaction",
        params: {
          threadId: runtime.id,
          status: "completed",
        },
      });
      return;
    }
    if (message.context_usage && !message.parent_tool_use_id && isRecord(message.context_usage)) {
      this.#emitContextUsage(runtime, message.context_usage.total_tokens, message.context_usage.raw_max_tokens);
    }
    if (message.type === "rate_limit_event") {
      const info = message.rate_limit_info;
      if (!isDynamicRecord(info)) return;
      const turn = runtime.activeTurn;
      if (turn && info.status === "rejected") {
        turn.usageLimit = { resetsAt: claudeResetSeconds(info.resetsAt), text: turn.usageLimit?.text ?? null };
      }
      const windows = claudePushedWindows(info, this.#weeklyLimitKey);
      if (windows)
        this.emit("notification", {
          method: "account/rateLimits/updated",
          params: { rateLimits: { limitId: "claude", ...windows } },
        });
      return;
    }

    if (
      (message.type === "stream_event" || message.type === "assistant") &&
      !runtime.activeTurn &&
      message.parent_tool_use_id === null &&
      message.user_message_uuid &&
      isUuid(message.user_message_uuid) &&
      !message.resume_reason
    )
      runtime.nextTurnId = message.user_message_uuid;
    if (message.type === "stream_event" && message.parent_tool_use_id === null) {
      const event = message.event;
      const delta = isRecord(event) ? event.delta : null;
      const block = isRecord(event) ? event.content_block : null;
      if (isRecord(event) && event.type === "message_start") {
        this.#closeBlockedReply(runtime);
        runtime.streamMessage = { id: getString(event.message, "id"), thinkingBlocks: new Map<number, string>() };
      } else if (
        isRecord(event) &&
        event.type === "content_block_start" &&
        isRecord(block) &&
        block.type === "thinking"
      ) {
        this.#streamThinkingBlock(runtime, event.index, true);
      } else if (
        isRecord(event) &&
        event.type === "content_block_start" &&
        isRecord(block) &&
        (block.type === "tool_use" || block.type === "server_tool_use" || block.type === "mcp_tool_use")
      ) {
        this.#flushNarration(runtime);
      } else if (event && isRecord(event) && event.type === "content_block_delta" && isRecord(delta)) {
        if (delta.type === "text_delta" && isString(delta.text)) {
          this.#outputTurn(runtime);
          this.#bufferText(runtime, delta.text);
        } else if (delta.type === "thinking_delta" && isString(delta.thinking)) {
          this.#outputTurn(runtime);
          this.#appendThinking(runtime, this.#streamThinkingBlock(runtime, event.index, false), delta.thinking);
        }
      }
      return;
    }

    if (message.type === "assistant" && message.parent_tool_use_id && message.uuid) {
      if (message.error === "rate_limit") this.#holdSubagentLimit(runtime, message);
      this.#emitSubagents(
        runtime,
        foldClaudeSubagentMessage(runtime.subagents, message.parent_tool_use_id, message.uuid, message.message),
      );
      return;
    }
    if (message.type === "assistant") {
      if (message.parent_tool_use_id !== null || !message.uuid || isClaudeNoResponsePlaceholder(message.message))
        return;
      const turn = this.#outputTurn(runtime);
      const text = messageText(message.message);
      if (message.error === "rate_limit") {
        const refusal = claudeUsageLimitRefusal(message);
        if (isSpentBalanceDiagnostic(text)) {
          turn.usageLimit = null;
          turn.balanceSpent = true;
        } else if (turn.usageLimit || refusal || isPlanLimitDiagnostic(text)) {
          turn.usageLimit = { resetsAt: refusal?.resetsAt ?? turn.usageLimit?.resetsAt ?? null, text: text || null };
          return;
        }
      }
      if (message.error === "authentication_failed") turn.authenticationFailed = true;
      if (message.error === "billing_error") turn.billingFailed = true;
      if (message.error && message.error !== "max_output_tokens") return;
      this.#closeBlockedReply(runtime);
      const thinking = messageThinking(message.message);
      if (thinking) {
        const before = textBeforeThinking(message.message);
        if (before) {
          turn.assistantMessages.set(message.uuid, before);
          const upToBoundary = [...turn.assistantMessages.values()].join("");
          this.#reconcileText(runtime, upToBoundary);
          this.#flushNarration(runtime);
        }
      }
      if (!turn.thinkingSnapshots.has(message.uuid)) {
        turn.thinkingSnapshots.add(message.uuid);
        const messageId = getString(message.message, "id") ?? message.uuid;
        for (const blockText of messageThinkingBlocks(message.message)) {
          const ordinal = turn.thinkingSnapshotCounts.get(messageId) ?? 0;
          turn.thinkingSnapshotCounts.set(messageId, ordinal + 1);
          if (blockText) this.#setThinkingBlock(runtime, `${messageId}:thinking:${ordinal}`, blockText, false);
        }
      }
      if (text) {
        turn.assistantMessages.set(message.uuid, text);
        this.#reconcileText(runtime, [...turn.assistantMessages.values()].join(""));
      }
      const toolCalls = messageToolCalls(message.message);
      if (toolCalls.length > 0) {
        turn.ranTools = true;
        this.#flushNarration(runtime);
      }
      for (const toolCall of toolCalls) {
        if (turn.toolCalls.has(toolCall.id)) continue;
        const name = claudeBridgedToolName(toolCall.name, toolCall.input);
        turn.toolCalls.set(toolCall.id, { name, input: completedToolInput(toolCall.input) });
        this.#emitToolCall(runtime, toolCall.id, name, false, toolCall.input);
        const plan = foldClaudePlanCall(runtime.plan, toolCall);
        if (plan) this.#emitPlan(runtime, plan);
        this.#emitSubagents(
          runtime,
          foldClaudeSubagentCall(runtime.subagents, turn.id, toolCall, new Date().toISOString()),
        );
      }
      return;
    }

    if (message.type === "user") {
      const turn = runtime.activeTurn;
      if (!turn) return;
      if (!message.parent_tool_use_id && messageText(message.message).startsWith(CLAUDE_STOP_HOOK_FEEDBACK))
        turn.stopHookBlocked = true;
      for (const { id: toolCallId, text, isError } of messageToolResults(message.message)) {
        if (!message.parent_tool_use_id) {
          foldClaudePlanResult(runtime.plan, toolCallId, message.tool_use_result, text);
          this.#emitSubagents(
            runtime,
            foldClaudeSubagentResult(
              runtime.subagents,
              toolCallId,
              message.tool_use_result,
              isError,
              text,
              new Date().toISOString(),
            ),
          );
        }
        const call = turn.toolCalls.get(toolCallId);
        if (!call) continue;
        turn.toolCalls.delete(toolCallId);
        this.#emitToolCall(
          runtime,
          toolCallId,
          call.name,
          true,
          call.input,
          isError ? text : null,
          isError ? null : text,
        );
        if (
          isError &&
          call.name === "Bash" &&
          runtime.config.workspaceOnly &&
          !turn.sandboxBlockedWarned &&
          CLAUDE_SANDBOX_BLOCKED.test(text)
        ) {
          turn.sandboxBlockedWarned = true;
          queryLogger.warn("The Claude sandbox cannot start the agent's commands.");
          this.emit("notification", {
            method: "warning",
            params: { threadId: runtime.id, turnId: turn.id, message: sourceText("error.agent.claudeSandboxBlocked") },
          });
        }
      }
      return;
    }

    if (message.type !== "result") return;
    runtime.nextTurnId = null;
    const fastModeDisabledReason =
      runtime.appliedFastMode && isString(message.fast_mode_disabled_reason) ? message.fast_mode_disabled_reason : null;
    if (fastModeDisabledReason && fastModeDisabledReason !== runtime.fastModeDisabledReason) {
      queryLogger.warn("Claude ran a fast mode turn at the standard speed.", { reason: fastModeDisabledReason });
      const warning = claudeFastModeWarning(fastModeDisabledReason);
      if (warning && runtime.activeTurn) {
        this.emit("notification", {
          method: "warning",
          params: { threadId: runtime.id, turnId: runtime.activeTurn.id, message: warning },
        });
        runtime.fastModeDisabledReason = fastModeDisabledReason;
      }
    } else runtime.fastModeDisabledReason = fastModeDisabledReason;
    if (
      message.subtype === "success" &&
      message.total_cost_usd !== undefined &&
      message.total_cost_usd < runtime.usageCost
    )
      runtime.usageCounterId = randomUUID();
    if (message.subtype === "success" || (message.total_cost_usd ?? 0) > runtime.usageCost)
      runtime.usageCost = message.total_cost_usd ?? runtime.usageCost;
    if (runtime.activeTurn && message.modelUsage) {
      this.emit("notification", {
        method: "openbot/usage",
        params: {
          threadId: runtime.id,
          turnId: runtime.activeTurn.id,
          counterId: runtime.usageCounterId,
          modelUsage: message.modelUsage,
          ...(runtime.resumedUsage ? { turnModelUsage: claudeTurnModelUsage(runtime.requestUsage.values()) } : {}),
        },
      });
      runtime.resumedUsage = false;
      runtime.requestUsage.clear();
    }
    const fallback = message.subtype === "success" ? message.result : "";
    const errors = message.errors ?? [];
    const interrupted =
      message.terminal_reason === "aborted_streaming" ||
      message.terminal_reason === "aborted_tools" ||
      errors.some((error) => /interrupt|abort/i.test(error));
    const turn = runtime.activeTurn;
    if (turn?.prompt && !interrupted && isOtherTurnResult(message, turn.messageIds)) {
      queryLogger.info("Claude ended a turn of its own before the message's turn.", { threadId: runtime.id });
      return;
    }
    if (turn) for (const uuid of takenMessageIds(message)) turn.untakenSteerIds.delete(uuid);
    if (turn && interrupted && !turn.stopRequested && turn.untakenSteerIds.size > 0) {
      for (const [toolCallId, { name }] of turn.toolCalls) {
        this.#emitToolCall(runtime, toolCallId, name, true);
      }
      turn.toolCalls.clear();
      for (const hostToolCall of turn.hostToolCalls) hostToolCall.abort();
      turn.hostToolCalls.clear();
      queryLogger.info("Claude stopped its running tools to take a steered message.", { threadId: runtime.id });
      return;
    }
    const apiError = message.subtype === "success" && message.is_error === true;
    if (turn) {
      for (const [toolCallId, { name }] of turn.toolCalls) {
        this.#emitToolCall(runtime, toolCallId, name, true);
      }
      turn.toolCalls.clear();
      const limitError = apiError && (message.api_error_status == null || message.api_error_status === 429);
      const held = turn.unprompted ? runtime.subagentLimit : null;
      if (turn.unprompted) runtime.subagentLimit = null;
      const subagentLimit =
        held &&
        (held.resetsAt ?? Number.POSITIVE_INFINITY) * 1_000 > Date.now() &&
        turn.usageLimit?.text == null &&
        !turn.seenText &&
        !fallback &&
        !turn.ranTools &&
        !turn.balanceSpent &&
        !turn.billingFailed &&
        !turn.authenticationFailed &&
        message.subtype === "success" &&
        (!apiError || limitError)
          ? held
          : null;
      const limit = subagentLimit
        ? { resetsAt: subagentLimit.resetsAt ?? turn.usageLimit?.resetsAt ?? null, text: subagentLimit.text }
        : turn.usageLimit;
      if (
        limit &&
        !interrupted &&
        (limit.text !== null || limitError) &&
        !isSpentBalanceDiagnostic(limit.text ?? `${errors.join("\n")}\n${fallback}`)
      ) {
        this.emit("notification", {
          method: USAGE_LIMIT_METHOD,
          params: { threadId: runtime.id, turnId: turn.id, resetsAt: limit.resetsAt },
        });
        this.#reconcileText(runtime, [...turn.assistantMessages.values()].join(""));
        yield* this.#completeTurn(
          runtime,
          "failed",
          limit.text ?? (errors.join("\n") || fallback || sourceText("error.provider.usageLimitReached")),
        );
        return;
      }
      this.#reconcileText(runtime, [...turn.assistantMessages.values()].join(""));
      const structured =
        runtime.config.outputSchema && message.subtype === "success" && message.structured_output !== undefined
          ? JSON.stringify(message.structured_output)
          : null;
      if (structured !== null && !apiError) this.#bufferText(runtime, structured);
      else if (!turn.seenText && fallback && fallback !== CLAUDE_NO_RESPONSE_TEXT && !apiError)
        this.#bufferText(runtime, fallback);
    }
    const status = interrupted ? "interrupted" : message.subtype === "success" && !apiError ? "completed" : "failed";
    yield* this.#completeTurn(runtime, status, errors.length > 0 ? errors.join("\n") : apiError ? fallback : null);
    const contextRequest = ++runtime.contextRequest;
    if (runtime.query.getContextUsage)
      yield* Effect.forkIn(
        providerCall(() => runtime.query.getContextUsage?.({ detail: "summary" })).pipe(
          Effect.timeout("2 seconds"),
          Effect.tap((usage) =>
            Effect.sync(() => {
              if (
                this.#threads.get(runtime.id) !== runtime ||
                runtime.contextRequest !== contextRequest ||
                runtime.activeTurn ||
                !isRecord(usage)
              )
                return;
              this.#emitContextUsage(runtime, usage.totalTokens, usage.rawMaxTokens, claudeContextCategories(usage));
            }),
          ),
          Effect.ignore,
        ),
        this.#scope,
      );
  });

  #emitContextUsage(
    runtime: ThreadRuntime,
    used: unknown,
    window: unknown,
    categories?: AgentContextCategoryUsage[],
  ): void {
    if (
      typeof used !== "number" ||
      !Number.isFinite(used) ||
      used < 0 ||
      typeof window !== "number" ||
      !Number.isFinite(window) ||
      window <= 0
    )
      return;
    this.emit("notification", {
      method: "thread/tokenUsage/updated",
      params: {
        threadId: runtime.id,
        tokenUsage: {
          last: { totalTokens: used },
          modelContextWindow: window,
          estimated: true,
          ...(categories ? { categories } : {}),
        },
      },
    });
  }

  #emitToolCall(
    runtime: ThreadRuntime,
    id: string,
    name: string,
    completed: boolean,
    input?: unknown,
    failure: string | null = null,
    output: string | null = null,
  ): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    const bridged = name === "mcp__openbot__tool_call" && isRecord(input) && input.name === "openbot.send_message";
    const message = name === "mcp__openbot__send_message" ? input : bridged ? input.arguments : undefined;
    const recipients =
      isRecord(message) && Array.isArray(message.recipientAgentIds)
        ? { recipientAgentIds: message.recipientAgentIds }
        : null;
    this.emit("notification", {
      method: completed ? "item/completed" : "item/started",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        filePaths:
          ["Read", "Write", "Edit", "MultiEdit"].includes(name) &&
          isRecord(input) &&
          typeof input.file_path === "string"
            ? [input.file_path]
            : undefined,
        folderPaths:
          completed && failure === null && ["Glob", "Grep", "LS"].includes(name) && isRecord(input)
            ? [input.path].filter((path) => typeof path === "string")
            : undefined,
        item: {
          id,
          type: "toolCall",
          name,
          status: completed ? (failure === null ? "completed" : "failed") : "in_progress",
          ...(completed && failure ? { error: textEnds(failure) } : {}),
          ...(completed && !failure && output ? { output: textEnds(output) } : {}),
          ...(name === "Skill" && isRecord(input) && typeof input.skill === "string"
            ? { skill: input.skill.slice(0, INPUT_LIMITS.identifier) }
            : {}),
          ...(!completed && LABELLED_TOOLS.has(name) && isRecord(input) && typeof input.description === "string"
            ? { description: input.description.slice(0, TOOL_DESCRIPTION_LIMIT) }
            : {}),
          ...(completed ? {} : claudeStepTarget(name, input)),
          ...(name === "Bash" && isRecord(input) && typeof input.command === "string"
            ? { command: input.command.slice(0, INPUT_LIMITS.messageText) }
            : {}),
          ...(recipients === null
            ? {}
            : { arguments: bridged ? { name: "openbot.send_message", arguments: recipients } : recipients }),
        },
      },
    });
  }

  #emitSubagents(runtime: ThreadRuntime, change: SubagentChange | null): void {
    if (!change) return;
    this.emit("notification", {
      method: SUBAGENTS_UPDATED_METHOD,
      params: { threadId: runtime.id, turnId: change.turnId, subagents: change.subagents },
    });
  }

  #emitPlan(runtime: ThreadRuntime, plan: PlanUpdateStep[]): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    this.emit("notification", {
      method: PLAN_UPDATED_METHOD,
      params: { threadId: runtime.id, turnId: turn.id, explanation: null, plan },
    });
  }

  #streamThinkingBlock(runtime: ThreadRuntime, index: unknown, starts: boolean): string {
    const stream = runtime.streamMessage;
    const position = typeof index === "number" ? index : -1;
    const known = stream.thinkingBlocks.get(position);
    if (known && !starts) return known;
    stream.id ??= randomUUID();
    const key = `${stream.id}:thinking:${stream.thinkingBlocks.size}`;
    stream.thinkingBlocks.set(position, key);
    return key;
  }

  #appendThinking(runtime: ThreadRuntime, key: string, delta: string): void {
    const turn = runtime.activeTurn;
    if (!turn || !delta) return;
    const previous = turn.thinkingBlocks.get(key);
    if (previous && key === turn.thinkingTail) {
      turn.thinkingBlocks.set(key, `${previous}${delta}`);
      this.#emitThinking(runtime, delta);
      return;
    }
    this.#setThinkingBlock(runtime, key, `${previous ?? ""}${delta}`, true);
  }

  #setThinkingBlock(runtime: ThreadRuntime, key: string, text: string, streamed: boolean): void {
    const turn = runtime.activeTurn;
    if (!turn || !text || turn.thinkingBlocks.get(key) === text) return;
    const begins = !turn.thinkingBlocks.has(key);
    if (streamed && begins) this.#flushNarration(runtime);
    turn.thinkingBlocks.set(key, text);
    if (begins) turn.thinkingTail = key;
    const thinking = [...turn.thinkingBlocks.values()].join("\n");
    if (thinking.startsWith(turn.thinking)) {
      this.#emitThinking(runtime, thinking.slice(turn.thinking.length));
      return;
    }
    turn.thinking = thinking;
  }

  #emitThinking(runtime: ThreadRuntime, delta: string): void {
    const turn = runtime.activeTurn;
    if (!turn || !delta) return;
    if (!turn.thinkingStarted) {
      turn.thinkingStarted = true;
      this.emit("notification", {
        method: "item/started",
        params: {
          threadId: runtime.id,
          turnId: turn.id,
          item: { id: turn.reasoningItemId, type: "agentMessage", phase: "commentary" },
        },
      });
    }
    turn.thinking += delta;
    this.emit("notification", {
      method: "item/agentMessage/delta",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        itemId: turn.reasoningItemId,
        delta,
      },
    });
  }

  #bufferText(runtime: ThreadRuntime, delta: string): void {
    const turn = runtime.activeTurn;
    if (!turn || !delta) return;
    turn.text += delta;
    turn.seenText += delta;
  }

  #reconcileText(runtime: ThreadRuntime, completeText: string): void {
    const turn = runtime.activeTurn;
    if (!turn) return;
    if (completeText.startsWith(turn.seenText)) {
      this.#bufferText(runtime, completeText.slice(turn.seenText.length));
      return;
    }
    if (completeText.length === 0) return;
    if (completeText.startsWith(turn.publishedText)) {
      turn.text = completeText.slice(turn.publishedText.length);
      turn.seenText = completeText;
      return;
    }
    this.#correctNarration(runtime, completeText);
  }

  #correctNarration(runtime: ThreadRuntime, completeText: string): void {
    const turn = runtime.activeTurn;
    const last = turn?.lastNarration;
    if (!turn || !last) return;
    const prefix = turn.publishedText.slice(0, turn.publishedText.length - last.text.length);
    if (!completeText.startsWith(prefix)) return;
    const heldBack = turn.text.length > 0 && completeText.endsWith(turn.text) ? turn.text.length : 0;
    const corrected = completeText.slice(prefix.length, completeText.length - heldBack);
    if (!corrected || corrected === last.text) return;
    last.text = corrected;
    turn.publishedText = `${prefix}${corrected}`;
    turn.text = completeText.slice(prefix.length + corrected.length);
    turn.seenText = completeText;
    this.emit("notification", {
      method: "item/completed",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        item: { id: last.id, type: "agentMessage", phase: "commentary", text: corrected },
      },
    });
  }

  #closeBlockedReply(runtime: ThreadRuntime): void {
    const turn = runtime.activeTurn;
    if (!turn?.stopHookBlocked) return;
    turn.stopHookBlocked = false;
    this.#reconcileText(runtime, [...turn.assistantMessages.values()].join(""));
    this.#flushNarration(runtime);
  }

  #flushNarration(runtime: ThreadRuntime): void {
    const turn = runtime.activeTurn;
    if (!turn?.text) return;
    const text = turn.text;
    const id = `${turn.id}:narration:${turn.narrationCount}`;
    this.emit("notification", {
      method: "item/completed",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        item: { id, type: "agentMessage", phase: "commentary", text },
      },
    });
    turn.lastNarration = { id, text };
    turn.narrationCount += 1;
    turn.publishedText += text;
    turn.text = turn.text.slice(text.length);
  }

  readonly #completeTurn = Effect.fn("ClaudeAgentClient.completeTurn")(function* (
    this: ClaudeAgentClient,
    runtime: ThreadRuntime,
    status: string,
    error: unknown,
  ) {
    const turn = runtime.activeTurn;
    if (!turn) return;
    if (runtime.compacting && status !== "completed") {
      runtime.compacting = false;
      this.emit("notification", {
        method: "openbot/context-compaction",
        params: { threadId: runtime.id, status: "failed" },
      });
    }
    if (turn.thinkingStarted) {
      this.emit("notification", {
        method: "item/completed",
        params: {
          threadId: runtime.id,
          turnId: turn.id,
          item: { id: turn.reasoningItemId, type: "agentMessage", phase: "commentary", text: turn.thinking },
        },
      });
    }
    this.emit("notification", {
      method: "item/completed",
      params: {
        threadId: runtime.id,
        turnId: turn.id,
        item: { id: turn.itemId, type: "agentMessage", text: turn.text },
      },
    });
    if (status === "failed" && error) {
      const blocked = CLAUDE_CLOUDFLARE_BLOCK.test(String(error));
      if (blocked) queryLogger.warn("Cloudflare blocked a Claude request.", { error: redactText(String(error)) });
      const signInFailed = !blocked && (turn.authenticationFailed || CLAUDE_NOT_LOGGED_IN.test(String(error)));
      const billing = turn.billingFailed || (turn.balanceSpent && isBalanceDiagnostic(String(error)));
      const apiKey = this.#usesApiKey();
      const message = claudeTurnError(error, apiKey, !apiKey && runtime.firstPartyApi && this.#onClaudeAccount());
      const crashed = message === String(error) && claudeProcessExited(error) && classifyFailure(message) === "unknown";
      this.emit("notification", {
        method: "error",
        params: {
          threadId: runtime.id,
          turnId: turn.id,
          message,
          ...(blocked
            ? { causeCode: "provider_unavailable" }
            : signInFailed
              ? { causeCode: "authentication" }
              : billing
                ? { causeCode: "billing" }
                : turn.stalled
                  ? { causeCode: "stalled" }
                  : crashed
                    ? { causeCode: "provider_exited" }
                    : {}),
        },
      });
    }
    this.#emitSubagents(runtime, endSubagentTurn(runtime.subagents, turn.id, new Date().toISOString()));
    this.emit("notification", {
      method: "turn/completed",
      params: { threadId: runtime.id, turn: { id: turn.id, status } },
    });
    runtime.activeTurn = null;
    yield* this.#threads.markIdle(runtime);
  });

  readonly #readThreadEffect = Effect.fn("ClaudeAgentClient.readThread")(function* (
    this: ClaudeAgentClient,
    threadId: string,
  ): Effect.fn.Return<ThreadResponse, ProviderClientOperationError> {
    const cwd = this.#threads.get(threadId)?.config.cwd ?? this.#threads.released(threadId)?.cwd;
    if (!this.#readSessionMessages) {
      const turns: NonNullable<ThreadResponse["thread"]["turns"]> = [];
      let currentTurn: (typeof turns)[number] | null = null;
      yield* this.readHistory({ threadId, ...(cwd === undefined ? {} : { cwd }), items: "full" }, (fragment) =>
        Effect.sync(() => {
          if (currentTurn?.id === fragment.turnId) {
            currentTurn.items = [...(currentTurn.items ?? []), ...fragment.items];
            return true;
          }
          currentTurn = {
            id: fragment.turnId,
            status: fragment.status ?? "completed",
            ...(fragment.startedAt === undefined ? {} : { startedAt: fragment.startedAt }),
            items: fragment.items,
          };
          turns.unshift(currentTurn);
          return true;
        }),
      );
      return { thread: { id: threadId, turns } };
    }
    const readSessionMessages = this.#readSessionMessages;
    if (!readSessionMessages) return { thread: { id: threadId, turns: [] } };
    const messages = yield* providerCall(() => readSessionMessages(threadId, cwd ? { dir: cwd } : undefined));
    const turns: NonNullable<ThreadResponse["thread"]["turns"]> = [];
    let current: (typeof turns)[number] | null = null;
    let currentThinking: ThreadItem | null = null;
    let currentAnswer: ThreadItem | null = null;
    let skippingCompaction = false;
    for (const message of messages) {
      if (message.parent_tool_use_id) continue;
      const text = messageText(message.message);
      if (message.type === "user") {
        if (!text || isClaudeInterruptMarker(text)) continue;
        if (isClaudeCompactionSummary(text)) {
          skippingCompaction = true;
          current = null;
          continue;
        }
        skippingCompaction = false;
        current = {
          id: message.uuid,
          status: "completed",
          items:
            isClaudeTaskNotification(text) || isClaudeLocalCommand(text)
              ? []
              : [
                  {
                    id: message.uuid,
                    type: "userMessage",
                    clientId: message.uuid,
                    content: [{ type: "text", text }],
                  },
                ],
        };
        turns.push(current);
        currentThinking = null;
        currentAnswer = null;
      } else if (message.type === "assistant") {
        if (skippingCompaction || isClaudeNoResponsePlaceholder(message.message)) continue;
        const thinking = messageThinking(message.message);
        const endsStep = messageToolCalls(message.message).length > 0;
        if (!thinking && !text && !endsStep) continue;
        if (!current && (thinking || text)) {
          current = { id: message.uuid, status: "completed", items: [] };
          turns.push(current);
          currentThinking = null;
          currentAnswer = null;
        }
        if (!current) continue;
        const beforeThinking = thinking ? textBeforeThinking(message.message) : "";
        if (thinking) {
          if (currentAnswer) {
            currentAnswer.phase = "commentary";
            currentAnswer = null;
          }
          if (beforeThinking) {
            current.items?.push({
              id: `${message.uuid}:narration`,
              type: "agentMessage",
              phase: "commentary",
              text: beforeThinking,
            });
          }
          if (currentThinking) {
            currentThinking.text = `${currentThinking.text ?? ""}\n${thinking}`;
          } else {
            currentThinking = {
              id: `${current.id}:reasoning`,
              type: "agentMessage",
              phase: "commentary",
              text: thinking,
            };
            current.items?.push(currentThinking);
          }
        }
        const answerText = text.slice(beforeThinking.length);
        if (answerText) {
          if (currentAnswer) currentAnswer.phase = "commentary";
          currentAnswer = { id: message.uuid, type: "agentMessage", text: answerText };
          current.items?.push(currentAnswer);
        }
        if (endsStep && currentAnswer) {
          currentAnswer.phase = "commentary";
          currentAnswer = null;
        }
      }
    }
    return { thread: { id: threadId, turns } };
  });

  #createOpenBotServers(threadId: string, channelTools: boolean) {
    const call = (namespace: string, name: string, args: unknown) =>
      runCauseEffect(this.#callDynamicTool(threadId, namespace, name, args));
    return {
      openbot: createSdkMcpServer({
        name: "openbot",
        version: "0.1.0",
        tools: claudeOpenBotTools((name, args) => call("openbot", name, args), channelTools),
      }),
      [OPENBOT_BROWSER_NAMESPACE]: createSdkMcpServer({
        name: OPENBOT_BROWSER_NAMESPACE,
        version: "0.1.0",
        alwaysLoad: true,
        tools: claudeBrowserTools((name, args) => call(OPENBOT_BROWSER_NAMESPACE, name, args)),
      }),
    };
  }

  readonly #callDynamicTool = Effect.fn("ClaudeAgentClient.callDynamicTool")(function* (
    this: ClaudeAgentClient,
    threadId: string,
    namespace: string,
    name: string,
    args: unknown,
  ): Effect.fn.Return<CallToolResult, ProviderClientOperationError> {
    const runtime = yield* providerSync(() => this.#requireThread(threadId));
    const turn = runtime.activeTurn;
    const hostToolCall = new AbortController();
    turn?.hostToolCalls.add(hostToolCall);
    const result = yield* this.#awaitHost(
      threadId,
      this.#serverRequests.call(
        "item/tool/call",
        {
          threadId,
          turnId: turn?.id ?? randomUUID(),
          callId: randomUUID(),
          namespace,
          tool: name,
          arguments: args,
        },
        hostToolCall.signal,
      ),
    ).pipe(
      Effect.ensuring(Effect.sync(() => turn?.hostToolCalls.delete(hostToolCall))),
      toProviderClientOperationError,
    );
    if (!isRecord(result)) return { content: [{ type: "text" as const, text: String(result) }] };
    const content: CallToolResult["content"] = [];
    if (Array.isArray(result.contentItems)) {
      for (const item of result.contentItems) content.push(...dynamicContent(item));
    }
    return { content, isError: result.success === false || terminalToolRefusal(namespace, name, content) };
  });

  readonly #requestUserInputEffect = Effect.fn("ClaudeAgentClient.requestUserInput")(function* (
    this: ClaudeAgentClient,
    threadId: string,
    input: DynamicRecord,
    toolUseId: string,
  ): Effect.fn.Return<PermissionResult, ProviderClientOperationError> {
    const runtime = yield* providerSync(() => this.#requireThread(threadId));
    const rawQuestions = Array.isArray(input.questions) ? input.questions.filter(isRecord) : [];
    const questions = rawQuestions.map((question, index) => ({
      id: `question-${index}`,
      header: isString(question.header) ? question.header : "Question",
      question: isString(question.question) ? question.question : "Claude needs more information.",
      options: Array.isArray(question.options) ? question.options : undefined,
      ...(question.multiSelect === true ? { multiSelect: true } : {}),
    }));
    const result = yield* this.#awaitPerson(
      threadId,
      this.#serverRequests.call("item/tool/requestUserInput", {
        threadId,
        turnId: runtime.activeTurn?.id ?? randomUUID(),
        itemId: toolUseId,
        questions,
      }),
    ).pipe(toProviderClientOperationError);
    const responseAnswers = isRecord(result) && isRecord(result.answers) ? result.answers : {};
    const note = isRecord(result) && isString(result.note) ? result.note : "";
    const answers = Object.fromEntries(
      questions.map((question) => {
        const entry = responseAnswers[question.id];
        const values = isRecord(entry) && Array.isArray(entry.answers) ? entry.answers : [];
        return [question.question, values.filter((value): value is string => isString(value)).join(", ") || note];
      }),
    );
    return { behavior: "allow", updatedInput: { questions: input.questions, answers } };
  });

  readonly #requestElicitationEffect = Effect.fn("ClaudeAgentClient.requestElicitation")(function* (
    this: ClaudeAgentClient,
    threadId: string,
    request: Parameters<OnElicitation>[0],
    signal: AbortSignal,
  ): Effect.fn.Return<ElicitationResult> {
    const result = yield* this.#awaitPerson(
      threadId,
      this.#serverRequests.call(
        "mcpServer/elicitation/request",
        {
          threadId,
          turnId: this.#threads.get(threadId)?.activeTurn?.id ?? randomUUID(),
          serverName: request.serverName,
          mode: request.mode ?? "form",
          message: request.message,
          requestedSchema: request.requestedSchema ?? null,
          url: request.url ?? null,
          elicitationId: request.elicitationId ?? null,
        },
        signal,
      ),
    ).pipe(Effect.orElseSucceed(() => ({ action: "cancel" })));
    const action = getString(result, "action");
    if (action !== "accept") return { action: action === "decline" ? "decline" : "cancel" };
    const content: NonNullable<ElicitationResult["content"]> = {};
    const answers = isRecord(result) && isRecord(result.content) ? result.content : {};
    for (const [id, value] of Object.entries(answers)) {
      if (isString(value) || isNumber(value) || typeof value === "boolean") content[id] = value;
      else if (Array.isArray(value) && value.every(isString)) content[id] = value;
    }
    return { action, content };
  });

  readonly #requestWriteApprovalEffect = Effect.fn("ClaudeAgentClient.requestWriteApproval")(function* (
    this: ClaudeAgentClient,
    threadId: string,
    path: string,
    toolInput: DynamicRecord,
    toolUseId: string,
  ): Effect.fn.Return<PermissionResult, ProviderClientOperationError> {
    const result = yield* this.#awaitPerson(
      threadId,
      this.#serverRequests.call("item/fileChange/requestApproval", {
        threadId,
        turnId: this.#threads.get(threadId)?.activeTurn?.id ?? randomUUID(),
        itemId: toolUseId,
        reason: sourceText("status.agent.claudeWriteOutside", { path }),
      }),
    ).pipe(toProviderClientOperationError);
    if (isRecord(result) && result.decision === "accept") return { behavior: "allow", updatedInput: toolInput };
    return { behavior: "deny", message: "The user did not allow this write outside the workspace." };
  });

  #requireThread(threadId: string): ThreadRuntime {
    const runtime = this.#threads.get(threadId);
    if (!runtime) throw new Error(`Unknown Claude thread: ${threadId}`);
    return runtime;
  }

  #resolveEffort(model: string | undefined, effort: string | undefined): ClaudeEffort | undefined {
    if (!effort) return undefined;
    const normalized = normalizeClaudeEffort(effort);
    if (!model) return normalized;
    const capability = this.#modelEffortCapabilities.get(model);
    if (capability === null) return undefined;
    if (!capability || capability.supported.includes(normalized)) return normalized;
    return capability.defaultEffort;
  }

  #sdkModel(model: string): string {
    return this.#modelSdkValues.get(model) ?? (CLAUDE_LISTED_MODELS.has(model) ? model : normalizeClaudeModel(model));
  }
}

type ClaudeSdkLaunch = Pick<Options, "pathToClaudeCodeExecutable" | "spawnClaudeCodeProcess">;

const writeClaudeMcpConfig = Effect.fn("ClaudeAgentClient.writeMcpConfig")(function* (
  stateDirectory: string,
  threadId: string,
  servers: Record<string, ClaudeMcpServer>,
) {
  const directory = join(stateDirectory, "claude-mcp");
  const file = join(directory, `${threadId}-${randomUUID()}.json`);
  yield* providerCall(() => mkdir(directory, { recursive: true, mode: 0o700 }));
  yield* providerCall(() => writeFile(file, JSON.stringify({ mcpServers: servers }), { mode: 0o600 }));
  return file;
});

const writeClaudeFlagSettings = Effect.fn("ClaudeAgentClient.writeFlagSettings")(function* (
  stateDirectory: string,
  threadId: string,
  settings: Settings,
) {
  const directory = join(stateDirectory, "claude-settings");
  const file = join(directory, `${threadId}-${randomUUID()}.json`);
  yield* providerCall(() => mkdir(directory, { recursive: true, mode: 0o700 }));
  yield* providerCall(() => writeFile(file, JSON.stringify(settings), { mode: 0o600 }));
  return file;
});

export function claudeOpenBotTools(
  call: (name: string, args: unknown) => Promise<CallToolResult>,
  channelTools = false,
) {
  const channel = channelTools
    ? CHANNEL_TOOL_DEFINITIONS.filter((definition) =>
        CLAUDE_TERMINAL_CHANNEL_TOOLS.includes(`mcp__openbot__${definition.name}`),
      )
    : [];
  const claudeTool = (definition: (typeof channel)[number], extras?: { alwaysLoad: true }) =>
    tool(
      definition.name,
      definition.description,
      advertisedZodShape(z.strictObject(definition.shape)),
      (args) => call(definition.name, args),
      extras,
    );
  return [
    ...visibleToolDefinitions("claude")
      .filter((definition) => definition.name !== "ask_user")
      .map((definition) =>
        claudeTool(definition, definition.name === ROUTINE_NO_UPDATE_TOOL ? { alwaysLoad: true } : undefined),
      ),
    ...channel.map((definition) => claudeTool(definition, { alwaysLoad: true })),
  ];
}

export function claudeBrowserTools(call: (name: string, args: unknown) => Promise<CallToolResult>) {
  return DIRECT_BROWSER_TOOL_DEFINITIONS.map((definition) =>
    tool(definition.name, definition.description, advertisedZodShape(definition.schema), (args) =>
      call(definition.name, args),
    ),
  );
}

const clearClaudeNeedsAuthMarks = Effect.fn("ClaudeAgentClient.clearNeedsAuthMarks")(
  function* (configDirectory: string, names: readonly string[]) {
    if (names.length === 0) return;
    const file = join(configDirectory, "mcp-needs-auth-cache.json");
    const marks = yield* providerCall(async (): Promise<unknown> => JSON.parse(await readFile(file, "utf8")));
    if (!isRecord(marks)) return;
    const isMark = (name: string) => {
      const mark = marks[name];
      return isRecord(mark) && typeof mark.timestamp === "number";
    };
    if (!names.some(isMark)) return;
    const kept = Object.fromEntries(Object.entries(marks).filter(([name]) => !(names.includes(name) && isMark(name))));
    yield* providerCall(() => writeFile(file, JSON.stringify(kept)));
  },
  (effect) => Effect.ignore(effect),
);

function removeClaudeQueryFile(file: string | null): Effect.Effect<void> {
  return file ? providerCall(() => rm(file, { force: true })).pipe(Effect.ignore) : Effect.void;
}

const CLAUDE_SANDBOX_UNAVAILABLE = /Sandbox required but unavailable: (.+?)\.? Set sandbox\.failIfUnavailable=false/s;

const CLAUDE_SANDBOX_BLOCKED =
  /^(?:apply-seccomp: (?:unshare\(|write \/proc\/self\/(?:setgroups|uid_map|gid_map)\b)|bwrap: (?:Failed to make \/ slave|setting up uid map|No permissions to creat(?:e a new|ing new) namespace|Creating new namespace failed|pivot_root\b|loopback: Failed RTM_NEW(?:ADDR|LINK)))/mu;

const CLAUDE_API_CREDIT_EMPTY = /\bcredit balance (?:is )?too low\b/iu;

const CLAUDE_NOT_LOGGED_IN = /\bnot logged in\b\s*·\s*please run \/login\b/iu;

const CLAUDE_CLOUDFLARE_BLOCK =
  /\b403\b[\s\S]*(?:attention required!? \| cloudflare|sorry, you have been blocked|cf-browser-verification|__cf_chl|cdn-cgi\/challenge-platform)/iu;

function claudeFastModeWarning(reason: string): string | null {
  switch (reason) {
    case "extra_usage_disabled":
      return sourceText("status.provider.claudeFastModeNeedsUsageCredits");
    case "free":
      return sourceText("status.provider.claudeFastModeNotOnPlan");
    case "not_first_party":
      return sourceText("status.provider.claudeFastModeNotFirstParty");
    case "model_not_allowed":
      return sourceText("status.provider.claudeFastModeModelNotAllowed");
    case "disabled_by_env":
    case "preference":
      return sourceText("status.provider.claudeFastModeTurnedOff");
    case "pending":
    case "sdk_opt_in_required":
      return null;
    default:
      return sourceText("status.provider.claudeFastModeUnavailable");
  }
}

function claudeTurnError(error: unknown, apiKey: boolean, claudeAccount: boolean): string {
  const text = String(error);
  if (apiKey && CLAUDE_API_CREDIT_EMPTY.test(text)) return sourceText("error.provider.claudeApiKeyNoCredit");
  if (claudeAccount && CLAUDE_API_CREDIT_EMPTY.test(text)) return sourceText("error.provider.claudeAccountNoCredit");
  if (CLAUDE_CLOUDFLARE_BLOCK.test(text)) return sourceText("error.provider.claudeServiceBlocked");
  if (!apiKey && CLAUDE_NOT_LOGGED_IN.test(text))
    return sourceText("error.provider.signInExpired", { provider: agentProviderName("claude") });
  return CLAUDE_SANDBOX_UNAVAILABLE.test(text) ? sourceText("error.agent.claudeNoSandbox") : text;
}

function claudeProcessExited(error: unknown): boolean {
  for (let cause = error, depth = 0; cause instanceof Error && depth < 3; cause = cause.cause, depth += 1) {
    if (
      "errorClass" in cause &&
      (cause.errorClass === "process_exited_nonzero" || cause.errorClass === "process_killed_by_signal")
    )
      return true;
  }
  return false;
}

const NPM_WRAPPER_TARGET = /"%dp0%\\([^"%]+\.(?:exe|js))"\s+%\*/i;

function claudeSdkLaunch(executable: string): ClaudeSdkLaunch {
  if (!cliSpawnTarget(executable, []).windowsVerbatimArguments) return { pathToClaudeCodeExecutable: executable };
  const target = NPM_WRAPPER_TARGET.exec(readWrapper(executable))?.[1];
  const program = target ? join(dirname(executable), target) : null;
  if (program && existsSync(program)) return { pathToClaudeCodeExecutable: program };
  return { pathToClaudeCodeExecutable: executable, spawnClaudeCodeProcess: spawnClaudeWrapper };
}

function readWrapper(executable: string): string {
  try {
    return readFileSync(executable, "utf8");
  } catch {
    return "";
  }
}

function spawnClaudeWrapper({ command, args, cwd, env, signal }: SpawnOptions): SpawnedProcess {
  const target = cliSpawnTarget(command, args);
  const child = spawn(target.command, target.args, {
    cwd,
    env,
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
    windowsVerbatimArguments: target.windowsVerbatimArguments,
  });
  const killWrapper = child.kill.bind(child);
  const running = () => child.pid !== undefined && child.exitCode === null && child.signalCode === null;
  let stopping = false;
  child.kill = (killSignal) => {
    if (!running()) return false;
    if (stopping) return true;
    stopping = true;
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {
      if (running()) killWrapper(killSignal);
    });
    return true;
  };
  const abort = () => child.kill();
  const release = () => signal.removeEventListener("abort", abort);
  signal.addEventListener("abort", abort, { once: true });
  child.once("exit", release);
  child.once("error", release);
  if (signal.aborted) abort();
  return child;
}

const CLAUDE_STDERR_TAIL_CHARS = 2_048;

const CLAUDE_PROCESS_EXIT = /^Claude Code process (?:exited with code|terminated by signal) [^.]*$/;

class ClaudeStderrTail {
  #text = "";
  readonly #decoder = new StringDecoder("utf8");

  push(chunk: Buffer): void {
    this.#text += this.#decoder.write(chunk);
    if (this.#text.length > 2 * CLAUDE_STDERR_TAIL_CHARS) this.#text = this.#text.slice(-CLAUDE_STDERR_TAIL_CHARS);
  }

  addTo(error: unknown): unknown {
    if (!(error instanceof Error) || !CLAUDE_PROCESS_EXIT.test(error.message)) return error;
    const text = redactText(this.#text).slice(-CLAUDE_STDERR_TAIL_CHARS).trim();
    return text ? new Error(`${error.message}. stderr: ${text}`, { cause: error }) : error;
  }
}

function spawnClaudeProcessGroup(
  { command, args, cwd, env, signal }: SpawnOptions,
  stderr: ClaudeStderrTail,
): SpawnedProcess {
  const child = spawn(command, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
  endProcessGroupOnExit(child);
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stderr.on("error", () => {});
  const abort = () => child.kill();
  const release = () => signal.removeEventListener("abort", abort);
  signal.addEventListener("abort", abort, { once: true });
  child.once("exit", release);
  child.once("error", release);
  if (signal.aborted) abort();
  return child;
}

function claudeMcpStartupEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  if (env.MCP_TIMEOUT?.trim()) return {};
  return { MCP_TIMEOUT: String(MCP_STDIO_PROBE_TIMEOUT_MS) };
}

function claudeEnvironment(cli: ClaudeCliInfo): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...cliPathEnvironment(cli),
    ...(cli.source === "managed" ? { DISABLE_AUTOUPDATER: "1" } : {}),
  };
}

function claudeRateLimits(value: unknown, model: string | null): AccountRateLimitsReadResult {
  if (!isDynamicRecord(value) || value.rate_limits_available !== true || !isDynamicRecord(value.rate_limits)) {
    return { rateLimits: null, rateLimitsByLimitId: null };
  }
  const rateLimits = value.rate_limits;
  const primary = claudeUsageWindow(rateLimits.five_hour, 300);
  const secondary = claudeUsageWindow(rateLimits[claudeWeeklyKey(rateLimits, model)], 10_080);
  if (!primary && !secondary) return { rateLimits: null, rateLimitsByLimitId: null };
  return {
    rateLimits: { limitId: "claude", primary, secondary },
    rateLimitsByLimitId: null,
  };
}

function claudeWeeklyKey(rateLimits: DynamicRecord, model: string | null): string {
  const name = model?.toLowerCase() ?? "";
  const familyKey = name.includes("opus") ? "seven_day_opus" : name.includes("sonnet") ? "seven_day_sonnet" : null;
  return familyKey && claudeUsageWindow(rateLimits[familyKey], 10_080) ? familyKey : "seven_day";
}

function claudePushedWindows(
  info: DynamicRecord,
  weeklyKey: string,
): { primary?: AccountRateLimitWindowResult; secondary?: AccountRateLimitWindowResult } | null {
  const windows = isDynamicRecord(info.unifiedWindows)
    ? info.unifiedWindows
    : isString(info.rateLimitType)
      ? { [info.rateLimitType]: info }
      : {};
  const primary = claudePushedWindow(windows.five_hour, 300);
  const secondary = claudePushedWindow(windows[weeklyKey], 10_080);
  if (!primary && !secondary) return null;
  return { ...(primary && { primary }), ...(secondary && { secondary }) };
}

function claudePushedWindow(value: unknown, windowDurationMins: number): AccountRateLimitWindowResult | null {
  if (!isDynamicRecord(value)) return null;
  const utilization = numberValue(value.utilization);
  if (utilization === null || utilization < 0) return null;
  return { usedPercent: utilization * 100, windowDurationMins, resetsAt: claudeResetSeconds(value.resetsAt) };
}

function claudeUsageWindow(value: unknown, windowDurationMins: number): AccountRateLimitWindowResult | null {
  if (!isDynamicRecord(value)) return null;
  const usedPercent = numberValue(value.utilization) ?? numberValue(value.percent);
  if (usedPercent === null) return null;
  const reset = stringValue(value.resets_at) ?? stringValue(value.resetsAt);
  const resetMilliseconds = reset ? Date.parse(reset) : Number.NaN;
  return {
    usedPercent,
    windowDurationMins,
    resetsAt: Number.isFinite(resetMilliseconds) ? resetMilliseconds / 1_000 : null,
  };
}

function claudeUsageLimitRefusal(message: ClaudeStreamMessage): { resetsAt: number | null } | null {
  const params = isDynamicRecord(message.api_error_params) ? message.api_error_params : null;
  const info = params && isDynamicRecord(params.rate_limit_info) ? params.rate_limit_info : null;
  if (message.api_error !== "usage_limit_reached" && info?.status !== "rejected") return null;
  return { resetsAt: claudeResetSeconds(info?.resetsAt) };
}

function claudeResetSeconds(value: unknown): number | null {
  if (!isNumber(value) || !Number.isFinite(value) || value <= 0) return null;
  return value > 100_000_000_000 ? value / 1_000 : value;
}

function stringValue(value: unknown): string | null {
  return isString(value) && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

class AsyncMessageQueue implements AsyncIterable<SDKUserMessage> {
  readonly #values: SDKUserMessage[] = [];
  readonly #waiters: Array<(result: IteratorResult<SDKUserMessage>) => void> = [];
  #closed = false;

  push(value: SDKUserMessage): void {
    if (this.#closed) throw new Error("Claude input queue is closed.");
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.#values.push(value);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const value = this.#values.shift();
        if (value) return Promise.resolve({ done: false, value });
        if (this.#closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => this.#waiters.push(resolve));
      },
    };
  }
}

function readThreadConfig(params: unknown): ThreadConfig {
  const roots =
    isRecord(params) && Array.isArray(params.runtimeWorkspaceRoots)
      ? params.runtimeWorkspaceRoots.filter((value): value is string => isString(value))
      : [];
  const cwd = requiredString(params, "cwd");
  const model = getString(params, "model");
  const effort = getString(params, "effort");
  return {
    cwd,
    ...(model === null ? {} : { model }),
    ...(effort === null ? {} : { effort }),
    developerInstructions: getString(params, "developerInstructions") ?? "",
    additionalDirectories: [...new Set([cwd, ...roots])],
    persistSession: !isRecord(params) || params.persistSession !== false,
    profileGeneration: isRecord(params) && params.profileGeneration === true,
    outputSchema:
      isRecord(params) && params.profileGeneration === true && isDynamicRecord(params.outputSchema)
        ? params.outputSchema
        : null,
    computerUse: computerUseParam(params),
    channelTools: isRecord(params) && params.channelTools === true,
    workspaceOnly: isRecord(params) && params.workspaceOnly === true,
    excludedFolders:
      isRecord(params) && Array.isArray(params.excludedFolders)
        ? params.excludedFolders.filter((value): value is string => isString(value))
        : [],
    excludedInstructionFiles:
      isRecord(params) && Array.isArray(params.excludedInstructionFiles)
        ? params.excludedInstructionFiles.filter((value): value is string => isString(value))
        : [],
    agentId: mcpAgentParam(params),
  };
}

function threadConfigKey(config: ThreadConfig, withModel: boolean): string {
  const fields = {
    ...config,
    model: withModel ? (config.model ?? null) : null,
    effort: withModel ? (config.effort ?? null) : null,
  };
  return JSON.stringify(Object.entries(fields).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function textEnds(text: string): string {
  const half = Math.floor(INPUT_LIMITS.messageText / 2);
  return text.length <= INPUT_LIMITS.messageText ? text : `${text.slice(0, half)}\n…\n${text.slice(-half)}`;
}

function parseAuthStatus(stdout: unknown): DynamicRecord | null {
  if (!isString(stdout)) return null;
  try {
    const status = JSON.parse(stdout);
    return isRecord(status) && typeof status.loggedIn === "boolean" ? status : null;
  } catch {
    return null;
  }
}

function readInputText(params: unknown): string {
  if (!isRecord(params) || !Array.isArray(params.input)) return "";
  return params.input
    .filter(isRecord)
    .filter((item) => item.type === "text" && isString(item.text))
    .map((item) => item.text)
    .join("\n");
}

const readInputImages = Effect.fnUntraced(function* (params: unknown) {
  const paths = getArray(params, "input").flatMap((item) =>
    isRecord(item) && item.type === "localImage" && isString(item.path) ? [item.path] : [],
  );
  return yield* Effect.forEach(paths, (path) =>
    Effect.gen(function* () {
      const mediaType = attachmentMimeTypeForName(path);
      if (!isOneOf(CLAUDE_IMAGE_TYPES, mediaType))
        return yield* providerFailure(new Error(sourceText("error.workflow.modelImageType")));
      const data = yield* providerCall(() => readFile(path));
      return {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: data.toString("base64") },
      } as const;
    }),
  );
});

function messageText(message: unknown): string {
  if (!isRecord(message)) return "";
  if (isString(message.content)) return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter(isRecord)
    .filter(
      (block) =>
        block.type === "text" && isString(block.text) && !(message.role === "user" && isTurnContextBlock(block.text)),
    )
    .map((block) => block.text)
    .join("\n");
}

function textBeforeThinking(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) return "";
  const blocks = message.content.filter(isRecord);
  const boundary = blocks.findIndex((block) => block.type === "thinking");
  if (boundary < 0) return "";
  const before = blocks
    .slice(0, boundary)
    .filter((block) => block.type === "text" && isString(block.text))
    .map((block) => String(block.text));
  if (before.length === 0) return "";
  const follows = blocks.slice(boundary + 1).some((block) => block.type === "text" && isString(block.text));
  return `${before.join("\n")}${follows ? "\n" : ""}`;
}

function messageThinkingBlocks(message: unknown): string[] {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content
    .filter(isRecord)
    .filter((block) => block.type === "thinking")
    .map((block) => getString(block, "thinking") ?? "");
}

function messageThinking(message: unknown): string {
  return messageThinkingBlocks(message).filter(Boolean).join("\n");
}

function messageToolCalls(message: unknown): Array<{ id: string; name: string; input: unknown }> {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord).flatMap((block) => {
    const id = getString(block, "id");
    const name = getString(block, "name");
    return block.type === "tool_use" && id && name ? [{ id, name, input: block.input }] : [];
  });
}

function messageToolResults(message: unknown): Array<{ id: string; text: string; isError: boolean }> {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  return message.content.filter(isRecord).flatMap((block) => {
    const id = getString(block, "tool_use_id");
    if (block.type !== "tool_result" || !id) return [];
    const content = block.content;
    const text = isString(content)
      ? content
      : Array.isArray(content)
        ? content
            .filter(isRecord)
            .map((part) => getString(part, "text") ?? "")
            .join("\n")
        : "";
    return [{ id, text, isError: block.is_error === true }];
  });
}

function dynamicContent(value: unknown): CallToolResult["content"] {
  if (!isRecord(value)) return [];
  if (value.type === "inputText" && isString(value.text)) {
    return [{ type: "text" as const, text: value.text }];
  }
  if (value.type === "inputImage" && isString(value.imageUrl)) {
    const [, mimeType, data] = value.imageUrl.match(/^data:([^;]+);base64,(.+)$/s) ?? [];
    if (mimeType !== undefined && data !== undefined) return [{ type: "image" as const, mimeType, data }];
  }
  return [];
}

function normalizeClaudeModel(model: string): string {
  return model.startsWith("claude-") ? model : defaultProviderModel("claude");
}

function normalizeClaudeEffort(effort: string): ClaudeEffort {
  return isOneOf(CLAUDE_EFFORTS, effort) ? effort : "high";
}

function promptUuid(runtime: ThreadRuntime, requested: string | null | undefined): UUID {
  const run = requested && isUuid(requested) ? untakenRunId(requested, runtime.promptIds) : null;
  return run && isUuid(run) ? run : randomUUID();
}

function claudeCacheWriteTtlMs(message: unknown): number | null {
  const written = getRecord(getRecord(message, "usage"), "cache_creation");
  const tokens = (key: string) => {
    const value = written?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  };
  if (tokens("ephemeral_5m_input_tokens") > 0) return CLAUDE_CACHE_TTL_MS.short;
  if (tokens("ephemeral_1h_input_tokens") > 0) return CLAUDE_CACHE_TTL_MS.long;
  return null;
}

function takePrompt(runtime: ThreadRuntime, uuid: string): void {
  runtime.promptIds.add(uuid);
  for (const old of runtime.promptIds) {
    if (runtime.promptIds.size <= TAKEN_PROMPT_LIMIT) break;
    runtime.promptIds.delete(old);
  }
}

function takenMessageIds(message: ClaudeStreamMessage): string[] {
  const listed = Array.isArray(message.user_message_uuids) ? message.user_message_uuids.filter(isString) : [];
  return listed.length > 0 ? listed : message.user_message_uuid ? [message.user_message_uuid] : [];
}

function isOtherTurnResult(message: ClaudeStreamMessage, messageIds: ReadonlySet<string>): boolean {
  const taken = takenMessageIds(message);
  if (taken.length > 0) return !taken.some((uuid) => messageIds.has(uuid));
  return (
    isRecord(message.origin) &&
    message.origin.kind === "task-notification" &&
    message.num_turns === 0 &&
    message.subtype === "success" &&
    message.is_error !== true &&
    !message.result
  );
}

function failedClaudeMcpServers(servers: unknown): string[] {
  if (!Array.isArray(servers)) return [];
  return servers.flatMap((server) => {
    const name = getString(server, "name");
    return name && getString(server, "status") === "failed" ? [name] : [];
  });
}

function isUuid(value: string): value is UUID {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function claudeTurnModelUsage(
  requests: Iterable<{ model: string; usage: unknown }>,
): Record<string, Record<string, number | null>> {
  const models: Record<string, Record<string, number | null>> = {};
  for (const { model, usage } of requests) {
    if (!isDynamicRecord(usage)) continue;
    const total = models[model] ?? {
      inputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      smallestRequestInputTokens: Number.POSITIVE_INFINITY,
    };
    models[model] = total;
    let prompt: number | null = 0;
    for (const [key, field] of [
      ["inputTokens", "input_tokens"],
      ["cacheReadInputTokens", "cache_read_input_tokens"],
      ["cacheCreationInputTokens", "cache_creation_input_tokens"],
      ["outputTokens", "output_tokens"],
    ] as const) {
      const value = usage[field] ?? 0;
      const sum = total[key];
      total[key] = isNumber(value) && isNumber(sum) ? sum + value : null;
      if (key !== "outputTokens") prompt = isNumber(value) && prompt !== null ? prompt + value : null;
    }
    const smallest = total.smallestRequestInputTokens;
    total.smallestRequestInputTokens = isNumber(smallest) && prompt !== null ? Math.min(smallest, prompt) : null;
  }
  return models;
}

function claudeStepTarget(name: string, input: unknown): Record<string, string> {
  if (!isRecord(input)) return {};
  const text = (key: string) => (typeof input[key] === "string" ? input[key].slice(0, INPUT_LIMITS.identifier) : null);
  const path = name === "Read" ? text("file_path") : null;
  const pattern = name === "Grep" || name === "Glob" ? text("pattern") : null;
  const query = name === "WebSearch" ? text("query") : null;
  const url = name === "WebFetch" ? text("url") : null;
  return {
    ...(path ? { path } : {}),
    ...(pattern ? { pattern } : {}),
    ...(query ? { query } : {}),
    ...(url ? { url } : {}),
  };
}

function completedToolInput(input: unknown): Record<string, string> {
  const kept: Record<string, string> = {};
  if (!isRecord(input)) return kept;
  for (const key of ["skill", "command", "file_path", "path"])
    if (typeof input[key] === "string") kept[key] = input[key];
  return kept;
}
