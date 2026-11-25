import { randomUUID } from "node:crypto";
import type { CreditMediaGenerationKind } from "@openbot/contracts/credit-media";
import type { FeedbackPhone } from "@openbot/contracts/feedback";
import type {
  AgentApproval,
  AgentApprovalKind,
  AgentEvent,
  AgentPromptQuestion,
  AgentPromptResolution,
  AgentRuntimeSnapshot,
  BrowserTab,
  BrowserTakeoverRequest,
  BrowserVaultSkipReason,
  ConversationMessageSender,
  CreditsHold,
  LocalBrowserSecretResponse,
  MediaApprovalChoice,
  MediaApprovalOffer,
  RespondToApprovalInput,
  RespondToBrowserTakeoverInput,
  RespondToCreditsHoldInput,
  RespondToMediaApprovalInput,
  RespondToPromptInput,
} from "@openbot/contracts/ipc";
import {
  AGENT_RUNTIME_ATTENTION_LIMIT,
  AGENT_WELCOME_ITEM_TYPE,
  BROWSER_TAKEOVER_REASONS,
  cardBrand,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";
import { normalizeTwoStepKey, twoStepKeySecret } from "@openbot/contracts/two-step-code";
import {
  type ConversationUiBlock,
  normalizeConversationUiBlock,
  UI_BLOCK_LIMITS,
  UI_BLOCK_TEXT_ACTION_ID,
  UI_BLOCK_VERSION,
  type UiBlockAutoAnswer,
  type UiBlockResponse,
  type UiBlockSpec,
  type UiBlockState,
  type UiBlockValue,
  type UiVaultRequestKind,
  type UiVaultSavedItem,
  uiBlockActionIsPrivileged,
  uiBlockAnswersFromResponse,
  uiBlockFallbackQuestions,
  uiBlockHasPrivilegedAction,
  uiBlockOutcomeText,
  uiBlockResponseFromAnswers,
  uiConfirmPreviewEdit,
  validateUiBlockResponse,
} from "@openbot/contracts/ui-blocks";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, redactText, registerSecretValue, toLogValue } from "@openbot/logging";
import { Deferred, Effect, Option, Result, Schema } from "effect";
import { getDomain } from "tldts";
import type { AgentApiKeys, SavedApiKey } from "../agent-api-keys";
import type { AgentClient, AgentProvider } from "../agent-client";
import { type BrowserOperationError, browserFailure, secureInputFailure } from "../browser-effects";
import type { PreparedBrowserSecret } from "../browser-host";
import type { BrowserCardVault } from "../browser-tool-actions";
import { repairBrowserToolInput } from "../browser-tool-input";
import { type BrowserToolArguments, parseBrowserToolCall } from "../browser-tools";
import { causeHelpers } from "../effect-boundary";
import { LINK_CARD_ID_PREFIX, type LinkWallet } from "../link-wallet";
import type { NearWallet } from "../near-wallet";
import {
  isWebProtocol,
  type PasswordVault,
  type PasswordVaultError,
  type VaultLogin,
  websiteUrl,
} from "../password-vault";
import {
  type AppServerRequest,
  type DynamicToolCallParams,
  type DynamicToolResult,
  getArray,
  getRecord,
  getString,
  isRecord,
  type RequestId,
} from "../protocol";
import {
  type VaultAgent,
  type VaultAgentChange,
  type VaultAgentResult,
  type VaultEnteredItem,
  type VaultItems,
  type VaultTypedLogin,
  vaultClosedText,
} from "../vault-items";
import { type ApprovalAutomationPolicy, NO_APPROVAL_AUTOMATION, shouldAutoApprove } from "./approval-automation";
import type { ConversationRuntime } from "./conversation-runtime";
import type { HostedSiteOperationFailed } from "./hosted-site-coordinator";
import {
  HOSTED_SITE_APPROVAL_METHOD,
  type HostedSiteApprovalTarget,
  type HostedSiteMutationContext,
} from "./hosted-site-coordinator";
import type { HostedSiteMutationTool } from "./hosted-site-events";
import { ForbiddenAttentionAnswer, InactiveAttentionRequest } from "./inactive-attention-request";
import {
  API_KEY_FIELD_ID,
  API_KEY_SCOPE_AGENT,
  API_KEY_SCOPE_FIELD_ID,
  apiKeyPromptResult,
  approvalPermissions,
  browserTakeoverError,
  browserTakeoverExpiredResult,
  browserTakeoverLateNotes,
  browserTakeoverReleasedResult,
  browserTakeoverResult,
  browserTakeoverWaitingResult,
  commandText,
  declinedMcpElicitationText,
  detachedPromptResult,
  dynamicPromptResult,
  editedPreviewQuestions,
  expiredPromptResult,
  lateAnswerText,
  locationPromptResult,
  MCP_TOOL_CONSENT_ALLOW_ONCE,
  mcpElicitationQuestions,
  mcpElicitationResult,
  mcpToolCallConsent,
  promptQuestions,
  promptQuestionsProblem,
  promptResolution,
  questionPromptText,
  uiBlockPromptResult,
  userMessagePromptResult,
  validPromptQuestions,
  vaultLateAnswerText,
  vaultPromptResult,
  vaultRequestFormSpec,
} from "./prompts";
import { compactRuntimeApproval, compactRuntimeQuestion } from "./runtime-snapshot";
import { isDynamicToolCall } from "./thread-items";

const logger = createOpenBotLogger("attention-registry");

interface PendingPrompt {
  client: AgentClient;
  id: RequestId;
  responseKind: "dynamic-tool" | "mcp-elicitation" | "user-input" | "ui-block";
  params: unknown;
  agentId: string;
  publicThreadId: string;
  turnId: string;
  messageId: string;
  questions: AgentPromptQuestion[];
  uiBlock?: SurfacedUiBlock;
  saving?: boolean;
  autoAnswer?: { state: UiBlockAutoAnswer; timer: ReturnType<typeof setTimeout> };
  detach?: { target: LateAnswerTarget; timer?: ReturnType<typeof setTimeout> };
  detached?: LateAnswerTarget;
  expireTimer?: ReturnType<typeof setTimeout>;
  subagent?: true;
}

function outlivesTurn(pending: PendingPrompt): boolean {
  return pending.detached !== undefined || pending.subagent === true;
}

function plainBlock(
  block: SurfacedUiBlock,
  auto: UiBlockAutoAnswer | undefined,
  questions: AgentPromptQuestion[],
): boolean {
  return (
    !block.vault &&
    !block.apiKey &&
    !block.location &&
    auto === undefined &&
    !questions.some((question) => question.isSecret)
  );
}

function providerStopsCall(request: AppServerRequest): boolean {
  return request.detachAfterMs !== undefined || request.answerBeforeMs !== undefined;
}

export type AgentPersonWait = "approval" | "answer" | "browser";

export interface LateAnswerTarget {
  taskId?: string;
}

export interface SurfacedUiBlock {
  blockId: string;
  spec: UiBlockSpec;
  apiKey?: { name: string; vault?: boolean };
  vault?: { kind: UiVaultRequestKind };
  location?: true;
}

export interface PromptResponder {
  sender?: ConversationMessageSender;
  privileged: boolean;
  automatic?: boolean;
}

const AUTOMATIC_RESPONDER: PromptResponder = { privileged: true, automatic: true };

export interface ApprovalResponder {
  owner: boolean;
  phone?: FeedbackPhone;
  person?: { id: string; canAdminister: boolean };
}

export interface CreditsHoldCall {
  kind: CreditMediaGenerationKind;
  cost: number;
}

export interface CreditsHoldWallet {
  agentsAllowed: () => boolean;
  enableAgents: () => Effect.Effect<void, unknown>;
  balance: () => Effect.Effect<number | null>;
}

export type CreditAnswerVia = "local" | "remote" | "automatic";

function answerVia(responder: ApprovalResponder | undefined): CreditAnswerVia {
  return responder ? "remote" : "local";
}

export interface CreditsHoldAnswer {
  action: "continue" | "skip" | "mute";
  responder?: ApprovalResponder;
  via?: CreditAnswerVia;
  enabled?: boolean;
  stopped?: boolean;
}

interface PendingCreditsHold {
  call: CreditsHoldCall;
  balance: number | null;
  wallet: CreditsHoldWallet;
  answer: (answer: CreditsHoldAnswer) => void;
}

function respondsAsAdmin(responder: ApprovalResponder | undefined): boolean {
  if (!responder) return true;
  return responder.person?.canAdminister ?? responder.owner;
}

function creditsSum(values: readonly number[]): number {
  return Math.round(values.reduce((total, value) => total + value, 0) * 1000) / 1000;
}

interface PendingApproval {
  client: AgentClient;
  id: RequestId;
  method: string;
  params: unknown;
  approval: AgentApproval;
  executionThreadId: string;
  hostedSiteMutation?: HostedSiteMutationContext;
  decide?: (decision: ToolApprovalDecision, responder?: ApprovalResponder, choice?: MediaApprovalChoice) => void;
  media?: MediaApprovalOffer;
  creditsHold?: PendingCreditsHold;
  alwaysAsk?: boolean;
  ownerOnly?: boolean;
  needsPhone?: boolean;
}

export type ToolApprovalDecision = "accept" | "decline" | "cancel";

interface MediaApprovalAnswer {
  readonly decision: ToolApprovalDecision;
  readonly choice?: MediaApprovalChoice;
  readonly via: CreditAnswerVia;
}

const TOOL_APPROVAL_METHOD = "openbot/tool-approval";
const MESSAGING_QUESTION_REFUSED =
  "This conversation is in an external chat, where nobody can answer a question card. Ask the question in your answer: the person replies in the conversation.";
const MESSAGING_REQUEST_CARD_REFUSED =
  "This request came from an external chat (Slack, Discord, Telegram or WhatsApp) through another agent, and nobody can answer a card here. Decide on your own and continue. When only the OpenBot user can unblock you, such as a sign-in, a key or a password, stop and say in your answer exactly what the OpenBot user must do in OpenBot.";
const MCP_TOOL_CONSENT_UNANSWERABLE = {
  action: "cancel",
  content: null,
  _meta: { codex_approval_cancellation_reason: "non_interactive" },
} as const;

const TAKEOVER_TAB_ID_MISSING = "Give tabId: the id of the tab, from open or list_tabs.";
const TAKEOVER_TAB_OF_OTHER_CHAT =
  "This chat cannot use this tab. Open the page in this chat with open, then call this tool with the new tabId.";
const USER_ANSWER_LIMIT_MS = 10 * 60_000;
const TAKEOVER_ALREADY_WAITING = "A takeover of this tab already waits for the user. Wait for it to return.";
const VAULT_UNAVAILABLE = "No Vault is available on this computer. Ask the user.";
const ROUTINE_SAVED_LOGIN_NOT_FILLED =
  "This is a routine run, so nobody can answer a password card. When this text says how to correct the call, correct it and call submit_secret again with the loginId. Else stop the sign-in and say in your report that the user must sign in, and why OpenBot did not fill the saved login. Do not call submit_secret without loginId or request_takeover.";
const NO_LOGIN_FOR_SITE =
  "No saved login is for the site of this page. A login fits only the site of a website saved in it, with its subdomains, and a sign-in page can be on a different site than the service. When the user says that a login for this account is saved, tell them what to check. In a password manager: add the address of this sign-in page as a website of the login, and keep the login where they share logins with OpenBot; the page of each password manager in Marketplace shows where. In the OpenBot Vault, a login has one website: save a second login for the address of this sign-in page in Server settings > Vault, and let this agent use the login under Agents. Until then, continue as for a site with no saved login.";
const VAULT_LOGIN_ADD_FIELDS =
  "A new login needs website and password. When you do not have the password, call request_vault_item kind=login.";
const VAULT_PASSWORD_EXTERNAL_REFUSED =
  "You cannot save a password in an external chat. Ask the user to add it in Server settings > Vault.";
const VAULT_PASSWORD_PERSON_ONLY =
  "Only a person's message, in your OpenBot chat or a thread they opened, can save a password or a two-step key. Ask the user to add it in Server settings > Vault.";
const decodePasswordArgument = Schema.decodeUnknownOption(Schema.Struct({ password: Schema.String }));
const VAULT_TWO_STEP_KEY_INVALID =
  "twoStepKey is not an authenticator setup key. Give the base32 key (at least 16 characters) or the otpauth://totp/ link that the site shows with its QR code.";
const decodeTwoStepKeyArgument = Schema.decodeUnknownOption(Schema.Struct({ twoStepKey: Schema.String }));
const VAULT_CARD_ADD_REFUSED =
  "You cannot add a card: its number comes only from the user. Call request_vault_item kind=card. In a Slack, Discord or Telegram chat, ask the user to add it in Server settings > Vault.";
const VAULT_FIELDS: Record<BrowserToolArguments<"save_vault_item">["kind"], readonly string[]> = {
  contact: ["label", "fullName", "address", "address2", "city", "region", "postalCode", "country", "phone", "email"],
  login: ["website", "username", "password", "twoStepKey"],
  card: ["label", "nameOnCard", "expMonth", "expYear", "billingContactId"],
};

const LINK_UNAVAILABLE =
  "Link is not connected. Ask the user to connect Link in Server settings > Vault > Cards, or use a saved card.";

const NEAR_UNAVAILABLE =
  "The NEAR Intents wallet is not ready. Ask the user to set it up or unfreeze it in Server settings > Vault > Crypto.";

function httpsHost(address: string): string | null {
  try {
    const url = new URL(address);
    return url.protocol === "https:" ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function sameSite(address: string, merchant: string): boolean {
  const host = httpsHost(address);
  if (!host) return false;
  const domain = getDomain(host, { allowPrivateDomains: true });
  return domain !== null && domain === getDomain(merchant, { allowPrivateDomains: true });
}

type VaultAgentSave = VaultAgentChange | { kind: "newLogin"; login: VaultTypedLogin; twoStepKey?: string | undefined };

function vaultChange(args: BrowserToolArguments<"save_vault_item">): VaultAgentSave | string {
  const allowed = VAULT_FIELDS[args.kind];
  const misplaced = Object.entries(args).find(
    ([key, value]) => value !== undefined && key !== "kind" && key !== "id" && !allowed.includes(key),
  );
  if (misplaced) return `${misplaced[0]} is not a field of a ${args.kind}. Its fields are: ${allowed.join(", ")}.`;
  if (args.kind === "login") {
    if (args.twoStepKey && normalizeTwoStepKey(args.twoStepKey) === null) return VAULT_TWO_STEP_KEY_INVALID;
    if (args.id) {
      if (args.website !== undefined)
        return "A saved login keeps its website. Omit website, or omit id to add a login.";
      return {
        kind: "login",
        id: args.id,
        username: args.username,
        password: args.password,
        twoStepKey: args.twoStepKey,
      };
    }
    if (!args.website?.trim() || !args.password?.trim()) return VAULT_LOGIN_ADD_FIELDS;
    const url = websiteUrl(args.website);
    if (!url || !isWebProtocol(url) || !url.hostname)
      return "website must be an HTTP or HTTPS website, such as example.com or http://192.168.1.1.";
    return {
      kind: "newLogin",
      login: { origin: url.origin, username: args.username ?? "", password: args.password },
      twoStepKey: args.twoStepKey || undefined,
    };
  }
  if (args.kind === "card")
    return args.id
      ? {
          kind: "card",
          id: args.id,
          label: args.label,
          nameOnCard: args.nameOnCard,
          expMonth: args.expMonth,
          expYear: args.expYear,
          billingContactId: args.billingContactId,
        }
      : VAULT_CARD_ADD_REFUSED;
  const fields = {
    label: args.label,
    fullName: args.fullName,
    address: args.address,
    address2: args.address2,
    city: args.city,
    region: args.region,
    postalCode: args.postalCode,
    country: args.country,
    phone: args.phone,
    email: args.email,
  };
  if (!args.id && !Object.values(fields).some((value) => value?.trim())) return "Give at least one contact field.";
  return { kind: "contact", id: args.id, fields };
}

function vaultFailure(action: "save" | "delete", failure: PasswordVaultError): DynamicToolResult {
  logger.warn(`Unable to ${action} a Vault item for an agent`, { error: toLogValue(failure.cause) });
  const { cause } = failure;
  return browserTakeoverError(
    cause instanceof Error && !("code" in cause) ? cause.message : `The Vault item could not be ${action}d.`,
  );
}

function vaultResult(value: { status: string } & VaultAgentResult): DynamicToolResult {
  return { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] };
}

function enteredExpiry(text: string): { expMonth: number; expYear: number } {
  const match = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/u.exec(text.trim());
  if (!match?.[1] || !match[2]) return { expMonth: Number.NaN, expYear: Number.NaN };
  const year = Number(match[2]);
  return { expMonth: Number(match[1]), expYear: year < 100 ? 2000 + year : year };
}

function enteredVaultItem(
  kind: UiVaultRequestKind,
  values: Readonly<Record<string, UiBlockValue>>,
): VaultEnteredItem | null {
  const text = (id: string) => {
    const value = values[id];
    return typeof value === "string" ? value.trim() : "";
  };
  switch (kind) {
    case "login":
      if (!text("website") && !values.password) return null;
      return {
        kind,
        id: null,
        website: text("website"),
        username: text("username"),
        notes: "",
        password: typeof values.password === "string" ? values.password : "",
      };
    case "card":
      if (!text("number")) return null;
      return {
        kind,
        id: null,
        label: text("label"),
        nameOnCard: text("nameOnCard"),
        ...enteredExpiry(text("expiry")),
        billingContactId: null,
        number: text("number"),
        securityCode: text("securityCode") || null,
      };
    case "contact": {
      const fields = {
        label: text("label"),
        fullName: text("fullName"),
        address: text("address"),
        address2: text("address2"),
        city: text("city"),
        region: text("region"),
        postalCode: text("postalCode"),
        country: text("country"),
        phone: text("phone"),
        email: text("email"),
      };
      if (!Object.values(fields).some(Boolean)) return null;
      return { kind, id: null, ...fields };
    }
  }
}

const TYPED_PASSWORD_NOT_SAVED =
  "The password was not saved in the Vault: the secure input did not complete. Tell the user in one short sentence that the password was not saved.";

interface PendingBrowserTakeover {
  client: AgentClient;
  providerRequestId: RequestId;
  secret?: PreparedBrowserSecret | undefined;
  submitting?: boolean;
  vaultLoginId?: string;
  vaultSkipped?: string;
  personCompleted?: true;
  memberCompleted?: true;
  personCancelled?: true;
  vaultNotSaved?: true;
  secureInputFailed?: string;
  params: DynamicToolCallParams;
  request: BrowserTakeoverRequest;
  resolve: (result: DynamicToolResult) => void;
  releaseAt: number;
  detached?: true;
  released?: LateAnswerTarget;
  subagent?: true;
}

function heldTakeoverKey(tabId: string, threadId: string): string {
  return JSON.stringify([tabId, threadId]);
}

interface HeldTakeoverResult {
  tabId: string;
  threadId: string;
  turnId: string;
  result: DynamicToolResult;
}

function takeoverCall() {
  const completion = Deferred.makeUnsafe<DynamicToolResult>();
  const resolve = (result: DynamicToolResult) => {
    Deferred.doneUnsafe(completion, Effect.succeed(result));
  };
  return { completion, resolve };
}

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

export interface RoutineAttention {
  markNeedsAttention(turnId: string | null): void;
  markRunningForTurn(turnId: string | null): void;
  runsTurn(turnId: string): boolean;
}

export interface AttentionBrowserHost {
  prepareSecret?(params: DynamicToolCallParams): Effect.Effect<PreparedBrowserSecret, BrowserOperationError>;
  listTabs(): BrowserTab[];
  toolCanUseTab(params: DynamicToolCallParams, tabId: string): boolean;
  beginTakeover(tabId: string): Effect.Effect<void, BrowserOperationError>;
  endTakeover(tabId: string, completed?: boolean): void;
  takeoverSignInArrived?(tabId: string): boolean;
}

type AttentionConversation = Pick<
  ConversationRuntime,
  "agentForThread" | "emitConversation" | "ensureSnapshot" | "publicThreadId"
>;

export interface AttentionRegistryOptions {
  conversation: AttentionConversation;
  browser: AttentionBrowserHost;
  hostedSites: HostedSiteApprovals;
  routines: RoutineAttention;
  approvalAutomation?: ApprovalAutomationPolicy | undefined;
  workspaceSandboxed?(agentId: string): boolean;
  confinedWritesAllowed?(agentId: string, paths: readonly string[]): boolean;
  beforeFileChangeAccepted?(agentId: string, paths: readonly string[]): Effect.Effect<void>;
  messagingThread?(threadId: string): boolean;
  messagingRequestTurn?(agentId: string, turnId: string): boolean;
  approvalChatThread?(agentId: string, threadId: string): string;
  emit(event: AgentEvent): void;
  emitError(code: string, error: unknown, agentId?: string): void;
  emitRuntimeSnapshot(): void;
  passwordVault?: PasswordVault | null | undefined;
  vaultItems?: VaultItems | null | undefined;
  linkWallet?: LinkWallet | null | undefined;
  nearWallet?: NearWallet | null | undefined;
  agentName?(agentId: string): string | undefined;
  noteVaultChange?(agentId: string, threadId: string, turnId: string, text: string): void;
  apiKeys?: AgentApiKeys | null | undefined;
  codexSubagentParent?(childThreadId: string): CodexSubagentParent | undefined;
  lateAnswerTarget?(agentId: string, publicThreadId: string): LateAnswerTarget | null;
  sendLateAnswer?(
    agentId: string,
    target: LateAnswerTarget,
    text: string,
    sender: ConversationMessageSender | undefined,
  ): void;
  userAnswerLimitMs?: number;
}

export interface CodexSubagentParent {
  agentId: string;
  threadId: string;
  turnId: string;
}

export type RuntimeAttention = Pick<
  AgentRuntimeSnapshot,
  "attentionComplete" | "pendingPrompts" | "pendingApprovals" | "pendingBrowserTakeovers"
>;

export type LocalAttentionResponse =
  | { kind: "prompt"; requestId: string; answers: Record<string, string[]> }
  | { kind: "approval"; requestId: string; decision: "accept" | "decline" };

export class AttentionRegistry {
  readonly #localHandles = new WeakMap<PendingPrompt | PendingApproval | PendingBrowserTakeover, string>();
  readonly #conversation: AttentionConversation;
  readonly #browser: AttentionBrowserHost;
  readonly #hostedSites: HostedSiteApprovals;
  readonly #routines: RoutineAttention;
  readonly #approvalAutomation: ApprovalAutomationPolicy;
  readonly #workspaceSandboxed: (agentId: string) => boolean;
  readonly #confinedWritesAllowed: (agentId: string, paths: readonly string[]) => boolean;
  readonly #beforeFileChangeAccepted: (agentId: string, paths: readonly string[]) => Effect.Effect<void>;
  readonly #messagingThread: (threadId: string) => boolean;
  readonly #messagingRequestTurn: (agentId: string, turnId: string) => boolean;
  readonly #approvalChatThread: (agentId: string, threadId: string) => string;
  readonly #emit: (event: AgentEvent) => void;
  readonly #emitError: (code: string, error: unknown, agentId?: string) => void;
  readonly #emitRuntimeSnapshot: () => void;
  readonly #passwordVault: PasswordVault | null;
  readonly #vaultItems: VaultItems | null;
  readonly #linkWallet: LinkWallet | null;
  readonly #nearWallet: NearWallet | null;
  readonly #agentName: (agentId: string) => string | undefined;
  readonly #noteVaultChange: (agentId: string, threadId: string, turnId: string, text: string) => void;
  readonly #apiKeys: AgentApiKeys | null;
  readonly #codexSubagentParent: (childThreadId: string) => CodexSubagentParent | undefined;
  readonly #lateAnswerTarget: (agentId: string, publicThreadId: string) => LateAnswerTarget | null;
  readonly #sendLateAnswer: NonNullable<AttentionRegistryOptions["sendLateAnswer"]>;
  readonly #userAnswerLimitMs: number;
  readonly #prompts = new Map<RequestId, PendingPrompt>();
  readonly #approvals = new Map<RequestId, PendingApproval>();
  readonly #takeovers = new Map<RequestId, PendingBrowserTakeover>();
  readonly #heldTakeoverResults = new Map<string, HeldTakeoverResult>();

  constructor(options: AttentionRegistryOptions) {
    this.#conversation = options.conversation;
    this.#browser = options.browser;
    this.#hostedSites = options.hostedSites;
    this.#routines = options.routines;
    this.#approvalAutomation = options.approvalAutomation ?? NO_APPROVAL_AUTOMATION;
    this.#workspaceSandboxed = options.workspaceSandboxed ?? (() => false);
    this.#confinedWritesAllowed = options.confinedWritesAllowed ?? (() => false);
    this.#beforeFileChangeAccepted = options.beforeFileChangeAccepted ?? (() => Effect.void);
    this.#messagingThread = options.messagingThread ?? (() => false);
    this.#messagingRequestTurn = options.messagingRequestTurn ?? (() => false);
    this.#approvalChatThread = options.approvalChatThread ?? ((_agentId, threadId) => threadId);
    this.#emit = options.emit;
    this.#emitError = options.emitError;
    this.#emitRuntimeSnapshot = options.emitRuntimeSnapshot;
    this.#passwordVault = options.passwordVault ?? null;
    this.#vaultItems = options.vaultItems ?? null;
    this.#linkWallet = options.linkWallet ?? null;
    this.#nearWallet = options.nearWallet ?? null;
    this.#agentName = options.agentName ?? (() => undefined);
    this.#noteVaultChange = options.noteVaultChange ?? (() => undefined);
    this.#apiKeys = options.apiKeys ?? null;
    this.#lateAnswerTarget = options.lateAnswerTarget ?? (() => null);
    this.#sendLateAnswer = options.sendLateAnswer ?? (() => undefined);
    this.#userAnswerLimitMs = options.userAnswerLimitMs ?? USER_ANSWER_LIMIT_MS;
    this.#codexSubagentParent = options.codexSubagentParent ?? (() => undefined);
  }

  #vaultAgent(agentId: string): VaultAgent {
    return { id: agentId, name: this.#agentName(agentId) };
  }

  agentIdForRequest(requestId: RequestId): string | undefined {
    return (
      this.#prompts.get(requestId)?.agentId ??
      this.#approvals.get(requestId)?.approval.agentId ??
      this.#takeovers.get(requestId)?.request.agentId
    );
  }

  pendingApproval(requestId: RequestId): AgentApproval | undefined {
    const pending = this.#approvals.get(requestId);
    return pending ? structuredClone(pending.approval) : undefined;
  }

  pendingMediaApproval(agentId: string, requestId: RequestId): MediaApprovalOffer | undefined {
    const pending = this.#approvals.get(requestId);
    if (!pending?.media || pending.approval.agentId !== agentId) return undefined;
    return structuredClone(pending.media);
  }

  pendingCreditsHold(agentId: string, requestId: RequestId, canEnable: boolean): CreditsHold | undefined {
    const pending = this.#approvals.get(requestId);
    if (!pending?.creditsHold || pending.approval.agentId !== agentId) return undefined;
    return this.#creditsHoldSummary(pending, pending.creditsHold, canEnable);
  }

  #creditsHoldGroup(pending: PendingApproval): PendingApproval[] {
    const { agentId, threadId, turnId } = pending.approval;
    return [...this.#approvals.values()].filter(
      (other) =>
        other.creditsHold !== undefined &&
        other.approval.agentId === agentId &&
        other.approval.threadId === threadId &&
        other.approval.turnId === turnId,
    );
  }

  #creditsHoldSummary(pending: PendingApproval, hold: PendingCreditsHold, canEnable: boolean): CreditsHold {
    const calls = this.#creditsHoldGroup(pending).flatMap((other) =>
      other.creditsHold ? [other.creditsHold.call] : [],
    );
    return {
      reason: hold.wallet.agentsAllowed() ? "balance" : "agentsOff",
      images: calls.filter((call) => call.kind === "image").length,
      videos: calls.filter((call) => call.kind === "video").length,
      cost: creditsSum(calls.map((call) => call.cost)),
      balance: hold.balance,
      canEnable,
    };
  }

  #resolveCreditsHolds(group: readonly PendingApproval[], answer: CreditsHoldAnswer): void {
    for (const pending of group) {
      if (this.#approvals.get(pending.id) !== pending) continue;
      this.#approvals.delete(pending.id);
      this.#routines.markRunningForTurn(pending.approval.turnId);
      this.#emitInputResolved("approval", pending.id, pending.approval.agentId);
      pending.creditsHold?.answer(answer);
    }
    this.#emitRuntimeSnapshot();
  }

  readonly respondToCreditsHold = Effect.fn("AttentionRegistry.respondToCreditsHold")(function* (
    this: AttentionRegistry,
    input: RespondToCreditsHoldInput,
    responder?: ApprovalResponder,
    automatic = false,
  ) {
    const { pending, hold } = yield* attentionStep(() => {
      const value = this.#approvals.get(input.requestId);
      if (!value?.creditsHold || value.approval.agentId !== input.agentId)
        throw new InactiveAttentionRequest(sourceText("error.backend.approvalInactive"));
      if (input.action === "enable" && !respondsAsAdmin(responder))
        throw new ForbiddenAttentionAnswer(sourceText("error.backend.creditsHoldAdminOnly"));
      return { pending: value, hold: value.creditsHold };
    });
    const canEnable = respondsAsAdmin(responder);
    const via = automatic ? "automatic" : answerVia(responder);
    if (input.action === "skip" || input.action === "mute") {
      this.#resolveCreditsHolds(this.#creditsHoldGroup(pending), {
        action: input.action,
        via,
        ...(responder ? { responder } : {}),
      });
      return null;
    }
    if (input.action === "enable" && !hold.wallet.agentsAllowed())
      yield* hold.wallet.enableAgents().pipe(Effect.mapError((cause) => new AttentionOperationFailed({ cause })));
    if (!hold.wallet.agentsAllowed()) return this.#creditsHoldSummary(pending, hold, canEnable);
    const balance = yield* hold.wallet.balance();
    const group = this.#creditsHoldGroup(pending);
    const cost = creditsSum(group.flatMap((other) => (other.creditsHold ? [other.creditsHold.call.cost] : [])));
    if (balance !== null && balance < cost) {
      for (const other of group) if (other.creditsHold) other.creditsHold.balance = balance;
      return this.#creditsHoldSummary(pending, hold, canEnable);
    }
    this.#resolveCreditsHolds(group, {
      action: "continue",
      via,
      ...(input.action === "enable" ? { enabled: true } : {}),
      ...(responder ? { responder } : {}),
    });
    return null;
  }, Effect.uninterruptible).bind(this);

  recheckCreditsHolds(): void {
    const seen = new Set<string>();
    for (const pending of [...this.#approvals.values()]) {
      if (!pending.creditsHold) continue;
      const key = `${pending.approval.agentId}\u0000${pending.approval.threadId}\u0000${pending.approval.turnId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const report = (error: unknown) =>
        Effect.sync(() => {
          if (this.#approvals.get(pending.id) === pending)
            this.#emitError("credits_hold_recheck_failed", error, pending.approval.agentId);
        });
      Effect.runFork(
        this.respondToCreditsHold(
          {
            agentId: pending.approval.agentId,
            requestId: pending.id,
            action: "continue",
          },
          undefined,
          true,
        ).pipe(Effect.catch(report), Effect.catchDefect(report)),
      );
    }
  }

  hasAttentionFor(agentId: string): boolean {
    return (
      [...this.#prompts.values()].some((pending) => pending.agentId === agentId) ||
      [...this.#approvals.values()].some((pending) => pending.approval.agentId === agentId) ||
      [...this.#takeovers.values()].some((pending) => pending.request.agentId === agentId)
    );
  }

  waitsFor(agentId: string): AgentPersonWait[] {
    const kinds: AgentPersonWait[] = [];
    if ([...this.#approvals.values()].some((pending) => pending.approval.agentId === agentId)) kinds.push("approval");
    if ([...this.#prompts.values()].some((pending) => pending.agentId === agentId && pending.detached === undefined))
      kinds.push("answer");
    if ([...this.#takeovers.values()].some((pending) => pending.request.agentId === agentId)) kinds.push("browser");
    return kinds;
  }

  hasAttentionForTurn(threadId: string, turnId: string): boolean {
    return (
      [...this.#prompts.values()].some(
        (pending) =>
          !pending.detached &&
          getString(pending.params, "threadId") === threadId &&
          getString(pending.params, "turnId") === turnId,
      ) ||
      [...this.#approvals.values()].some(
        (pending) =>
          (getString(pending.params, "threadId") ?? getString(pending.params, "conversationId")) === threadId &&
          (getString(pending.params, "turnId") ?? turnId) === turnId,
      ) ||
      [...this.#takeovers.values()].some(
        (pending) => !pending.released && pending.params.threadId === threadId && pending.params.turnId === turnId,
      )
    );
  }

  localAttention(agentId: string) {
    return {
      prompts: [...this.#prompts.values()]
        .filter((pending) => pending.agentId === agentId)
        .map((pending) => ({
          requestId: this.#localHandle(pending),
          questions: structuredClone(pending.questions),
          requiresOpenBot: pending.questions.some(localQuestionNeedsOpenBot),
        })),
      approvals: [...this.#approvals.values()]
        .filter((pending) => pending.approval.agentId === agentId)
        .map((pending) => ({ ...structuredClone(pending.approval), requestId: this.#localHandle(pending) })),
      browserTakeovers: [...this.#takeovers.values()]
        .filter((pending) => pending.request.agentId === agentId)
        .map((pending) => ({ requestId: this.#localHandle(pending), requiresOpenBot: true })),
    };
  }

  readonly respondToLocalAttention = Effect.fn("AttentionRegistry.respondToLocalAttention")(function* (
    this: AttentionRegistry,
    agentId: string,
    input: LocalAttentionResponse,
  ) {
    if (input.kind === "prompt") {
      const pending = [...this.#prompts.values()].find(
        (entry) => entry.agentId === agentId && this.#localHandles.get(entry) === input.requestId,
      );
      if (!pending || pending.questions.some(localQuestionNeedsOpenBot)) {
        return yield* attentionStep(() => {
          throw new InactiveAttentionRequest(sourceText("error.backend.promptInactive"));
        });
      }
      return yield* this.respondToPrompt({ requestId: pending.id, answers: input.answers }, { privileged: false });
    }
    const pending = [...this.#approvals.values()].find(
      (entry) => entry.approval.agentId === agentId && this.#localHandles.get(entry) === input.requestId,
    );
    if (!pending) {
      return yield* attentionStep(() => {
        throw new InactiveAttentionRequest(sourceText("error.backend.approvalInactive"));
      });
    }
    return yield* this.respondToApproval({ requestId: pending.id, decision: input.decision }, { owner: false });
  }).bind(this);

  #localHandle(pending: PendingPrompt | PendingApproval | PendingBrowserTakeover): string {
    const existing = this.#localHandles.get(pending);
    if (existing) return existing;
    const handle = randomUUID();
    this.#localHandles.set(pending, handle);
    return handle;
  }

  pendingPrompts(): RuntimeAttention["pendingPrompts"] {
    return [...this.#prompts.values()].map((pending) => ({
      requestId: pending.id,
      agentId: pending.agentId,
      threadId: pending.publicThreadId,
      turnId: pending.turnId,
      questions: pending.questions.map(compactRuntimeQuestion),
      ...(outlivesTurn(pending) ? { detached: true as const } : {}),
    }));
  }

  runtimeAttention(): RuntimeAttention {
    const attentionComplete =
      this.#prompts.size + this.#approvals.size + this.#takeovers.size <= AGENT_RUNTIME_ATTENTION_LIMIT;
    let remainingAttention = AGENT_RUNTIME_ATTENTION_LIMIT;
    const pendingPrompts = this.pendingPrompts().slice(0, remainingAttention);
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

  readonly respondToPrompt = Effect.fn("AttentionRegistry.respondToPrompt")(function* (
    this: AttentionRegistry,
    input: RespondToPromptInput,
    responder?: PromptResponder,
  ) {
    const saved = yield* this.#saveApiKeyAnswer(input, responder);
    const savedItem = yield* this.#saveVaultAnswer(input, responder);
    yield* attentionStep(() => {
      const pending = this.#prompts.get(input.requestId);
      if (saved && pending !== saved.pending) return;
      if (savedItem && pending !== savedItem.pending) return;
      if (!pending) throw new InactiveAttentionRequest(sourceText("error.backend.promptInactive"));
      const edit = pending.uiBlock
        ? uiConfirmPreviewEdit(pending.uiBlock.spec, input.answers)
        : { answers: input.answers };
      if (!edit) throw new Error(sourceText("error.backend.uiBlockAnswerInvalid"));
      const { answers } = edit;
      const questionIds = new Set(pending.questions.map((question) => question.id));
      if (Object.keys(answers).some((id) => !questionIds.has(id))) {
        throw new Error(sourceText("error.backend.promptAnswerMismatch"));
      }
      const uiBlockResponse = pending.uiBlock ? uiBlockAnswer(pending.uiBlock.spec, answers, responder) : null;
      const preview = uiBlockResponse ? edit.preview : undefined;
      this.#routines.markRunningForTurn(getString(pending.params, "turnId"));

      const result = pending.uiBlock?.apiKey
        ? apiKeyPromptResult(pending.uiBlock.blockId, saved?.key ?? null)
        : pending.uiBlock?.vault
          ? vaultPromptResult(pending.uiBlock.blockId, savedItem?.item ?? null)
          : pending.uiBlock?.location
            ? locationPromptResult(pending.uiBlock.blockId, uiBlockResponse)
            : pending.uiBlock
              ? uiBlockPromptResult(
                  uiBlockResponse
                    ? { status: "answered", blockId: pending.uiBlock.blockId, response: uiBlockResponse, preview }
                    : { status: "skipped", blockId: pending.uiBlock.blockId },
                )
              : pending.responseKind === "dynamic-tool"
                ? dynamicPromptResult(answers)
                : pending.responseKind === "mcp-elicitation"
                  ? mcpElicitationResult(pending.params, answers)
                  : {
                      answers: Object.fromEntries(
                        Object.entries(answers).map(([id, values]) => [id, { answers: values }]),
                      ),
                    };
      if (!pending.detached) pending.client.respond(pending.id, result);
      this.#prompts.delete(input.requestId);
      clearTimeout(pending.autoAnswer?.timer);
      clearTimeout(pending.detach?.timer);
      clearTimeout(pending.expireTimer);
      this.#emitInputResolved("prompt", input.requestId, pending.agentId);
      try {
        if (pending.uiBlock) {
          const frozenResponse = pending.uiBlock.vault && !savedItem ? null : uiBlockResponse;
          const state = answeredUiBlockState(
            pending.uiBlock.spec,
            frozenResponse,
            responder,
            pending.autoAnswer?.state,
          );
          if (savedItem)
            state.outcome = sourceText("status.agent.vaultAdded", {
              name: savedItem.item.name || (pending.uiBlock.spec.title ?? ""),
            }).slice(0, UI_BLOCK_LIMITS.outcome);
          else if (pending.uiBlock.location && uiBlockResponse)
            state.outcome = sourceText("status.agent.location.shared").slice(0, UI_BLOCK_LIMITS.outcome);
          else if (saved && saved.created !== null)
            state.outcome = sourceText(saved.created ? "status.agent.vaultAdded" : "status.agent.vaultUpdated", {
              name: saved.key.name,
            }).slice(0, UI_BLOCK_LIMITS.outcome);
          this.#resolvePersistedPrompt(
            pending,
            frozenResponse ? promptResolution(pending.questions, answers) : { status: "cancelled" },
            state,
            savedItem?.saved,
            preview,
          );
        } else {
          const resolution = promptResolution(pending.questions, answers);
          this.#resolvePersistedPrompt(pending, resolution);
          this.#showWelcomeAnswer(pending, resolution, responder);
        }
      } catch (error) {
        this.#emitError("prompt_persistence_failed", error, pending.agentId);
      }
      const lateAnswer = !pending.detached
        ? ""
        : pending.uiBlock?.vault
          ? vaultLateAnswerText(pending.uiBlock.spec.title ?? "", savedItem ? savedItem.item.name : null)
          : lateAnswerText(editedPreviewQuestions(pending.questions, pending.uiBlock?.spec, preview), answers);
      if (pending.detached && lateAnswer)
        this.#sendLateAnswer(pending.agentId, pending.detached, lateAnswer, responder?.sender);
      this.#emitRuntimeSnapshot();
    });
  }).bind(this);

  readonly #saveApiKeyAnswer = Effect.fn("AttentionRegistry.saveApiKeyAnswer")(function* (
    this: AttentionRegistry,
    input: RespondToPromptInput,
    responder: PromptResponder | undefined,
  ) {
    const answer = yield* attentionStep(() => {
      const pending = this.#prompts.get(input.requestId);
      const apiKey = pending?.uiBlock?.apiKey;
      if (!pending?.uiBlock || !apiKey) return null;
      if (pending.saving) throw new Error(sourceText("error.backend.apiKeySaving"));
      const values = uiBlockAnswer(pending.uiBlock.spec, input.answers, responder)?.values;
      const answered = values?.[API_KEY_FIELD_ID];
      const value = typeof answered === "string" ? answered.trim() : "";
      const typed = value !== "" || input.answers[API_KEY_FIELD_ID]?.some((answer) => answer.trim() !== "");
      if (!typed) return null;
      if (value === "") throw new Error(sourceText("error.backend.apiKeyAnswerUnreadable"));
      if (!this.#apiKeys) throw new Error(sourceText("error.backend.apiKeySaveFailed"));
      const toVault = apiKey.vault === true && values?.[API_KEY_SCOPE_FIELD_ID] !== API_KEY_SCOPE_AGENT;
      if (toVault && !this.#vaultItems) throw new Error(sourceText("error.vault.unavailable"));
      pending.saving = true;
      return {
        pending,
        apiKeys: this.#apiKeys,
        vaultItems: toVault ? this.#vaultItems : null,
        name: apiKey.name,
        value,
      };
    });
    if (!answer) return null;
    const { pending, apiKeys, vaultItems, name, value } = answer;
    const save: Effect.Effect<{ key: SavedApiKey; created: boolean | null }, AttentionOperationFailed> = vaultItems
      ? Effect.gen({ self: this }, function* () {
          const saved = yield* vaultItems
            .saveApiKey({ name, key: value }, this.#vaultAgent(pending.agentId), false)
            .pipe(toAttentionOperationFailed);
          yield* apiKeys.remove(pending.agentId, name).pipe(toAttentionOperationFailed);
          const keys = yield* apiKeys.list(pending.agentId).pipe(toAttentionOperationFailed);
          const key = keys.find((entry) => entry.name === name && entry.source === "vault");
          if (!key)
            return yield* new AttentionOperationFailed({
              cause: new Error(sourceText("error.backend.apiKeySaveFailed")),
            });
          return { key, created: saved.created };
        })
      : apiKeys.save(this.#vaultAgent(pending.agentId), name, value).pipe(
          toAttentionOperationFailed,
          Effect.map((key) => ({ key, created: null })),
        );
    const saved = yield* save.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          pending.saving = false;
        }),
      ),
    );
    return { pending, ...saved };
  });

  readonly #saveVaultAnswer = Effect.fn("AttentionRegistry.saveVaultAnswer")(function* (
    this: AttentionRegistry,
    input: RespondToPromptInput,
    responder: PromptResponder | undefined,
  ) {
    const answer = yield* attentionStep(() => {
      const pending = this.#prompts.get(input.requestId);
      const vault = pending?.uiBlock?.vault;
      if (!pending?.uiBlock || !vault) return null;
      if (pending.saving) throw new Error(sourceText("error.backend.vaultItemSaving"));
      const response = uiBlockAnswer(pending.uiBlock.spec, input.answers, responder);
      const item = response?.values ? enteredVaultItem(vault.kind, response.values) : null;
      if (!item) return null;
      if (!this.#vaultItems) throw new Error(sourceText("error.vault.unavailable"));
      pending.saving = true;
      return { pending, vaultItems: this.#vaultItems, item };
    });
    if (!answer) return null;
    const item = yield* answer.vaultItems.addEntered(answer.item, this.#vaultAgent(answer.pending.agentId)).pipe(
      toAttentionOperationFailed,
      Effect.ensuring(
        Effect.sync(() => {
          answer.pending.saving = false;
        }),
      ),
    );
    const digits = answer.item.kind === "card" ? (answer.item.number ?? "").replace(/\D/gu, "") : "";
    const brand = digits ? cardBrand(digits) : null;
    const saved: UiVaultSavedItem = {
      id: item.id,
      name: item.name,
      ...(brand ? { brand } : {}),
      ...(digits ? { last4: digits.slice(-4) } : {}),
    };
    return { pending: answer.pending, item, saved };
  });

  readonly respondToMediaApproval = Effect.fn("AttentionRegistry.respondToMediaApproval")(function* (
    this: AttentionRegistry,
    input: RespondToMediaApprovalInput,
    responder?: ApprovalResponder,
  ) {
    yield* attentionStep(() => {
      if (!this.pendingMediaApproval(input.agentId, input.requestId))
        throw new InactiveAttentionRequest(sourceText("error.backend.approvalInactive"));
    });
    yield* this.respondToApproval({ requestId: input.requestId, decision: "accept" }, responder, input.choice);
  }).bind(this);

  readonly respondToApproval = Effect.fn("AttentionRegistry.respondToApproval")(function* (
    this: AttentionRegistry,
    input: RespondToApprovalInput,
    responder?: ApprovalResponder,
    choice?: MediaApprovalChoice,
  ) {
    const held = this.#approvals.get(input.requestId);
    if (held?.creditsHold) {
      const still = yield* this.respondToCreditsHold(
        {
          agentId: held.approval.agentId,
          requestId: input.requestId,
          action: input.decision === "accept" ? "continue" : "skip",
        },
        responder,
      );
      if (still)
        yield* attentionStep(() => {
          throw new ForbiddenAttentionAnswer(sourceText("error.backend.creditsHoldShort"));
        });
      return;
    }
    const pending = yield* attentionStep(() => {
      const value = this.#approvals.get(input.requestId);
      if (!value) throw new InactiveAttentionRequest(sourceText("error.backend.approvalInactive"));
      if (choice && !value.media?.models.some((model) => model.id === choice.model))
        throw new InactiveAttentionRequest(sourceText("error.backend.approvalInactive"));
      if (value.ownerOnly && responder && !responder.owner)
        throw new ForbiddenAttentionAnswer(sourceText("error.backend.approvalOwnerOnly"));
      if (value.needsPhone && input.decision === "accept" && !responder?.phone)
        throw new ForbiddenAttentionAnswer(sourceText("error.backend.feedbackNeedsPhone"));
      if (responder?.phone && !value.needsPhone)
        throw new InactiveAttentionRequest(sourceText("error.backend.approvalInactive"));
      return value;
    });
    this.#routines.markRunningForTurn(getString(pending.params, "turnId"));

    const mutation = pending.hostedSiteMutation;
    if (pending.decide) {
      pending.decide(input.decision, responder, choice);
    } else if (mutation) {
      this.#approvals.delete(input.requestId);
      yield* this.#hostedSites
        .resolveApproval(
          mutation,
          { client: pending.client, id: pending.id, agentId: pending.approval.agentId },
          input.decision,
        )
        .pipe(toAttentionOperationFailed);
    } else {
      if (input.decision === "accept") yield* this.#beforeAccept(pending.approval, pending.params);
      pending.client.respond(
        pending.id,
        approvalReply(pending.method, pending.params, input.decision, "The user declined this action."),
      );
    }
    this.#approvals.delete(input.requestId);
    this.#emitInputResolved("approval", input.requestId, pending.approval.agentId);
    this.#emitRuntimeSnapshot();
  }, Effect.uninterruptible).bind(this);

  browserTakeoverBlocks(agentId: string, threadId: string, tabId: string | undefined): boolean {
    return [...this.#takeovers.values()].some(
      ({ request }) => request.agentId === agentId && (request.tabId === tabId || request.threadId === threadId),
    );
  }

  readonly respondToBrowserTakeover = Effect.fn("AttentionRegistry.respondToBrowserTakeover")(
    (input: RespondToBrowserTakeoverInput, fromMember = false) =>
      attentionStep(() => {
        const pending = this.#takeovers.get(input.requestId);
        if (!pending) throw new Error(sourceText("error.backend.takeoverInactive"));
        if (pending.submitting) throw new Error(sourceText("error.backend.authSubmitting"));
        pending.secret?.cancel();
        this.#routines.markRunningForTurn(pending.request.turnId);
        if (input.decision === "complete") {
          pending.personCompleted = true;
          if (fromMember) pending.memberCompleted = true;
        } else pending.personCancelled = true;
        this.#resolveBrowserTakeover(input.requestId, pending, input.decision);
      }),
  ).bind(this);

  readonly respondToBrowserSecret = Effect.fnUntraced(function* (
    this: AttentionRegistry,
    input: LocalBrowserSecretResponse,
    vaultCode?: string,
  ) {
    const { pending, secret } = yield* attentionStep(() => {
      const value = this.#takeovers.get(input.requestId);
      if (!value?.secret || value.request.agentId !== input.agentId)
        throw new InactiveAttentionRequest(sourceText("error.backend.authRequestInactive"));
      if (value.submitting) throw new Error(sourceText("error.backend.authSubmitting"));
      return { pending: value, secret: value.secret };
    });
    if (input.decision === "cancel") {
      secret.cancel();
      pending.personCancelled = true;
      this.#resolveBrowserTakeover(input.requestId, pending, "cancel");
      return;
    }
    if (input.decision === "takeover") {
      secret.cancel();
    } else {
      pending.submitting = true;
      const outcome = yield* secret.submit(input.secret, pending.vaultLoginId !== undefined, vaultCode).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            const reason = secureInputFailure(error) ?? "";
            logger.warn("Unable to complete the secure browser input", { reason: reason || "unknown" });
            pending.secureInputFailed = reason;
            return "takeover" as const;
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            pending.submitting = false;
          }),
        ),
      );
      if (this.#takeovers.get(input.requestId) !== pending) return;
      if (outcome === "submitted") {
        const vault = pending.vaultLoginId
          ? `OpenBot filled saved login ${pending.vaultLoginId}; the user did not type it.`
          : input.saveToVault && secret.request.method === "password"
            ? yield* this.#saveTypedPassword(pending, secret.request.origin, input.secret)
            : undefined;
        if (this.#takeovers.get(input.requestId) !== pending) return;
        this.#resolveBrowserTakeover(input.requestId, pending, "complete", vault);
        return;
      }
      if (pending.vaultLoginId !== undefined && this.#routines.runsTurn(pending.request.turnId)) {
        const reason = pending.secureInputFailed ? ` ${pending.secureInputFailed}` : "";
        pending.resolve(
          browserTakeoverError(
            `OpenBot could not finish filling saved login ${pending.vaultLoginId}.${reason} ${ROUTINE_SAVED_LOGIN_NOT_FILLED}`,
          ),
        );
        this.#resolveBrowserTakeover(input.requestId, pending, "cancel");
        return;
      }
    }
    secret.cancel();
    delete pending.secret;
    delete pending.vaultLoginId;
    delete pending.request.vaultSkip;
    if (input.decision === "submit" && input.saveToVault && secret.request.method === "password")
      pending.vaultNotSaved = true;
    if (input.decision === "submit" && pending.request.secret)
      pending.request.secret = { ...pending.request.secret, requiresReload: true };
    else delete pending.request.secret;
    yield* this.#browser.beginTakeover(pending.request.tabId).pipe(toAttentionOperationFailed);
    this.#emit({ type: "browser-takeover-requested", request: pending.request });
    this.#emitRuntimeSnapshot();
  }, Effect.uninterruptible);

  #answerWithoutAsking(client: AgentClient, request: AppServerRequest, approval: AgentApproval): boolean {
    if (!this.#answersForAgent(approval.agentId) && !this.#confinedWrite(request, approval)) return false;
    const answer = () => client.respond(request.id, approvalReply(request.method, request.params, "accept", ""));
    if (approval.kind !== "file-change") answer();
    else Effect.runFork(this.#beforeAccept(approval, request.params).pipe(Effect.ensuring(Effect.sync(answer))));
    return true;
  }

  #beforeAccept(approval: AgentApproval, params: unknown): Effect.Effect<void> {
    if (approval.kind !== "file-change") return Effect.void;
    const paths = [getString(params, "grantRoot"), ...getArray(params, "confinedWritePaths")].filter(isString);
    if (paths.length === 0) return Effect.void;
    return this.#beforeFileChangeAccepted(approval.agentId, paths).pipe(Effect.catchCause(() => Effect.void));
  }

  #confinedWrite(request: AppServerRequest, approval: AgentApproval): boolean {
    if (approval.kind !== "file-change") return false;
    const paths = getArray(request.params, "confinedWritePaths").filter(isString);
    return this.#confinedWritesAllowed(approval.agentId, paths);
  }

  #answersForAgent(agentId: string): boolean {
    return !this.#workspaceSandboxed(agentId) && shouldAutoApprove(this.#approvalAutomation, { agentId });
  }

  answerGrantedRequests(): void {
    const report = (agentId: string) => (error: unknown) =>
      Effect.sync(() => this.#emitError("auto_approval_failed", error, agentId));
    for (const pending of [...this.#approvals.values()]) {
      const agentId = pending.approval.agentId;
      if (pending.alwaysAsk || !this.#answersForAgent(agentId)) continue;
      Effect.runFork(
        this.respondToApproval({ requestId: pending.id, decision: "accept" }).pipe(
          Effect.catch(report(agentId)),
          Effect.catchDefect(report(agentId)),
        ),
      );
    }
    for (const pending of [...this.#prompts.values()]) {
      if (pending.responseKind !== "mcp-elicitation") continue;
      if (!this.#answersMcpToolConsent(pending.params, pending.agentId)) continue;
      Effect.runFork(
        this.respondToPrompt({ requestId: pending.id, answers: MCP_TOOL_CONSENT_ALLOW_ONCE }).pipe(
          Effect.catch(report(pending.agentId)),
          Effect.catchDefect(report(pending.agentId)),
        ),
      );
    }
  }

  #holdApproval(pending: Omit<PendingApproval, "executionThreadId">): void {
    const executionThreadId = pending.approval.threadId;
    const approval = {
      ...pending.approval,
      threadId: this.#approvalChatThread(pending.approval.agentId, executionThreadId),
    };
    this.#approvals.set(pending.id, { ...pending, approval, executionThreadId });
    this.#routines.markNeedsAttention(approval.turnId);
    this.#emit({ type: "approval", approval });
  }

  approvalExecutionThreadId(requestId: RequestId): string | undefined {
    return this.#approvals.get(requestId)?.executionThreadId;
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
    this.#holdApproval({ client, id: request.id, method: request.method, params: request.params, approval });
  }

  readonly awaitToolApproval = Effect.fn("AttentionRegistry.awaitToolApproval")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
    approval: AgentApproval,
    options: { readonly alwaysAsk?: boolean; readonly ownerOnly?: boolean } = {},
  ) {
    return (yield* this.#awaitToolAnswer(client, request, approval, options)).decision;
  }).bind(this);

  readonly awaitMediaApproval = Effect.fn("AttentionRegistry.awaitMediaApproval")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
    approval: AgentApproval,
    media: MediaApprovalOffer,
  ) {
    const answer = yield* this.#awaitToolAnswer(client, request, approval, { alwaysAsk: true, media });
    const choice = "choice" in answer ? answer.choice : undefined;
    const via = "via" in answer && answer.via ? answer.via : "local";
    return { decision: answer.decision, via, ...(choice ? { choice } : {}) } satisfies MediaApprovalAnswer;
  }).bind(this);

  readonly awaitCreditsHold = Effect.fn("AttentionRegistry.awaitCreditsHold")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
    approval: AgentApproval,
    hold: { call: CreditsHoldCall; balance: number | null; wallet: CreditsHoldWallet },
  ) {
    if (request.signal?.aborted) return { action: "skip" } satisfies CreditsHoldAnswer;
    const answer = Deferred.makeUnsafe<CreditsHoldAnswer>();
    const settle = (value: CreditsHoldAnswer) => Deferred.doneUnsafe(answer, Effect.succeed(value));
    this.#holdApproval({
      client,
      id: request.id,
      method: TOOL_APPROVAL_METHOD,
      params: request.params,
      approval,
      decide: (decision, responder) =>
        settle(
          decision === "cancel"
            ? { action: "skip", stopped: true }
            : { action: decision === "accept" ? "continue" : "skip", via: answerVia(responder) },
        ),
      creditsHold: { ...hold, answer: settle },
      alwaysAsk: true,
    });
    return yield* Deferred.await(answer);
  }).bind(this);

  readonly awaitPhoneFeedbackApproval = Effect.fn("AttentionRegistry.awaitPhoneFeedbackApproval")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
    approval: AgentApproval,
  ) {
    return yield* this.#awaitToolAnswer(client, request, approval, { ownerOnly: true, needsPhone: true });
  }).bind(this);

  readonly #awaitToolAnswer = Effect.fn("AttentionRegistry.awaitToolAnswer")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
    approval: AgentApproval,
    options: {
      readonly alwaysAsk?: boolean;
      readonly ownerOnly?: boolean;
      readonly needsPhone?: boolean;
      readonly media?: MediaApprovalOffer;
    },
  ) {
    if (request.signal?.aborted) return { decision: "cancel" } as const;
    const alwaysAsk = options.alwaysAsk || options.ownerOnly;
    if (!alwaysAsk && this.#answersForAgent(approval.agentId)) return { decision: "accept" } as const;
    const answer = Deferred.makeUnsafe<{
      decision: ToolApprovalDecision;
      phone?: FeedbackPhone;
      choice?: MediaApprovalChoice;
      via?: CreditAnswerVia;
    }>();
    this.#holdApproval({
      client,
      id: request.id,
      method: TOOL_APPROVAL_METHOD,
      params: request.params,
      approval,
      decide: (decision, responder, choice) =>
        Deferred.doneUnsafe(
          answer,
          Effect.succeed({
            decision,
            via: answerVia(responder),
            ...(responder?.phone ? { phone: responder.phone } : {}),
            ...(choice && decision === "accept" ? { choice } : {}),
          }),
        ),
      ...(options.media ? { media: options.media } : {}),
      ...(alwaysAsk ? { alwaysAsk: true } : {}),
      ...(options.ownerOnly ? { ownerOnly: true } : {}),
      ...(options.needsPhone ? { needsPhone: true } : {}),
    });
    return yield* Deferred.await(answer);
  }).bind(this);

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
    if (!prepared || request.signal?.aborted) return;
    if (this.#answersForAgent(prepared.approval.agentId)) {
      yield* this.#hostedSites
        .resolveApproval(prepared.mutation, { client, id: request.id, agentId: prepared.approval.agentId }, "accept")
        .pipe(toAttentionOperationFailed);
      return;
    }
    this.#holdApproval({
      client,
      id: request.id,
      method: HOSTED_SITE_APPROVAL_METHOD,
      params,
      approval: prepared.approval,
      hostedSiteMutation: prepared.mutation,
    });
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
    this.#holdApproval({ client, id: request.id, method: request.method, params: request.params, approval });
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
    const publicThreadId = agentId ? this.#conversation.publicThreadId(agentId, threadId) : null;
    if (!agentId || !turnId || !publicThreadId) return browserTakeoverError();
    const args = repairBrowserToolInput(params.tool, params.arguments).value;
    const tabId = getString(args, "tabId");
    if (!tabId) return browserTakeoverError(TAKEOVER_TAB_ID_MISSING);
    const tab = this.#browser.listTabs().find((candidate) => candidate.id === tabId);
    if (!tab || (tab.ownerAgentId !== agentId && tab.ownerThreadId !== publicThreadId))
      return browserTakeoverError(sourceText("error.backend.browserTabNotFound"));
    if (!this.#browser.toolCanUseTab({ ...params, threadId: publicThreadId, ownerAgentId: agentId }, tabId))
      return browserTakeoverError(TAKEOVER_TAB_OF_OTHER_CHAT);
    const heldKey = heldTakeoverKey(tabId, threadId);
    const held = this.#heldTakeoverResults.get(heldKey);
    if (held) {
      this.#heldTakeoverResults.delete(heldKey);
      if (held.turnId === turnId) return held.result;
    }
    const waiting = [...this.#takeovers].find(([, pending]) => pending.request.tabId === tabId);
    if (waiting) {
      const [waitingId, pending] = waiting;
      if (pending.released && pending.request.threadId === publicThreadId && pending.params.tool === params.tool) {
        if (pending.params.turnId === turnId) return browserTakeoverReleasedResult(params.tool, tabId);
        const call = takeoverCall();
        delete pending.released;
        pending.client = client;
        pending.providerRequestId = request.id;
        pending.params = params;
        pending.request.turnId = turnId;
        pending.releaseAt = Date.now() + this.#userAnswerLimitMs;
        pending.resolve = call.resolve;
        if (request.subagent) pending.subagent = true;
        else delete pending.subagent;
        this.#routines.markNeedsAttention(turnId);
        this.#emitRuntimeSnapshot();
        return yield* this.#awaitBrowserTakeover(waitingId, pending, request, call.completion, Effect.void);
      }
      if (
        !pending.detached ||
        pending.params.threadId !== threadId ||
        pending.params.turnId !== turnId ||
        pending.params.tool !== params.tool
      )
        return browserTakeoverError(TAKEOVER_ALREADY_WAITING);
      const call = takeoverCall();
      pending.client = client;
      pending.providerRequestId = request.id;
      pending.resolve = call.resolve;
      delete pending.detached;
      return yield* this.#awaitBrowserTakeover(waitingId, pending, request, call.completion, Effect.void);
    }
    if (params.tool === "request_takeover" && this.#messagingRequestTurn(agentId, turnId))
      return browserTakeoverError(MESSAGING_REQUEST_CARD_REFUSED);

    const requestId = params.tool === "submit_secret" ? randomUUID() : request.id;
    const reason = getString(args, "reason");
    const takeover: BrowserTakeoverRequest = {
      requestId,
      agentId,
      threadId: publicThreadId,
      turnId,
      tabId,
      ...(params.tool === "request_takeover" && isOneOf(BROWSER_TAKEOVER_REASONS, reason) ? { reason } : {}),
    };
    const call = takeoverCall();
    const pending: PendingBrowserTakeover = {
      client,
      providerRequestId: request.id,
      params,
      request: takeover,
      resolve: call.resolve,
      releaseAt: Date.now() + this.#userAnswerLimitMs,
      ...(request.subagent ? { subagent: true as const } : {}),
    };
    this.#takeovers.set(requestId, pending);
    const show = Effect.gen({ self: this }, function* () {
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
          if (websiteUrl(secret.request.origin)?.protocol !== "http:") pending.request.secret = secret.request;
        } else yield* this.#browser.beginTakeover(takeover.tabId).pipe(toAttentionOperationFailed);
      });
      const prepared = yield* Effect.result(prepare);
      if (Result.isSuccess(prepared)) {
        if (
          this.#takeovers.get(requestId) === pending &&
          !(yield* this.#fillFromVault(requestId, pending)) &&
          this.#takeovers.get(requestId) === pending
        ) {
          if (this.#messagingRequestTurn(agentId, turnId)) {
            pending.resolve(browserTakeoverError(MESSAGING_REQUEST_CARD_REFUSED));
            this.#resolveBrowserTakeover(requestId, pending, "cancel");
          } else if (getString(args, "loginId") && this.#routines.runsTurn(turnId)) {
            pending.resolve(
              browserTakeoverError(
                `${pending.vaultSkipped ?? "OpenBot did not fill a saved login: no password manager is connected."} ${ROUTINE_SAVED_LOGIN_NOT_FILLED}`,
              ),
            );
            this.#resolveBrowserTakeover(requestId, pending, "cancel");
          } else if (pending.secret?.withCode) {
            pending.resolve(
              browserTakeoverError(
                `${pending.vaultSkipped ?? "OpenBot did not fill a saved login: no password manager is connected."} Correct the call, or use request_takeover so that the user signs in.`,
              ),
            );
            this.#resolveBrowserTakeover(requestId, pending, "cancel");
          } else if (pending.secret && websiteUrl(pending.secret.request.origin)?.protocol === "http:") {
            pending.resolve(
              browserTakeoverError(
                `${pending.vaultSkipped ?? "OpenBot did not fill a saved login: no password manager is connected."} On an HTTP page, OpenBot fills only a saved login. Use request_takeover so that the user signs in.`,
              ),
            );
            this.#resolveBrowserTakeover(requestId, pending, "cancel");
          } else if (pending.request.vaultSkip === "agent-script") {
            pending.resolve(
              browserTakeoverError(
                `${pending.vaultSkipped} When OpenBot still does not fill the saved login, call submit_secret without loginId so that the user types the password, or use request_takeover.`,
              ),
            );
            this.#resolveBrowserTakeover(requestId, pending, "cancel");
          } else {
            this.#routines.markNeedsAttention(turnId);
            this.#emit({ type: "browser-takeover-requested", request: takeover });
          }
        }
      } else {
        const error = prepared.failure.cause;
        logger.warn("Unable to prepare browser takeover", { tool: params.tool, error: toLogValue(error) });
        if (this.#takeovers.get(requestId) === pending) {
          this.#takeovers.delete(requestId);
          pending.resolve(
            params.tool === "submit_secret" && error instanceof Error
              ? browserTakeoverError(error.message)
              : browserTakeoverError(),
          );
          this.#emitRuntimeSnapshot();
        }
      }
    });
    return yield* this.#awaitBrowserTakeover(requestId, pending, request, call.completion, show);
  }).bind(this);

  #awaitBrowserTakeover<E, R>(
    requestId: RequestId,
    pending: PendingBrowserTakeover,
    request: AppServerRequest,
    completion: Deferred.Deferred<DynamicToolResult>,
    show: Effect.Effect<void, E, R>,
  ): Effect.Effect<DynamicToolResult, E, R> {
    const detach =
      request.answerBeforeMs === undefined
        ? undefined
        : setTimeout(() => this.#detachBrowserTakeover(requestId, pending), request.answerBeforeMs);
    const release = setTimeout(
      () => this.#releaseBrowserTakeover(requestId, pending),
      Math.max(0, pending.releaseAt - Date.now()),
    );
    return show.pipe(
      Effect.andThen(Deferred.await(completion)),
      Effect.ensuring(
        Effect.sync(() => {
          clearTimeout(detach);
          clearTimeout(release);
          if (this.#takeovers.get(requestId) === pending && !pending.detached && !pending.released)
            this.#resolveBrowserTakeover(requestId, pending, "cancel");
        }),
      ),
    );
  }

  #releaseBrowserTakeover(requestId: RequestId, pending: PendingBrowserTakeover): void {
    if (this.#takeovers.get(requestId) !== pending || pending.detached || pending.released) return;
    const answerCall = pending.resolve;
    const target = this.#lateAnswerTarget(pending.request.agentId, pending.request.threadId);
    if (!target) {
      pending.resolve = () => answerCall(browserTakeoverExpiredResult());
      this.#resolveBrowserTakeover(requestId, pending, "cancel");
      return;
    }
    pending.released = target;
    pending.resolve = () => undefined;
    this.#routines.markRunningForTurn(pending.request.turnId);
    this.#emitRuntimeSnapshot();
    answerCall(browserTakeoverReleasedResult(pending.params.tool, pending.request.tabId));
  }

  #detachBrowserTakeover(requestId: RequestId, pending: PendingBrowserTakeover): void {
    if (this.#takeovers.get(requestId) !== pending || pending.detached || pending.released) return;
    const answerCall = pending.resolve;
    const { threadId, turnId, tool } = pending.params;
    const { tabId } = pending.request;
    let held = false;
    pending.detached = true;
    pending.resolve = (result) => {
      if (held) return;
      held = true;
      this.#heldTakeoverResults.set(heldTakeoverKey(tabId, threadId), { tabId, threadId, turnId, result });
    };
    answerCall(browserTakeoverWaitingResult(tool, tabId));
  }

  readonly listVaultItems = Effect.fn("AttentionRegistry.listVaultItems")(function* (
    this: AttentionRegistry,
    params: DynamicToolCallParams,
  ) {
    const call = yield* attentionStep(() => parseBrowserToolCall("list_vault_items", params.arguments));
    if (call.tool !== "list_vault_items")
      return yield* new AttentionOperationFailed({ cause: new Error("Invalid Vault list request.") });
    const agentId = params.ownerAgentId;
    if (this.#vaultItems && !this.#vaultItems.ready())
      return browserTakeoverError(`${vaultClosedText(this.#vaultItems.status())} Or use request_takeover.`);
    const listed = yield* Effect.result(
      attentionStep(() => (agentId ? (this.#vaultItems?.listForAgent(agentId) ?? null) : null)),
    );
    if (Result.isFailure(listed)) {
      logger.warn("Unable to list the Vault items", { error: toLogValue(listed.failure.cause) });
      return browserTakeoverError("The Vault could not be read. Ask the user, or use request_takeover.");
    }
    const answer =
      listed.success === null
        ? {
            available: false,
            logins: [],
            cards: [],
            contacts: [],
            next: "No Vault is available. Ask the user, or use request_takeover.",
          }
        : { available: true, ...listed.success };
    const result: DynamicToolResult = {
      success: true,
      contentItems: [{ type: "inputText", text: JSON.stringify(answer) }],
    };
    return result;
  }).bind(this);

  cardVault(
    client: AgentClient,
    request: AppServerRequest,
    params: DynamicToolCallParams,
  ): BrowserCardVault | undefined {
    const vault = this.#vaultItems;
    const agentId = params.ownerAgentId;
    if (!vault || !agentId) return undefined;
    return {
      secret: (cardId) => vault.cardSecret(cardId, agentId),
      approved: (cardId, page, frames) => vault.cardFillApproved(cardId, page, frames),
      approve: (cardId, page, frames) =>
        Effect.gen({ self: this }, function* () {
          const card = vault.listForAgent(agentId).cards.find(({ id }) => id === cardId);
          if (!card) return false;
          const others = frames.filter((frame) => frame !== page);
          const reason = [
            sourceText("status.agent.vaultCardFill", { card: card.label || `•••• ${card.last4}`, site: page }),
            ...(others.length > 0
              ? [sourceText("status.agent.vaultCardFillFrames", { origins: others.join(", ") })]
              : []),
          ].join(" ");
          const decision = yield* this.awaitToolApproval(
            client,
            request,
            {
              requestId: request.id,
              agentId,
              threadId: params.threadId,
              turnId: params.turnId,
              kind: "permissions",
              command: null,
              cwd: null,
              reason,
              grantRoot: null,
              permissions: null,
            },
            { ownerOnly: true },
          );
          if (decision !== "accept") return false;
          yield* vault.approveCardFill(cardId, page, frames).pipe(Effect.mapError(browserFailure));
          return true;
        }),
    };
  }

  readonly requestLinkPayment = Effect.fn("AttentionRegistry.requestLinkPayment")(function* (
    this: AttentionRegistry,
    params: DynamicToolCallParams,
  ) {
    const call = yield* attentionStep(() => parseBrowserToolCall("request_link_payment", params.arguments));
    if (call.tool !== "request_link_payment")
      return yield* new AttentionOperationFailed({ cause: new Error("Invalid Link payment request.") });
    const wallet = this.#linkWallet;
    if (!wallet?.connected()) return browserTakeoverError(LINK_UNAVAILABLE);
    const answer = yield* Effect.result(wallet.requestPayment(call.args));
    if (Result.isFailure(answer)) return browserTakeoverError(`Link payment failed: ${answer.failure.message}`);
    const result = answer.success;
    const next =
      result.status === "approved"
        ? "Take a fresh snapshot of the checkout and call fill_card with this cardId."
        : "Do not ask Link again for this purchase. Tell the user.";
    return {
      success: result.status === "approved",
      contentItems: [{ type: "inputText", text: JSON.stringify({ ...result, next }) }],
    } satisfies DynamicToolResult;
  }).bind(this);

  readonly requestNearPayment = Effect.fn("AttentionRegistry.requestNearPayment")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
    params: DynamicToolCallParams,
  ) {
    const call = yield* attentionStep(() => parseBrowserToolCall("request_near_payment", params.arguments));
    if (call.tool !== "request_near_payment")
      return yield* new AttentionOperationFailed({ cause: new Error("Invalid NEAR payment request.") });
    const wallet = this.#nearWallet;
    const agentId = params.ownerAgentId;
    if (!wallet?.ready() || !agentId) return browserTakeoverError(NEAR_UNAVAILABLE);
    if (this.#messagingThread(params.threadId) || this.#messagingRequestTurn(agentId, params.turnId))
      return browserTakeoverError(
        "request_near_payment does not work for a request from a Slack, Discord or Telegram chat. Ask the user to start the payment in the OpenBot chat.",
      );
    const requestId = String(request.id);
    const plan = yield* Effect.result(wallet.prepare({ agentId, threadId: params.threadId, requestId, ...call.args }));
    if (Result.isFailure(plan))
      return browserTakeoverError(`NEAR payment refused: ${plan.failure.message} Do not try again; tell the user.`);
    if (plan.success.kind === "ask") {
      const decision = yield* this.awaitToolApproval(
        client,
        request,
        {
          requestId: request.id,
          agentId,
          threadId: params.threadId,
          turnId: params.turnId,
          kind: "permissions",
          command: null,
          cwd: null,
          reason: sourceText("status.agent.nearPayment", {
            amount: plan.success.amount,
            symbol: plan.success.symbol,
            recipient: call.args.recipient,
            domain: call.args.domain,
            reason: call.args.reason,
          }),
          grantRoot: null,
          permissions: null,
        },
        { ownerOnly: true },
      ).pipe(Effect.onInterrupt(() => Effect.sync(() => wallet.drop(requestId))));
      if (decision !== "accept") {
        wallet.drop(requestId);
        return browserTakeoverError("The owner declined this NEAR payment. Do not ask again; tell the user.");
      }
    }
    const paid = yield* Effect.result(wallet.pay(requestId));
    if (Result.isFailure(paid)) return browserTakeoverError(`NEAR payment failed: ${paid.failure.message}`);
    const result = paid.success;
    const next =
      result.status === "paid"
        ? "Go back to the site and continue."
        : result.status === "uncertain"
          ? "Do not pay again. OpenBot finishes this payment; tell the user to check the wallet in Server settings > Vault > Crypto."
          : "Do not try again; tell the user.";
    return {
      success: result.status === "paid",
      contentItems: [{ type: "inputText", text: JSON.stringify({ ...result, next }) }],
    } satisfies DynamicToolResult;
  }).bind(this);

  readonly linkCardVault = Effect.fn("AttentionRegistry.linkCardVault")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
    params: DynamicToolCallParams,
  ): Effect.fn.Return<BrowserCardVault | DynamicToolResult | null> {
    if (params.tool !== "fill_card") return null;
    const call = yield* Effect.result(attentionStep(() => parseBrowserToolCall("fill_card", params.arguments)));
    if (Result.isFailure(call) || call.success.tool !== "fill_card") return null;
    const cardId = call.success.args.cardId;
    if (!cardId.startsWith(LINK_CARD_ID_PREFIX)) return null;
    const wallet = this.#linkWallet;
    const agentId = params.ownerAgentId;
    if (!wallet?.connected() || !agentId) return browserTakeoverError(LINK_UNAVAILABLE);
    const read = yield* Effect.result(wallet.card(cardId));
    if (Result.isFailure(read)) return browserTakeoverError(`Link card failed: ${read.failure.message}`);
    const card = read.success;
    if (!card) return browserTakeoverError("Link has no approved card with this id. Call request_link_payment first.");
    const merchant = httpsHost(card.merchantUrl);
    const onMerchant = (address: string) => merchant !== null && sameSite(address, merchant);
    const approvedFrames = new Map<string, Set<string>>();
    return {
      secret: (id) => (id === cardId ? card.secret : null),
      approved: (id, page, frames) =>
        id === cardId &&
        [page, ...frames].every((frame) => onMerchant(frame) || approvedFrames.get(page)?.has(frame) === true),
      approve: (id, page, frames) =>
        Effect.gen({ self: this }, function* () {
          if (id !== cardId) return false;
          const others = frames.filter((frame) => frame !== page && !onMerchant(frame));
          const decision = yield* this.awaitToolApproval(
            client,
            request,
            {
              requestId: request.id,
              agentId,
              threadId: params.threadId,
              turnId: params.turnId,
              kind: "permissions",
              command: null,
              cwd: null,
              reason: [
                sourceText("status.agent.linkCardFill", {
                  card: `•••• ${card.secret.number.slice(-4)}`,
                  site: page,
                  merchant: card.merchantUrl || "?",
                }),
                ...(others.length > 0
                  ? [sourceText("status.agent.vaultCardFillFrames", { origins: others.join(", ") })]
                  : []),
              ].join(" "),
              grantRoot: null,
              permissions: null,
            },
            { ownerOnly: true },
          );
          if (decision !== "accept") return false;
          approvedFrames.set(page, new Set([...(approvedFrames.get(page) ?? []), page, ...frames]));
          return true;
        }),
    } satisfies BrowserCardVault;
  }).bind(this);

  readonly saveVaultItem = Effect.fn("AttentionRegistry.saveVaultItem")(function* (
    this: AttentionRegistry,
    params: DynamicToolCallParams,
    requestedByPerson: () => boolean,
  ) {
    const raw = decodePasswordArgument(params.arguments);
    if (Option.isSome(raw)) registerSecretValue(raw.value.password);
    const rawKey = decodeTwoStepKeyArgument(params.arguments);
    if (Option.isSome(rawKey) && rawKey.value.twoStepKey) {
      registerSecretValue(rawKey.value.twoStepKey);
      const secret = twoStepKeySecret(rawKey.value.twoStepKey);
      if (secret) registerSecretValue(secret);
    }
    const call = yield* attentionStep(() => parseBrowserToolCall("save_vault_item", params.arguments));
    if (call.tool !== "save_vault_item")
      return yield* new AttentionOperationFailed({ cause: new Error("Invalid Vault save request.") });
    if (call.args.password !== undefined) {
      if (this.#messagingThread(params.threadId)) return browserTakeoverError(VAULT_PASSWORD_EXTERNAL_REFUSED);
      if (!requestedByPerson()) return browserTakeoverError(VAULT_PASSWORD_PERSON_ONLY);
    }
    if (call.args.twoStepKey !== undefined && !requestedByPerson())
      return browserTakeoverError(VAULT_PASSWORD_PERSON_ONLY);
    const vault = this.#vaultItems;
    const agentId = params.ownerAgentId;
    if (!vault || !agentId) return browserTakeoverError(VAULT_UNAVAILABLE);
    if (!vault.ready()) return browserTakeoverError(vaultClosedText(vault.status()));
    const change = vaultChange(call.args);
    if (typeof change === "string") return browserTakeoverError(change);
    const agent = this.#vaultAgent(agentId);
    const saved = yield* Effect.result(
      change.kind === "newLogin" ? vault.saveLogin(change.login, agent) : vault.save(change, agent),
    );
    if (Result.isFailure(saved)) return vaultFailure("save", saved.failure);
    let keySaved = false;
    if (change.kind === "newLogin" && change.twoStepKey !== undefined) {
      const keyed = yield* Effect.result(
        vault.save({ kind: "login", id: saved.success.id, twoStepKey: change.twoStepKey }, agent),
      );
      if (Result.isFailure(keyed)) return vaultFailure("save", keyed.failure);
      keySaved = true;
    }
    const { created, id, kind, name } = saved.success;
    const item = { id, kind, name };
    if ("changed" in saved.success && !saved.success.changed && !keySaved)
      return vaultResult({ status: "unchanged", ...item });
    this.#noteVaultChange(
      agentId,
      params.threadId,
      params.turnId,
      sourceText(created ? "status.agent.vaultAdded" : "status.agent.vaultUpdated", { name: item.name }),
    );
    return vaultResult({ status: created ? "added" : "updated", ...item });
  }).bind(this);

  readonly requestVaultItem = Effect.fn("AttentionRegistry.requestVaultItem")(function* (
    this: AttentionRegistry,
    client: AgentClient,
    request: AppServerRequest,
    params: DynamicToolCallParams,
  ) {
    const call = yield* attentionStep(() => parseBrowserToolCall("request_vault_item", params.arguments));
    if (call.tool !== "request_vault_item")
      return yield* new AttentionOperationFailed({ cause: new Error("Invalid Vault request.") });
    if (!this.#vaultItems?.ready()) return browserTakeoverError(vaultClosedText(this.#vaultItems?.status()));
    if (this.#messagingThread(params.threadId))
      return browserTakeoverError(
        "request_vault_item does not work in a Slack, Discord or Telegram chat. Ask the user to add the item in Server settings > Vault.",
      );
    const spec = vaultRequestFormSpec(call.args);
    if (typeof spec === "string") return browserTakeoverError(spec);
    this.surfaceUiBlock(client, request, { blockId: randomUUID(), spec, vault: { kind: call.args.kind } });
    return null;
  }).bind(this);

  readonly deleteVaultItem = Effect.fn("AttentionRegistry.deleteVaultItem")(function* (
    this: AttentionRegistry,
    params: DynamicToolCallParams,
  ) {
    const call = yield* attentionStep(() => parseBrowserToolCall("delete_vault_item", params.arguments));
    if (call.tool !== "delete_vault_item")
      return yield* new AttentionOperationFailed({ cause: new Error("Invalid Vault delete request.") });
    const vault = this.#vaultItems;
    const agentId = params.ownerAgentId;
    if (!vault || !agentId) return browserTakeoverError(VAULT_UNAVAILABLE);
    if (!vault.ready()) return browserTakeoverError(vaultClosedText(vault.status()));
    const deleted = yield* Effect.result(vault.delete(call.args.id, agentId));
    if (Result.isFailure(deleted)) return vaultFailure("delete", deleted.failure);
    if (deleted.success === null) return browserTakeoverError("No Vault item has this id. Call list_vault_items.");
    this.#noteVaultChange(
      agentId,
      params.threadId,
      params.turnId,
      sourceText("status.agent.vaultDeleted", { name: deleted.success.name }),
    );
    return vaultResult({ status: "deleted", ...deleted.success });
  }).bind(this);

  readonly #saveTypedPassword = Effect.fn("AttentionRegistry.saveTypedPassword")(function* (
    this: AttentionRegistry,
    pending: PendingBrowserTakeover,
    origin: string,
    password: string,
  ) {
    const vault = this.#vaultItems;
    if (!vault) return "The password was not saved: no Vault is available.";
    const { agentId, threadId, turnId } = pending.request;
    const call = yield* Effect.result(
      attentionStep(() => parseBrowserToolCall("submit_secret", pending.params.arguments)),
    );
    const args = Result.isSuccess(call) && call.success.tool === "submit_secret" ? call.success.args : undefined;
    const loginId = args?.loginId;
    const chosen =
      loginId && this.#passwordVault
        ? yield* this.#passwordVault.loginsFor(origin, agentId).pipe(
            Effect.catch((error) => Effect.succeed(error.logins)),
            Effect.map((logins) => logins?.find((login) => login.id === loginId)),
          )
        : undefined;
    const username = chosen?.username ?? args?.username;
    const saved = yield* Effect.result(
      vault.saveLogin({ origin, username: username ?? "", password }, this.#vaultAgent(agentId)),
    );
    if (Result.isFailure(saved)) {
      logger.warn("Unable to save the typed password in the Vault", { error: toLogValue(saved.failure.cause) });
      return "The password was not saved in the Vault.";
    }
    const { id, name, created, changed } = saved.success;
    if (changed)
      this.#noteVaultChange(
        agentId,
        threadId,
        turnId,
        sourceText(created ? "status.agent.vaultAdded" : "status.agent.vaultUpdated", { name }),
      );
    return `The user saved this password in the Vault as login ${id} (${name}).`;
  }).bind(this);

  readonly listVaultLogins = Effect.fn("AttentionRegistry.listVaultLogins")(function* (
    this: AttentionRegistry,
    params: DynamicToolCallParams,
  ) {
    const call = yield* attentionStep(() => parseBrowserToolCall("list_logins", params.arguments));
    if (call.tool !== "list_logins")
      return yield* new AttentionOperationFailed({ cause: new Error("Invalid login list request.") });
    const { tabId } = call.args;
    const tab = this.#browser.listTabs().find((candidate) => candidate.id === tabId);
    if (!tab || tab.ownerAgentId !== params.ownerAgentId || !this.#browser.toolCanUseTab(params, tabId))
      return browserTakeoverError(sourceText("error.backend.browserTabNotFound"));
    const listed = yield* Effect.result(
      this.#passwordVault
        ? this.#passwordVault.loginsFor(tab.url, tab.ownerAgentId ?? undefined)
        : Effect.succeed(null),
    );
    const unreadable = Result.isFailure(listed) ? listed.failure.sources : undefined;
    if (Result.isFailure(listed) && !unreadable) {
      logger.warn("Unable to list the shared logins", { error: toLogValue(listed.failure.cause) });
      return browserTakeoverError("The shared password vault could not be read. Use submit_secret without loginId.");
    }
    const logins = Result.isFailure(listed) ? (listed.failure.logins ?? []) : listed.success;
    const answer = unreadable
      ? {
          connected: true,
          logins,
          unreadable,
          next: `OpenBot could not read the saved logins of ${unreadable.join(", ")}, so this list can be incomplete. Tell the user which of them could not be read: the page of each password manager in Marketplace shows what to do. Use a listed login only when it is the account for the task; else use submit_secret without loginId.`,
        }
      : logins === null
        ? { connected: false, logins: [], next: "No password vault is connected. Use submit_secret without loginId." }
        : logins.length === 0
          ? // A login matches only pages of its own site, and a sign-in can be on another site (#10502).
            { connected: true, logins, next: NO_LOGIN_FOR_SITE }
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
    const problem = promptQuestionsProblem(questions);
    if (!threadId || !turnId || !agentId || !publicThreadId || problem) {
      client.respond(request.id, {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: problem
              ? `OpenBot could not create a user question: ${problem} Correct the arguments and retry.`
              : "OpenBot could not create a user question.",
          },
        ],
      });
      return;
    }
    if (this.#messagingThread(publicThreadId)) {
      client.respond(request.id, {
        success: false,
        contentItems: [{ type: "inputText", text: MESSAGING_QUESTION_REFUSED }],
      });
      return;
    }
    if (this.#messagingRequestTurn(agentId, turnId)) {
      client.respond(request.id, {
        success: false,
        contentItems: [{ type: "inputText", text: MESSAGING_REQUEST_CARD_REFUSED }],
      });
      return;
    }

    const messageId = this.#persistQuestionPrompt(agentId, publicThreadId, turnId, request.id, questions);
    this.#expireDetachedInChat(agentId, publicThreadId, turnId);
    const pending: PendingPrompt = {
      client,
      id: request.id,
      responseKind: "dynamic-tool",
      params: request.params,
      agentId,
      publicThreadId,
      turnId,
      messageId,
      questions,
      ...(request.subagent ? { subagent: true as const } : {}),
    };
    this.#limitQuestion(request, pending);
    this.#prompts.set(request.id, pending);
    this.#routines.markNeedsAttention(turnId);
    this.#emit({
      type: "prompt",
      requestId: request.id,
      agentId,
      threadId: publicThreadId,
      turnId,
      ...(request.subagent ? { detached: true as const } : {}),
      questions,
    });
  }

  surfaceUiBlock(
    client: AgentClient,
    request: AppServerRequest,
    block: SurfacedUiBlock,
    autoAnswer?: { actionId: string; afterMs: number },
  ): void {
    const threadId = getString(request.params, "threadId");
    const turnId = getString(request.params, "turnId");
    const agentId = threadId ? this.#conversation.agentForThread(threadId) : undefined;
    const publicThreadId = threadId && agentId ? this.#conversation.publicThreadId(agentId, threadId) : null;
    const questions = uiBlockFallbackQuestions(block.spec);
    const auto: UiBlockAutoAnswer | undefined = autoAnswer && {
      actionId: autoAnswer.actionId,
      at: new Date(Date.now() + autoAnswer.afterMs).toISOString(),
    };
    const uiBlock = normalizeConversationUiBlock({
      version: UI_BLOCK_VERSION,
      blockId: block.blockId,
      spec: block.spec,
      state: auto ? { status: "pending", autoAnswer: auto } : { status: "pending" },
      ...(block.vault ? { vault: { kind: block.vault.kind } } : {}),
      ...(block.apiKey?.vault ? { apiKey: true } : {}),
      ...(block.location ? { location: true } : {}),
    });
    if (!threadId || !turnId || !agentId || !publicThreadId || !uiBlock || !validPromptQuestions(questions)) {
      client.respond(request.id, {
        success: false,
        contentItems: [{ type: "inputText", text: "OpenBot could not show this block." }],
      });
      return;
    }
    if (this.#messagingThread(publicThreadId)) {
      client.respond(request.id, {
        success: false,
        contentItems: [{ type: "inputText", text: MESSAGING_QUESTION_REFUSED }],
      });
      return;
    }
    if (!auto && this.#messagingRequestTurn(agentId, turnId)) {
      client.respond(request.id, {
        success: false,
        contentItems: [{ type: "inputText", text: MESSAGING_REQUEST_CARD_REFUSED }],
      });
      return;
    }

    const messageId = this.#persistQuestionPrompt(agentId, publicThreadId, turnId, request.id, questions, uiBlock);
    this.#expireDetachedInChat(agentId, publicThreadId, turnId);
    let autoAnswerTimer: PendingPrompt["autoAnswer"];
    if (auto && autoAnswer) {
      const timer = setTimeout(() => this.#answerAutomatically(request.id), autoAnswer.afterMs);
      timer.unref?.();
      autoAnswerTimer = { state: auto, timer };
    }
    const pending: PendingPrompt = {
      client,
      id: request.id,
      responseKind: "ui-block",
      params: request.params,
      agentId,
      publicThreadId,
      turnId,
      messageId,
      questions,
      uiBlock: block,
      ...(autoAnswerTimer ? { autoAnswer: autoAnswerTimer } : {}),
      ...(request.subagent ? { subagent: true as const } : {}),
    };
    if (block.vault || (plainBlock(block, auto, questions) && providerStopsCall(request)))
      this.#scheduleDetach(request, pending);
    this.#prompts.set(request.id, pending);
    this.#routines.markNeedsAttention(turnId);
    this.#emit({
      type: "prompt",
      requestId: request.id,
      agentId,
      threadId: publicThreadId,
      turnId,
      ...(request.subagent ? { detached: true as const } : {}),
      questions,
    });
  }

  #answerAutomatically(requestId: RequestId): void {
    const pending = this.#prompts.get(requestId);
    if (!pending?.uiBlock || !pending.autoAnswer) return;
    const answers = uiBlockAnswersFromResponse(pending.uiBlock.spec, { actionId: pending.autoAnswer.state.actionId });
    const report = (error: unknown) =>
      Effect.sync(() => logger.warn("Unable to give a block its auto answer", { error: toLogValue(error) }));
    Effect.runFork(
      this.respondToPrompt({ requestId, answers }, AUTOMATIC_RESPONDER).pipe(
        Effect.catch((failure) => report(failure)),
        Effect.catchDefect(report),
      ),
    );
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
    if (this.#messagingThread(publicThreadId) || this.#messagingRequestTurn(agentId, turnId)) {
      client.respond(request.id, { answers: {} });
      return;
    }
    const messageId = this.#persistQuestionPrompt(agentId, publicThreadId, turnId, request.id, questions);
    this.#expireDetachedInChat(agentId, publicThreadId, turnId);
    const pending: PendingPrompt = {
      client,
      id: request.id,
      responseKind: "user-input",
      params: request.params,
      agentId,
      publicThreadId,
      turnId,
      messageId,
      questions,
    };
    if (client.userInputNote) this.#limitQuestion(request, pending);
    this.#prompts.set(request.id, pending);
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

  #answerMcpToolConsentWithoutAsking(client: AgentClient, request: AppServerRequest, agentId: string): boolean {
    if (!this.#answersMcpToolConsent(request.params, agentId)) return false;
    client.respond(request.id, { action: "accept", content: {}, _meta: null });
    return true;
  }

  #answersMcpToolConsent(params: unknown, agentId: string): boolean {
    return mcpToolCallConsent(params) && this.#answersForAgent(agentId);
  }

  #requestOwner(params: unknown): { agentId: string; publicThreadId: string; turnId: string; params: unknown } | null {
    const threadId = getString(params, "threadId");
    const turnId = getString(params, "turnId");
    if (!threadId || !turnId) return null;
    const agentId = this.#conversation.agentForThread(threadId);
    if (agentId)
      return { agentId, publicThreadId: this.#conversation.publicThreadId(agentId, threadId), turnId, params };
    const parent = this.#codexSubagentParent(threadId);
    if (!parent || !isRecord(params) || this.#conversation.agentForThread(parent.threadId) !== parent.agentId)
      return null;
    return {
      agentId: parent.agentId,
      publicThreadId: this.#conversation.publicThreadId(parent.agentId, parent.threadId),
      turnId: parent.turnId,
      params: { ...params, threadId: parent.threadId, turnId: parent.turnId },
    };
  }

  surfaceMcpElicitation(client: AgentClient, request: AppServerRequest): void {
    const owner = this.#requestOwner(request.params);
    const questions = mcpElicitationQuestions(request.params);
    if (!owner || !questions) {
      client.respond(request.id, { action: "decline", content: null, _meta: null });
      this.#emitError("mcp_safety_handoff", declinedMcpElicitationText(request.params), owner?.agentId);
      return;
    }
    const { agentId, publicThreadId, turnId, params } = owner;
    if (this.#answerMcpToolConsentWithoutAsking(client, request, agentId)) return;
    if (this.#messagingThread(publicThreadId) || this.#messagingRequestTurn(agentId, turnId)) {
      client.respond(
        request.id,
        mcpToolCallConsent(params) ? MCP_TOOL_CONSENT_UNANSWERABLE : { action: "cancel", content: null, _meta: null },
      );
      return;
    }

    const messageId = this.#persistQuestionPrompt(agentId, publicThreadId, turnId, request.id, questions);
    this.#expireDetachedInChat(agentId, publicThreadId, turnId);
    this.#prompts.set(request.id, {
      client,
      id: request.id,
      responseKind: "mcp-elicitation",
      params,
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

  clearForTurn(threadId: string, turnId: string, completed: boolean): void {
    for (const [requestId, pending] of this.#prompts) {
      const pendingThreadId = getString(pending.params, "threadId");
      const pendingTurnId = getString(pending.params, "turnId");
      if (pendingThreadId !== threadId || pendingTurnId !== turnId || (completed && outlivesTurn(pending))) continue;
      this.#expirePrompt(requestId, pending);
    }
    for (const [requestId, pending] of this.#approvals) {
      const pendingThreadId = getString(pending.params, "threadId") ?? getString(pending.params, "conversationId");
      const pendingTurnId = getString(pending.params, "turnId");
      if (pendingThreadId === threadId && (!pendingTurnId || pendingTurnId === turnId)) {
        this.#approvals.delete(requestId);
        this.#cancelApproval(pending);
      }
    }
    for (const [requestId, pending] of this.#takeovers) {
      if (pending.params.threadId !== threadId || pending.params.turnId !== turnId) continue;
      if (completed && (pending.released || (pending.subagent && !pending.detached))) continue;
      this.#resolveBrowserTakeover(requestId, pending, "cancel");
    }
    for (const [key, held] of this.#heldTakeoverResults) {
      if (held.threadId === threadId && held.turnId === turnId) this.#heldTakeoverResults.delete(key);
    }
  }

  releaseForUserMessage(agentId: string, publicThreadId: string, turnId: string): void {
    let changed = false;
    for (const [requestId, pending] of this.#prompts) {
      if (pending.agentId !== agentId || pending.publicThreadId !== publicThreadId || pending.turnId !== turnId)
        continue;
      if (pending.saving || pending.detached || pending.responseKind === "mcp-elicitation") continue;
      this.#routines.markRunningForTurn(turnId);
      this.#closeForUserMessage(requestId, pending);
      changed = true;
    }
    if (changed) this.#emitRuntimeSnapshot();
  }

  closeDetachedForUserMessage(agentId: string, publicThreadId: string): void {
    let changed = false;
    for (const [requestId, pending] of this.#prompts) {
      if (!pending.detached || pending.saving) continue;
      if (pending.agentId !== agentId || pending.publicThreadId !== publicThreadId) continue;
      if (this.#closeForUserMessage(requestId, pending)) changed = true;
    }
    if (changed) this.#emitRuntimeSnapshot();
    for (const [requestId, pending] of this.#takeovers) {
      if (!pending.released || pending.submitting) continue;
      if (pending.request.agentId !== agentId || pending.request.threadId !== publicThreadId) continue;
      this.#resolveBrowserTakeover(requestId, pending, "cancel");
    }
  }

  #closeForUserMessage(requestId: RequestId, pending: PendingPrompt): boolean {
    if (pending.responseKind === "mcp-elicitation") return false;
    const uiBlockState = pending.uiBlock
      ? answeredUiBlockState(pending.uiBlock.spec, null, undefined, undefined)
      : undefined;
    if (uiBlockState) uiBlockState.outcome = sourceText("status.agent.uiBlockClosedByMessage");
    this.#closePrompt(
      requestId,
      pending,
      userMessagePromptResult(pending.responseKind, pending.uiBlock?.blockId, pending.client.userInputNote),
      { status: "cancelled" },
      uiBlockState,
    );
    return true;
  }

  #expireDetachedInChat(agentId: string, publicThreadId: string, turnId: string): void {
    const routineQuestion = this.#routines.runsTurn(turnId);
    let changed = false;
    for (const [requestId, pending] of this.#prompts) {
      if (!pending.detached || pending.saving) continue;
      if (pending.agentId !== agentId || pending.publicThreadId !== publicThreadId) continue;
      if (routineQuestion && !this.#routines.runsTurn(pending.turnId)) continue;
      this.#expirePrompt(requestId, pending);
      changed = true;
    }
    if (changed) this.#emitRuntimeSnapshot();
  }

  expireDetached(agentId: string | null, publicThreadId: string | null): void {
    let changed = false;
    for (const [requestId, pending] of this.#prompts) {
      if (!outlivesTurn(pending)) continue;
      if (agentId !== null && pending.agentId !== agentId) continue;
      if (publicThreadId !== null && pending.publicThreadId !== publicThreadId) continue;
      this.#expirePrompt(requestId, pending);
      changed = true;
    }
    if (changed) this.#emitRuntimeSnapshot();
    for (const [requestId, pending] of this.#takeovers) {
      if (!pending.subagent && !pending.released) continue;
      if (agentId !== null && pending.request.agentId !== agentId) continue;
      if (publicThreadId !== null && pending.request.threadId !== publicThreadId) continue;
      this.#resolveBrowserTakeover(requestId, pending, "cancel");
    }
  }

  clearPrompts(client?: AgentClient): void {
    for (const [requestId, pending] of this.#prompts) {
      if (client && (pending.client !== client || pending.detached)) continue;
      this.#expirePrompt(requestId, pending);
    }
  }

  cancelRequest(client: AgentClient, requestId: RequestId, providerStoppedWaiting = false): void {
    let changed = false;
    const prompt = this.#prompts.get(requestId);
    if (prompt?.client === client && !prompt.detached) {
      if (!providerStoppedWaiting || !this.#detachForLateAnswer(requestId, prompt)) {
        this.#routines.markRunningForTurn(prompt.turnId);
        this.#expirePrompt(requestId, prompt);
      }
      changed = true;
    }
    const approval = this.#approvals.get(requestId);
    if (approval?.client === client) {
      this.#routines.markRunningForTurn(approval.approval.turnId);
      this.#approvals.delete(requestId);
      this.#cancelApproval(approval);
      changed = true;
    }
    for (const [key, takeover] of this.#takeovers) {
      if (
        takeover.client === client &&
        takeover.providerRequestId === requestId &&
        !takeover.detached &&
        !takeover.released
      ) {
        if (providerStoppedWaiting) this.#releaseBrowserTakeover(key, takeover);
        else this.#resolveBrowserTakeover(key, takeover, "cancel");
      }
    }
    if (changed) this.#emitRuntimeSnapshot();
  }

  #scheduleDetach(request: AppServerRequest, pending: PendingPrompt): void {
    const target = this.#lateAnswerTarget(pending.agentId, pending.publicThreadId);
    if (!target) return;
    const deadlines = [request.detachAfterMs, request.answerBeforeMs].filter((ms) => ms !== undefined);
    pending.detach = {
      target,
      timer: setTimeout(() => this.#detachPrompt(request.id, pending), Math.min(this.#userAnswerLimitMs, ...deadlines)),
    };
  }

  #limitQuestion(request: AppServerRequest, pending: PendingPrompt): void {
    if (!pending.questions.some((question) => question.isSecret)) this.#scheduleDetach(request, pending);
    if (pending.detach) return;
    pending.expireTimer = setTimeout(() => this.#expireUnanswered(request.id, pending), this.#userAnswerLimitMs);
  }

  #expireUnanswered(requestId: RequestId, pending: PendingPrompt): void {
    if (this.#prompts.get(requestId) !== pending || pending.saving) return;
    this.#routines.markRunningForTurn(pending.turnId);
    this.#expirePrompt(requestId, pending);
    this.#emitRuntimeSnapshot();
  }

  detachPromptsOf(provider: AgentProvider): void {
    for (const [requestId, pending] of this.#prompts)
      if (pending.client.provider === provider && pending.detach && !pending.saving)
        this.#detachPrompt(requestId, pending);
  }

  #detachForLateAnswer(requestId: RequestId, pending: PendingPrompt): boolean {
    if (pending.saving || pending.questions.some((question) => question.isSecret)) return false;
    const target = this.#lateAnswerTarget(pending.agentId, pending.publicThreadId);
    return target !== null && this.#detachPrompt(requestId, pending, target);
  }

  #detachPrompt(requestId: RequestId, pending: PendingPrompt, target = pending.detach?.target): boolean {
    if (this.#prompts.get(requestId) !== pending || !target) return false;
    clearTimeout(pending.detach?.timer);
    delete pending.detach;
    pending.detached = target;
    this.#routines.markRunningForTurn(pending.turnId);
    if (pending.client.running) {
      try {
        pending.client.respond(pending.id, detachedPromptResult(pending.responseKind));
      } catch (error) {
        logger.warn("Unable to answer a detached prompt", { error: toLogValue(error) });
      }
    }
    this.#emitRuntimeSnapshot();
    return true;
  }

  #expirePrompt(requestId: RequestId, pending: PendingPrompt): void {
    this.#closePrompt(
      requestId,
      pending,
      pending.uiBlock
        ? uiBlockPromptResult({ status: "expired", blockId: pending.uiBlock.blockId })
        : expiredPromptResult(pending.responseKind),
      { status: "expired" },
      { status: "expired" },
    );
  }

  #closePrompt(
    requestId: RequestId,
    pending: PendingPrompt,
    result: unknown,
    resolution: AgentPromptResolution,
    uiBlockState: UiBlockState | undefined,
  ): void {
    this.#prompts.delete(requestId);
    clearTimeout(pending.autoAnswer?.timer);
    clearTimeout(pending.detach?.timer);
    clearTimeout(pending.expireTimer);
    this.#emitInputResolved("prompt", requestId, pending.agentId);
    if (pending.client.running && !pending.detached) {
      try {
        pending.client.respond(pending.id, result);
      } catch (error) {
        logger.warn("Unable to answer a closed prompt", { error: toLogValue(error) });
      }
    }
    try {
      this.#resolvePersistedPrompt(pending, resolution, uiBlockState);
    } catch (error) {
      this.#emitError("prompt_persistence_failed", error, pending.agentId);
    }
  }

  clearBrowserTakeovers(client?: AgentClient): void {
    for (const [requestId, pending] of this.#takeovers) {
      if (client && (pending.client !== client || pending.released)) continue;
      this.#resolveBrowserTakeover(requestId, pending, "cancel");
    }
  }

  #cancelApproval(pending: PendingApproval): void {
    this.#emitInputResolved("approval", pending.id, pending.approval.agentId);
    pending.decide?.("cancel");
    if (pending.decide || !pending.client.running) return;
    if (pending.hostedSiteMutation) {
      const report = (error: unknown) =>
        Effect.sync(() => this.#emitError("approval_cleanup_failed", error, pending.approval.agentId));
      Effect.runFork(
        this.#hostedSites
          .resolveApproval(
            pending.hostedSiteMutation,
            { client: pending.client, id: pending.id, agentId: pending.approval.agentId },
            "decline",
          )
          .pipe(Effect.catch(report), Effect.catchDefect(report)),
      );
      return;
    }
    try {
      pending.client.respond(
        pending.id,
        approvalReply(pending.method, pending.params, "decline", "This approval request is no longer pending."),
      );
    } catch (error) {
      logger.warn("Unable to answer a cleared approval", { error: toLogValue(error) });
    }
  }

  clearApprovals(client?: AgentClient): void {
    for (const [requestId, pending] of this.#approvals) {
      if (client && pending.client !== client) continue;
      this.#approvals.delete(requestId);
      this.#cancelApproval(pending);
    }
  }

  #emitInputResolved(kind: "prompt" | "approval", requestId: RequestId, agentId: string): void {
    this.#emit({ type: "agent-input-resolved", kind, requestId, agentId });
  }

  cancelTakeoversForMissingTabs(tabs: BrowserTab[]): void {
    for (const [requestId, pending] of this.#takeovers) {
      if (!tabs.some((tab) => tab.id === pending.request.tabId)) {
        this.#resolveBrowserTakeover(requestId, pending, "cancel");
      }
    }
    for (const [key, held] of this.#heldTakeoverResults) {
      if (!tabs.some((tab) => tab.id === held.tabId)) this.#heldTakeoverResults.delete(key);
    }
  }

  #respondToMalformedApproval(client: AgentClient, request: AppServerRequest): void {
    client.respond(
      request.id,
      approvalReply(request.method, request.params, "decline", "OpenBot could not identify this approval."),
    );
  }

  readonly #fillFromVault = Effect.fn("AttentionRegistry.fillFromVault")(function* (
    this: AttentionRegistry,
    requestId: RequestId,
    pending: PendingBrowserTakeover,
  ) {
    const vault = this.#passwordVault;
    const request = pending.secret?.request;
    if (!vault?.connected() || !request || request.method === "otp") return false;
    const kind = request.method === "password" ? "password" : "totp";
    const { agentId } = pending.request;
    const skip = (
      reason: string,
      note: string,
      { loginId, card }: { loginId?: string; card?: BrowserVaultSkipReason } = {},
    ) => {
      logger.info("Shared vault fill skipped", { origin: request.origin, method: request.method, loginId, reason });
      pending.vaultSkipped = `OpenBot did not fill a saved login: ${note}`;
      if (card) pending.request.vaultSkip = card;
      return false;
    };
    const parsed = yield* Effect.result(
      attentionStep(() => parseBrowserToolCall("submit_secret", pending.params.arguments)),
    );
    const args = Result.isSuccess(parsed) && parsed.success.tool === "submit_secret" ? parsed.success.args : undefined;
    const loginId = args?.loginId;
    const namedCard = (card: BrowserVaultSkipReason) => (loginId ? { loginId, card } : {});
    if (pending.secret?.agentScriptedOrigin !== false)
      return skip(
        "agent-scripted-origin",
        "a script that you ran with evaluate can still run in this page or in another open page of this site. First close or navigate each other tab of this site, also a popup or opener tab where you did not run evaluate. A tab of another agent or a channel can also block the fill, and list_tabs does not show it: when no other tab of this site is in list_tabs, ask the user to close the other tabs of this site. Then reload this page with navigate direction=reload, not with evaluate or by opening its address again, and call submit_secret again.",
        namedCard("agent-script"),
      );
    const withCode = pending.secret.withCode;
    const codeFields =
      'A code field has autocomplete="one-time-code", or is a text, tel, or number input with a word such as otp, totp, authentication code, or verification code in its id, name, aria-label, placeholder, title, or label, or a field named "code" or "passcode" in a form whose visible text names an authenticator app and no email or SMS. Its name and label have no backup, recovery, mail, phone, SMS, name, label, promo, coupon, voucher, discount, gift, invite, referral, zip, postal, country, card, CVC, CVV, or CSC word.';
    if (pending.secret.vaultFillable !== true)
      return skip(
        "field-kind",
        withCode
          ? `the field target is not a password input, or the code targets are not code fields. ${codeFields}`
          : kind === "password"
            ? "the field target is not a password input."
            : `the field targets are not code fields. ${codeFields}`,
        namedCard("field-kind"),
      );
    const fits = (login: VaultLogin) => kind === "password" || login.hasOneTimePassword;
    const found = yield* Effect.result(
      Effect.gen(function* () {
        if (Result.isFailure(parsed)) return yield* parsed.failure;
        const candidates = loginId ? [] : ((yield* vault.loginsFor(request.origin, agentId)) ?? []).filter(fits);
        const account = (name: string | null | undefined) => name?.trim().toLowerCase() ?? "";
        const wanted = account(args?.username);
        const only = candidates.length === 1 ? candidates[0] : undefined;
        const saved = account(only?.username);
        if (only && wanted && saved && saved !== wanted)
          return { chosen: false as const, several: false, otherAccount: true };
        const chosen = loginId ?? only?.id;
        if (!chosen) return { chosen: false as const, several: candidates.length > 1, otherAccount: false };
        const secret = yield* vault.secretFor(chosen, request.origin, kind, agentId);
        const listed = secret || !loginId ? null : yield* Effect.result(vault.loginsFor(request.origin, agentId));
        const sitesLogins = listed !== null && Result.isSuccess(listed) ? (listed.success ?? []) : null;
        const unknown = sitesLogins !== null && !sitesLogins.some((candidate) => candidate.id === loginId);
        const code = withCode && secret ? yield* vault.secretFor(chosen, request.origin, "totp", agentId) : undefined;
        return {
          chosen: true as const,
          loginId: chosen,
          secret,
          code,
          unknown,
          listUnread: listed !== null && Result.isFailure(listed),
          otherLogins: Boolean(sitesLogins?.some(fits)),
        };
      }),
    );
    if (Result.isFailure(found)) {
      logger.warn("Unable to fill from the shared vault", { error: toLogValue(found.failure.cause) });
      pending.vaultSkipped = "OpenBot did not fill a saved login: the password manager could not be read.";
      if (Result.isSuccess(parsed)) pending.request.vaultSkip = "vault-unreadable";
      return false;
    }
    const login = found.success;
    if (this.#takeovers.get(requestId) !== pending) return false;
    if (!login.chosen && login.otherAccount)
      return skip(
        "other-username",
        "the only saved login for this site has another username than this sign-in, so the user types the password. When the sign-in is for that saved account, call list_logins and use its loginId.",
      );
    if (!login.chosen)
      return skip(
        "no-login",
        "no saved login matches this site, or several match and the call has no loginId from list_logins.",
        login.several ? { card: "login-choice" } : {},
      );
    if (login.unknown)
      return skip(
        "unknown-login",
        `no saved login for this site has the id ${login.loginId}. Call list_logins and give the id of a login exactly as list_logins shows it, with its prefix, for example openbot:.`,
        { loginId: login.loginId, ...(login.otherLogins ? { card: "login-choice" } : {}) },
      );
    if (!login.secret)
      return skip(
        "no-secret",
        `saved login ${login.loginId} has no ${kind === "password" ? "password" : "authenticator key"} for this site.`,
        { loginId: login.loginId, ...(login.listUnread ? {} : { card: "no-secret" }) },
      );
    if (withCode && !login.code)
      return skip("no-code", `saved login ${login.loginId} has no authenticator key for this site.`, {
        loginId: login.loginId,
      });
    pending.vaultLoginId = login.loginId;
    const submitted = yield* Effect.result(
      this.respondToBrowserSecret(
        {
          requestId,
          agentId: pending.request.agentId,
          decision: "submit",
          secret: login.secret,
        },
        login.code ?? undefined,
      ),
    );
    if (Result.isFailure(submitted)) {
      logger.warn("Unable to submit the shared login", { error: toLogValue(submitted.failure.cause) });
      if (this.#takeovers.get(requestId) === pending) this.#resolveBrowserTakeover(requestId, pending, "cancel");
      return true;
    }
    if (this.#takeovers.get(requestId) === pending) this.#routines.markNeedsAttention(pending.request.turnId);
    return true;
  }).bind(this);

  #resolveBrowserTakeover(
    requestId: RequestId,
    pending: PendingBrowserTakeover,
    decision: RespondToBrowserTakeoverInput["decision"],
    vault?: string,
  ): void {
    pending.secret?.cancel();
    this.#routines.markRunningForTurn(pending.request.turnId);
    this.#takeovers.delete(requestId);
    const signInMissing =
      decision === "complete" &&
      pending.memberCompleted === true &&
      pending.request.reason === "sign-in-blocked" &&
      this.#browser.takeoverSignInArrived?.(pending.request.tabId) === false;
    if (![...this.#takeovers.values()].some((candidate) => candidate.request.tabId === pending.request.tabId)) {
      this.#browser.endTakeover(pending.request.tabId, pending.personCompleted === true);
    }
    this.#emit({
      type: "browser-takeover-resolved",
      requestId: pending.request.requestId,
      agentId: pending.request.agentId,
    });
    this.#emitRuntimeSnapshot();
    const vaultNote = vault ?? (pending.vaultNotSaved ? TYPED_PASSWORD_NOT_SAVED : undefined);
    if (pending.released && (decision === "complete" || pending.personCancelled)) {
      const lateText = sourceText(
        decision === "complete" ? "status.agent.takeoverLateCompleted" : "status.agent.takeoverLateCancelled",
        { tabId: pending.request.tabId },
      );
      const lateNotes = browserTakeoverLateNotes(
        vaultNote,
        pending.vaultSkipped,
        signInMissing,
        pending.secureInputFailed,
      );
      this.#sendLateAnswer(
        pending.request.agentId,
        pending.released,
        lateNotes ? `${lateText}\n${lateNotes}` : lateText,
        undefined,
      );
    }
    pending.resolve(
      browserTakeoverResult(
        decision,
        vaultNote,
        pending.vaultSkipped,
        signInMissing,
        pending.personCancelled === true,
        pending.secureInputFailed,
      ),
    );
  }

  #persistQuestionPrompt(
    agentId: string,
    publicThreadId: string,
    turnId: string,
    requestId: RequestId,
    questions: AgentPromptQuestion[],
    uiBlock?: ConversationUiBlock,
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
        ...(uiBlock ? { uiBlock } : {}),
      });
      this.#conversation.emitConversation(snapshot, "prompt.requested", { turnId, requestId });
    }
    return messageId;
  }

  #resolvePersistedPrompt(
    pending: PendingPrompt,
    resolution: AgentPromptResolution,
    uiBlockState?: UiBlockState,
    vaultSaved?: UiVaultSavedItem,
    preview?: string,
  ): void {
    const snapshot = this.#conversation.ensureSnapshot(pending.agentId, pending.publicThreadId);
    const message = snapshot.messages.find((candidate) => candidate.id === pending.messageId);
    if (!message?.questionPrompt || message.questionPrompt.resolution !== null) return;
    message.questionPrompt.resolution = structuredClone(resolution);
    const edited =
      preview && message.uiBlock?.spec.type === "confirm"
        ? normalizeConversationUiBlock({ ...message.uiBlock, spec: { ...message.uiBlock.spec, preview } })
        : null;
    const editedQuestions = edited ? uiBlockFallbackQuestions(edited.spec) : null;
    if (edited && message.uiBlock && editedQuestions && validPromptQuestions(editedQuestions)) {
      message.uiBlock.spec = edited.spec;
      message.questionPrompt.questions = editedQuestions;
    }
    message.text = questionPromptText(message.questionPrompt.questions, resolution);
    if (message.uiBlock && uiBlockState) {
      const vault = message.uiBlock.vault && vaultSaved ? { ...message.uiBlock.vault, saved: vaultSaved } : undefined;
      const frozen = normalizeConversationUiBlock({
        ...message.uiBlock,
        state: uiBlockState,
        ...(vault ? { vault } : {}),
      });
      message.uiBlock.state = frozen?.state ?? {
        status: uiBlockState.status === "answered" ? "closed" : uiBlockState.status,
      };
      if (frozen?.vault) message.uiBlock.vault = frozen.vault;
    }
    this.#conversation.emitConversation(snapshot, "prompt.resolved", {
      turnId: pending.turnId,
      requestId: pending.id,
      status: resolution.status,
    });
  }

  #showWelcomeAnswer(
    pending: PendingPrompt,
    resolution: AgentPromptResolution,
    responder: PromptResponder | undefined,
  ): void {
    if (pending.detached || pending.subagent || pending.responseKind === "mcp-elicitation" || responder?.automatic)
      return;
    const text = welcomeAnswerText(pending.questions, resolution);
    if (!text) return;
    const snapshot = this.#conversation.ensureSnapshot(pending.agentId, pending.publicThreadId);
    const inTurn = snapshot.messages.filter((message) => message.turnId === pending.turnId);
    const welcomeTurn = inTurn.some((message) => message.itemType === AGENT_WELCOME_ITEM_TYPE);
    const firstQuestion = inTurn.find((message) => message.questionPrompt)?.id === pending.messageId;
    const id = `welcome-answer:${pending.turnId}:${String(pending.id)}`;
    if (!welcomeTurn || !firstQuestion || inTurn.some((message) => message.id === id)) return;
    snapshot.messages.push({
      id,
      turnId: pending.turnId,
      author: "user",
      source: "user",
      ...(responder?.sender ? { senderMember: structuredClone(responder.sender) } : {}),
      text,
      createdAt: new Date().toISOString(),
      status: "completed",
    });
    this.#conversation.emitConversation(snapshot);
  }
}

function welcomeAnswerText(questions: AgentPromptQuestion[], resolution: AgentPromptResolution): string {
  const [question] = questions;
  if (questions.length !== 1 || !question || question.isSecret || resolution.status !== "answered") return "";
  const response = resolution.responses[question.id];
  return response?.status === "answered" && response.answers ? response.answers.join(", ").trim() : "";
}

function uiBlockAnswer(
  spec: UiBlockSpec,
  answers: Readonly<Record<string, readonly string[]>>,
  responder: PromptResponder | undefined,
): UiBlockResponse | null {
  const read = uiBlockResponseFromAnswers(spec, answers);
  if (!read) return null;
  const response = validateUiBlockResponse(spec, read);
  if (!response) throw new Error(sourceText("error.backend.uiBlockAnswerInvalid"));
  const privileged =
    response.actionId === UI_BLOCK_TEXT_ACTION_ID
      ? uiBlockHasPrivilegedAction(spec)
      : uiBlockActionIsPrivileged(spec, response.actionId);
  if (responder && !responder.privileged && privileged) {
    throw new ForbiddenAttentionAnswer(sourceText("error.backend.uiBlockActionNotAllowed"));
  }
  return response;
}

function answeredUiBlockState(
  spec: UiBlockSpec,
  response: UiBlockResponse | null,
  responder: PromptResponder | undefined,
  autoAnswer: UiBlockAutoAnswer | undefined,
): UiBlockState {
  const state: UiBlockState = response ? { status: "answered", response } : { status: "closed" };
  const outcome = response ? uiBlockOutcomeText(spec, response) : "";
  if (outcome.trim()) state.outcome = outcome;
  if (autoAnswer && responder?.automatic) state.autoAnswer = { ...autoAnswer, done: true };
  if (responder?.sender) state.respondedBy = structuredClone(responder.sender);
  state.respondedAt = new Date().toISOString();
  return state;
}

class AttentionOperationFailed extends Schema.TaggedError<AttentionOperationFailed>()("AttentionOperationFailed", {
  cause: Schema.Defect(),
}) {}

function localQuestionNeedsOpenBot(question: AgentPromptQuestion): boolean {
  return (
    question.isSecret ||
    redactText(question.id) !== question.id ||
    (question.options?.some((option) => redactText(option.label) !== option.label) ?? false)
  );
}

const { sync: attentionStep, rewrap: toAttentionOperationFailed } = causeHelpers(AttentionOperationFailed);

type ApprovalReply =
  | { permissions: DynamicRecord; scope: "turn" }
  | { decision: "approved" | { denied: { rejection: string } } }
  | { decision: "accept" | "decline" };

function approvalReply(
  method: string,
  params: unknown,
  decision: "accept" | "decline",
  rejection: string,
): ApprovalReply {
  if (method === "item/permissions/requestApproval")
    return { permissions: decision === "accept" ? (getRecord(params, "permissions") ?? {}) : {}, scope: "turn" };
  if (method === "applyPatchApproval" || method === "execCommandApproval")
    return { decision: decision === "accept" ? "approved" : { denied: { rejection } } };
  return { decision };
}
