import { win32 } from "node:path";
import type { LoadSessionResponse, NewSessionRequest, PromptResponse, RequestError } from "@agentclientprotocol/sdk";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import type { CauseCode } from "@openbot/telemetry";
import type { GeneratedMediaKind } from "./agent/image-generation";
import { enableCursorMcpServers } from "./cursor-mcp-disabled";
import { grokMediaItem, grokMediaKind, grokMediaToolKind } from "./grok-media";
import { isRecord, type ThreadItem } from "./protocol";

/** The custom endpoint that serves a model, as a turn's error names it. Never a credential itself. */
export interface AcpCustomEndpoint {
  readonly name: string;
  /** Whether the endpoint has a saved API key or header. */
  readonly hasCredentials: boolean;
  /** How long a turn on this endpoint may send nothing before it fails. The agent's own limit when absent. */
  readonly stallMs?: number;
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
   * custom endpoint that serves that model, or null.
   */
  turnFailure?(
    error: unknown,
    detail: string,
    redact: (text: string) => string,
    log: (text: string) => void,
    model: string | null,
    endpoint: AcpCustomEndpoint | null,
  ): string;
  /**
   * The cause of a turn's failure that the agent names in a structured field, such as an error name
   * in the error's data or a stop reason that means another thing for this agent. `null` gives the
   * decision to the protocol's rules. It is a fixed code; it never carries the error's text.
   */
  failureCause?(error: unknown): CauseCode | null;
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
   * starts, or list the sessions to find out whether this one exists. `null` reports the failure.
   */
  restoreFailure?(error: unknown, method: "load" | "resume"): "wait-for-start" | "list-sessions" | null;
  /**
   * A turn that the agent lost, after which it refuses each request of the session until the turn is
   * discarded. `refusal` matches the text of that refusal, and `unsent` the refusal of a prompt that
   * the agent did not take. `discard` gives the arguments of the agent's command that discards the
   * lost turns of a session. OpenBot never sends a prompt again that the agent took.
   */
  lostTurns?: { refusal: RegExp; unsent: RegExp; discard(sessionId: string): readonly string[] };
  /** A failed model refresh keeps the last list that the agent gave. */
  keepModelsOnRefreshFailure?: true;
  /**
   * The model belongs to the agent's process, not to one session: a model set moves every session
   * to it. A set of the model the process already runs on is not sent again.
   */
  processWideModel?: true;
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
    /** The failure text of a model step that ended with neither text nor tool calls. */
    emptyOutputFailure?: RegExp;
    /** The message of a turn that failed in this way, from the failure text. */
    turnFailure(text: string): string;
    /**
     * The https link in the failure text that the user must open to fix their account, or `null`.
     * The turn fails as a sign-in failure, and the error banner opens the link.
     */
    accountLink?(text: string): string | null;
    /** The message of an answer chunk that reports an exhausted quota, or `null`. */
    quota(text: string): string | null;
    /** The MCP server whose failed start ended the turn, from the failure text, or `null`. */
    mcpLoadFailure(text: string): { name: string; reason: string } | null;
    /**
     * The MCP tools whose parameter schema the agent refused in the session's last prompt, from the
     * agent's own log, for a failure text that names no cause. Each name is `mcp_<server>_<tool>`.
     */
    refusedMcpTools?(text: string, argv: readonly string[], sessionId: string): string[];
    /** A failure text after which the agent no longer has the session, so the next prompt opens it again. */
    sessionLost?: RegExp;
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
   * stalled and OpenBot does not end it (`ACP_TURN_STALL_MS`). A prompt that gets no update at all
   * is sent again once, and then fails (`ACP_FIRST_UPDATE_MS`).
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
   * The MCP server names in the agent's own files for `cwd`. The agent starts its own entry in place
   * of a session server with the same name, so that server travels as `openbot_<name>`. `argv` is
   * the command line of the agent's process, which can name the folder of those files.
   */
  ownMcpServerNames?(cwd: string, argv: readonly string[]): readonly string[];
  /** Turns OpenBot's servers back on where the agent's own settings for `cwd` turned them off. */
  enableMcpServers?(cwd: string, names: readonly string[]): void;
  /** OpenBot compacts by replacing the session, for an agent that reports `usage_update` and has no compact request. */
  contextCompaction?: "handoff";
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

/** Cline CLI 3.0.68 runs a subagent with its `spawn_agent` tool: `{ systemPrompt, task }`, result `{ text }`. */
export const CLINE_ACP_FLAVOR: AcpFlavor = { subagentTools: ["spawn_agent"] };

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
};

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
  return isRecord(error) && isRecord(error.data) && error.data.details === "admitted_turn_failed"
    ? sourceText("error.provider.hermesTurnFailed")
    : detail;
}

/**
 * Hermes Agent 0.21.5 answers a `session/resume` of a missing session with a new session, and the
 * reply does not give its id: each later prompt to the saved id then ends as "refusal". Its
 * `session/load` of a missing session answers null, which the SDK gives as an empty reply. A load of
 * a session that exists always gives its `modes`.
 */
export const HERMES_ACP_FLAVOR: AcpFlavor = {
  loadInsteadOfResume: { missing: (response) => response.modes == null },
  lostTurns: HERMES_LOST_TURNS,
  // Hermes Agent 0.23.0 streams the answer, and then sends all of it again when a plugin rewrote it
  // (`transform_llm_output`). The rewrite has the streamed message's ID, so the answer showed two
  // times in one message (#6433).
  resendsAnswer: true,
  // Its `delegate_task` call is titled `delegate_task: <goal>`, and its subagents send no events.
  subagentTools: ["delegate_task"],
  turnFailure: hermesTurnFailure,
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
  // Cursor sends a used-up plan as one chunk in the same form, and then ends the turn as a success
  // (#5668). Only the full chunk matches, so an answer that quotes the text stays an answer.
  planUsedUpChunk: /^\n\nUpgrade your plan to continue$/u,
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
  // Kimi CLI 1.52.0 stops reading a turn at `StepInterrupted`, so a model step that fails ends the
  // prompt as `end_turn`, and the step's error is lost. The chat then showed no answer and no error
  // (#6722). Kimi's thinking alone is not an answer.
  emptyAnswerFailure: noAnswerUnlessPlanOrCompaction,
};

/**
 * Devin CLI 3000.11.234 refuses `session/load` of a session that it does not have with -32016 and
 * `{ "cognition.ai/errorKind": "session_not_found" }`. Only that kind counts.
 */
export const DEVIN_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: (error) =>
    error.code === -32016 ? isRecord(error.data) && error.data["cognition.ai/errorKind"] === "session_not_found" : null,
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
  // Vibe 3.1.0 asks Mistral for the account's model catalogue when a session opens, and waits up to
  // 5 s for it. A close stops that request, and then nothing saves the catalogue for later sessions.
  probeCloseDelayMs: 5_000,
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

/** Oh My Pi (`omp acp`). Its rules are here when they do not apply to every custom agent. */
const OMP_ACP_FLAVOR: AcpFlavor = { sessionNotFound: ompSessionNotFound, emptyAnswerFailure: customEmptyAnswerFailure };

/**
 * A custom agent without a flavor of its own. It keeps omp's rule: the rule needs the exact session
 * ID, and an agent can reuse omp's error text.
 */
const CUSTOM_ACP_FLAVOR: AcpFlavor = {
  sessionNotFound: ompSessionNotFound,
  emptyAnswerFailure: customEmptyAnswerFailure,
};

const CUSTOM_AGENT_FLAVORS: Readonly<Partial<Record<string, AcpFlavor>>> = {
  omp: OMP_ACP_FLAVOR,
  // Hermes Agent added as a custom agent (`hermes acp`) keeps the custom rules. Its lost turns are
  // discarded, its answer sent again replaces the streamed one, and its failed turn is explained, as
  // for the Hermes provider.
  hermes: { ...CUSTOM_ACP_FLAVOR, lostTurns: HERMES_LOST_TURNS, resendsAnswer: true, turnFailure: hermesTurnFailure },
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
