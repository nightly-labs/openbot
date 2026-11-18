import { win32 } from "node:path";
import {
  type LoadSessionResponse,
  type NewSessionRequest,
  type PromptResponse,
  RequestError,
  type SessionUpdate,
} from "@agentclientprotocol/sdk";
import { agentProviderName } from "@openbot/contracts/agent-providers";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { type CauseCode, classifyFailure } from "@openbot/telemetry";
import type { GeneratedMediaKind } from "./agent/image-generation";
import { enableCursorMcpServers } from "./cursor-mcp-disabled";
import { grokMediaItem, grokMediaKind, grokMediaToolKind } from "./grok-media";
import { grokMcpServerName } from "./mcp-provider-shapes";
import { isRecord, type ThreadItem } from "./protocol";

/** An agent's notice that it sends a failed model request again (`AcpFlavor.retryNotice`). */
interface AcpRetryNotice {
  readonly sessionId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  /** The agent could not connect to its server. Else the server answered with an error or stopped answering. */
  readonly unreachable: boolean;
}

/**
 * Why a model request failed: the agent could not connect to the model provider, the model server ran
 * out of memory for the request, or the provider answered with another error or stopped answering.
 */
export type AcpRetryCause = "unreachable" | "outOfMemory" | "serverError";

/** A session update that says that the agent sends a failed model request again (`AcpFlavor.retryUpdate`). */
interface AcpRetryUpdate {
  /** The number of the retry: 1 for the first request after the failed one. */
  readonly attempt: number;
  readonly cause: AcpRetryCause;
}

/** The custom endpoint that serves a model, as a turn's error names it. Never a credential itself. */
export interface AcpCustomEndpoint {
  readonly name: string;
  /** Whether the endpoint has a saved API key or header. */
  readonly hasCredentials: boolean;
  /** How long a turn on this endpoint may send nothing before it fails. The agent's own limit when absent. */
  readonly stallMs?: number;
}

/** An MCP server that the agent could not start for one session, as `AcpFlavor.mcpServerFailure` reads it. */
export interface AcpMcpServerFailure {
  readonly sessionId: string;
  /** The name that the server travels under to the agent. */
  readonly name: string;
  readonly reason: string;
}

/**
 * What one ACP agent does differently from the protocol. `AcpAgentClient` reads each hook at the
 * place that the agent's behavior changes; an absent hook is the protocol's own behavior. Add a hook
 * only for an observed agent version, and name that version where the hook is set.
 */
export interface AcpFlavor {
  /**
   * Tool calls that make an image or a video. `kind` gives the media kind of one update, or null.
   * The client keeps the kind of each call, because a later update can leave the tool out. `item`
   * gives the `imageGeneration` or `videoGeneration` item that the chat shows in place of the call,
   * from the tool item with all updates so far and the content of the last update. `permitted` gives
   * the media kind of a permission request from the tool name that the CLI sets only, never from the
   * arguments that the model writes.
   */
  mediaTools?: {
    kind(update: {
      _meta?: unknown;
      title?: string | null;
      rawInput?: unknown;
      rawOutput?: unknown;
    }): GeneratedMediaKind | null;
    item(kind: GeneratedMediaKind, call: ThreadItem, content: unknown): ThreadItem;
    permitted(request: { _meta?: unknown; title?: string | null }): GeneratedMediaKind | null;
  };
  /** The `clientInfo` that `initialize` sends. Absent: `OPENBOT_ACP_CLIENT_INFO`. */
  clientInfo?: { name: string; title: string; version: string };
  /**
   * Whether an error names this missing session. `null` gives the decision to the protocol's
   * `-32002` rule. Another error code or another session must never replace a provider session.
   */
  sessionNotFound?(error: RequestError, sessionId: string): boolean | null;
  /**
   * Whether ACP's `authRequired` error (`-32000`) to a new session means that the saved sign-in
   * stopped working. The client then reports the sign-out, as at its start. Absent: the error is the
   * session's failure only.
   */
  authRequiredSignsOut?: boolean;
  /**
   * The message of a failed turn, from the redacted failure text. `redact` masks more text, `log`
   * writes a diagnostic that it redacts first, and `model` is the session's model. `endpoint` is the
   * custom endpoint that serves that model, or null. `savedKey` tells whether OpenBot sent a saved
   * API key for the provider of that model. `providerKeyStored` reads, at each call, whether the
   * agent's own store has a key for a provider. `label` is the agent's name for the user.
   * `refusalStatus` reads the HTTP status of the provider refusal that the agent's own store keeps
   * for this turn, or null.
   */
  turnFailure?(
    error: unknown,
    detail: string,
    redact: (text: string) => string,
    log: (text: string) => void,
    model: string | null,
    endpoint: AcpCustomEndpoint | null,
    savedKey: boolean,
    providerKeyStored: (provider: string) => boolean,
    label: string,
    refusalStatus: () => number | null,
  ): string;
  /**
   * The cause of a turn's failure that the agent names in a structured field, such as an error name
   * in the error's data or a stop reason that means another thing for this agent. `null` gives the
   * decision to the protocol's rules. It is a fixed code; it never carries the error's text. `answer`
   * is the answer text that the turn ended with, for an agent that gives the reason only there.
   */
  failureCause?(error: unknown, answer: string): CauseCode | null;
  /**
   * The whole answer text of a failed turn that is the agent's own report of the failure, not text
   * of the model. The turn did not start to answer, so a backup model can take it.
   */
  failureReport?: RegExp;
  /**
   * The message of a turn that ended with no answer text, or `null` when that turn succeeds.
   * Absent: such a turn succeeds.
   */
  emptyAnswerFailure?(
    turn: { reasoned: boolean; answered: boolean; showedPlanOrCompaction: boolean },
    label: string,
  ): string | null;
  /**
   * The failure text of a prompt that the agent failed because the model gave no answer. The turn
   * then ends as a turn with no answer does, not with the agent's own error text.
   */
  emptyAnswerError?: RegExp;
  /**
   * What to do when `session/load` or `session/resume` fails: wait once for a process that still
   * starts, or list the sessions to find out whether this one exists. `list-sessions` tries a listed
   * session once more; `confirm-missing` reports the failure of a listed session as it is. `null`
   * reports the failure.
   */
  restoreFailure?(
    error: unknown,
    method: "load" | "resume",
  ): "wait-for-start" | "list-sessions" | "confirm-missing" | null;
  /**
   * A turn that the agent lost, after which it refuses each request of the session until the turn is
   * discarded. `refusal` matches the text of that refusal, and `unsent` the refusal of a prompt that
   * the agent did not take. `discard` gives the arguments of the agent's command that discards the
   * lost turns of a session. OpenBot never sends a prompt again that the agent took.
   */
  lostTurns?: { refusal: RegExp; unsent: RegExp; discard(sessionId: string): readonly string[] };
  /**
   * Whether a failed prompt is a refusal after which the agent's process can refuse each prompt
   * until it ends. OpenBot then ends a process that answered a prompt before, when no other turn
   * runs on it, so the next message starts a new process. A process that refuses from its first
   * prompt is not ended again.
   */
  refusesUntilRestart?(error: unknown): boolean;
  /**
   * Whether a failed request says that the agent lost the connection to its own server, after which
   * its process can fail each request until it ends. OpenBot then ends the process as for
   * `refusesUntilRestart`, also when the session open or a settings change of a turn fails.
   */
  lostServerUntilRestart?(error: unknown): boolean;
  /**
   * Whether a failed prompt says that the agent lost its own server, which can come a moment before
   * its process exits. The turn then waits for that exit, as for a closed connection, so it ends as
   * at a process exit: the recovery continues an answer that the exit cut (#10310).
   */
  serverLost?(error: unknown): boolean;
  /**
   * Whether the agent refused to open a session again because a prompt still runs in it, such as a
   * stopped prompt whose command goes on. Nothing ran, so the message waits and is sent again.
   */
  sessionBusy?(error: unknown): boolean;
  /** A failed, timed-out or empty model refresh keeps the last list that the agent gave. */
  keepModelsOnRefreshFailure?: true;
  /**
   * The model belongs to the agent's process, not to one session: a model set moves every session
   * to it. A set of the model the process already runs on is not sent again.
   */
  processWideModel?: true;
  /**
   * A model or effort that the session already has is not sent again before a turn. Each set makes
   * the agent do slow work of its own, and a set that does not answer in time fails the turn.
   */
  setsConfigOnlyOnChange?: true;
  /**
   * A `session/set_model` failure after which the session already runs on the new model. The agent
   * changes the session first and then fails to save the model as its default.
   */
  modelSetUnsaved?(error: RequestError): boolean;
  /**
   * A `session/set_config_option` failure after which the session already has the new value. The
   * agent changes the session first and then fails to save the value as its default.
   */
  configSetUnsaved?(error: RequestError): boolean;
  /**
   * The agent frees what a session holds only when its process ends, not at `session/close`. Model
   * discovery then resumes one probe session for each process rather than opening another.
   */
  closeKeepsSession?: true;
  /** How long a model discovery session stays open after discovery read it. Absent: it closes at once. */
  probeCloseDelayMs?: number;
  /**
   * The categories of the select option that holds the reasoning effort. Absent: the protocol's
   * `thought_level` only. The option then goes to the Effort menu, not to the provider settings.
   */
  effortCategories?: readonly string[];
  /**
   * Each session gets a process of its own, and an idle session is closed by ending that process.
   * For an agent with `closeKeepsSession`, or one that shares MCP servers between its sessions.
   */
  sessionProcesses?: true;
  /** An agent that sends a failed prompt as answer text and ends the turn as a success. */
  sdkHarness?: {
    /** The session whose prompt failed, from a stderr line. */
    failedSession(stderrLine: string): string | undefined;
    /** The start of an answer that is the failure text, when no stderr line came. */
    answerIsFailure: RegExp;
    /**
     * The number of the failed model request that an answer chunk reports while the agent tries it
     * again, or `null`. The chunk is a status of the turn, not its answer and not yet its failure.
     */
    retryNotice?(text: string): number | null;
    /** The failure text of a model step that ended with neither text nor tool calls. */
    emptyOutputFailure?: RegExp;
    /**
     * A tool call that the model wrote as answer text, which the agent does not run: the words that
     * one starts with, and the whole text of one. The text is held back, and a turn that ends on it
     * ends as a turn with no answer.
     */
    textToolCall?: { starts: readonly string[]; whole: RegExp };
    /** The message of a turn that failed in this way, from the failure text. */
    turnFailure(text: string): string;
    /**
     * The cause of a turn that failed in this way, from the same rules as `turnFailure`, or `null`.
     * It counts only when the generic text rules name no cause, so a cause that they name stays.
     */
    fallbackCause?(text: string): CauseCode | null;
    /**
     * The https link that the user must open to fix their account, from the failure text or, for a
     * text that names no link, from the agent's own log, or `null`. The turn fails as a sign-in
     * failure, and the error banner opens the link.
     */
    accountLink?(text: string, argv: readonly string[], sessionId: string): string | null;
    /** A failure text that asks the user to verify their account: the turn fails as a sign-in failure. */
    accountVerification?: RegExp;
    /** The message of an answer chunk that reports an exhausted quota, or `null`. */
    quota(text: string): string | null;
    /** The MCP server whose failed start ended the turn, from the failure text, or `null`. */
    mcpLoadFailure(text: string): { name: string; reason: string } | null;
    /**
     * The MCP tools whose parameter schema the agent refused in the session's last prompt, from the
     * failure text, or from the agent's own log when the text names no cause. When Google refused a
     * tool, the text names only its fields, and the tools come from the schemas that the agent saved.
     * Each name is `mcp_<server>_<tool>`.
     */
    refusedMcpTools?(text: string, argv: readonly string[], sessionId: string): string[];
    /** A failure text after which the agent no longer has the session, so the next prompt opens it again. */
    sessionLost?: RegExp;
  };
  /** A stop finishes the turn locally, and the next prompt opens the session again first. */
  cancelLocallyThenResume?: true;
  /**
   * The CLI version from which a second `session/prompt` during a running turn joins that turn. The
   * CLI answers the prompt before it with `end_turn`, and the work goes on under the new prompt.
   * Without it or `steerByPromptCapability`, ACP has no steer request, and a second prompt can cancel
   * the running turn.
   */
  steerByPromptSince?: string;
  /**
   * The `agentCapabilities._meta` key that is `true` when a second `session/prompt` during a running
   * turn joins that turn, for a CLI whose `agentInfo.version` does not tell the release.
   */
  steerByPromptCapability?: string;
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
   * The agent continues a dropped answer in a new model step of the same turn, so a thought after
   * answer text, with no tool call between, does not end the answer. A tool call or the end of the
   * turn still does. A line break joins the two parts when neither side has a space at the seam.
   * `report` is the agent's notice of the dropped stream, which shows as a thought.
   */
  resumesAnswerAfterThought?: { report: RegExp };
  /**
   * `session/prompt` stays open with no update while background tasks run, so a silent turn is not
   * stalled and OpenBot does not end it (`ACP_TURN_STALL_MS`). A prompt that gets no update at all
   * is sent again once, and then fails (`ACP_FIRST_UPDATE_MS`).
   */
  promptOpenForBackgroundTasks?: true;
  /**
   * The agent answers a finished background task in a turn of its own and sends no session update
   * for it. Only its `session/load` replays that turn. A tool call that leaves a task running ends
   * with `rawOutput.metadata.status` "running" and the task's `sessionID`, or the `shellID` of a
   * shell command that runs in the background.
   */
  unsentBackgroundTurns?: true;
  /**
   * The agent can end a prompt with `end_turn` while a command (`execute` tool call) that it moved to
   * the background still runs, and then wakes its model by itself when the command ends. With no
   * prompt open, it sends no update and no permission request for that work. OpenBot keeps the turn
   * open, and when `session/list` shows that the session changed, a second prompt connects the work
   * again. A command with `rawInput.IsDaemon` runs on by intent and does not keep the turn open.
   */
  wakesAfterPromptEnds?: true;
  /**
   * The tool calls after which the agent wakes its model by itself, such as subagents that run in the
   * background and timers, as a pattern of the call's name. The agent reports no end of that work.
   * With `wakesAfterPromptEnds`, it wakes with no prompt open, so OpenBot starts a turn with a wake
   * prompt when `session/list` shows that the session changed after the turn.
   */
  selfWakeTools?: RegExp;
  /** Each answer message has its own `messageId`, so text of a new ID is a new message, not more text. */
  messagePerId?: true;
  /**
   * The agent can send an answer again after it streamed it, as one chunk with the same `messageId`,
   * and that chunk replaces the streamed text. ACP adds such a chunk to the message. At the end of
   * the turn, a last chunk that holds all of the text before it in its message replaces that text,
   * when two or more chunks of the message came before it.
   */
  resendsAnswer?: true;
  /**
   * OpenCode sends the work of its subagents as `opencode/session/child_update` notifications when
   * the client asks for them, and they show in the subagent card, not in the parent's steps.
   */
  childSessionUpdates?: true;
  /**
   * An extension notification that says that the agent sends a failed model request again, else null.
   * The prompt is still in progress, so such a notice keeps its turn from ending as stalled, as a
   * session update does, and the chat shows the retry.
   */
  retryNotice?: (method: string, params: DynamicRecord) => AcpRetryNotice | null;
  /**
   * A session update that says that the agent sends a failed model request again, else null. The agent
   * does not say how many times it tries. The chat shows the retry until the agent's next output.
   */
  retryUpdate?: (update: SessionUpdate) => AcpRetryUpdate | null;
  /**
   * Whether a session update reports a retry of a model request that timed out: a retry that the agent
   * schedules, or the end of a retried attempt. The agent waits for a model as long as OpenBot's stall
   * limit, then retries, so OpenBot waited exactly as long and ended each such turn as the retry started (#9941).
   * For such an agent OpenBot waits `ACP_MODEL_RETRY_GRACE` times the limit, and only the first retry
   * notice after the last output counts as activity: one retry gets the whole limit, not all of them.
   */
  modelRetryUpdate?: (update: SessionUpdate) => boolean;
  /**
   * How long a turn may send nothing before OpenBot ends it as stalled (`ACP_TURN_STALL_MS` when
   * absent), for an agent that waits longer for a silent model stream than that and then gives a
   * notice of its own. Only the turn's stall watch uses it, not the checks of a process that stopped.
   */
  turnStallMs?: number;
  /**
   * The tools that run a subagent and send no events of it, as the tool name or `<name>: <description>`.
   * Each call shows as a subagent with its task, state, and report.
   */
  subagentTools?: readonly string[];
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
  /**
   * How long the agent waits for an MCP server of a session to connect. Then it continues without the
   * server and does not connect again while the server's settings stay the same. A session that
   * OpenBot's servers did not reach in time is restored once with new tokens.
   */
  mcpConnectLimitMs?: number;
  /**
   * The agent drops a stdio MCP server of `session/new` and `session/load` with no error, although
   * ACP requires stdio, or keeps it running after the session closes. OpenBot starts each one itself
   * (`startStdioMcpRelay`), sends it as http, and stops it when the session closes.
   */
  relayStdioMcpServers?: true;
  /**
   * The MCP server that an extension notification reports as not started, or `null`. The agent
   * leaves the server out of the session with no error, so OpenBot reports it as a dropped server.
   */
  mcpServerFailure?(method: string, params: DynamicRecord): AcpMcpServerFailure | null;
  /**
   * The agent's own rule for an MCP server name, applied after `providerMcpServerName`. The agent
   * skips each tool of a server whose name breaks the rule, with no error.
   */
  mcpServerName?(name: string): string;
  /**
   * The MCP server names in the agent's own files for `cwd`. The agent starts its own entry in place
   * of a session server with the same name, so that server travels as `openbot_<name>`. `argv` is
   * the command line of the agent's process, which can name the folder of those files.
   */
  ownMcpServerNames?(cwd: string, argv: readonly string[]): readonly string[];
  /**
   * The most MCP servers that the agent takes in one session, OpenBot's own servers included. The
   * agent refuses a session with more, so OpenBot gives it the first of the user's servers that fit.
   */
  mcpServerLimit?: number;
  /** Turns OpenBot's servers back on where the agent's own settings for `cwd` turned them off. */
  enableMcpServers?(cwd: string, names: readonly string[]): void;
  /**
   * The agent stops each MCP tool call after this time, also when OpenBot sends progress, and a
   * session server cannot change it. A call that waits for the user answers before then (#9689).
   */
  mcpToolCallLimitMs?: number;
  /**
   * The agent keeps the tools that a session has at its first turn. A server that the agent gets
   * later, such as on `session/load` or `session/resume` after the user added it, reaches the model
   * only as a note, and the model cannot call its tools. A changed MCP set must start a new session.
   */
  mcpToolsFixedAtStart?: true;
  /**
   * The agent hides all MCP tools behind its own tool search, so each OpenBot catalog tool is also an
   * MCP tool of its own (`withCatalogTools`). Behind OpenBot's own search, the model must find OpenBot's
   * tool_call with the agent's search, and the agent's tool_call refused `openbot.channel_result` (#9312).
   */
  catalogAsMcpTools?: true;
  /** OpenBot compacts by replacing the session, for an agent that reports `usage_update` and has no compact request. */
  contextCompaction?: "handoff";
  /**
   * The agent compacts its own context, and OpenBot cannot ask it to. The context meter then says that
   * the provider manages compaction. The ACP client sees each compaction when the context shrinks.
   */
  compactsItself?: true;
  /**
   * The agent opens a saved session again with all of its prompts. A session that an idle release
   * closed keeps the instructions that it got, so its next prompt does not send them again.
   */
  reopenKeepsPrompts?: true;
  /** A whole answer chunk that is the agent's own transport error, not answer text. OpenBot drops it. */
  noiseChunk?: RegExp;
  /**
   * A whole answer chunk that tells that the agent's process lost its sign-in. OpenBot fails the
   * turn and ends the process, so the next turn starts a process that reads the sign-in again.
   */
  signInLostChunk?: RegExp;
  /**
   * The text for a session that the agent could not open because its server refused the saved
   * sign-in or did not answer, or null for another error. The start asks once more, because the
   * failure can be short, and then asks the user to sign in again.
   */
  signInUnusable?(error: RequestError): string | null;
  /**
   * A whole answer chunk that tells that the plan is used up, sent as answer text in a turn that
   * then ends as a success. OpenBot fails the turn as a usage limit, so a backup model can take it.
   */
  planUsedUpChunk?: RegExp;
  /**
   * The agent runs an approved edit under a second tool call id. At the end of the turn it reports
   * the approved id as failed with this text, although the edit ran. OpenBot shows the approved call
   * as completed when an edit of the same file, or the only approved edit, completed under another
   * id in the turn. Without such an edit, the failure stays.
   */
  approvedEditSweep?: RegExp;
  /** The `_meta` of each `session/new`, `session/load` and `session/resume` request. */
  sessionMeta?: NewSessionRequest["_meta"];
  /**
   * The agent reads the project files (instructions, skills, hooks) only of a folder that the user
   * trusted or that the session adds. OpenBot puts the workspace first in `additionalDirectories` of
   * each `session/new`, `session/load` and `session/resume`, and sends them although the agent does
   * not advertise them.
   */
  workspaceAsAdditionalDirectory?: true;
  /**
   * OpenBot opens a saved session with `session/load`, also when the agent advertises
   * `session/resume`, and this tells from a successful load reply that the session is missing.
   */
  loadInsteadOfResume?: { missing(response: LoadSessionResponse): boolean };
  /** The usage of this prompt alone, for an agent that sends it in the `_meta` of the prompt result, not in `usage`. */
  promptUsage?(response: PromptResponse): DynamicRecord | null;
  /**
   * The run of the agent that a prompt reply ends. Replies of the same run carry the same usage, so
   * a steered turn reports it once.
   */
  promptRun?(response: PromptResponse): string | undefined;
  /**
   * The agent asks the user its questions with this extension method (the name without the `_` of
   * the wire) and reads a reply of its own shape. `answers` has the answers of each question by its
   * id; a question with no answer has none.
   */
  userQuestions?: {
    method: string;
    reply(
      questions: readonly { id: string; question: string }[],
      answers: Readonly<Record<string, readonly string[]>>,
    ): DynamicRecord;
  };
}

/** The protocol's own behavior, with no change for one agent. */
export const DEFAULT_ACP_FLAVOR: AcpFlavor = {};

/**
 * The billing wall of Cursor and GitHub Copilot when the account needs a payment method for more use
 * (#4556, #9808). As answer text, only the whole chunk matches, so an answer that quotes it stays an
 * answer. In an error, the text can be part of a longer message.
 */
const PAYMENT_METHOD_WALL = /^\s*Add a payment method to continue\.?\s*$/u;
const PAYMENT_METHOD_WALL_TEXT = /\bAdd a payment method to continue\b/u;

/** Cline CLI 3.0.68 runs a subagent with its `spawn_agent` tool: `{ systemPrompt, task }`, result `{ text }`. */
export const CLINE_ACP_FLAVOR: AcpFlavor = {
  subagentTools: ["spawn_agent"],
  // Cline CLI 3.0.74 throws its `SessionNotFoundError` when its hub no longer has the session, and the
  // ACP SDK sends it as "Internal error" with `data.details` "session not found: <id>". OpenBot kept
  // the session, so each message failed, also after a restart (#11096). Only this session counts.
  sessionNotFound: (error, sessionId) =>
    error.code === -32603 ? isRecord(error.data) && error.data.details === `session not found: ${sessionId}` : null,
};

/**
 * GitHub Copilot CLI 1.0.105 advertises only http and sse MCP servers, and drops a stdio one, so its
 * agents had no Computer Use and no stdio server of the user (github/copilot-cli#3889).
 */
export const COPILOT_ACP_FLAVOR: AcpFlavor = {
  relayStdioMcpServers: true,
  turnFailure: copilotTurnFailure,
  // GitHub Copilot CLI 1.0.112 sent its billing wall as the whole answer, or as the turn's error. The
  // chat showed only "Add a payment method to continue", and no backup model took the turn (#9808).
  planUsedUpChunk: PAYMENT_METHOD_WALL,
  failureCause: (error) => (PAYMENT_METHOD_WALL_TEXT.test(errorText(error)) ? "usage_limit" : null),
  // GitHub Copilot CLI 1.0.112 compacts its session by itself. The context meter said "This agent
  // does not compact its context." (#10643).
  compactsItself: true,
};

/**
 * GitHub Copilot CLI 1.0.105 writes the model request. For some models it sends
 * `thinking.type.enabled`, which GitHub's service refuses with a 400, and each turn on that model
 * fails. The chat showed "Execution failed: CAPIError: 400 ..." (#8222). OpenBot sends only the model
 * and the effort, so the user's action is another model.
 */
function copilotTurnFailure(_error: unknown, detail: string): string {
  if (PAYMENT_METHOD_WALL_TEXT.test(detail))
    return sourceText("error.provider.acpPlanUsedUp", { provider: agentProviderName("copilot") });
  return /"thinking\.type\.enabled" is not supported for this model/u.test(detail)
    ? sourceText("error.provider.copilotThinkingRejected")
    : detail;
}

/** The message of an error and the data that it carries, such as the `RequestError` of a prompt. */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const data = isRecord(error) && "data" in error ? JSON.stringify(error.data) : undefined;
  return data ? `${error.message} ${data}` : error.message;
}

/**
 * A turn that ended as done with no answer text and no tool call fails, also when it sent its
 * reasoning. A plan or a compaction shows in the chat, so such a turn still succeeds.
 */
function noAnswerUnlessPlanOrCompaction(
  { showedPlanOrCompaction }: { showedPlanOrCompaction: boolean },
  label: string,
): string | null {
  return showedPlanOrCompaction ? null : sourceText("error.provider.acpNoAnswer", { provider: label });
}

/**
 * Grok CLI 1.0.77 sends `x.ai/mcp/server_status` for each MCP server of a session. A server whose
 * first start fails, by a crash or by no answer in its start time, is `unavailable` with the reason
 * `handshake_failed`, and its detail names the cause. Grok then answers `search_tool` as complete
 * without the server, so the agent and the user did not learn why its tools were missing (#8083).
 * Only the first start counts: the `restart_failed` statuses after it, and those of a session that
 * closes, repeat a failure or come from the close.
 */
function grokMcpServerFailure(method: string, params: DynamicRecord): AcpMcpServerFailure | null {
  if (method !== "x.ai/mcp/server_status" || params.status !== "unavailable" || params.reason !== "handshake_failed")
    return null;
  if (typeof params.sessionId !== "string" || typeof params.name !== "string") return null;
  const reason = typeof params.detail === "string" && params.detail.trim() ? params.detail.trim() : params.reason;
  return { sessionId: params.sessionId, name: params.name, reason };
}

/**
 * Grok CLI 1.0.22 and 1.0.70 send no `usage` in the `session/prompt` result and no `usage_update`.
 * The result's `_meta.usage` holds the tokens and the cost of this prompt's model calls (#4827).
 */
export const GROK_ACP_FLAVOR: AcpFlavor = {
  // Grok CLI 1.0.77 shows its image and video tools as plain tool calls (`grok-media.ts`).
  mediaTools: { kind: grokMediaKind, item: grokMediaItem, permitted: grokMediaToolKind },
  promptUsage: (response) => (isRecord(response._meta) && isRecord(response._meta.usage) ? response._meta.usage : null),
  // Grok CLI 1.0.77 fails the prompt when the model sends only its reasoning: `Internal error:
  // "empty response from model (reasoning_only)"` (#6073).
  emptyAnswerError: /\bempty response from model\b/u,
  // Grok CLI 1.0.77 accepts an answer of only spaces and line breaks, and ends the prompt as done.
  // The chat then showed no answer and no error (#6529).
  emptyAnswerFailure: noAnswerUnlessPlanOrCompaction,
  mcpServerFailure: grokMcpServerFailure,
  mcpServerName: grokMcpServerName,
  // Grok CLI 1.0.77 keeps a session in a folder named by its working directory. A resume of a session
  // that is not in the folder of the workspace, such as after the workspace moved, fails with "Path
  // not found." and `data.code` `FS_NOT_FOUND`, which Grok also sends for any other missing file. The
  // agent then failed each message (#8936). Only a `session/list` without the session replaces it.
  restoreFailure: (error) =>
    error instanceof RequestError && error.code === -32603 && isRecord(error.data) && error.data.code === "FS_NOT_FOUND"
      ? "confirm-missing"
      : null,
  // Grok CLI 1.0.77 reads the reply of `ask_user_question` as an enum with the tag `outcome`, and
  // fails the tool on a reply without it. `accepted` has the answers by question text, each a text
  // or a list of texts, and `annotations`. `cancelled` tells the model that the user did not answer.
  userQuestions: {
    method: "x.ai/ask_user_question",
    reply: (questions, answers) => {
      const given = questions.flatMap((question): [string, string | readonly string[]][] => {
        const [first, ...more] = answers[question.id] ?? [];
        if (first === undefined) return [];
        return [[question.question, more.length > 0 ? [first, ...more] : first]];
      });
      return given.length > 0
        ? { outcome: "accepted", answers: Object.fromEntries(given), annotations: {} }
        : { outcome: "cancelled" };
    },
  },
  retryNotice: grokRetryNotice,
  // Grok CLI 1.0.77 waits 10 minutes for a silent model stream, then sends an `idle_timeout` retry
  // notice (`GROK_RETRY_TYPES`). A long step after many tool calls can send nothing for more than 5
  // minutes, so OpenBot ended it as stalled while Grok still worked, and its reply came later (#12295).
  turnStallMs: 12 * 60_000,
  turnFailure: grokTurnFailure,
};

/**
 * Grok CLI 1.0.77 fails a prompt after its last retry with the error of the model request, such as
 * `Internal error: API error (status 503 Service Unavailable)` or `reqwest error stream: error sending
 * request for url (…)`. The user reads what failed and what to do; the cause still comes from the
 * agent's own text (#6883).
 */
function grokTurnFailure(error: unknown, detail: string): string {
  if (!(error instanceof RequestError)) return detail;
  const cause = classifyFailure(detail);
  if (cause === "network") return sourceText("error.provider.grokConnectionFailed");
  if (cause === "provider_unavailable" || cause === "timeout") return sourceText("error.provider.grokServiceFailure");
  return detail;
}

/**
 * The `error_type` of a Grok retry, with whether Grok could not connect. Grok CLI 1.0.77 sends `api`
 * for a 5xx status, `idle_timeout` for a stream that stopped for 10 minutes, and `http` for a failed
 * connection. A retry after an answer of only reasoning (`empty_response`) sends that reasoning as a
 * session update, so it needs no notice.
 */
const GROK_RETRY_TYPES: ReadonlyMap<string, boolean> = new Map([
  ["api", false],
  ["idle_timeout", false],
  ["http", true],
]);

/**
 * Grok CLI 1.0.77 sends a model request that fails with a 5xx status again 14 times in about five
 * minutes, then starts again, and sends no session update meanwhile. It tells of each attempt only in
 * an `x.ai/session_notification` with a `retry_state` update. Without it, OpenBot ended the turn as
 * stalled before Grok gave its error, so a backup model did not start (#6883).
 */
function grokRetryNotice(method: string, params: DynamicRecord): AcpRetryNotice | null {
  if (method.replace(/^_/u, "") !== "x.ai/session_notification") return null;
  const { sessionId, update } = params;
  if (!isRecord(update) || update.sessionUpdate !== "retry_state" || update.type !== "retrying") return null;
  const unreachable = typeof update.error_type === "string" ? GROK_RETRY_TYPES.get(update.error_type) : undefined;
  const { attempt, max_retries: maxAttempts } = update;
  if (unreachable === undefined || typeof sessionId !== "string") return null;
  if (typeof attempt !== "number" || typeof maxAttempts !== "number") return null;
  return { sessionId, attempt, maxAttempts, unreachable };
}

/**
 * Hermes Agent 0.22 marks a turn as lost when its gateway restarts during the turn. It then refuses
 * each prompt, model change and MCP server change of that session with `unknown_execution` until the
 * turn is discarded. An open of the session with new MCP tokens changes its MCP servers, so the open
 * failed too, and the agent stopped answering (#6026). `sessions discard` is the Hermes command for
 * scripts. The prompt that the gateway lost fails with the same code, and says that Hermes keeps it.
 */
const HERMES_LOST_TURNS: NonNullable<AcpFlavor["lostTurns"]> = {
  refusal: /\bunknown_execution\b/u,
  unsent: /\(nothing was submitted\)/u,
  discard: (sessionId) => ["sessions", "discard", sessionId, "--yes"],
};

/**
 * Hermes Agent 0.23.1 fails a turn whose MCP server did not connect, or whose provider kept failing,
 * with only `admitted_turn_failed` in the error. The reason is in its log, or in the answer text
 * before the error. The chat showed "Internal error: admitted_turn_failed" (#6395).
 */
function hermesTurnFailure(error: unknown, detail: string): string {
  if (isRecord(error) && isRecord(error.data) && error.data.details === "admitted_turn_failed")
    return sourceText("error.provider.hermesTurnFailed");
  if (hermesGatewayLost(error)) return sourceText("error.provider.hermesConnectionLost");
  return hermesRefusal(error) ? sourceText("error.provider.hermesRefused") : detail;
}

/**
 * Hermes Agent fails a request with an internal error and "Gateway disconnected…" in `data.details`
 * when its gateway restarts. Hermes Agent 0.22.0 and before keep the closed connection, so each later
 * request of that process failed the same way, also after the gateway started again, until OpenBot
 * started again (#10624).
 */
function hermesGatewayLost(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    typeof error.data.details === "string" &&
    /^Gateway disconnected\b/u.test(error.data.details)
  );
}

/**
 * Hermes Agent 0.23.1 fails a prompt that its gateway refuses with an internal error and only
 * `invalid_params` in `data.details`. It keeps the refused field in its own `gateway.log`. The
 * chat showed "Internal error: invalid_params" on each message to each agent for a day, until
 * OpenBot started again (#9718).
 */
function hermesRefusal(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    error.data.details === "invalid_params"
  );
}

/**
 * Hermes Agent changes the MCP servers or the folder of a session only while no turn runs in it. An
 * open of a session with new MCP tokens, after a stop whose command still ran, then failed with an
 * internal error and only `session_busy` in `data.details`, and each message to that agent failed
 * (#9938). Hermes ends that turn by itself, so the open works again later.
 */
function hermesSessionBusy(error: unknown): boolean {
  return (
    error instanceof RequestError &&
    error.code === -32603 &&
    isRecord(error.data) &&
    error.data.details === "session_busy"
  );
}

/** The cause codes of Hermes Agent (`FailoverReason`) that have an OpenBot cause. */
const HERMES_FAILURE_REASONS: Readonly<Partial<Record<string, CauseCode>>> = {
  auth: "authentication",
  auth_permanent: "authentication",
  billing: "billing",
  rate_limit: "rate_limit",
  upstream_rate_limit: "rate_limit",
  overloaded: "provider_unavailable",
  server_error: "provider_unavailable",
  timeout: "timeout",
};

/**
 * The failure summary of Hermes Agent: one paragraph of Hermes, then the provider's own error. Text
 * of the model before it does not match, so a turn that started to answer keeps its cause.
 */
const HERMES_FAILURE_SUMMARY = /^\s*[^\n]+\n\nProvider said: ([^\n]+)/u;

/**
 * The cause of a Hermes turn that failed with only `admitted_turn_failed`: a backup model did not
 * take a turn that a usage limit failed (#8293). A newer Hermes names the cause in
 * `data.failure_reason`, with its summary in `data.message`. Hermes Agent 0.23.1 sends the summary
 * only as the answer text, which then counted as an answer, so the turn did not run again
 * (`AcpFlavor.failureReport`). The "Provider said:" line of the summary decides. A failure with no
 * summary, such as an MCP server that did not connect, keeps its cause.
 */
function hermesFailureCause(error: unknown, answer: string): CauseCode | null {
  if (!isRecord(error) || !isRecord(error.data) || error.data.details !== "admitted_turn_failed") return null;
  const { failure_reason: reason, message } = error.data;
  const named = typeof reason === "string" ? HERMES_FAILURE_REASONS[reason] : undefined;
  if (named) return named;
  const said = HERMES_FAILURE_SUMMARY.exec(typeof message === "string" && message ? message : answer)?.[1];
  const cause = said ? classifyFailure(said) : "unknown";
  return cause === "unknown" ? null : cause;
}

/**
 * Hermes Agent 0.23 runs ACP through its gateway. A prompt, load or resume of a session that the
 * process does not hold fails with an internal error and only `not_found` in `data.details`, not with
 * ACP's `-32002`, so each message to that agent failed (#8078). A refused prompt only makes the next
 * message load the session again, and a session that the gateway still stores keeps its history.
 * Only a refused load replaces the session. Other codes and details keep it.
 */
function hermesSessionNotFound(error: RequestError): boolean | null {
  return error.code === -32603 && isRecord(error.data) && error.data.details === "not_found" ? true : null;
}

/**
 * Hermes Agent 0.23.1 refuses a session with more than 16 MCP servers with an internal error
 * and only `invalid_params` in `data.details`, so each message to the agent failed (#10023).
 */
const HERMES_MCP_SERVER_LIMIT = 16;

/**
 * Hermes Agent 0.21.5 answers a `session/resume` of a missing session with a new session, and the
 * reply does not give its id: each later prompt to the saved id then ends as "refusal". Its
 * `session/load` of a missing session answers null, which the SDK gives as an empty reply. A load of
 * a session that exists always gives its `modes`.
 */
export const HERMES_ACP_FLAVOR: AcpFlavor = {
  loadInsteadOfResume: { missing: (response) => response.modes == null },
  sessionNotFound: hermesSessionNotFound,
  lostTurns: HERMES_LOST_TURNS,
  refusesUntilRestart: hermesRefusal,
  lostServerUntilRestart: hermesGatewayLost,
  sessionBusy: hermesSessionBusy,
  mcpServerLimit: HERMES_MCP_SERVER_LIMIT,
  // Hermes Agent sends each set to its gateway, which reads the full session for it. A set before
  // each turn failed every turn when the gateway was slow (#9738).
  setsConfigOnlyOnChange: true,
  // Hermes Agent 0.23.0 streams the answer, and then sends all of it again when a plugin rewrote it
  // (`transform_llm_output`). The rewrite has the streamed message's ID, so the answer showed two
  // times in one message (#6433).
  resendsAnswer: true,
  // Its `delegate_task` call is titled `delegate_task: <goal>`, and its subagents send no events.
  subagentTools: ["delegate_task"],
  turnFailure: hermesTurnFailure,
  failureCause: hermesFailureCause,
  failureReport: HERMES_FAILURE_SUMMARY,
  // Hermes Agent 0.23.1 defers all MCP tools behind its own tool_search, also with the default
  // `tools.tool_search.enabled: auto`, and a session cannot turn it off.
  catalogAsMcpTools: true,
};

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
  // Cursor 2026.10.22-27dcf5f keeps its access token in memory for the life of the process, and
  // refreshes it there only with an API key. When its server refuses the token, each turn of each
  // session sends only one of these chunks until the process ends. A new process reads the Keychain
  // again (#4614).
  signInLostChunk:
    /^\n\n(?:Please sign in to continue|Error: \[unauthenticated\] Backend rejected authentication\.[^\n]*)$/u,
  // Cursor 2026.09.28-64d2043 and 2026.11.05-86047df open a session only when their server accepts the
  // saved sign-in or key. A refused one and no connection give the same error (#7644).
  signInUnusable: (error) =>
    error.code === -32603 && isRecord(error.data) && error.data.message === "Failed to initialize session services"
      ? sourceText("error.provider.cursorSignInUnusable")
      : null,
  // Cursor sends a used-up plan as one chunk in the same form, and then ends the turn as a success
  // (#5668), and a plan that needs a payment method too (#4556). Only the full chunk matches, so an
  // answer that quotes the text stays an answer.
  planUsedUpChunk: /^(?:\n\nUpgrade your plan to continue|\s*Add a payment method to continue\.?\s*)$/u,
  // Cursor 2026.10.22-27dcf5f asks its server for the model list on each model set, and reports a
  // failed request as "Invalid model value" (#3800). One set per change, not one per turn.
  processWideModel: true,
  // Cursor 2026.10.22-27dcf5f leaves out a disabled or blocked server, and the agent turn then
  // finds no OpenBot tools (#3058).
  mcpServersLoadWithSession: true,
  enableMcpServers: enableCursorMcpServers,
};

/**
 * Kimi CLI 1.52.0 refuses `session/load` and `session/resume` for a session that it does not have
 * with "Invalid params" and `{ session_id: "Session not found" }`. Only that exact data counts: other
 * invalid parameters, such as an unknown model, must not cause a provider session to be replaced.
 */
export const KIMI_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error) =>
    error.code === -32602 ? isRecord(error.data) && error.data.session_id === "Session not found" : null,
  // Kimi CLI 1.52.0 moves the session to the new model, and then saves it as the default model in
  // its config.toml. In a confined process that file is protected, and the save fails with -32603.
  modelSetUnsaved: (error) =>
    error.code === -32603 &&
    isRecord(error.data) &&
    typeof error.data.details === "string" &&
    error.data.details.includes("config.toml"),
  // Its `Agent` call is titled `Agent: <description>`, and its arguments come as content text.
  subagentTools: ["Agent"],
  // Kimi CLI 1.52.0 refuses a new session with `authRequired` when it has no token, or an expired
  // one with no refresh token. A chat then showed "RequestError: Authentication required" (#8555).
  authRequiredSignsOut: true,
  // Kimi CLI 1.52.0 stops reading a turn at `StepInterrupted`, so a model step that fails ends the
  // prompt as `end_turn`, and the step's error is lost. The chat then showed no answer and no error
  // (#6722). Kimi's thinking alone is not an answer.
  emptyAnswerFailure: noAnswerUnlessPlanOrCompaction,
  // Kimi Code 2.6.0 gives a server added to a resumed session only as a `<tools_added>` note. The
  // agent knew the Tavily tools and could not call them (#8931).
  mcpToolsFixedAtStart: true,
};

/**
 * Devin CLI 3000.11.234 refuses `session/load` of a session that it does not have with -32016 and
 * `{ "cognition.ai/errorKind": "session_not_found" }`. Only that kind counts.
 */
export const DEVIN_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error) =>
    error.code === -32016 ? isRecord(error.data) && error.data["cognition.ai/errorKind"] === "session_not_found" : null,
  // Devin CLI 3000.12.57 reports `agentInfo.version` "0.0.0-dev", and sets this capability. In a live
  // probe, a second prompt during a turn moved the running command to the background, and the agent
  // went on under the new prompt. Both prompts got `end_turn` when that run ended.
  steerByPromptCapability: "cognition.ai/midTurnPrompts",
  // Each reply of that probe had the same `usage` and `cognition.ai/userMessageId`.
  promptRun: (response) => {
    const run = isRecord(response._meta) ? response._meta["cognition.ai/userMessageId"] : undefined;
    return typeof run === "string" ? run : undefined;
  },
};

/**
 * Mistral Vibe 3.1.0 refuses `session/load` and `session/resume` of a session that it does not have
 * with "Invalid params", the message `Session not found: <id>` and `{ session_id: <id> }`. Only that
 * session counts: a wrong config value is also "Invalid params".
 */
export const MISTRAL_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error, sessionId) =>
    error.code === -32602 ? isRecord(error.data) && error.data.session_id === sessionId : null,
  // Vibe 3.1.0 reads no `AGENTS.md`, `.vibe` or `.agents/skills` in a folder that the user did not
  // trust. A folder in `additionalDirectories` counts as trusted for that session only, so the
  // workspace goes there, and nothing goes to the user's `trusted_folders.toml`. Its ACP trust
  // decision would write that file: Vibe 3.1.0 takes only `trust_cwd`, `trust_repo` and `decline`.
  workspaceAsAdditionalDirectory: true,
  // Vibe 3.1.0 changes the session's model or thinking level, and then saves it as the default in
  // `config.toml`. In a confined process that file is protected, and the save fails with "Invalid
  // params" and "Layer 'user-toml': cannot write config file at <path>".
  configSetUnsaved: (error) => error.code === -32602 && error.message.includes("cannot write config file"),
  // Vibe 3.1.0 to 3.1.2 sends the thinking level of the model as the option `thinking` with the
  // category `thinking`, not the protocol's `thought_level` (#8056, mistralai/mistral-vibe#989).
  // Its levels `off` to `max` are OpenBot's effort names. `thought_level` stays for a later Vibe.
  effortCategories: ["thought_level", "thinking"],
  // Vibe 3.1.0 asks Mistral for the account's model catalogue when a session opens, and waits up to
  // 5 s for it. A close stops that request, and then nothing saves the catalogue for later sessions.
  probeCloseDelayMs: 5_000,
  // Vibe 3.1.2 keeps one MCP server of each name for its whole process, and its server fingerprint
  // has the header names but not their values. Each session's `openbot` call then went out with the
  // token of the session that opened last, and ran in another agent's chat (#9805).
  sessionProcesses: true,
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

/**
 * A custom agent can end a turn as done and send nothing for it, for example when its context is full.
 * The chat then showed nothing at all (#5110). A turn that sent any update, such as a thought, a plan
 * or a compaction, shows it, so it still succeeds.
 */
function customEmptyAnswerFailure({ answered }: { answered: boolean }, label: string): string | null {
  return answered ? null : sourceText("error.provider.acpNoAnswer", { provider: label });
}

/**
 * A custom agent's `refusal` stop reason names no cause, and agents use it for other things than
 * blocked content: WorkBuddy sends it when its sign-in is missing (#8876). The chat showed only the
 * word "refusal", and analytics counted blocked content.
 */
function customRefusal(error: unknown, detail: string, label: string): string {
  return error === "refusal" ? sourceText("error.provider.acpRefusedNoReason", { provider: label }) : detail;
}

const customTurnFailure: NonNullable<AcpFlavor["turnFailure"]> = (
  error,
  detail,
  _redact,
  _log,
  _model,
  _endpoint,
  _savedKey,
  _providerKeyStored,
  label,
) => customRefusal(error, detail, label);

function customFailureCause(error: unknown): CauseCode | null {
  return error === "refusal" ? "unknown" : null;
}

/** Oh My Pi (`omp acp`). Its rules are here when they do not apply to every custom agent. */
const OMP_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: ompSessionNotFound,
  emptyAnswerFailure: customEmptyAnswerFailure,
  turnFailure: customTurnFailure,
  failureCause: customFailureCause,
};

/**
 * A custom agent without a flavor of its own. It keeps omp's rule: the rule needs the exact session
 * ID, and an agent can reuse omp's error text.
 */
const CUSTOM_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: ompSessionNotFound,
  emptyAnswerFailure: customEmptyAnswerFailure,
  turnFailure: customTurnFailure,
  failureCause: customFailureCause,
};

const CUSTOM_AGENT_FLAVORS: Readonly<Partial<Record<string, AcpFlavor>>> = {
  omp: OMP_ACP_FLAVOR,
  // Hermes Agent added as a custom agent (`hermes acp`) keeps the custom rules. Its missing session
  // is found, its lost turns are discarded, its answer sent again replaces the streamed one, its
  // failed turn is explained, a process that starts to refuse each prompt or lost its gateway ends, an
  // unchanged model or effort is not sent again, it gets the catalog as MCP tools, and it gets no more
  // MCP servers than it takes, as for the Hermes provider (#9718, #9738, #9312, #10023, #10624).
  hermes: {
    ...CUSTOM_ACP_FLAVOR,
    sessionNotFound: (error, sessionId) => hermesSessionNotFound(error) ?? ompSessionNotFound(error, sessionId),
    lostTurns: HERMES_LOST_TURNS,
    refusesUntilRestart: hermesRefusal,
    lostServerUntilRestart: hermesGatewayLost,
    sessionBusy: hermesSessionBusy,
    mcpServerLimit: HERMES_MCP_SERVER_LIMIT,
    setsConfigOnlyOnChange: true,
    resendsAnswer: true,
    turnFailure: (error, detail, _redact, _log, _model, _endpoint, _savedKey, _providerKeyStored, label) =>
      customRefusal(error, hermesTurnFailure(error, detail), label),
    failureCause: (error, answer) => customFailureCause(error) ?? hermesFailureCause(error, answer),
    failureReport: HERMES_FAILURE_SUMMARY,
    catalogAsMcpTools: true,
  },
  // Kimi Code added as a custom agent (`kimi acp`) keeps the custom rules and the tools of its first
  // turn, as for the Kimi provider (#8931).
  kimi: { ...CUSTOM_ACP_FLAVOR, mcpToolsFixedAtStart: true },
  // Kiro CLI (`kiro-cli acp`) stops each request to an HTTP MCP server after 120 s: its `reqwest`
  // client has a total timeout of the server's `timeout`, 120 s by default, and it ignores progress.
  // A session server cannot set that timeout, so a question card closed with "Transport closed"
  // before the user answered (#11049).
  "kiro-cli": { ...CUSTOM_ACP_FLAVOR, mcpToolCallLimitMs: 120_000 },
};

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
