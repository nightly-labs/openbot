import type { AgentProviderId } from "./agent-providers";
import type { ConversationMessage } from "./ipc-conversation-messages";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

/**
 * Feedback from the app for the OpenBot repository: a bug report or a feature idea.
 *
 * Each kind has an issue form in `.github/ISSUE_TEMPLATE`. GitHub fills a form field from a query
 * parameter with the field `id`, and a dropdown value must be one of its options, word for word. The
 * user reads a prefilled form and submits it in the browser. `parseFeedback` is the feedback that the
 * app sends, which the account Worker opens as an issue with the same sections.
 */
const ISSUE_FORM = "https://github.com/nightly-labs/openbot/issues/new?template=";

/** The repository that gets the feedback, as `owner/name`. */
export const FEEDBACK_REPOSITORY = "nightly-labs/openbot";

/** A bug report (`bug_report.yml`) or a feature idea (`feature_request.yml`). */
export const FEEDBACK_KINDS = ["bug", "idea"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The label of each issue that the app sends, so that triage can find feedback from the app. */
const FEEDBACK_SENT_LABEL = "from-app";
/** The label of a report that the agent sent for a problem that it found itself, such as a tool error. */
const FEEDBACK_AGENT_LABEL = "agent-reported";

const ISSUE_FORMS = {
  bug: { template: "bug_report.yml", titlePrefix: "[Bug]: ", labels: ["bug", "needs-triage"] },
  idea: { template: "feature_request.yml", titlePrefix: "[Feature]: ", labels: ["enhancement", "needs-triage"] },
} as const satisfies Record<FeedbackKind, { template: string; titlePrefix: string; labels: readonly string[] }>;

/** The `platform` options of the form that the desktop app and the web client can be. */
export type BugReportPlatform = "macOS" | "Windows" | "Linux" | "Web client";

/** The form's platform for a Node.js `process.platform`. Other Unix systems are closest to Linux. */
export function bugReportPlatform(nodePlatform: string): Exclude<BugReportPlatform, "Web client"> {
  if (nodePlatform === "darwin") return "macOS";
  if (nodePlatform === "win32") return "Windows";
  return "Linux";
}

/** The `providers` options of the form. A provider with no option leaves the field to the user. */
const PROVIDER_OPTIONS: Partial<Record<AgentProviderId, BugReportProvider>> = {
  codex: "ChatGPT (Codex CLI)",
  claude: "Claude (Claude Code)",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Gemini (Antigravity)",
  cursor: "Cursor",
  cline: "Cline",
  pi: "Pi",
  muse: "Muse",
  acp: "Custom agent (ACP)",
};

/** The options of the form's dropdowns, word for word, so that a sent report reads as a form answer. */
export const BUG_REPORT_INSTALL_SOURCES = ["Built from source", "Other"] as const;
export const BUG_REPORT_PROVIDERS = [
  "ChatGPT (Codex CLI)",
  "Claude (Claude Code)",
  "Grok",
  "OpenCode",
  "Gemini (Antigravity)",
  "Cursor",
  "Cline",
  "Pi",
  "Muse",
  "Custom agent (ACP)",
  "Not related to a provider",
] as const;
export type BugReportProvider = (typeof BUG_REPORT_PROVIDERS)[number];
export const BUG_REPORT_AREAS = [
  "Conversations and messages",
  "Agents and providers",
  "Routines and schedules",
  "Team and shared agents",
  "Browser",
  "Computer use",
  "Connectors and channels (Slack, Discord, Telegram, GitHub)",
  "MCP apps",
  "Skills",
  "Memory",
  "Files and attachments",
  "Remote servers and remote desktop",
  "Phone app and pairing",
  "Voice",
  "Updates and installation",
  "Sign-in and account",
  "Other",
] as const;
export const BUG_REPORT_SEVERITIES = [
  "Crash or the app does not start",
  "Data loss",
  "Blocked, with no workaround",
  "Works, but incorrectly or slowly",
  "Visual or text problem",
] as const;
export const BUG_REPORT_FREQUENCIES = ["Every time", "Sometimes", "One time only"] as const;
export const BUG_REPORT_REGRESSIONS = ["Yes", "No", "I do not know"] as const;
export type BugReportArea = (typeof BUG_REPORT_AREAS)[number];
export type BugReportSeverity = (typeof BUG_REPORT_SEVERITIES)[number];
export type BugReportFrequency = (typeof BUG_REPORT_FREQUENCIES)[number];
export type BugReportRegression = (typeof BUG_REPORT_REGRESSIONS)[number];
const BUG_REPORT_PLATFORMS: readonly BugReportPlatform[] = ["macOS", "Windows", "Linux", "Web client"];

/** The `type` options of the feature request form. */
export const FEATURE_REQUEST_TYPES = [
  "Small improvement to an existing feature",
  "New provider",
  "New MCP app or connector",
  "New feature",
  "Change to existing behavior",
] as const;
export type FeatureRequestType = (typeof FEATURE_REQUEST_TYPES)[number];

/** Where the agent runs: on the desktop app, on a server that the user set up, or on a hosted server. */
export const FEEDBACK_HOSTS = ["Desktop app", "Server", "Hosted server"] as const;
export type FeedbackHost = (typeof FEEDBACK_HOSTS)[number];
/** Where the user saw the problem. A joined server is used from the desktop app, the web app or the phone. */
export const FEEDBACK_SURFACES = ["Desktop app", "Web app", "Phone app"] as const;
export type FeedbackSurface = (typeof FEEDBACK_SURFACES)[number];
/** Who found the problem: the user told the agent, or the agent found it while it worked. */
export const FEEDBACK_FINDERS = ["user", "agent"] as const;
export type FeedbackFinder = (typeof FEEDBACK_FINDERS)[number];

export const FEEDBACK_LIMITS = {
  title: 200,
  fact: 200,
  text: 1000,
  /** The redacted errors of the chat, one per line. */
  errors: 1500,
} as const;

export interface FeedbackFacts {
  readonly platform: BugReportPlatform;
  /** The OpenBot version, when the caller knows it. */
  readonly version?: string;
  /** The operating system version and the processor architecture, such as `macOS 26.1 (arm64)`. */
  readonly os?: string;
  /** True for a build from source: the form has an option for it. A release build leaves the field to the user. */
  readonly builtFromSource?: boolean;
  /** Where this OpenBot runs, when the caller knows it. */
  readonly host?: FeedbackHost;
}

/** The text and the provider that an agent gives for its bug report. */
export interface BugReportDetails {
  readonly title?: string;
  readonly description?: string;
  readonly reproduction?: string;
  readonly area?: BugReportArea;
  readonly severity?: BugReportSeverity;
  readonly frequency?: BugReportFrequency;
  readonly regression?: BugReportRegression;
  readonly provider?: AgentProviderId;
  readonly providerVersion?: string;
}

/** The text that an agent gives for its feature idea. */
export interface FeatureRequestDetails {
  readonly title?: string;
  readonly type?: FeatureRequestType;
  readonly problem?: string;
  readonly proposal?: string;
}

function issueFormUrl(kind: FeedbackKind, title: string | undefined, query: URLSearchParams): string {
  const form = ISSUE_FORMS[kind];
  if (title) query.set("title", `${form.titlePrefix}${title}`);
  return `${ISSUE_FORM}${form.template}&${query.toString()}`;
}

export function bugReportFormUrl(facts: FeedbackFacts, details: BugReportDetails = {}): string {
  const query = new URLSearchParams({ platform: facts.platform });
  if (facts.builtFromSource) query.set("install-source", "Built from source");
  if (facts.version) query.set("version", facts.version);
  if (facts.os) query.set("os", facts.os);
  const providerOption = details.provider && PROVIDER_OPTIONS[details.provider];
  if (providerOption) query.set("providers", providerOption);
  if (details.providerVersion) query.set("provider-version", details.providerVersion);
  if (details.area) query.set("area", details.area);
  if (details.severity) query.set("severity", details.severity);
  if (details.frequency) query.set("frequency", details.frequency);
  if (details.regression) query.set("regression", details.regression);
  if (details.description) query.set("description", details.description);
  if (details.reproduction) query.set("reproduction", details.reproduction);
  return issueFormUrl("bug", details.title, query);
}

/** The feature request form has no fields for the version and the system; the user answers the rest. */
export function featureRequestFormUrl(details: FeatureRequestDetails = {}): string {
  const query = new URLSearchParams({ contribution: "No" });
  if (details.type) query.set("type", details.type);
  if (details.problem) query.set("problem", details.problem);
  if (details.proposal) query.set("proposal", details.proposal);
  return issueFormUrl("idea", details.title, query);
}

/** The facts that the app adds to each sent report, so that the user does not look them up. */
interface SentFacts {
  readonly title: string;
  readonly platform: BugReportPlatform;
  readonly installSource: (typeof BUG_REPORT_INSTALL_SOURCES)[number];
  readonly version: string;
  readonly os: string;
  readonly provider: BugReportProvider;
  readonly providerVersion: string;
  /** The agent's model and reasoning effort; empty when the agent has none. */
  readonly model: string;
  readonly effort: string;
  readonly host: FeedbackHost | null;
  readonly surface: FeedbackSurface | null;
  readonly foundBy: FeedbackFinder;
  /** The redacted errors that the chat showed before the report, one per line; empty when none. */
  readonly recentErrors: string;
  /** An open issue of the same problem: the report becomes a comment on it. */
  readonly sameAs: number | null;
}

/**
 * Feedback that the app sends to the account Worker, which opens it as an issue as `openbotgit[bot]`.
 *
 * Most users are not developers, so the agent writes only the text in the user's words, and the app
 * adds the facts. A choice or a text that the chat does not show stays null or empty, and the issue
 * reads "No response" for it, as GitHub writes an empty form field.
 */
export interface BugReport extends SentFacts {
  readonly kind: "bug";
  readonly area: BugReportArea | null;
  readonly severity: BugReportSeverity | null;
  readonly frequency: BugReportFrequency | null;
  readonly regression: BugReportRegression | null;
  /** What went wrong and what the user expected. */
  readonly description: string;
  /** Empty when the agent does not know the steps. */
  readonly reproduction: string;
}

export interface FeatureRequest extends SentFacts {
  readonly kind: "idea";
  readonly type: FeatureRequestType | null;
  /** What the user wants OpenBot to do. */
  readonly proposal: string;
  /** The problem that it solves; empty when the agent does not know it. */
  readonly problem: string;
}

export type Feedback = BugReport | FeatureRequest;

/**
 * The form option and version line for an agent's provider. A provider that the form does not list is
 * "Custom agent (ACP)", and its id starts the version line, so that triage knows the real provider.
 */
export function bugReportProviderFacts(
  provider: AgentProviderId,
  version: string,
): { provider: BugReportProvider; providerVersion: string } {
  const option = PROVIDER_OPTIONS[provider];
  if (option) return { provider: option, providerVersion: version };
  return { provider: "Custom agent (ACP)", providerVersion: `${provider} ${version}`.trim() };
}

type Section = readonly [label: string, value: string | null, required: boolean];

function factSections(feedback: Feedback): Section[] {
  return [
    ["Platform", feedback.platform, true],
    ["Installation source", feedback.installSource, true],
    ["OpenBot version", feedback.version, true],
    ["Operating system and hardware", feedback.os, true],
    ["Agent runs on", feedback.host, false],
    ["Seen in", feedback.surface, false],
    ["Providers", feedback.provider, true],
    ["Provider CLI version", feedback.providerVersion, false],
    ["Model", feedback.model, false],
    ["Reasoning effort", feedback.effort, false],
  ];
}

/** The text sections of the report. A choice that the agent did not make is not a section. */
function textSections(feedback: Feedback): Section[] {
  return feedback.kind === "bug"
    ? [
        ["Area", feedback.area, false],
        ["Severity", feedback.severity, false],
        ["Frequency", feedback.frequency, false],
        ["Did this work in an earlier version?", feedback.regression, false],
        ["What happened?", feedback.description, true],
        ["Steps to reproduce", feedback.reproduction, false],
      ]
    : [
        ["Type of request", feedback.type, false],
        ["Problem", feedback.problem, false],
        ["Proposed behavior", feedback.proposal, true],
      ];
}

/** A fenced block that no backtick run in the text can close. */
function codeBlock(text: string): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/gu), (match) => match[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

function sectionsMarkdown(sections: readonly Section[], feedback: Feedback): string[] {
  const answers = sections.flatMap(([label, value, required]) => {
    const answer = noMentions(value?.trim() ?? "");
    if (!answer && !required) return [];
    return [`### ${label}\n\n${answer || "_No response_"}`];
  });
  if (feedback.recentErrors.trim())
    answers.push(`### Recent errors in the chat\n\n${codeBlock(noMentions(feedback.recentErrors.trim()))}`);
  return answers;
}

function feedbackFooter(feedback: Feedback) {
  return feedback.foundBy === "agent"
    ? "Sent from the OpenBot app. The agent found this problem while it worked, and wrote this text. The user approved it before it was sent."
    : "Sent from the OpenBot app. An agent wrote this text, and the user approved it before it was sent.";
}

/**
 * The issue for the feedback. The body has the sections that GitHub writes for a form answer
 * (`### Label`, then the answer), so that triage reads sent feedback as it reads a form. An optional
 * section with no answer is left out.
 */
export function feedbackIssue(feedback: Feedback): { title: string; body: string; labels: string[] } {
  const sections =
    feedback.kind === "bug"
      ? [...factSections(feedback), ...textSections(feedback)]
      : [...textSections(feedback), ...factSections(feedback)];
  const form = ISSUE_FORMS[feedback.kind];
  return {
    title: `${form.titlePrefix}${noMentions(feedback.title)}`,
    body: [...sectionsMarkdown(sections, feedback), "---", feedbackFooter(feedback)].join("\n\n"),
    labels: [...form.labels, FEEDBACK_SENT_LABEL, ...(feedback.foundBy === "agent" ? [FEEDBACK_AGENT_LABEL] : [])],
  };
}

/** The comment that adds a report to an open issue of the same problem (`sameAs`). */
export function feedbackComment(feedback: Feedback): string {
  const sections = [["Title", feedback.title, true] as const, ...textSections(feedback), ...factSections(feedback)];
  return [
    "Another report of this problem from the OpenBot app.",
    ...sectionsMarkdown(sections, feedback),
    "---",
    feedbackFooter(feedback),
  ].join("\n\n");
}

/** The words of a title that find similar issues: the longest ones, which say the most. */
export function feedbackSearchTerms(title: string): string[] {
  const words = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => Array.from(word).length >= 4 && !SEARCH_STOP_WORDS.has(word));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, FEEDBACK_SEARCH_TERMS);
}

/** GitHub search allows five `OR` operators, so six words. */
const FEEDBACK_SEARCH_TERMS = 6;
const SEARCH_STOP_WORDS: ReadonlySet<string> = new Set([
  "after",
  "agent",
  "agents",
  "does",
  "doesn",
  "from",
  "have",
  "into",
  "openbot",
  "should",
  "that",
  "the",
  "there",
  "this",
  "when",
  "with",
  "work",
  "works",
]);

/** An open issue that can be the same problem as new feedback. */
export interface SimilarFeedbackIssue {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  /** What the issue says happened, so that a comment adds only what is new. */
  readonly summary: string;
}

/**
 * The text that the user approves: the title on the first line, then the text of the agent, in plain
 * words. The app version and the system go in the issue too; the approval says so.
 */
export function feedbackPreview(
  feedback: Feedback,
  notes: { recentErrors: string; sameAs: (issue: number) => string },
): string {
  const parts =
    feedback.kind === "bug"
      ? [feedback.title, feedback.description, feedback.reproduction]
      : [feedback.title, feedback.proposal, feedback.problem];
  // The card shows what else goes out: the errors and the issue. Each note is its own paragraph, a
  // source text that the card translates.
  if (feedback.recentErrors.trim()) parts.push(notes.recentErrors, feedback.recentErrors.trim());
  if (feedback.sameAs !== null) parts.push(notes.sameAs(feedback.sameAs));
  return parts.filter((part) => part.trim()).join("\n\n");
}

/**
 * The feedback in a request body, or null when a field is missing, too long, or not a form option.
 * The Worker trusts nothing else: it opens a public issue with this text.
 */
export function parseFeedback(value: unknown): Feedback | null {
  if (!isDynamicRecord(value)) return null;
  const text = (field: unknown, limit: number, required: boolean): string | null => {
    if ((field === undefined || field === null) && !required) return "";
    if (!isString(field) || field.length > limit) return null;
    return required && !field.trim() ? null : field;
  };
  const choice = <const T extends readonly string[]>(options: T, field: unknown): T[number] | null | undefined => {
    if (field === undefined || field === null) return null;
    return isOneOf(options, field) ? field : undefined;
  };
  const title = text(value.title, FEEDBACK_LIMITS.title, true);
  const version = text(value.version, FEEDBACK_LIMITS.fact, true);
  const os = text(value.os, FEEDBACK_LIMITS.fact, true);
  const providerVersion = text(value.providerVersion, FEEDBACK_LIMITS.fact, false);
  // An older app sends none of these, so each one is optional.
  const model = text(value.model, FEEDBACK_LIMITS.fact, false);
  const effort = text(value.effort, FEEDBACK_LIMITS.fact, false);
  const recentErrors = text(value.recentErrors, FEEDBACK_LIMITS.errors, false);
  const host = choice(FEEDBACK_HOSTS, value.host);
  const surface = choice(FEEDBACK_SURFACES, value.surface);
  const foundBy =
    value.foundBy === undefined || value.foundBy === null ? "user" : choice(FEEDBACK_FINDERS, value.foundBy);
  const sameAs =
    value.sameAs === undefined || value.sameAs === null ? null : isIssueNumber(value.sameAs) ? value.sameAs : undefined;
  if (
    title === null ||
    version === null ||
    os === null ||
    providerVersion === null ||
    model === null ||
    effort === null ||
    recentErrors === null ||
    host === undefined ||
    surface === undefined ||
    !foundBy ||
    sameAs === undefined ||
    !isOneOf(BUG_REPORT_PLATFORMS, value.platform) ||
    !isOneOf(BUG_REPORT_INSTALL_SOURCES, value.installSource) ||
    !isOneOf(BUG_REPORT_PROVIDERS, value.provider)
  )
    return null;
  const facts: SentFacts = {
    title,
    platform: value.platform,
    installSource: value.installSource,
    version,
    os,
    provider: value.provider,
    providerVersion,
    model,
    effort,
    host,
    surface,
    foundBy,
    recentErrors,
    sameAs,
  };
  if (value.kind === "idea") {
    const type = choice(FEATURE_REQUEST_TYPES, value.type);
    const proposal = text(value.proposal, FEEDBACK_LIMITS.text, true);
    const problem = text(value.problem, FEEDBACK_LIMITS.text, false);
    if (type === undefined || proposal === null || problem === null) return null;
    return { kind: "idea", ...facts, type, proposal, problem };
  }
  if (value.kind !== "bug") return null;
  const description = text(value.description, FEEDBACK_LIMITS.text, true);
  const reproduction = text(value.reproduction, FEEDBACK_LIMITS.text, false);
  const area = choice(BUG_REPORT_AREAS, value.area);
  const severity = choice(BUG_REPORT_SEVERITIES, value.severity);
  const frequency = choice(BUG_REPORT_FREQUENCIES, value.frequency);
  const regression = choice(BUG_REPORT_REGRESSIONS, value.regression);
  if (
    description === null ||
    reproduction === null ||
    area === undefined ||
    severity === undefined ||
    frequency === undefined ||
    regression === undefined
  )
    return null;
  return { kind: "bug", ...facts, area, severity, frequency, regression, description, reproduction };
}

function isIssueNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

/** A `@name` in the text would notify that GitHub user. A zero-width space after `@` keeps the text and stops it. */
function noMentions(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9])/gu, "@\u200b");
}

const FEEDBACK_SENT_ITEM_TYPE_PREFIX = "feedback-sent:";

/** The issue that the account service opened for approved feedback. */
export interface FeedbackIssue {
  readonly number: number;
  readonly url: string;
}

/** The item type of the chat card that thanks the user for sent feedback. It holds the issue number. */
export function feedbackSentItemType(number: number): string {
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("A valid issue number is required.");
  return `${FEEDBACK_SENT_ITEM_TYPE_PREFIX}${number}`;
}

/** The issue of a thank-you card, or null for any other message. The URL comes from the number only. */
export function feedbackSentIssue(message: ConversationMessage): FeedbackIssue | null {
  if (message.author !== "system" || message.source !== "system" || message.status !== "completed") return null;
  if (!message.itemType?.startsWith(FEEDBACK_SENT_ITEM_TYPE_PREFIX)) return null;
  const digits = message.itemType.slice(FEEDBACK_SENT_ITEM_TYPE_PREFIX.length);
  if (!/^[1-9][0-9]{0,15}$/u.test(digits)) return null;
  const number = Number(digits);
  if (!Number.isSafeInteger(number)) return null;
  return { number, url: `https://github.com/${FEEDBACK_REPOSITORY}/issues/${number}` };
}
