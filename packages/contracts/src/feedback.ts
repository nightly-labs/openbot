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

export const FEEDBACK_LIMITS = { title: 200, fact: 200, text: 1000 } as const;

export interface FeedbackFacts {
  readonly platform: BugReportPlatform;
  /** The OpenBot version, when the caller knows it. */
  readonly version?: string;
  /** The operating system version and the processor architecture, such as `macOS 26.1 (arm64)`. */
  readonly os?: string;
  /** True for a build from source: the form has an option for it. A release build leaves the field to the user. */
  readonly builtFromSource?: boolean;
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

/**
 * The issue for the feedback. The body has the sections that GitHub writes for a form answer
 * (`### Label`, then the answer), so that triage reads sent feedback as it reads a form.
 */
export function feedbackIssue(feedback: Feedback): { title: string; body: string; labels: string[] } {
  const facts: [string, string][] = [
    ["Platform", feedback.platform],
    ["Installation source", feedback.installSource],
    ["OpenBot version", feedback.version],
    ["Operating system and hardware", feedback.os],
    ["Providers", feedback.provider],
    ["Provider CLI version", feedback.providerVersion],
  ];
  const sections: [string, string | null][] =
    feedback.kind === "bug"
      ? [
          ...facts,
          ["Area", feedback.area],
          ["Severity", feedback.severity],
          ["Frequency", feedback.frequency],
          ["Did this work in an earlier version?", feedback.regression],
          ["What happened?", feedback.description],
          ["Steps to reproduce", feedback.reproduction],
        ]
      : [
          ["Type of request", feedback.type],
          ["Problem", feedback.problem],
          ["Who has this problem?", null],
          ["Current workaround", null],
          ["Proposed behavior", feedback.proposal],
          ["Fit with OpenBot", null],
          ["Out of scope", null],
          ["Security and local-data impact", null],
          ["Do you plan to send a pull request?", "No"],
          ...facts,
        ];
  const answers = sections.map(
    ([label, value]) => `### ${label}\n\n${noMentions(value?.trim() ?? "") || "_No response_"}`,
  );
  const form = ISSUE_FORMS[feedback.kind];
  return {
    title: `${form.titlePrefix}${noMentions(feedback.title)}`,
    body: [
      ...answers,
      "---",
      "Sent from the OpenBot app. An agent wrote this text, and the user approved it before it was sent.",
    ].join("\n\n"),
    labels: [...form.labels],
  };
}

/**
 * The text that the user approves: the title on the first line, then the text of the agent, in plain
 * words. The app version and the system go in the issue too; the approval says so.
 */
export function feedbackPreview(feedback: Feedback): string {
  const parts =
    feedback.kind === "bug"
      ? [feedback.title, feedback.description, feedback.reproduction]
      : [feedback.title, feedback.proposal, feedback.problem];
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
  if (
    title === null ||
    version === null ||
    os === null ||
    providerVersion === null ||
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
