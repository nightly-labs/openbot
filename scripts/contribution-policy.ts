// Applies the external contribution policy in CONTRIBUTING.md ("What you can send").
//
//   bun scripts/contribution-policy.ts pr <number>     checks one pull request
//   bun scripts/contribution-policy.ts issue <number>  checks one new issue
//   bun scripts/contribution-policy.ts sweep           checks every open pull request that has
//                                                      `needs-approved-issue`, and closes the ones
//                                                      that still fail after CLOSE_AFTER_DAYS
//   --dry-run              writes nothing to GitHub; the decisions go to REPORT_PATH
//   --assume-label <name>  adds a label to the pull request before the check (dry run only)
//
// Organization members, users with write access and the bots in TRUSTED_BOTS skip every rule.
// A pull request from anyone else fails only when a maintainer adds `needs-approved-issue` and it
// links no issue with the `approved` label. An issue from anyone else must come from an issue form
// with all required answers; the form definitions are read from `.github/ISSUE_TEMPLATE`.
//
// No package imports: `contribution-policy.yml` runs this before `bun install`. Every GitHub read
// uses `gh api --jq`, so the script handles only text.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// `openbotgit[bot]` is the OpenBot GitHub App. The account Worker gives its installation token only for
// repositories where the signed-in user can push (`apps/auth-api/src/server/github-installation-tokens.ts`).
const TRUSTED_BOTS = new Set(["infeld-ai[bot]", "dependabot[bot]", "openbotgit[bot]"]);
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const TRUSTED_PERMISSIONS = new Set(["admin", "maintain", "write"]);
const LABEL_EXTERNAL = "external";
const LABEL_NEEDS_ISSUE = "needs-approved-issue";
const LABEL_APPROVED = "approved";
const LABEL_EXEMPT = "policy-exempt";
const LABEL_INVALID = "invalid";
const STATUS_CONTEXT = "Contribution policy";
const COMMENT_MARKER = "<!-- contribution-policy -->";
const COMMENT_AUTHOR = "github-actions[bot]";
const CLOSE_AFTER_DAYS = 7;
const FORM_DIR = ".github/ISSUE_TEMPLATE";
const REPORT_PATH = ".openbot-build/contribution-policy/report.json";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const assumeLabelFlag = args.indexOf("--assume-label");
const assumedLabel = assumeLabelFlag === -1 ? undefined : args[assumeLabelFlag + 1];
const [command, numberArgument] = args.filter(
  (arg, index) => !arg.startsWith("--") && (assumeLabelFlag === -1 || index !== assumeLabelFlag + 1),
);

if (assumedLabel !== undefined && !dryRun) fail("--assume-label works only with --dry-run.");

const repository =
  process.env.GITHUB_REPOSITORY || gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
const [owner, name] = repository.split("/");
const policyUrl = `https://github.com/${repository}/blob/main/CONTRIBUTING.md#what-you-can-send`;

interface Decision {
  readonly kind: "pr" | "issue";
  readonly number: number;
  readonly author: string;
  readonly trusted: boolean;
  readonly result: "skipped" | "pass" | "fail" | "closed";
  readonly reason: string;
}

const decisions: Decision[] = [];
const writes: string[] = [];

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function gh(ghArgs: readonly string[], input?: string): string {
  return execFileSync("gh", ghArgs, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  }).replace(/\n+$/, "");
}

function read(path: string, jq: string): string {
  return gh(["api", path, "--jq", jq]);
}

/** One column of a `@tsv` row or a regular expression match. A missing column is a script error. */
function column(values: readonly string[], index: number): string {
  const value = values[index];
  if (value === undefined) fail(`Unexpected value from GitHub: ${values.join("\t")}`);
  return value;
}

function readLines(path: string, jq: string): string[] {
  return gh(["api", "--paginate", path, "--jq", jq])
    .split("\n")
    .filter((line) => line !== "");
}

/** Every change to GitHub goes through here, so `--dry-run` only records it. */
function write(description: string, ghArgs: readonly string[], input?: string): void {
  writes.push(description);
  if (!dryRun) gh(ghArgs, input);
}

function parseNumber(value: string | undefined): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail(`Expected an issue or pull request number, got "${value}".`);
  return number;
}

function isTrusted(login: string, association: string): boolean {
  if (TRUSTED_BOTS.has(login) || TRUSTED_ASSOCIATIONS.has(association)) return true;
  // `author_association` can miss a private organization member. The permission lookup does not,
  // and it fails closed: an error treats the author as external.
  try {
    return TRUSTED_PERMISSIONS.has(read(`repos/${repository}/collaborators/${login}/permission`, ".permission"));
  } catch {
    return false;
  }
}

function addLabel(number: number, label: string, labels: readonly string[]): void {
  if (labels.includes(label)) return;
  write(`add label ${label} to #${number}`, [
    "api",
    "-X",
    "POST",
    `repos/${repository}/issues/${number}/labels`,
    "-f",
    `labels[]=${label}`,
  ]);
}

function comment(number: number, body: string): void {
  write(
    `comment on #${number}:\n${body}`,
    ["api", "-X", "POST", `repos/${repository}/issues/${number}/comments`, "-F", "body=@-"],
    body,
  );
}

/** Keeps one policy comment per pull request and edits it in place. */
function upsertStickyComment(number: number, body: string, createIfMissing: boolean): void {
  const text = `${COMMENT_MARKER}\n${body}`;
  const [existing] = readLines(
    `repos/${repository}/issues/${number}/comments?per_page=100`,
    `.[] | select(.user.login == "${COMMENT_AUTHOR}" and (.body | contains("${COMMENT_MARKER}"))) | .id`,
  );
  if (existing !== undefined) {
    write(
      `edit policy comment on #${number}:\n${body}`,
      ["api", "-X", "PATCH", `repos/${repository}/issues/comments/${existing}`, "-F", "body=@-"],
      text,
    );
  } else if (createIfMissing) {
    comment(number, text);
  }
}

function setStatus(sha: string, state: "success" | "failure", description: string): void {
  write(`status ${state} on ${sha.slice(0, 12)}: ${description}`, [
    "api",
    "-X",
    "POST",
    `repos/${repository}/statuses/${sha}`,
    "-f",
    `state=${state}`,
    "-f",
    `context=${STATUS_CONTEXT}`,
    "-f",
    `description=${description}`,
    "-f",
    `target_url=${policyUrl}`,
  ]);
}

/**
 * The issues that the pull request closes: `Closes #n` in its body, or a link set in the sidebar.
 * A plain `#n` mention does not count. A maintainer still checks that the closed issue matches.
 */
function linkedIssues(number: number): number[] {
  const query =
    "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){closingIssuesReferences(first:50){nodes{number}}}}}";
  return gh([
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `number=${number}`,
    "--jq",
    ".data.repository.pullRequest.closingIssuesReferences.nodes[].number",
  ])
    .split("\n")
    .filter((value) => value !== "")
    .map(Number);
}

function approvedIssue(numbers: readonly number[]): number | undefined {
  return numbers.find((issue) => {
    try {
      // A pull request number answers on the issues endpoint too; only a real issue counts.
      const row = read(
        `repos/${repository}/issues/${issue}`,
        '[(.pull_request != null), (.labels | map(.name) | join(","))] | @tsv',
      ).split("\t");
      return column(row, 0) === "false" && column(row, 1).split(",").includes(LABEL_APPROVED);
    } catch {
      return false;
    }
  });
}

interface PullRequest {
  readonly number: number;
  readonly author: string;
  readonly association: string;
  readonly sha: string;
  readonly state: string;
  readonly labels: readonly string[];
}

function loadPullRequest(number: number): PullRequest {
  const row = read(
    `repos/${repository}/pulls/${number}`,
    '[.user.login, .author_association, .head.sha, .state, (.labels | map(.name) | join(","))] | @tsv',
  ).split("\t");
  const labels = column(row, 4)
    .split(",")
    .filter((label) => label !== "");
  if (assumedLabel !== undefined && !labels.includes(assumedLabel)) labels.push(assumedLabel);
  return {
    number,
    author: column(row, 0),
    association: column(row, 1),
    sha: column(row, 2),
    state: column(row, 3),
    labels,
  };
}

function failureComment(author: string): string {
  return [
    `@${author}, thank you for the pull request. A maintainer marked it as a feature or a change to how OpenBot works.`,
    "",
    `Changes of this type need an issue with the \`${LABEL_APPROVED}\` label before we review code. To continue:`,
    "",
    "1. Open a feature request, or find the issue that already describes this change.",
    `2. Wait until a maintainer adds the \`${LABEL_APPROVED}\` label to that issue.`,
    "3. Link the issue in the description of this pull request, for example `Closes #123`.",
    "",
    `If this pull request does not link an approved issue in ${CLOSE_AFTER_DAYS} days, it closes automatically. See [What you can send](${policyUrl}).`,
  ].join("\n");
}

function checkPullRequest(number: number): Decision {
  const pr = loadPullRequest(number);
  const record = (trusted: boolean, result: Decision["result"], reason: string): Decision => {
    const decision: Decision = { kind: "pr", number, author: pr.author, trusted, result, reason };
    decisions.push(decision);
    return decision;
  };

  if (isTrusted(pr.author, pr.association)) {
    if (pr.state === "open") setStatus(pr.sha, "success", "Trusted author.");
    return record(true, "skipped", "trusted author");
  }
  if (pr.state !== "open") {
    return record(false, "skipped", `pull request is ${pr.state}`);
  }

  addLabel(number, LABEL_EXTERNAL, pr.labels);
  if (pr.labels.includes(LABEL_EXEMPT)) {
    setStatus(pr.sha, "success", "A maintainer exempted this pull request.");
    upsertStickyComment(
      number,
      "A maintainer exempted this pull request. The contribution policy check passes.",
      false,
    );
    return record(false, "pass", LABEL_EXEMPT);
  }
  if (!pr.labels.includes(LABEL_NEEDS_ISSUE)) {
    setStatus(pr.sha, "success", "No approved issue is necessary.");
    upsertStickyComment(
      number,
      "This pull request does not need an approved issue. The contribution policy check passes.",
      false,
    );
    return record(false, "pass", `no ${LABEL_NEEDS_ISSUE} label`);
  }

  const issues = linkedIssues(number);
  const approved = approvedIssue(issues);
  // The label stays: if the author removes the link later, the check fails again.
  if (approved !== undefined) {
    setStatus(pr.sha, "success", `Linked to approved issue #${approved}.`);
    upsertStickyComment(
      number,
      `This pull request links approved issue #${approved}. The contribution policy check passes.`,
      false,
    );
    return record(false, "pass", `approved issue #${approved}`);
  }

  setStatus(pr.sha, "failure", "Link an issue that has the approved label.");
  upsertStickyComment(number, failureComment(pr.author), true);
  return record(
    false,
    "fail",
    issues.length === 0 ? "no linked issue" : `no approved issue among #${issues.join(", #")}`,
  );
}

/**
 * The start of the current waiting time: when the label was added, or a later reopen by a
 * maintainer. A reopen by the author does not restart the wait.
 */
function waitingSince(number: number): Date | undefined {
  const times = readLines(
    `repos/${repository}/issues/${number}/events?per_page=100`,
    `.[] | select((.event == "labeled" and .label.name == "${LABEL_NEEDS_ISSUE}") or .event == "reopened") | [.created_at, .event, .actor.login] | @tsv`,
  )
    .map((line) => line.split("\t"))
    .filter((row) => column(row, 1) === "labeled" || isTrusted(column(row, 2), ""))
    .map((row) => column(row, 0));
  const latest = times.sort().at(-1);
  return latest === undefined ? undefined : new Date(latest);
}

function sweep(): void {
  const numbers = readLines(
    `repos/${repository}/issues?state=open&labels=${LABEL_NEEDS_ISSUE}&per_page=100`,
    ".[] | select(.pull_request != null) | .number",
  ).map(Number);
  for (const number of numbers) {
    const decision = checkPullRequest(number);
    if (decision.result !== "fail") continue;
    const since = waitingSince(number);
    if (since === undefined) continue;
    const days = (Date.now() - since.getTime()) / 86_400_000;
    if (days < CLOSE_AFTER_DAYS) continue;
    comment(
      number,
      `@${decision.author}, this pull request did not link an issue with the \`${LABEL_APPROVED}\` label in ${CLOSE_AFTER_DAYS} days, so it is closed. When a maintainer approves the issue, link it and ask a maintainer to reopen this pull request. See [What you can send](${policyUrl}).`,
    );
    write(`close #${number}`, ["api", "-X", "PATCH", `repos/${repository}/pulls/${number}`, "-f", "state=closed"]);
    decisions.push({ ...decision, result: "closed", reason: `waited ${Math.floor(days)} days` });
  }
}

interface FormField {
  readonly type: string;
  readonly label: string;
  readonly required: boolean;
  /** For checkboxes: the options that must be checked. */
  readonly requiredOptions: readonly string[];
}

interface Form {
  readonly file: string;
  readonly fields: readonly FormField[];
}

/**
 * Reads the fields of each issue form. The forms use one fixed layout (`- type:`, then
 * `attributes.label`, then `validations.required`, or `required` under each checkbox option), so a
 * line reader is enough and keeps this script free of a YAML dependency. A field without a label
 * is not shown as a heading.
 */
function loadForms(): Form[] {
  return readdirSync(FORM_DIR)
    .filter((file) => file.endsWith(".yml") && file !== "config.yml")
    .map((file) => {
      const fields: FormField[] = [];
      let current: { type: string; label: string; required: boolean; requiredOptions: string[] } | undefined;
      let option = "";
      const flush = (): void => {
        if (current !== undefined && current.type !== "markdown" && current.label !== "") fields.push(current);
      };
      for (const line of readFileSync(join(FORM_DIR, file), "utf8").split("\n")) {
        const type = /^ {2}- type: (\w+)/.exec(line);
        if (type) {
          flush();
          current = { type: column(type, 1), label: "", required: false, requiredOptions: [] };
          continue;
        }
        if (current === undefined) continue;
        const label = /^ {6}label: (.+)$/.exec(line);
        if (label) current.label = column(label, 1).replace(/^"(.*)"$/, "$1");
        if (/^ {6}required: true\s*$/.test(line)) current.required = true;
        const optionLabel = /^ {8}- label: (.+)$/.exec(line);
        if (optionLabel) option = column(optionLabel, 1).replace(/^"(.*)"$/, "$1");
        if (/^ {10}required: true\s*$/.test(line)) {
          current.required = true;
          current.requiredOptions.push(option);
        }
      }
      flush();
      return { file, fields };
    });
}

/** Splits an issue form body into its `### Label` sections. */
function formSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = body.replace(/\r\n/g, "\n").split(/^### (.+)$/m);
  for (let index = 1; index < parts.length; index += 2)
    sections.set(column(parts, index).trim(), column(parts, index + 1).trim());
  return sections;
}

function missingAnswers(form: Form, sections: ReadonlyMap<string, string>): string[] {
  return form.fields
    .filter((field) => field.required)
    .filter((field) => {
      const answer = sections.get(field.label);
      if (answer === undefined || answer === "" || answer === "_No response_") return true;
      if (field.type === "checkboxes") {
        const checked = new Set([...answer.matchAll(/^- \[[xX]\] (.+)$/gm)].map((match) => column(match, 1).trim()));
        return field.requiredOptions.some((option) => !checked.has(option));
      }
      // "None" and "n/a" are valid answers. Only punctuation, such as "." or "-", counts as empty.
      return !/[\p{L}\p{N}].*[\p{L}\p{N}]/su.test(answer);
    })
    .map((field) => field.label);
}

function checkIssue(number: number): void {
  const row = read(
    `repos/${repository}/issues/${number}`,
    '[.user.login, .author_association, (.pull_request != null), (.labels | map(.name) | join(","))] | @tsv',
  ).split("\t");
  if (column(row, 2) === "true") fail(`#${number} is a pull request. Use the pr command.`);
  const author = column(row, 0);
  const association = column(row, 1);
  const labelList = column(row, 3).split(",");
  const record = (trusted: boolean, result: Decision["result"], reason: string): void => {
    decisions.push({ kind: "issue", number, author, trusted, result, reason });
  };

  if (isTrusted(author, association)) {
    record(true, "skipped", "trusted author");
    return;
  }
  addLabel(number, LABEL_EXTERNAL, labelList);

  const sections = formSections(read(`repos/${repository}/issues/${number}`, '.body // ""'));
  const results = loadForms().map((form) => ({ form, missing: missingAnswers(form, sections) }));
  const complete = results.find((result) => result.missing.length === 0);
  if (complete !== undefined) {
    record(false, "pass", `complete ${complete.form.file}`);
    return;
  }

  // Report against the form that the issue matches best: the one with the most headings present.
  const best = results
    .map((result) => ({ ...result, present: result.form.fields.filter((field) => sections.has(field.label)).length }))
    .sort((left, right) => right.present - left.present)[0];
  const reason =
    best === undefined || best.present === 0
      ? "This issue was not created from an issue form."
      : `These required answers are missing or empty: ${best.missing.map((label) => `**${label}**`).join(", ")}.`;
  comment(
    number,
    [
      `@${author}, thank you for the report. ${reason}`,
      "",
      `We accept issues only from the [bug report or feature request forms](https://github.com/${repository}/issues/new/choose), with all required answers, so that we can act on them. Open a new issue from a form. For questions and open ideas, use [Discussions](https://github.com/${repository}/discussions). See [What you can send](${policyUrl}).`,
    ].join("\n"),
  );
  addLabel(number, LABEL_INVALID, labelList);
  write(`close #${number} as not planned`, [
    "api",
    "-X",
    "PATCH",
    `repos/${repository}/issues/${number}`,
    "-f",
    "state=closed",
    "-f",
    "state_reason=not_planned",
  ]);
  record(false, "closed", reason);
}

switch (command) {
  case "pr":
    checkPullRequest(parseNumber(numberArgument));
    break;
  case "issue":
    checkIssue(parseNumber(numberArgument));
    break;
  case "sweep":
    sweep();
    break;
  default:
    fail(
      "Usage: bun scripts/contribution-policy.ts <pr <number> | issue <number> | sweep> [--dry-run] [--assume-label <name>]",
    );
}

const report = { repository, command, dryRun, decisions, writes };
if (dryRun) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
