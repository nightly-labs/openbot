/**
 * The bug report form of the OpenBot repository, with the facts that the app knows filled in.
 *
 * GitHub fills a form field from a query parameter with the field `id` of
 * `.github/ISSUE_TEMPLATE/bug_report.yml`. A dropdown value must be one of its options, word for word.
 * The user reads the form and submits it in the browser; nothing is sent from the app.
 */
const BUG_REPORT_FORM = "https://github.com/nightly-labs/openbot/issues/new?template=bug_report.yml";

/** The `platform` options of the form that the desktop app and the web client can be. */
export type BugReportPlatform = "macOS" | "Windows" | "Linux" | "Web client";

export interface BugReportFacts {
  readonly platform: BugReportPlatform;
  /** The OpenBot version, when the caller knows it. */
  readonly version?: string;
  /** The operating system version and the processor architecture, such as `macOS 26.1 (arm64)`. */
  readonly os?: string;
  /** True for a build from source: the form has an option for it. A release build leaves the field to the user. */
  readonly builtFromSource?: boolean;
}

export function bugReportFormUrl(facts: BugReportFacts): string {
  const query = new URLSearchParams({ platform: facts.platform });
  if (facts.builtFromSource) query.set("install-source", "Built from source");
  if (facts.version) query.set("version", facts.version);
  if (facts.os) query.set("os", facts.os);
  return `${BUG_REPORT_FORM}&${query.toString()}`;
}
