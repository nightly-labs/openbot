// Checks the OpenBot Contributor License Agreement (CLA.md) on one pull request.
//
//   bun scripts/cla.ts pr <number>                checks one open pull request
//   bun scripts/cla.ts record <login> <number>    records the signed PDF of <login>, then checks <number>
//   --dry-run                                     writes nothing to GitHub; the decisions go to REPORT_PATH
//
// The author of the pull request and each commit author must sign. Bots, organization members and
// users with write access skip the check, as in `contribution-policy.ts`. An author signs the PDF
// from CLA_PAGE_URL and sends it to LICENSES_EMAIL. A maintainer reads the email, then runs `record`
// with a GitHub token that can write to the repository. `record` adds the signature to
// SIGNATURES_FILE on the SIGNATURES_BRANCH branch and checks the pull request again. A closed pull
// request is skipped.
//
// A signature of the Contributor Assignment Agreement 1.0 also passes: that agreement assigns the
// copyright, which gives more than the license, and it continues to apply to the contributions of
// its signers. Its signatures were a ticked box or a comment, recorded by earlier versions of this
// script.
//
// No package imports: `cla.yml` runs this before `bun install`. Every GitHub read uses `gh api --jq`.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Not COLLABORATOR: that includes collaborators with read or triage access, who must sign. The
// permission lookup in `isTrusted` passes collaborators with write access.
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER"]);
const TRUSTED_PERMISSIONS = new Set(["admin", "maintain", "write"]);
const AGREEMENT_PATH = "CLA.md";
const AGREEMENT_NAME = "OpenBot Contributor License Agreement";
/** Earlier versions whose signatures still pass. See the comment at the top. */
const EARLIER_ACCEPTED_VERSIONS = ["1.0"];
const CLA_PAGE_URL = "https://openbot.run/cla";
const LICENSES_EMAIL = "licenses@openbot.run";
const SIGNATURES_BRANCH = "cla-signatures";
const SIGNATURES_FILE = "signatures.json";
const STATUS_CONTEXT = "CLA";
const COMMENT_MARKER = "<!-- cla -->";
const COMMENT_AUTHOR = "github-actions[bot]";
/** The pull request commits endpoint returns at most this number of commits. */
const MAX_COMMITS = 250;
const SAVE_ATTEMPTS = 3;
const REPORT_PATH = ".openbot-build/cla/report.json";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [command, ...positional] = args.filter((arg) => !arg.startsWith("--"));

const repository =
  process.env.GITHUB_REPOSITORY || gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
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

function readLines(path: string, jq: string): string[] {
  return gh(["api", "--paginate", path, "--jq", jq])
    .split("\n")
    .filter((line) => line !== "");
}

/** `gh` prints the HTTP status on standard error when a request fails. */
function failedWith(error: unknown, statuses: readonly number[]): boolean {
  const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
  return statuses.some((status) => stderr.includes(`HTTP ${status}`));
}

/** One column of a `@tsv` row. A missing column is a script error. */
function column(values: readonly string[], index: number): string {
  const value = values[index];
  if (value === undefined) fail(`Unexpected value from GitHub: ${values.join("\t")}`);
  return value;
}

function isTrusted(login: string, association: string): boolean {
  if (TRUSTED_ASSOCIATIONS.has(association)) return true;
  // `author_association` can miss a private organization member. The permission lookup does not,
  // and it fails closed: an error treats the author as external.
  try {
    return TRUSTED_PERMISSIONS.has(read(`repos/${repository}/collaborators/${login}/permission`, ".permission"));
  } catch {
    return false;
  }
}

/** Every change to GitHub goes through here, so `--dry-run` only records it. */
function write(description: string, ghArgs: readonly string[], input?: string): void {
  writes.push(description);
  if (!dryRun) gh(ghArgs, input);
}

function parseNumber(value: string | undefined): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail(`Expected a pull request number, got "${value}".`);
  return number;
}

/** The version of CLA.md. The script fails when CLA.md is not the expected agreement. */
function loadAgreement(): string {
  const text = readFileSync(AGREEMENT_PATH, "utf8");
  if (!text.startsWith(`# ${AGREEMENT_NAME}\n`)) fail(`${AGREEMENT_PATH} is not the ${AGREEMENT_NAME}.`);
  const version = /^Version: (\S+)$/m.exec(text)?.[1];
  if (version === undefined) fail(`${AGREEMENT_PATH} has no "Version:" line.`);
  return version;
}

interface Person {
  readonly login: string;
  readonly id: number;
}

interface Signature {
  readonly login: string;
  readonly userId: number;
  readonly version: string;
  readonly signedAt: string;
  readonly pullRequest: number;
  /** Version 1.0 signatures are a ticked box or a comment. Later signatures are a PDF sent by email. */
  readonly method: "checkbox" | "comment" | "email";
  /** The pull request for a checkbox or an email, or the comment. */
  readonly url: string;
  readonly text: string;
}

interface SignatureStore {
  readonly signatures: readonly Signature[];
  /** The blob SHA of SIGNATURES_FILE, or undefined when the file does not exist. */
  readonly sha: string | undefined;
  readonly branchExists: boolean;
}

function loadStore(): SignatureStore {
  try {
    const row = read(
      `repos/${repository}/contents/${SIGNATURES_FILE}?ref=${SIGNATURES_BRANCH}`,
      '[.sha, (.content | gsub("\\n"; ""))] | @tsv',
    ).split("\t");
    const parsed: { signatures: Signature[] } = JSON.parse(Buffer.from(column(row, 1), "base64").toString("utf8"));
    return { signatures: parsed.signatures, sha: column(row, 0), branchExists: true };
  } catch (error) {
    if (!failedWith(error, [404])) throw error;
  }
  try {
    read(`repos/${repository}/git/ref/heads/${SIGNATURES_BRANCH}`, ".object.sha");
    return { signatures: [], sha: undefined, branchExists: true };
  } catch (error) {
    if (!failedWith(error, [404])) throw error;
    return { signatures: [], sha: undefined, branchExists: false };
  }
}

function hasSigned(signatures: readonly Signature[], id: number, version: string): boolean {
  return signatures.some(
    (signature) =>
      signature.userId === id &&
      (signature.version === version || EARLIER_ACCEPTED_VERSIONS.includes(signature.version)),
  );
}

/** Writes the file with the content API. A new branch gets one commit with no parent. */
function saveStore(store: SignatureStore, signatures: readonly Signature[], message: string): void {
  const content = `${JSON.stringify({ signatures }, null, 2)}\n`;
  if (!store.branchExists) {
    const tree = gh(
      ["api", "-X", "POST", `repos/${repository}/git/trees`, "--input", "-", "--jq", ".sha"],
      JSON.stringify({ tree: [{ path: SIGNATURES_FILE, mode: "100644", type: "blob", content }] }),
    );
    const commit = gh(
      ["api", "-X", "POST", `repos/${repository}/git/commits`, "--input", "-", "--jq", ".sha"],
      JSON.stringify({ message, tree, parents: [] }),
    );
    gh(
      ["api", "-X", "POST", `repos/${repository}/git/refs`, "--input", "-"],
      JSON.stringify({ ref: `refs/heads/${SIGNATURES_BRANCH}`, sha: commit }),
    );
    return;
  }
  gh(
    ["api", "-X", "PUT", `repos/${repository}/contents/${SIGNATURES_FILE}`, "--input", "-"],
    JSON.stringify({
      message,
      branch: SIGNATURES_BRANCH,
      content: Buffer.from(content).toString("base64"),
      ...(store.sha === undefined ? {} : { sha: store.sha }),
    }),
  );
}

/**
 * Adds the new signatures to the record. A different run that writes at the same time makes the
 * write fail with 409 or 422; then the record is read again and merged.
 */
function recordSignatures(added: readonly Signature[], version: string): void {
  const message = `Record CLA ${version} signatures: ${added.map((signature) => signature.login).join(", ")}`;
  writes.push(`${message}\n${added.map((signature) => signature.url).join("\n")}`);
  if (dryRun) return;
  for (let attempt = 1; ; attempt += 1) {
    const store = loadStore();
    const missing = added.filter((signature) => !hasSigned(store.signatures, signature.userId, version));
    if (missing.length === 0) return;
    try {
      saveStore(store, [...store.signatures, ...missing], message);
      return;
    } catch (error) {
      if (attempt === SAVE_ATTEMPTS || !failedWith(error, [409, 422])) throw error;
    }
  }
}

interface PullRequest {
  readonly number: number;
  readonly author: Person;
  readonly authorIsBot: boolean;
  readonly association: string;
  readonly sha: string;
  readonly state: string;
  readonly commits: number;
  readonly url: string;
}

function loadPullRequest(number: number): PullRequest {
  const row = read(
    `repos/${repository}/pulls/${number}`,
    "[.user.login, .user.id, .user.type, .author_association, .head.sha, .state, .commits, .html_url] | @tsv",
  ).split("\t");
  return {
    number,
    author: { login: column(row, 0), id: Number(column(row, 1)) },
    authorIsBot: column(row, 2) === "Bot",
    association: column(row, 3),
    sha: column(row, 4),
    state: column(row, 5),
    commits: Number(column(row, 6)),
    url: column(row, 7),
  };
}

/** The people who must sign, and the commits whose author email has no GitHub account. */
function requiredSigners(pr: PullRequest): { readonly signers: Person[]; readonly unlinked: string[] } {
  const people = new Map<number, Person>();
  const unlinked: string[] = [];
  if (!pr.authorIsBot) people.set(pr.author.id, pr.author);
  const rows = readLines(
    `repos/${repository}/pulls/${pr.number}/commits?per_page=100`,
    '.[] | [(.author.login // ""), (.author.id // 0 | tostring), (.author.type // ""), .sha] | @tsv',
  ).map((line) => line.split("\t"));
  for (const row of rows) {
    const login = column(row, 0);
    if (login === "") unlinked.push(column(row, 3).slice(0, 12));
    else if (column(row, 2) !== "Bot") people.set(Number(column(row, 1)), { login, id: Number(column(row, 1)) });
  }
  const signers = [...people.values()].filter(
    (person) => !isTrusted(person.login, person.id === pr.author.id ? pr.association : ""),
  );
  return { signers, unlinked };
}

/** Keeps one CLA comment per pull request and edits it in place. */
function upsertStickyComment(number: number, body: string, createIfMissing: boolean): void {
  const text = `${COMMENT_MARKER}\n${body}`;
  const [existing] = readLines(
    `repos/${repository}/issues/${number}/comments?per_page=100`,
    `.[] | select(.user.login == "${COMMENT_AUTHOR}" and (.body | contains("${COMMENT_MARKER}"))) | .id`,
  );
  if (existing !== undefined) {
    write(
      `edit CLA comment on #${number}:\n${body}`,
      ["api", "-X", "PATCH", `repos/${repository}/issues/comments/${existing}`, "-F", "body=@-"],
      text,
    );
  } else if (createIfMissing) {
    write(
      `comment on #${number}:\n${body}`,
      ["api", "-X", "POST", `repos/${repository}/issues/${number}/comments`, "-F", "body=@-"],
      text,
    );
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
    `target_url=${CLA_PAGE_URL}`,
  ]);
}

function requestComment(pr: PullRequest, unsigned: readonly Person[], unlinked: readonly string[]): string {
  const lines: string[] = [];
  if (unsigned.length > 0) {
    lines.push(
      `${unsigned.map((person) => `@${person.login}`).join(", ")}, thank you for the contribution. Before we can merge it, each author from outside the organization must sign the [${AGREEMENT_NAME}](${CLA_PAGE_URL}). With the agreement, you keep the copyright in your contributions and give OpenBot a license to use them.`,
      "",
      `To sign, download the agreement as a PDF from [openbot.run/cla](${CLA_PAGE_URL}). Fill it in, sign it, and send it to ${LICENSES_EMAIL}. In the email, write your GitHub login and the link to this pull request: ${pr.url}`,
      "",
      "A maintainer records your signature, and then this check runs again. You sign one time. The signature applies to all your contributions to OpenBot.",
    );
  }
  if (unlinked.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `The author email of these commits is not linked to a GitHub account, so we cannot find who must sign: ${unlinked.map((sha) => `\`${sha}\``).join(", ")}. Add the email to your GitHub account, or change the commit author and push again.`,
    );
  }
  return lines.join("\n");
}

interface Decision {
  readonly number: number;
  readonly state: string;
  readonly signers: readonly string[];
  readonly unsigned: readonly string[];
  readonly unlinked: readonly string[];
  readonly result: "skipped" | "pass" | "fail";
  readonly reason: string;
}

function checkPullRequest(number: number): Decision {
  const version = loadAgreement();
  const pr = loadPullRequest(number);
  if (pr.state !== "open") {
    return {
      number,
      state: pr.state,
      signers: [],
      unsigned: [],
      unlinked: [],
      result: "skipped",
      reason: `pull request is ${pr.state}`,
    };
  }
  const { signers, unlinked } = requiredSigners(pr);
  const store = loadStore();
  const unsigned = signers.filter((person) => !hasSigned(store.signatures, person.id, version));

  const tooManyCommits = pr.commits > MAX_COMMITS;
  const passed = unsigned.length === 0 && unlinked.length === 0 && !tooManyCommits;
  const reason = tooManyCommits
    ? `More than ${MAX_COMMITS} commits. Squash the commits so that the authors can be checked.`
    : unsigned.length > 0
      ? `Not signed by ${unsigned.map((person) => person.login).join(", ")}.`
      : unlinked.length > 0
        ? "A commit author has no GitHub account."
        : signers.length === 0
          ? "No author must sign."
          : "All authors signed.";

  setStatus(pr.sha, passed ? "success" : "failure", reason.slice(0, 140));
  if (passed) {
    upsertStickyComment(number, "All authors signed the agreement. The CLA check passes.", false);
  } else if (tooManyCommits) {
    upsertStickyComment(number, reason, true);
  } else {
    upsertStickyComment(number, requestComment(pr, unsigned, unlinked), true);
  }

  return {
    number,
    state: pr.state,
    signers: signers.map((person) => person.login),
    unsigned: unsigned.map((person) => person.login),
    unlinked,
    result: passed ? "pass" : "fail",
    reason,
  };
}

/** Records the signed PDF that `login` sent by email, for the pull request `number`. */
function recordEmailSignature(login: string, number: number): string {
  const version = loadAgreement();
  const user = read(`users/${login}`, "[.login, .id, .type] | @tsv").split("\t");
  if (column(user, 2) !== "User") fail(`${login} is not a GitHub user.`);
  const pr = loadPullRequest(number);
  recordSignatures(
    [
      {
        login: column(user, 0),
        userId: Number(column(user, 1)),
        version,
        signedAt: new Date().toISOString(),
        pullRequest: number,
        method: "email",
        url: pr.url,
        text: `Signed PDF of the ${AGREEMENT_NAME} ${version}, sent to ${LICENSES_EMAIL}.`,
      },
    ],
    version,
  );
  return column(user, 0);
}

let recorded: string | undefined;
let decision: Decision;
if (command === "pr" && positional.length === 1) {
  decision = checkPullRequest(parseNumber(positional[0]));
} else if (command === "record" && positional.length === 2 && positional[0] !== undefined) {
  const number = parseNumber(positional[1]);
  recorded = recordEmailSignature(positional[0], number);
  decision = checkPullRequest(number);
} else {
  fail(
    "Usage: bun scripts/cla.ts pr <number> [--dry-run]\n       bun scripts/cla.ts record <login> <number> [--dry-run]",
  );
}

const report = { repository, command, dryRun, recorded, decision, writes };
if (dryRun) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
