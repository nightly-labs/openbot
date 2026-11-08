import type { AgentProviderId } from "./agent-providers";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

/**
 * The bug report form of the OpenBot repository, with the facts that the app knows filled in.
 *
 * GitHub fills a form field from a query parameter with the field `id` of
 * `.github/ISSUE_TEMPLATE/bug_report.yml`. A dropdown value must be one of its options, word for word.
 * The user reads the form and submits it in the browser. `parseBugReport` is the report that the app sends.
 */
const BUG_REPORT_FORM = "https://github.com/nightly-labs/openbot/issues/new?template=bug_report.yml";

/** The title prefix of the form. */
const TITLE_PREFIX = "[Bug]: ";

/** The repository that gets the reports, as `owner/name`. */
export const BUG_REPORT_REPOSITORY = "nightly-labs/openbot";

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

export const BUG_REPORT_LIMITS = { title: 200, fact: 200, text: 1000 } as const;

export interface BugReportFacts {
  readonly platform: BugReportPlatform;
  /** The OpenBot version, when the caller knows it. */
  readonly version?: string;
  /** The operating system version and the processor architecture, such as `macOS 26.1 (arm64)`. */
  readonly os?: string;
  /** True for a build from source: the form has an option for it. A release build leaves the field to the user. */
  readonly builtFromSource?: boolean;
}

/** The text and the provider that an agent gives for its report. */
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

export function bugReportFormUrl(facts: BugReportFacts, details: BugReportDetails = {}): string {
  const query = new URLSearchParams({ platform: facts.platform });
  if (details.title) query.set("title", `${TITLE_PREFIX}${details.title}`);
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
  return `${BUG_REPORT_FORM}&${query.toString()}`;
}

/**
 * A report that the app sends to the account Worker, which opens it as an issue as `openbotgit[bot]`.
 *
 * Most reporters are not developers, so the agent writes only the problem in the user's words and the
 * steps that it saw. The app adds the facts. A choice that the chat does not show stays null, and the
 * issue reads "No response" for it, as GitHub writes an empty form field.
 */
export interface BugReport {
  readonly title: string;
  readonly platform: BugReportPlatform;
  readonly installSource: (typeof BUG_REPORT_INSTALL_SOURCES)[number];
  readonly version: string;
  readonly os: string;
  readonly provider: BugReportProvider;
  readonly providerVersion: string;
  readonly area: BugReportArea | null;
  readonly severity: BugReportSeverity | null;
  readonly frequency: BugReportFrequency | null;
  readonly regression: BugReportRegression | null;
  /** What went wrong and what the user expected. */
  readonly description: string;
  /** Empty when the agent does not know the steps. */
  readonly reproduction: string;
}

/** The form option for an agent's provider; a provider that the form does not list is "Custom agent (ACP)". */
export function bugReportProvider(provider: AgentProviderId): BugReportProvider {
  return PROVIDER_OPTIONS[provider] ?? "Custom agent (ACP)";
}

/** The issue title, with the form's prefix. */
export function bugReportIssueTitle(report: BugReport): string {
  return `${TITLE_PREFIX}${noMentions(report.title)}`;
}

/**
 * The issue body, in the sections that GitHub writes for a form answer (`### Label`, then the answer),
 * so that triage reads a sent report as it reads a form.
 */
export function bugReportIssueBody(report: BugReport): string {
  const sections: [string, string | null][] = [
    ["Platform", report.platform],
    ["Installation source", report.installSource],
    ["OpenBot version", report.version],
    ["Operating system and hardware", report.os],
    ["Providers", report.provider],
    ["Provider CLI version", report.providerVersion],
    ["Area", report.area],
    ["Severity", report.severity],
    ["Frequency", report.frequency],
    ["Did this work in an earlier version?", report.regression],
    ["What happened?", report.description],
    ["Steps to reproduce", report.reproduction],
  ];
  const answers = sections.map(
    ([label, value]) => `### ${label}\n\n${noMentions(value?.trim() ?? "") || "_No response_"}`,
  );
  return [
    ...answers,
    "---",
    "Sent from the OpenBot app. An agent wrote this report, and the user approved the text before it was sent.",
  ].join("\n\n");
}

/**
 * The text that the user approves: the title on the first line, then the problem and the steps, in
 * plain words. The app version and the system go in the issue too; the approval says so.
 */
export function bugReportPreview(report: BugReport): string {
  return [report.title, report.description, report.reproduction].filter((part) => part.trim()).join("\n\n");
}

/**
 * The report in a request body, or null when a field is missing, too long, or not a form option. The
 * Worker trusts nothing else: it opens a public issue with this text.
 */
export function parseBugReport(value: unknown): BugReport | null {
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
  const title = text(value.title, BUG_REPORT_LIMITS.title, true);
  const version = text(value.version, BUG_REPORT_LIMITS.fact, true);
  const os = text(value.os, BUG_REPORT_LIMITS.fact, true);
  const providerVersion = text(value.providerVersion, BUG_REPORT_LIMITS.fact, false);
  const description = text(value.description, BUG_REPORT_LIMITS.text, true);
  const reproduction = text(value.reproduction, BUG_REPORT_LIMITS.text, false);
  const area = choice(BUG_REPORT_AREAS, value.area);
  const severity = choice(BUG_REPORT_SEVERITIES, value.severity);
  const frequency = choice(BUG_REPORT_FREQUENCIES, value.frequency);
  const regression = choice(BUG_REPORT_REGRESSIONS, value.regression);
  if (
    title === null ||
    version === null ||
    os === null ||
    providerVersion === null ||
    description === null ||
    reproduction === null ||
    area === undefined ||
    severity === undefined ||
    frequency === undefined ||
    regression === undefined ||
    !isOneOf(BUG_REPORT_PLATFORMS, value.platform) ||
    !isOneOf(BUG_REPORT_INSTALL_SOURCES, value.installSource) ||
    !isOneOf(BUG_REPORT_PROVIDERS, value.provider)
  )
    return null;
  return {
    title,
    platform: value.platform,
    installSource: value.installSource,
    version,
    os,
    provider: value.provider,
    providerVersion,
    area,
    severity,
    frequency,
    regression,
    description,
    reproduction,
  };
}

/** A `@name` in the text would notify that GitHub user. A zero-width space after `@` keeps the text and stops it. */
function noMentions(text: string): string {
  return text.replace(/@(?=[A-Za-z0-9])/gu, "@\u200b");
}
