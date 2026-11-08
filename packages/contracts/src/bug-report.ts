import type { AgentProviderId } from "./agent-providers";

/**
 * The bug report form of the OpenBot repository, with the facts that the app knows filled in.
 *
 * GitHub fills a form field from a query parameter with the field `id` of
 * `.github/ISSUE_TEMPLATE/bug_report.yml`. A dropdown value must be one of its options, word for word.
 * The user reads the form and submits it in the browser; nothing is sent from the app.
 */
const BUG_REPORT_FORM = "https://github.com/nightly-labs/openbot/issues/new?template=bug_report.yml";

/** The title prefix of the form. */
const TITLE_PREFIX = "[Bug]: ";

/** The `platform` options of the form that the desktop app and the web client can be. */
export type BugReportPlatform = "macOS" | "Windows" | "Linux" | "Web client";

/** The form's platform for a Node.js `process.platform`. Other Unix systems are closest to Linux. */
export function bugReportPlatform(nodePlatform: string): Exclude<BugReportPlatform, "Web client"> {
  if (nodePlatform === "darwin") return "macOS";
  if (nodePlatform === "win32") return "Windows";
  return "Linux";
}

/** The `providers` options of the form. A provider with no option leaves the field to the user. */
const PROVIDER_OPTIONS: Partial<Record<AgentProviderId, string>> = {
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
  readonly expected?: string;
  readonly actual?: string;
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
  if (details.description) query.set("description", details.description);
  if (details.reproduction) query.set("reproduction", details.reproduction);
  if (details.expected) query.set("expected", details.expected);
  if (details.actual) query.set("actual", details.actual);
  return `${BUG_REPORT_FORM}&${query.toString()}`;
}
