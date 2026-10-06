import { randomUUID } from "node:crypto";
import type {
  AgentApproval,
  AgentApprovalKind,
  AgentEvent,
  AgentPromptQuestion,
  AgentPromptResolution,
  AgentRuntimeSnapshot,
  BrowserTab,
  BrowserTakeoverRequest,
  RespondToApprovalInput,
  RespondToBrowserSecretInput,
  RespondToBrowserTakeoverInput,
  RespondToPromptInput,
} from "@openbot/contracts/ipc";
import { AGENT_RUNTIME_ATTENTION_LIMIT } from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Result, Schema } from "effect";
import type { AgentClient } from "../agent-client";
import type { BrowserOperationError } from "../browser-effects";
import type { PreparedBrowserSecret } from "../browser-host";
import { parseBrowserToolCall } from "../browser-tools";
import { causeHelpers } from "../effect-boundary";
import type { PasswordVault } from "../password-vault";
import {
  type AppServerRequest,
  type DynamicToolCallParams,
  type DynamicToolResult,
  getRecord,
  getString,
  type RequestId,
} from "../protocol";
import { type ApprovalAutomationPolicy, NO_APPROVAL_AUTOMATION, shouldAutoApprove } from "./approval-automation";
import type { ConversationRuntime } from "./conversation-runtime";
import type { HostedSiteOperationFailed } from "./hosted-site-coordinator";
import {
  HOSTED_SITE_APPROVAL_METHOD,
  type HostedSiteApprovalTarget,
  type HostedSiteMutationContext,
} from "./hosted-site-coordinator";
import type { HostedSiteMutationTool } from "./hosted-site-events";
import {
  approvalPermissions,
  browserTakeoverError,
  browserTakeoverResult,
  commandText,
  dynamicPromptResult,
  expiredPromptResult,
  mcpElicitationQuestions,
  mcpElicitationResult,
  promptQuestions,
  promptResolution,
  questionPromptText,
  validPromptQuestions,
} from "./prompts";
import { compactRuntimeApproval, compactRuntimeQuestion } from "./runtime-snapshot";
import { isDynamicToolCall } from "./thread-items";

const logger = createOpenBotLogger("attention-registry");

interface PendingPrompt {
  client: AgentClient;
  id: RequestId;
  responseKind: "dynamic-tool" | "mcp-elicitation" | "user-input";
  params: unknown;
  agentId: string;
  publicThreadId: string;
  turnId: string;
  messageId: string;
  questions: AgentPromptQuestion[];
}

interface PendingApproval {
  client: AgentClient;
  id: RequestId;
  method: string;
  params: unknown;
  approval: AgentApproval;
  hostedSiteMutation?: HostedSiteMutationContext;
}

interface PendingBrowserTakeover {
  client: AgentClient;
  /** The provider's request. `submit_secret` keys the entry by a new id, so it is kept here. */
  providerRequestId: RequestId;
  secret?: PreparedBrowserSecret;
  submitting?: boolean;
  params: DynamicToolCallParams;
  request: BrowserTakeoverRequest;
  resolve: (result: DynamicToolResult) => void;
}

/**
 * The hosted-site half of an approval, narrow enough that the registry never learns what a site is.
 * `HostedSiteCoordinator` satisfies it.
 */
export interface HostedSiteApprovals {
  prepareApproval(
    client: AgentClient,
    request: AppServerRequest,
    params: DynamicToolCallParams,
    tool: HostedSiteMutationTool,
  ): Effect.Effect<{ approval: AgentApproval; mutation: HostedSiteMutationContext } | null, HostedSiteOperationFailed>;
  resolveApproval(
    mutation: HostedSiteMutationContext,
    target: HostedSiteApprovalTarget,
    decision: "accept" | "decline",
  ): Effect.Effect<void, HostedSiteOperationFailed>;
}

/**
 * How an outstanding question feeds back into a routine run's status. Implemented by the facade in
 * this PR and handed to `RoutineScheduler` in the next.
 */
export interface RoutineAttention {
  markNeedsAttention(turnId: string | null): void;
  markRunningForTurn(turnId: string | null): void;
}

/**
 * The browser surface a takeover needs: the tab roster, to check that the agent asking owns the tab it
 * names, and the pair of calls that suspend and resume agent control of it. `BrowserHost` satisfies it.
 */
export interface AttentionBrowserHost {
  prepareSecret?(params: DynamicToolCallParams): Effect.Effect<PreparedBrowserSecret, BrowserOperationError>;
  listTabs(): BrowserTab[];
  beginTakeover(tabId: string): Effect.Effect<void, BrowserOperationError>;
  endTakeover(tabId: string): void;
}

export interface AttentionRegistryOptions {
  conversation: ConversationRuntime;
  browser: AttentionBrowserHost;
  hostedSites: HostedSiteApprovals;
  routines: RoutineAttention;
  /** Read at each approval, so a grant the user gives now applies to the next request. */
  approvalAutomation?: ApprovalAutomationPolicy;
  /**
   * Whether the agent runs in the workspace sandbox now. Each approval it raises asks to go outside
   * the limit the user chose, so Auto approve and Turbo do not answer it.
   */
  workspaceSandboxed?(agentId: string): boolean;
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string): void;
  emitRuntimeSnapshot(): void;
  /**
   * The vault the user shared with OpenBot, or null. A password or authenticator request for a login
   * saved there is filled without a card: putting the login in the shared vault is the consent.
   */
  passwordVault?: PasswordVault | null;
}

export type RuntimeAttention = Pick<
  AgentRuntimeSnapshot,
  "attentionComplete" | "pendingPrompts" | "pendingApprovals" | "pendingBrowserTakeovers"
>;

/**
 * Everything an agent can be blocked on waiting for the user: a question, an approval, a request to
 * take over a browser tab.
 *
 * The three live together because they are one queue as far as the product is concerned — the
 * runtime snapshot budgets them against a single attention limit in that order, duplication refuses
 * while any of them is outstanding, and a turn ending clears all three at once. Each also owes the
 * provider a response, so every path out of these maps either answers the request or cancels it;
 * an entry silently dropped is an agent stuck forever.
 */
export class AttentionRegistry {
  readonly #conversation: ConversationRuntime;
  readonly #browser: AttentionBrowserHost;
  readonly #hostedSites: HostedSiteApprovals;
  readonly #routines: RoutineAttention;
  readonly #approvalAutomation: ApprovalAutomationPolicy;
  readonly #workspaceSandboxed: (agentId: string) => boolean;
  readonly #emit: (event: AgentEvent) => void;
  readonly #emitError: (code: string, error: unknown, agentId?: string) => void;
  readonly #emitRuntimeSnapshot: () => void;
  readonly #passwordVault: PasswordVault | null;
  readonly #prompts = new Map<RequestId, PendingPrompt>();
  readonly #approvals = new Map<RequestId, PendingApproval>();
  readonly #takeovers = new Map<RequestId, PendingBrowserTakeover>();

  constructor(options: AttentionRegistryOptions) {
    this.#conversation = options.conversation;
    this.#browser = options.browser;
    this.#hostedSites = options.hostedSites;
    this.#routines = options.routines;
    this.#approvalAutomation = options.approvalAutomation ?? NO_APPROVAL_AUTOMATION;
    this.#workspaceSandboxed = options.workspaceSandboxed ?? (() => false);
    this.#emit = options.emit;
    this.#emitError = options.emitError;
    this.#emitRuntimeSnapshot = options.emitRuntimeSnapshot;
    this.#passwordVault = options.passwordVault ?? null;
  }

  hasAttentionFor(agentId: string): boolean {
    return (
      [...this.#prompts.values()].some((pending) => pending.agentId === agentId) ||
      [...this.#approvals.values()].some((pending) => pending.approval.agentId === agentId) ||
      [...this.#takeovers.values()].some((pending) => pending.request.agentId === agentId)
    );
  }

  /** The attention section of the runtime snapshot, budgeted prompts first and takeovers last. */
  runtimeAttention(): RuntimeAttention {
    const attentionComplete =
      this.#prompts.size + this.#approvals.size + this.#takeovers.size <= AGENT_RUNTIME_ATTENTION_LIMIT;
    let remainingAttention = AGENT_RUNTIME_ATTENTION_LIMIT;
    const pendingPrompts = [...this.#prompts.values()].slice(0, remainingAttention).map((pending) => ({
      requestId: pending.id,
      agentId: pending.agentId,
      threadId: pending.publicThreadId,
      turnId: pending.turnId,
      questions: pending.questions.map(compactRuntimeQuestion),
    }));
    remainingAttention -= pendingPrompts.length;
    const pendingApprovals = [...this.#approvals.values()]
      .slice(0, remainingAttention)
      .map((pending) => compactRuntimeApproval(pending.approval));
    remainingAttention -= pendingApprovals.length;
    const pendingBrowserTakeovers = [...this.#takeovers.values()]
      .slice(0, remainingAttention)
      .map((pending) => structuredClone(pending.request));
    return { attentionComplete, pendingPrompts, pendingApprovals, pendingBrowserTakeovers };
  }

  readonly respondToPrompt = Effect.fn("AttentionRegistry.respondToPrompt")((input: RespondToPromptInput) =>
    attentionStep(() => {
      const pending = this.#prompts.get(input.requestId);
      if (!pending) throw new Error(sourceText("error.backend.promptInactive"));
      const questionIds = new Set(pending.questions.map((question) => question.id));
      if (Object.keys(input.answers).some((id) => !questionIds.has(id))) {
        throw new Error(sourceText("error.backend.promptAnswerMismatch"));
      }
      this.#routines.markRunningForTurn(getString(pending.params, "turnId"));

      const result =
        pending.responseKind === "dynamic-tool"
          ? dynamicPromptResult(input.answers)
          : pending.responseKind === "mcp-elicitation"
            ? mcpElicitationResult(pending.params, input.answers)
            : {
                answers: Object.fromEntries(
                  Object.entries(input.answers).map(([id, values]) => [id, { answers: values }]),
                ),
              };
      pending.client.respond(pending.id, result);
      this.#prompts.delete(input.requestId);
      this.#emitInputResolved("prompt", input.requestId, pending.agentId);
      try {
        this.#resolvePersistedPrompt(pending, promptResolution(pending.questions, input.answers));
      } catch (error) {
        this.#emitError("prompt_persistence_failed", error, pending.agentId);
      }
      this.#emitRuntimeSnapshot();
    }),
  ).bind(this);

  readonly respondToApproval = Effect.fn("AttentionRegistry.respondToApproval")(function* (
    this: AttentionRegistry,
    input: RespondToApprovalInput,
  ) {
    const pending = yield* attentionStep(() => {
      const value = this.#approvals.get(input.requestId);
      if (!value) throw new Error(sourceText("error.backend.approvalInactive"));
      return value;
    });
    this.#routines.markRunningForTurn(getString(pending.params, "turnId"));

    const mutation = pending.hostedSiteMutation;
    if (mutation) {
      this.#approvals.delete(input.requestId);
      yield* this.#hostedSites
        .resolveApproval(
          mutation,
          { client: pending.client, id: pending.id, agentId: pending.approval.agentId },
          input.decision,
        )
        .pipe(toAttentionOperationFailed);
    } else if (pending.approval.kind === "permissions") {
      const permissions = getRecord(pending.params, "permissions") ?? {};
      pending.client.respond(pending.id, {
        permissions: input.decision === "accept" ? permissions : {},
        scope: "turn",
      });
    } else if (pending.method === "applyPatchApproval" || pending.method === "execCommandApproval") {
      pending.client.respond(pending.id, {
        decision:
          input.decision === "accept" ? "approved" : { denied: { rejection: "The user declined this action." } },
      });
    } else {
      pending.client.respond(pending.id, { decision: input.decision });
    }
    this.#approvals.delete(input.requestId);
    this.#emitInputResolved("approval", input.requestId, pending.approval.agentId);
    this.#emitRuntimeSnapshot();
  }, Effect.uninterruptible).bind(this);

  /**
   * Whether this agent is waiting on a takeover. Its browser tools are refused while one is outstanding:
   * the user has the tab, every reference the agent holds is already stale, and a tool call landing
   * mid-login would act on a page the user is in the middle of.
   */
  hasBrowserTakeoverForAgent(agentId: string): boolean {
    return [...this.#takeovers.values()].some((pending) => pending.request.agentId === agentId);
  }

  readonly respondToBrowserTakeover = Effect.fn("AttentionRegistry.respondToBrowserTakeover")(
    (input: RespondToBrowserTakeoverInput) =>
      attentionStep(() => {
        const pending = this.#takeovers.get(input.requestId);
        if (!pending) throw new Error(sourceText("error.backend.takeoverInactive"));
        if (pending.submitting) throw new Error(sourceText("error.backend.authSubmitting"));
        pending.secret?.cancel();
        this.#routines.markRunningForTurn(pending.request.turnId);
        this.#resolveBrowserTakeover(input.requestId, pending, input.decision);
      }),
  ).bind(this);

  readonly respondToBrowserSecret = Effect.fnUntraced(function* (
    this: AttentionRegistry,
    input: RespondToBrowserSecretInput,
  ) {
    const { pending, secret } = yield* attentionStep(() => {
      const value = this.#takeovers.get(input.requestId);
      if (!value?.secret || value.request.agentId !== input.agentId || value.submitting)
        throw new Error(sourceText("error.backend.authRequestInactive"));
      return { pending: value, secret: value.secret };
    });
    if (input.decision === "cancel") {
      secret.cancel();
      this.#resolveBrowserTakeover(input.requestId, pending, "cancel");
      return;
    }
    if (input.decision === "takeover") {
      secret.cancel();
    } else {
      pending.submitting = true;
      const outcome = yield* secret.submit(input.secret).pipe(
        Effect.catch(() => Effect.succeed("takeover")),
        Effect.ensuring(
          Effect.sync(() => {
            pending.submitting = false;
          }),
        ),
      );
      if (this.#takeovers.get(input.requestId) !== pending) return;
      if (outcome === "submitted") {
        this.#resolveBrowserTakeover(input.requestId, pending, "complete");
        return;
      }
    }
    secret.cancel();
    pending.secret = undefined;
    if (input.decision === "submit" && pending.request.secret)
      pending.request.secret = { ...pending.request.secret, requiresReload: true };
    else delete pending.request.secret;
    yield* this.#browser.beginTakeover(pending.request.tabId).pipe(toAttentionOperationFailed);
    this.#emit({ type: "browser-takeover-requested", request: pending.request });
    this.#emitRuntimeSnapshot();
  }, Effect.uninterruptible);

  /**
   * Answers an approval the user has already consented to, and reports whether it did.
   *
   * Nothing is registered and no `approval` event is emitted on this path, which is the whole point:
   * an emitted approval opens a card, raises an operating-system notification and lights the
   * Dynamic Island, and an automated grant that did all three before resolving itself a moment
   * later would be worse than the prompt it replaced. What the agent then does is still visible -
   * the command and the file change are ordinary timeline items either way.
   *
   * The response shapes are the ones `respondToApproval` uses for an accepted request; they are
   * what the provider on the other end of each method understands.
   */
  #answerWithoutAsking(client: AgentClient, request: AppServerRequest, approval: AgentApproval): boolean {
    if (this.#workspaceSandboxed(approval.agentId)) return false;
    if (!shouldAutoApprove(this.#approvalAutomation, approval)) return false;
    if (approval.kind === "permissions") {
      client.respond(request.id, { permissions: getRecord(request.params, "permissions") ?? {}, scope: "turn" });
    } else if (request.method === "applyPatchApproval" || request.method === "execCommandApproval") {
      client.respond(request.id, { decision: "approved" });
    } else {
      client.respond(request.id, { decision: "accept" });
    }
    return true;
  }

  surfaceApproval(client: AgentClient, request: AppServerRequest, kind: AgentApprovalKind): void {
    const threadId = getString(request.params, "threadId");
    const turnId = getString(request.params, "turnId") ?? (kind === "file-change" ? String(request.id) : null);
    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
    if (!threadId || !turnId || !agentId) {
      this.#respondToMalformedApproval(client, request);
      return;
    }

    const approval: AgentApproval = {
      requestId: request.id,
      agentId,
      threadId: this.#conversation.publicThreadId(agentId, threadId),
      turnId,
      kind,
      command: commandText(request.params),
      cwd: getString(request.params, "cwd"),
      reason: getString(request.params, "reason"),
      grantRoot: getString(request.params, "grantRoot"),
      permissions: kind === "permissions" ? approvalPermissions(request.params) : null,
    };
    if (this.#answerWithoutAsking(client, request, approval)) return;
    this.#approvals.set(request.id, {
      client,
      id: request.id,
      method: request.method,
      params: request.params,
      approval,
    });
    this.#routines.markNeedsAttention(turnId);
    this.#emit({ type: "approval", approval });
  }

  readonly surfaceHostedSiteApproval = Effect.fn("AttentionRegistry.surfaceHostedSiteApproval")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
    params: DynamicToolCallParams,
    tool: HostedSiteMutationTool,
  ) {
    const prepared = yield* this.#hostedSites
      .prepareApproval(client, request, params, tool)
      .pipe(toAttentionOperationFailed);
    // A request the provider abandoned during the preparation has nobody to report the decision to.
    if (!prepared || request.signal?.aborted) return;
    if (shouldAutoApprove(this.#approvalAutomation, prepared.approval) && this.#approvalAutomation.turboEnabled()) {
      yield* this.#hostedSites
        .resolveApproval(prepared.mutation, { client, id: request.id, agentId: prepared.approval.agentId }, "accept")
        .pipe(toAttentionOperationFailed);
      return;
    }
    this.#approvals.set(request.id, {
      client,
      id: request.id,
      method: HOSTED_SITE_APPROVAL_METHOD,
      params,
      approval: prepared.approval,
      hostedSiteMutation: prepared.mutation,
    });
    this.#routines.markNeedsAttention(prepared.approval.turnId);
    this.#emit({ type: "approval", approval: prepared.approval });
  }, Effect.uninterruptible).bind(this);

  surfaceLegacyApproval(client: AgentClient, request: AppServerRequest): void {
    const threadId = getString(request.params, "conversationId");
    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
    if (!threadId || !agentId) {
      this.#respondToMalformedApproval(client, request);
      return;
    }

    const kind: AgentApprovalKind = request.method === "execCommandApproval" ? "command" : "file-change";
    const approval: AgentApproval = {
      requestId: request.id,
      agentId,
      threadId: this.#conversation.publicThreadId(agentId, threadId),
      turnId: getString(request.params, "turnId") ?? String(request.id),
      kind,
      command: commandText(request.params),
      cwd: getString(request.params, "cwd"),
      reason: getString(request.params, "reason"),
      grantRoot: getString(request.params, "grantRoot"),
      permissions: null,
    };
    if (this.#answerWithoutAsking(client, request, approval)) return;
    this.#approvals.set(request.id, {
      client,
      id: request.id,
      method: request.method,
      params: request.params,
      approval,
    });
    this.#routines.markNeedsAttention(approval.turnId);
    this.#emit({ type: "approval", approval });
  }

  readonly surfaceBrowserTakeover = Effect.fn("AttentionRegistry.surfaceBrowserTakeover")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
  ) {
    if (!isDynamicToolCall(request.params)) return browserTakeoverError();
    const params = request.params;
    const { threadId, turnId } = params;
    const agentId = this.#conversation.agentForThread(threadId);
    const args = getRecord(params, "arguments");
    const tabId = getString(args, "tabId");
    const publicThreadId = agentId ? this.#conversation.publicThreadId(agentId, threadId) : null;
    const tab = tabId ? this.#browser.listTabs().find((candidate) => candidate.id === tabId) : undefined;
    if (
      !agentId ||
      !turnId ||
      !tabId ||
      !publicThreadId ||
      !tab ||
      tab.ownerThreadId !== publicThreadId ||
      tab.ownerAgentId !== agentId ||
      // A second request for a tab the user already holds would be answered by whichever card they
      // happened to press, and resolving either one would hand control back while the other still waits.
      [...this.#takeovers.values()].some((pending) => pending.request.tabId === tabId)
    ) {
      return browserTakeoverError();
    }

    const requestId = params.tool === "submit_secret" ? randomUUID() : request.id;
    const takeover: BrowserTakeoverRequest = {
      requestId,
      agentId,
      threadId: publicThreadId,
      turnId,
      tabId,
    };
    const completion = Deferred.makeUnsafe<DynamicToolResult>();
    const resolve = (result: DynamicToolResult) => Deferred.doneUnsafe(completion, Effect.succeed(result));
    const pending: PendingBrowserTakeover = {
      client,
      providerRequestId: request.id,
      params,
      request: takeover,
      resolve,
    };
    this.#takeovers.set(requestId, pending);
    return yield* Effect.gen({ self: this }, function* () {
      // The card is only shown once the tab has actually been handed over -- references invalidated,
      // diagnostics cleared, any recording stopped. Asking the user for control OpenBot then failed to
      // give them would leave the agent acting on the page underneath them.
      const prepare = Effect.gen({ self: this }, function* () {
        if (params.tool === "submit_secret") {
          const prepareSecret = this.#browser.prepareSecret?.bind(this.#browser);
          if (!prepareSecret)
            return yield* new AttentionOperationFailed({
              cause: new Error(sourceText("error.backend.secureAuthUnavailable")),
            });
          const secret = yield* prepareSecret({
            ...params,
            threadId: publicThreadId,
            ownerAgentId: agentId,
          }).pipe(toAttentionOperationFailed);
          if (this.#takeovers.get(requestId) !== pending) {
            secret.cancel();
            return;
          }
          pending.secret = secret;
          pending.request.secret = secret.request;
        } else yield* this.#browser.beginTakeover(takeover.tabId).pipe(toAttentionOperationFailed);
      });
      const prepared = yield* Effect.result(prepare);
      if (Result.isSuccess(prepared)) {
        if (
          this.#takeovers.get(requestId) === pending &&
          !(yield* this.#fillFromVault(requestId, pending)) &&
          this.#takeovers.get(requestId) === pending
        ) {
          this.#routines.markNeedsAttention(turnId);
          this.#emit({ type: "browser-takeover-requested", request: takeover });
        }
      } else {
        const error = prepared.failure.cause;
        logger.warn("Unable to prepare browser takeover", { tool: params.tool, error: toLogValue(error) });
        if (this.#takeovers.get(requestId) === pending) {
          this.#takeovers.delete(requestId);
          resolve(
            params.tool === "submit_secret" && error instanceof Error
              ? browserTakeoverError(error.message)
              : browserTakeoverError(),
          );
          this.#emitRuntimeSnapshot();
        }
      }
      return yield* Deferred.await(completion);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (this.#takeovers.get(requestId) === pending) this.#resolveBrowserTakeover(requestId, pending, "cancel");
        }),
      ),
    );
  }).bind(this);

  /**
   * Answers `list_logins`: the logins of the shared vault for the tab's current site. `params` carries
   * the public thread id and the owner agent, as the browser host receives them.
   */
  readonly listVaultLogins = Effect.fn("AttentionRegistry.listVaultLogins")(function* (
    this: AttentionRegistry,
    params: DynamicToolCallParams,
  ) {
    const call = yield* attentionStep(() => parseBrowserToolCall("list_logins", params.arguments));
    if (call.tool !== "list_logins")
      return yield* new AttentionOperationFailed({ cause: new Error("Invalid login list request.") });
    const { tabId } = call.args;
    const tab = this.#browser.listTabs().find((candidate) => candidate.id === tabId);
    if (!tab || tab.ownerAgentId !== params.ownerAgentId || tab.ownerThreadId !== params.threadId)
      return browserTakeoverError(sourceText("error.backend.browserTabNotFound"));
    const listed = yield* Effect.result(
      this.#passwordVault ? this.#passwordVault.loginsFor(tab.url) : Effect.succeed(null),
    );
    if (Result.isFailure(listed)) {
      logger.warn("Unable to list the shared logins", { error: toLogValue(listed.failure.cause) });
      return browserTakeoverError("The shared password vault could not be read. Use submit_secret without loginId.");
    }
    const logins = listed.success;
    const answer =
      logins === null
        ? { connected: false, logins: [], next: "No password vault is connected. Use submit_secret without loginId." }
        : { connected: true, logins };
    const result: DynamicToolResult = {
      success: true,
      contentItems: [{ type: "inputText", text: JSON.stringify(answer) }],
    };
    return result;
  }).bind(this);

  surfaceDynamicPrompt(client: AgentClient, request: AppServerRequest): void {
    const threadId = getString(request.params, "threadId");
    const turnId = getString(request.params, "turnId");
    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
    const publicThreadId = threadId && agentId ? this.#conversation.publicThreadId(agentId, threadId) : null;
    const args = getRecord(request.params, "arguments");
    const questions = promptQuestions(args);
    if (!threadId || !turnId || !agentId || !publicThreadId || !validPromptQuestions(questions)) {
      client.respond(request.id, {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: "OpenBot could not create a user question.",
          },
        ],
      });
      return;
    }

    const messageId = this.#persistQuestionPrompt(agentId, publicThreadId, turnId, request.id, questions);
    this.#prompts.set(request.id, {
      client,
      id: request.id,
      responseKind: "dynamic-tool",
      params: request.params,
      agentId,
      publicThreadId,
      turnId,
      messageId,
      questions,
    });
    this.#routines.markNeedsAttention(turnId);
    this.#emit({
      type: "prompt",
      requestId: request.id,
      agentId,
      threadId: publicThreadId,
      turnId,
      questions,
    });
  }

  surfacePrompt(client: AgentClient, request: AppServerRequest): void {
    const threadId = getString(request.params, "threadId");
    const turnId = getString(request.params, "turnId");
    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
    if (!threadId || !turnId || !agentId) {
      client.respond(request.id, { answers: {} });
      return;
    }

    const questions = promptQuestions(request.params);
    if (!validPromptQuestions(questions)) {
      client.respond(request.id, { answers: {} });
      return;
    }
    const publicThreadId = this.#conversation.publicThreadId(agentId, threadId);
    const messageId = this.#persistQuestionPrompt(agentId, publicThreadId, turnId, request.id, questions);
    this.#prompts.set(request.id, {
      client,
      id: request.id,
      responseKind: "user-input",
      params: request.params,
      agentId,
      publicThreadId,
      turnId,
      messageId,
      questions,
    });
    this.#routines.markNeedsAttention(turnId);
    this.#emit({
      type: "prompt",
      requestId: request.id,
      agentId,
      threadId: publicThreadId,
      turnId,
      questions,
    });
  }

  surfaceMcpElicitation(client: AgentClient, request: AppServerRequest): void {
    const threadId = getString(request.params, "threadId");
    const turnId = getString(request.params, "turnId");
    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
    const publicThreadId = threadId && agentId ? this.#conversation.publicThreadId(agentId, threadId) : null;
    const questions = mcpElicitationQuestions(request.params);
    if (!threadId || !turnId || !agentId || !publicThreadId || !questions) {
      client.respond(request.id, { action: "decline", content: null, _meta: null });
      this.#emitError(
        "mcp_safety_handoff",
        "A local plugin requested an unsupported security hand-off, so OpenBot declined it.",
        agentId,
      );
      return;
    }

    const messageId = this.#persistQuestionPrompt(agentId, publicThreadId, turnId, request.id, questions);
    this.#prompts.set(request.id, {
      client,
      id: request.id,
      responseKind: "mcp-elicitation",
      params: request.params,
      agentId,
      publicThreadId,
      turnId,
      messageId,
      questions,
    });
    this.#routines.markNeedsAttention(turnId);
    this.#emit({
      type: "prompt",
      requestId: request.id,
      agentId,
      threadId: publicThreadId,
      turnId,
      questions,
    });
  }

  /**
   * A turn ending expires its questions, drops its approvals and cancels its takeovers. Each removal
   * emits its resolved event: a compaction turn sends no `turn-completed`, so a client learns about
   * the removal only from that event.
   */
  clearForTurn(threadId: string, turnId: string): void {
    for (const [requestId, pending] of this.#prompts) {
      const pendingThreadId = getString(pending.params, "threadId");
      const pendingTurnId = getString(pending.params, "turnId");
      if (pendingThreadId === threadId && pendingTurnId === turnId) this.#expirePrompt(requestId, pending);
    }
    for (const [requestId, pending] of this.#approvals) {
      const pendingThreadId = getString(pending.params, "threadId") ?? getString(pending.params, "conversationId");
      const pendingTurnId = getString(pending.params, "turnId");
      if (pendingThreadId === threadId && (!pendingTurnId || pendingTurnId === turnId)) {
        this.#approvals.delete(requestId);
        this.#emitInputResolved("approval", requestId, pending.approval.agentId);
      }
    }
    for (const [requestId, pending] of this.#takeovers) {
      if (pending.params.threadId === threadId && pending.params.turnId === turnId) {
        this.#resolveBrowserTakeover(requestId, pending, "cancel");
      }
    }
  }

  /** Expires the prompts of one lost provider client, or of all clients when none is given. */
  clearPrompts(client?: AgentClient): void {
    for (const [requestId, pending] of this.#prompts) {
      if (client && pending.client !== client) continue;
      this.#expirePrompt(requestId, pending);
    }
  }

  /**
   * The provider stopped waiting for this request, such as an MCP client whose tool call timed out.
   * An answer now reaches nobody, so the question expires and the approval or takeover closes. The
   * turn continues without it.
   */
  cancelRequest(client: AgentClient, requestId: RequestId): void {
    let changed = false;
    const prompt = this.#prompts.get(requestId);
    if (prompt?.client === client) {
      this.#routines.markRunningForTurn(prompt.turnId);
      this.#expirePrompt(requestId, prompt);
      changed = true;
    }
    const approval = this.#approvals.get(requestId);
    if (approval?.client === client) {
      this.#routines.markRunningForTurn(approval.approval.turnId);
      this.#approvals.delete(requestId);
      this.#emitInputResolved("approval", requestId, approval.approval.agentId);
      changed = true;
    }
    for (const [key, takeover] of this.#takeovers) {
      // Resolving emits its own runtime snapshot.
      if (takeover.client === client && takeover.providerRequestId === requestId) {
        this.#resolveBrowserTakeover(key, takeover, "cancel");
      }
    }
    if (changed) this.#emitRuntimeSnapshot();
  }

  /**
   * A failed write must not stop the clear: the remaining requests would stay, and the provider
   * paths that clear a stopped client would fail after the client is gone.
   *
   * A client that still runs can still wait for the answer, for example an ACP turn that ended while
   * its MCP tool call stayed open. It gets a refusal, so its request does not wait forever. A client
   * that forgot the request ignores the answer.
   */
  #expirePrompt(requestId: RequestId, pending: PendingPrompt): void {
    this.#prompts.delete(requestId);
    this.#emitInputResolved("prompt", requestId, pending.agentId);
    if (pending.client.running) {
      try {
        pending.client.respond(pending.id, expiredPromptResult(pending.responseKind));
      } catch (error) {
        logger.warn("Unable to answer an expired prompt", { error: toLogValue(error) });
      }
    }
    try {
      this.#resolvePersistedPrompt(pending, { status: "expired" });
    } catch (error) {
      this.#emitError("prompt_persistence_failed", error, pending.agentId);
    }
  }

  /** Cancels the takeovers of one lost provider client, or of all clients when none is given. */
  clearBrowserTakeovers(client?: AgentClient): void {
    for (const [requestId, pending] of this.#takeovers) {
      if (client && pending.client !== client) continue;
      this.#resolveBrowserTakeover(requestId, pending, "cancel");
    }
  }

  /**
   * Drops the approvals of one lost provider client, or of all clients when none is given. The other
   * clients are still running and wait for an answer, so their approvals stay.
   */
  clearApprovals(client?: AgentClient): void {
    for (const [requestId, pending] of this.#approvals) {
      if (client && pending.client !== client) continue;
      this.#approvals.delete(requestId);
      this.#emitInputResolved("approval", requestId, pending.approval.agentId);
    }
  }

  #emitInputResolved(kind: "prompt" | "approval", requestId: RequestId, agentId: string): void {
    this.#emit({ type: "agent-input-resolved", kind, requestId, agentId });
  }

  /** A takeover whose tab disappeared can never be answered, so the tab list closing one cancels it. */
  cancelTakeoversForMissingTabs(tabs: BrowserTab[]): void {
    for (const [requestId, pending] of this.#takeovers) {
      if (!tabs.some((tab) => tab.id === pending.request.tabId)) {
        this.#resolveBrowserTakeover(requestId, pending, "cancel");
      }
    }
  }

  #respondToMalformedApproval(client: AgentClient, request: AppServerRequest): void {
    if (request.method === "item/permissions/requestApproval") {
      client.respond(request.id, { permissions: {}, scope: "turn" });
      return;
    }
    if (request.method === "applyPatchApproval" || request.method === "execCommandApproval") {
      client.respond(request.id, {
        decision: { denied: { rejection: "OpenBot could not identify this approval." } },
      });
      return;
    }
    client.respond(request.id, { decision: "decline" });
  }

  /**
   * Fills a password or authenticator request from the shared vault, without a card. True when the
   * request was answered this way. With no login for the site, or several and no `loginId`, the card
   * opens as before. The value goes to the browser only; the agent gets the usual result.
   */
  readonly #fillFromVault = Effect.fn("AttentionRegistry.fillFromVault")(function* (
    this: AttentionRegistry,
    requestId: RequestId,
    pending: PendingBrowserTakeover,
  ) {
    const vault = this.#passwordVault;
    const request = pending.secret?.request;
    if (!vault || !request || request.method === "otp") return false;
    // A script the agent ran on this site can read what is filled, and a field built for something
    // else can carry the value into a URL. In both cases the card lets the user decide.
    if (pending.secret?.agentScriptedOrigin !== false || pending.secret.vaultFillable !== true) return false;
    const kind = request.method === "password" ? "password" : "totp";
    const found = yield* Effect.result(
      Effect.gen(function* () {
        const call = yield* attentionStep(() => parseBrowserToolCall("submit_secret", pending.params.arguments));
        const loginId = call.tool === "submit_secret" ? call.args.loginId : undefined;
        const candidates = loginId
          ? []
          : ((yield* vault.loginsFor(request.origin)) ?? []).filter(
              (login) => kind === "password" || login.hasOneTimePassword,
            );
        const chosen = loginId ?? (candidates.length === 1 ? candidates[0]?.id : undefined);
        return chosen ? yield* vault.secretFor(chosen, request.origin, kind) : null;
      }),
    );
    if (Result.isFailure(found)) {
      logger.warn("Unable to fill from the shared vault", { error: toLogValue(found.failure.cause) });
      return false;
    }
    const secret = found.success;
    if (!secret || this.#takeovers.get(requestId) !== pending) return false;
    const submitted = yield* Effect.result(
      this.respondToBrowserSecret({ requestId, agentId: pending.request.agentId, decision: "submit", secret }),
    );
    if (Result.isFailure(submitted)) {
      // The tab could not be handed to the user. Answer the agent, so it does not wait forever.
      logger.warn("Unable to submit the shared login", { error: toLogValue(submitted.failure.cause) });
      if (this.#takeovers.get(requestId) === pending) this.#resolveBrowserTakeover(requestId, pending, "cancel");
      return true;
    }
    // A failed fill hands the tab to the user, as a failed card submission does.
    if (this.#takeovers.get(requestId) === pending) this.#routines.markNeedsAttention(pending.request.turnId);
    return true;
  }).bind(this);

  #resolveBrowserTakeover(
    requestId: RequestId,
    pending: PendingBrowserTakeover,
    decision: RespondToBrowserTakeoverInput["decision"],
  ): void {
    pending.secret?.cancel();
    this.#routines.markRunningForTurn(pending.request.turnId);
    this.#takeovers.delete(requestId);
    // `surfaceBrowserTakeover` refuses a second request for the same tab, so this is belt and braces --
    // but returning control while another request still waits on the tab would be the worse mistake.
    if (![...this.#takeovers.values()].some((candidate) => candidate.request.tabId === pending.request.tabId)) {
      this.#browser.endTakeover(pending.request.tabId);
    }
    this.#emit({
      type: "browser-takeover-resolved",
      requestId: pending.request.requestId,
      agentId: pending.request.agentId,
    });
    this.#emitRuntimeSnapshot();
    pending.resolve(browserTakeoverResult(decision));
  }

  #persistQuestionPrompt(
    agentId: string,
    publicThreadId: string,
    turnId: string,
    requestId: RequestId,
    questions: AgentPromptQuestion[],
  ): string {
    const snapshot = this.#conversation.ensureSnapshot(agentId, publicThreadId);
    const messageId = `question-prompt:${turnId}:${String(requestId)}`;
    const existing = snapshot.messages.find((message) => message.id === messageId);
    if (!existing) {
      snapshot.messages.push({
        id: messageId,
        turnId,
        author: "assistant",
        source: "assistant",
        text: questionPromptText(questions, null),
        createdAt: new Date().toISOString(),
        status: "completed",
        itemType: "question_prompt",
        questionPrompt: {
          requestId,
          questions: structuredClone(questions),
          resolution: null,
        },
      });
      this.#conversation.emitConversation(snapshot, "prompt.requested", { turnId, requestId });
    }
    return messageId;
  }

  #resolvePersistedPrompt(pending: PendingPrompt, resolution: AgentPromptResolution): void {
    const snapshot = this.#conversation.ensureSnapshot(pending.agentId, pending.publicThreadId);
    const message = snapshot.messages.find((candidate) => candidate.id === pending.messageId);
    if (!message?.questionPrompt || message.questionPrompt.resolution !== null) return;
    message.questionPrompt.resolution = structuredClone(resolution);
    message.text = questionPromptText(message.questionPrompt.questions, resolution);
    this.#conversation.emitConversation(snapshot, "prompt.resolved", {
      turnId: pending.turnId,
      requestId: pending.id,
      status: resolution.status,
    });
  }
}

export class AttentionOperationFailed extends Schema.TaggedError<AttentionOperationFailed>()(
  "AttentionOperationFailed",
  { cause: Schema.Defect() },
) {}

const { sync: attentionStep, rewrap: toAttentionOperationFailed } = causeHelpers(AttentionOperationFailed);
