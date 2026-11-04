// The GitHub REST calls of workflows: the changes of GitHub outputs, made as the OpenBot GitHub App's
// bot, the labels and people that an output can choose, and the newest events of a repository for
// "Run with last event". The backend keeps the rules; this adapter keeps the tokens and the HTTP.

import type {
  WorkflowGitHubCatalog,
  WorkflowGitHubCloseReason,
  WorkflowGitHubEvent,
  WorkflowGitHubLabel,
  WorkflowGitHubRepositoryOptions,
} from "@openbot/contracts/ipc";
import { WORKFLOW_GITHUB_OPTION_LIMIT } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Effect, Option } from "effect";
import { z } from "zod";
import type { MessagingAdapterError } from "../backend/messaging/messaging-types";
import {
  GITHUB_BODY_LIMIT,
  type WorkflowGitHubApi,
  type WorkflowGitHubApiFailure,
  type WorkflowGitHubChange,
  type WorkflowGitHubChangeResult,
  type WorkflowGitHubFile,
  type WorkflowGitHubFiles,
  type WorkflowGitHubRecentEvent,
} from "../backend/workflows/workflow-github-api";
import { WorkflowStoreError } from "../backend/workflows/workflow-store";
import { GITHUB_REQUEST_TIMEOUT_MS, type GitHubFetch } from "./github-device-flow";
import { GitHubOperationError, githubCall } from "./github-effects";

const API = "https://api.github.com";
const PAGE_SIZE = 100;
/** The newest items or comments that "Run with last event" reads. */
const RECENT_LIMIT = 30;
/** The pull requests whose reviews or checks "Run with last event" reads, one call each. */
const RECENT_DETAIL_LIMIT = 10;
/** The longest GitHub message that a failure keeps. */
const DETAIL_LIMIT = 300;
/** The `state_reason` that GitHub accepts for each saved close reason. */
const GITHUB_STATE_REASONS: Record<WorkflowGitHubCloseReason, string> = {
  completed: "completed",
  notPlanned: "not_planned",
};

/**
 * The branch that keeps the files of GitHub outputs. GitHub has no API that attaches a file to an issue
 * for an App, so the files go to this branch and the text links them. It has no history of the default
 * branch, so it has no workflow files, and a push to it starts no GitHub Actions.
 */
const FILES_BRANCH = "openbot-attachments";
/** The largest file that an output copies. A larger one keeps its own link, which expires. */
const FILE_BYTES_LIMIT = 25 * 1024 * 1024;
/** The most bytes that one output copies. The files after it keep their own links. */
const FILES_BYTES_LIMIT = 50 * 1024 * 1024;
/** The longest time that the download or the upload of one file can take. */
const FILE_TRANSFER_TIMEOUT_MS = 2 * 60 * 1000;
/** The largest part of GitHub's limit that the links can use, so that the text stays. */
const FILES_SECTION_LIMIT = GITHUB_BODY_LIMIT / 2;
/** The longest file name in the branch. */
const FILE_NAME_LIMIT = 100;
/** `[skip ci]` stops other CI services too. */
const FILES_COMMIT_MESSAGE = "Add files for an OpenBot workflow output [skip ci]";

/** One linked file: on the branch, or at its own address when it could not be copied. */
interface FileLink {
  name: string;
  url: string;
  image: boolean;
}

/** The name of a file in the branch: its place in the list, then only characters that need no escape. */
function branchFileName(name: string, index: number): string {
  const safe = name
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^[.-]+/u, "")
    .slice(-FILE_NAME_LIMIT);
  return `${index + 1}-${safe || "file"}`;
}

/** The address of a file of the source, or null when it is not an `https` address. */
function sourceUrl(file: WorkflowGitHubFile): string | null {
  try {
    const url = new URL(file.url);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The link of a file at its own address, or null when that is not an `https` address. */
function ownLink(file: WorkflowGitHubFile): FileLink | null {
  const url = sourceUrl(file);
  return url ? { name: file.name, url, image: file.contentType.startsWith("image/") } : null;
}

/** The Markdown of the links: an image shows in the text, another file is a link. */
function filesMarkdown(links: readonly FileLink[]): string {
  return links
    .map((link) => {
      const name = link.name.replace(/[\\[\]\r\n]/gu, (character) => (character.trim() ? `\\${character}` : " "));
      return `${link.image ? "!" : ""}[${name}](<${link.url}>)`;
    })
    .join("\n\n");
}

/**
 * The text with the links of its files below it, in GitHub's limit. When the links are too long, the
 * last links go, not a part of a link.
 */
function withFiles(body: string, links: readonly FileLink[]): string {
  let kept = links.length;
  while (kept > 0 && filesMarkdown(links.slice(0, kept)).length > FILES_SECTION_LIMIT) kept -= 1;
  const section = filesMarkdown(links.slice(0, kept));
  if (!section) return body;
  const room = Math.max(0, GITHUB_BODY_LIMIT - section.length - 2);
  return [body.slice(0, room).trimEnd(), section].filter(Boolean).join("\n\n").slice(0, GITHUB_BODY_LIMIT);
}

/** The tokens for one repository: the user's, and the app's where the user can push. */
interface GitHubRepositoryTokens {
  user: string;
  bot: string | null;
}

export interface GitHubRestOptions {
  fetch: GitHubFetch;
  /** Null while the GitHub connection is not active. */
  tokens: (repository: string) => Effect.Effect<GitHubRepositoryTokens | null, GitHubOperationError>;
  /**
   * The bytes of a file that a change links, such as a Discord attachment. Without it, or when it fails,
   * the text links the file at its own address.
   */
  download?: (url: string, maxBytes: number) => Effect.Effect<Uint8Array, MessagingAdapterError>;
}

const createdSchema = z.object({ id: z.number(), html_url: z.string().nullish() });
const issueSchema = z.object({ number: z.number(), html_url: z.string().nullish() });
const labelsSchema = z.array(z.object({ name: z.string().min(1), color: z.string() }));
const assigneesSchema = z.array(z.object({ login: z.string().min(1) }));
const messageSchema = z.object({ message: z.string() });
const shaSchema = z.object({ sha: z.string().min(1) });
const refSchema = z.object({ object: shaSchema });
const commitSchema = z.object({ sha: z.string().min(1), tree: shaSchema });

type Failure = WorkflowGitHubApiFailure;

/** When the comment or the item of a recent event was made, as GitHub's ISO time. */
function createdAt(candidate: WorkflowGitHubRecentEvent): string {
  const subject = candidate.body.comment ?? candidate.body.issue ?? candidate.body.pull_request;
  return isDynamicRecord(subject) && typeof subject.created_at === "string" ? subject.created_at : "";
}

const failure = (code: Failure["code"], message: string): Failure => ({ code, message });

/** A response that is not a success, as the step shows it. GitHub's own words go through redaction. */
function httpFailure(status: number, body: unknown, rateLimited: boolean): Failure {
  const parsed = messageSchema.safeParse(body);
  const message = parsed.success ? redactText(parsed.data.message).slice(0, DETAIL_LIMIT) : `HTTP ${status}`;
  if (status === 401) return failure("notConnected", sourceText("error.workflow.githubNotConnected"));
  if (status === 403 && !rateLimited) {
    if (/\blocked\b/iu.test(message)) return failure("locked", sourceText("error.workflow.githubLocked"));
    return failure("noWrite", sourceText("error.workflow.githubNoWrite"));
  }
  if (status === 404 || status === 410) return failure("noAccess", sourceText("error.workflow.githubNoAccess"));
  // A server error can come after GitHub made the change.
  if (status >= 500) return failure("unreachable", sourceText("error.workflow.githubUnreachable"));
  return failure("invalid", sourceText("error.workflow.githubRefused", { detail: message }));
}

/** The workflow calls to GitHub, over `fetch`, with the connector's tokens. */
export function createGitHubRest(options: GitHubRestOptions): WorkflowGitHubApi {
  const tokens = (repository: string) =>
    options.tokens(repository).pipe(
      // Nothing went to GitHub, so the step can say so plainly.
      Effect.mapError(() => failure("notSent", sourceText("error.workflow.githubUnreachable"))),
      Effect.flatMap((found) =>
        found
          ? Effect.succeed(found)
          : Effect.fail(failure("notConnected", sourceText("error.workflow.githubNotConnected"))),
      ),
    );

  /** One call. Answers the parsed body, or null for an empty one. */
  const call = Effect.fn("GitHubRest.call")(function* (
    token: string,
    method: string,
    path: string,
    body?: DynamicRecord,
    allowed: readonly number[] = [],
    timeoutMs = GITHUB_REQUEST_TIMEOUT_MS,
  ): Effect.fn.Return<unknown, Failure> {
    const response = yield* githubCall((signal) =>
      options.fetch(`${API}${path}`, {
        method,
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "OpenBot",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    ).pipe(Effect.mapError(() => failure("unreachable", sourceText("error.workflow.githubUnreachable"))));
    const json = yield* githubCall(() => response.text()).pipe(
      Effect.map((text) => {
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return null;
        }
      }),
      Effect.mapError(() => failure("unreachable", sourceText("error.workflow.githubUnreachable"))),
    );
    if (response.ok || allowed.includes(response.status)) return json;
    return yield* Effect.fail(
      httpFailure(response.status, json, response.headers.get("x-ratelimit-remaining") === "0"),
    );
  });

  const parse = <T>(schema: z.ZodType<T>, value: unknown) => {
    const parsed = schema.safeParse(value);
    return parsed.success
      ? Effect.succeed(parsed.data)
      : // GitHub made the change; only its answer is not as expected.
        Effect.fail(failure("unreachable", sourceText("error.workflow.githubUnreachable")));
  };

  /**
   * Copies the files to the files branch in one commit, and answers their links. A file that is too
   * large, that cannot be read or that GitHub refuses keeps its own address; so does each file when the
   * commit fails, such as in an empty repository or under a rule that protects every branch. A second
   * try of one change writes the same paths again in a new commit, and the links of each try stay.
   */
  const copyFiles = Effect.fn("GitHubRest.copyFiles")(function* (
    token: string,
    repository: string,
    files: WorkflowGitHubFiles,
  ): Effect.fn.Return<FileLink[], Failure> {
    const repo = `/repos/${repository}`;
    const own = files.files.map(ownLink);
    const download = options.download;
    if (!download) return own.filter((link) => link !== null);
    const copied = new Map<number, string>();
    const entries: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
    let total = 0;
    for (const [index, file] of files.files.entries()) {
      const room = Math.min(FILE_BYTES_LIMIT, FILES_BYTES_LIMIT - total);
      if (file.size > room || !own[index]) continue;
      const bytes = yield* download(file.url, room).pipe(Effect.timeout(FILE_TRANSFER_TIMEOUT_MS), Effect.option);
      if (Option.isNone(bytes) || bytes.value.byteLength === 0 || bytes.value.byteLength > room) continue;
      // A file of 25 MB is about 33 MB of JSON, which a slow upload cannot send in the usual deadline.
      const blob = yield* call(
        token,
        "POST",
        `${repo}/git/blobs`,
        { content: Buffer.from(bytes.value).toString("base64"), encoding: "base64" },
        [],
        FILE_TRANSFER_TIMEOUT_MS,
      ).pipe(
        Effect.flatMap((answer) => parse(shaSchema, answer)),
        Effect.option,
      );
      if (Option.isNone(blob)) continue;
      total += bytes.value.byteLength;
      const path = `${files.folder}/${branchFileName(file.name, index)}`;
      entries.push({ path, mode: "100644", type: "blob", sha: blob.value.sha });
      copied.set(index, path);
    }
    if (entries.length === 0) return own.filter((link) => link !== null);
    // A run of another output can move the branch at the same time: the second try builds on its commit.
    let commit: string | null = null;
    for (let attempt = 0; attempt < 2 && !commit; attempt += 1) {
      const head = refSchema.safeParse(
        yield* call(token, "GET", `${repo}/git/ref/heads/${FILES_BRANCH}`, undefined, [404]),
      );
      const parent = head.success ? head.data.object.sha : null;
      const base = parent
        ? yield* call(token, "GET", `${repo}/git/commits/${parent}`).pipe(
            Effect.flatMap((answer) => parse(commitSchema, answer)),
          )
        : null;
      const tree = yield* call(token, "POST", `${repo}/git/trees`, {
        ...(base ? { base_tree: base.tree.sha } : {}),
        tree: entries,
      }).pipe(Effect.flatMap((answer) => parse(shaSchema, answer)));
      const made = yield* call(token, "POST", `${repo}/git/commits`, {
        message: FILES_COMMIT_MESSAGE,
        tree: tree.sha,
        parents: parent ? [parent] : [],
      }).pipe(Effect.flatMap((answer) => parse(shaSchema, answer)));
      const moved = parent
        ? yield* call(token, "PATCH", `${repo}/git/refs/heads/${FILES_BRANCH}`, { sha: made.sha, force: false }, [422])
        : yield* call(token, "POST", `${repo}/git/refs`, { ref: `refs/heads/${FILES_BRANCH}`, sha: made.sha }, [422]);
      if (refSchema.safeParse(moved).success) commit = made.sha;
    }
    if (!commit) return own.filter((link) => link !== null);
    return own.flatMap((link, index) => {
      if (!link) return [];
      const path = copied.get(index);
      if (!path) return [link];
      const encoded = path.split("/").map(encodeURIComponent).join("/");
      // `?raw=true` shows the file itself, also to a person who can read a private repository.
      return [{ ...link, url: `https://github.com/${repository}/blob/${commit}/${encoded}?raw=true` }];
    });
  });

  /**
   * The change with the links of its files in its text, and no files. A file that cannot be copied does
   * not stop the issue or the comment: it keeps its own link.
   */
  const attachFiles = (change: WorkflowGitHubChange): Effect.Effect<WorkflowGitHubChange> => {
    const files = change.files;
    if (!files) return Effect.succeed(change);
    const links =
      files.files.length === 0
        ? Effect.succeed<FileLink[]>([])
        : tokens(change.repository).pipe(
            Effect.flatMap((found) =>
              found.bot
                ? copyFiles(found.bot, change.repository, files)
                : Effect.fail(failure("noWrite", sourceText("error.workflow.githubNoWrite"))),
            ),
            Effect.catch(() => Effect.succeed(files.files.flatMap((file) => ownLink(file) ?? []))),
          );
    return links.pipe(Effect.map((found) => ({ ...change, body: withFiles(change.body, found), files: null })));
  };

  const change = Effect.fn("GitHubRest.change")(function* (
    change: WorkflowGitHubChange,
  ): Effect.fn.Return<WorkflowGitHubChangeResult, Failure> {
    const found = yield* tokens(change.repository);
    // A change is the app's, so GitHub shows it as the app and the loop guard knows its events.
    if (!found.bot) return yield* Effect.fail(failure("noWrite", sourceText("error.workflow.githubNoWrite")));
    const token = found.bot;
    const repo = `/repos/${change.repository}`;
    const item = `${repo}/issues/${change.number ?? 0}`;
    const itemUrl = `https://github.com/${change.repository}/issues/${change.number ?? 0}`;
    const done = (url: string | null = itemUrl): WorkflowGitHubChangeResult => ({ created: null, url });
    switch (change.action) {
      case "comment": {
        const answer = yield* parse(
          createdSchema,
          yield* call(token, "POST", `${item}/comments`, { body: change.body }),
        );
        return { created: { kind: "comment", id: answer.id }, url: answer.html_url ?? itemUrl };
      }
      case "label.add":
        yield* call(token, "POST", `${item}/labels`, { labels: change.labels });
        return done();
      case "label.remove":
        // A label that the item does not have is removed already.
        for (const label of change.labels)
          yield* call(token, "DELETE", `${item}/labels/${encodeURIComponent(label)}`, undefined, [404]);
        return done();
      case "assign":
        yield* call(token, "POST", `${item}/assignees`, { assignees: change.people });
        return done();
      case "review.request":
        yield* call(token, "POST", `${repo}/pulls/${change.number ?? 0}/requested_reviewers`, {
          reviewers: change.people,
        });
        return done();
      case "review.approve":
      case "review.changes": {
        const answer = yield* parse(
          createdSchema,
          yield* call(token, "POST", `${repo}/pulls/${change.number ?? 0}/reviews`, {
            event: change.action === "review.approve" ? "APPROVE" : "REQUEST_CHANGES",
            ...(change.body ? { body: change.body } : {}),
          }),
        );
        return { created: { kind: "review", id: answer.id }, url: answer.html_url ?? itemUrl };
      }
      case "close":
        yield* call(token, "PATCH", item, { state: "closed", state_reason: GITHUB_STATE_REASONS[change.reason] });
        return done();
      case "reopen":
        yield* call(token, "PATCH", item, { state: "open" });
        return done();
      case "issue.create": {
        const answer = yield* parse(
          issueSchema,
          yield* call(token, "POST", `${repo}/issues`, {
            title: change.title,
            body: change.body,
            ...(change.labels.length > 0 ? { labels: change.labels } : {}),
          }),
        );
        return { created: { kind: "issue", number: answer.number }, url: answer.html_url ?? null };
      }
    }
  });

  /** Every page of a list, up to the option limit. */
  const pages = Effect.fn("GitHubRest.pages")(function* <T>(
    token: string,
    path: string,
    schema: z.ZodType<T[]>,
  ): Effect.fn.Return<T[], Failure> {
    const all: T[] = [];
    for (let page = 1; all.length < WORKFLOW_GITHUB_OPTION_LIMIT; page += 1) {
      const answer = yield* parse(schema, yield* call(token, "GET", `${path}?per_page=${PAGE_SIZE}&page=${page}`));
      all.push(...answer);
      if (answer.length < PAGE_SIZE) break;
    }
    return all.slice(0, WORKFLOW_GITHUB_OPTION_LIMIT);
  });

  const repositoryOptions = Effect.fn("GitHubRest.options")(function* (
    repository: string,
  ): Effect.fn.Return<WorkflowGitHubRepositoryOptions, Failure> {
    const found = yield* tokens(repository);
    const token = found.bot ?? found.user;
    const labels: WorkflowGitHubLabel[] = (yield* pages(token, `/repos/${repository}/labels`, labelsSchema)).map(
      (label) => ({ name: label.name, color: label.color }),
    );
    const people = (yield* pages(token, `/repos/${repository}/assignees`, assigneesSchema)).map(
      (person) => person.login,
    );
    return { labels, people };
  });

  const records = (value: unknown): DynamicRecord[] => (Array.isArray(value) ? value.filter(isDynamicRecord) : []);

  const recentEvents = Effect.fn("GitHubRest.recentEvents")(function* (
    repository: string,
    event: WorkflowGitHubEvent,
  ): Effect.fn.Return<WorkflowGitHubRecentEvent[], Failure> {
    const found = yield* tokens(repository);
    const token = found.bot ?? found.user;
    const repo = `/repos/${repository}`;
    const list = (path: string, query: string) =>
      call(token, "GET", `${repo}/${path}?per_page=${RECENT_LIMIT}&${query}`).pipe(Effect.map(records));
    // The REST answers are close to the App's bodies: the item is the subject, and its author the sender.
    const shape = (name: string, action: string, subject: DynamicRecord, extra: DynamicRecord = {}) => {
      const pullRequest = name === "pull_request" || name === "pull_request_review";
      return {
        event: name,
        body: {
          action,
          repository: { full_name: repository },
          sender: subject.user,
          [pullRequest ? "pull_request" : "issue"]: subject,
          ...extra,
        },
      };
    };
    const isIssue = (item: DynamicRecord) => !isDynamicRecord(item.pull_request);
    const kindOf = (item: DynamicRecord) => (isIssue(item) ? "issues" : "pull_request");

    switch (event) {
      case "issue.opened":
        return (yield* list("issues", "state=all&sort=created&direction=desc"))
          .filter(isIssue)
          .map((issue) => shape("issues", "opened", issue));
      case "issue.closed":
        return (yield* list("issues", "state=closed&sort=updated&direction=desc"))
          .filter(isIssue)
          .map((issue) => shape("issues", "closed", issue));
      case "issue.labeled":
        return (yield* list("issues", "state=all&sort=updated&direction=desc"))
          .filter(isIssue)
          .flatMap((issue) => records(issue.labels).map((label) => shape("issues", "labeled", issue, { label })));
      case "assigned":
        return (yield* list("issues", "state=all&sort=updated&direction=desc&assignee=*")).flatMap((item) =>
          records(item.assignees).map((assignee) => shape(kindOf(item), "assigned", item, { assignee })),
        );
      case "pr.opened":
        return (yield* list("pulls", "state=all&sort=created&direction=desc")).map((pull) =>
          shape("pull_request", "opened", pull),
        );
      case "pr.updated":
        return (yield* list("pulls", "state=open&sort=updated&direction=desc")).map((pull) =>
          shape("pull_request", "synchronize", pull),
        );
      case "pr.reviewRequested":
        return (yield* list("pulls", "state=open&sort=updated&direction=desc")).flatMap((pull) =>
          records(pull.requested_reviewers).map((reviewer) =>
            shape("pull_request", "review_requested", pull, { requested_reviewer: reviewer }),
          ),
        );
      case "pr.merged":
        return (yield* list("pulls", "state=closed&sort=updated&direction=desc"))
          .filter((pull) => typeof pull.merged_at === "string")
          .map((pull) => shape("pull_request", "closed", { ...pull, merged: true }));
      case "pr.reviewSubmitted": {
        const found: WorkflowGitHubRecentEvent[] = [];
        const pulls = (yield* list("pulls", "state=all&sort=updated&direction=desc")).slice(0, RECENT_DETAIL_LIMIT);
        for (const pull of pulls) {
          const reviews = records(yield* call(token, "GET", `${repo}/pulls/${String(pull.number)}/reviews`));
          const review = reviews.at(-1);
          // The reviewer is the sender of a review.
          if (review) found.push(shape("pull_request_review", "submitted", pull, { review, sender: review.user }));
        }
        return found;
      }
      case "pr.checksFailed": {
        const found: WorkflowGitHubRecentEvent[] = [];
        const pulls = (yield* list("pulls", "state=open&sort=updated&direction=desc")).slice(0, RECENT_DETAIL_LIMIT);
        for (const pull of pulls) {
          const head = isDynamicRecord(pull.head) ? pull.head : null;
          if (typeof head?.sha !== "string") continue;
          const answer = yield* call(token, "GET", `${repo}/commits/${head.sha}/check-suites`);
          const suites = isDynamicRecord(answer) ? records(answer.check_suites) : [];
          const failed = suites.find((suite) => suite.conclusion === "failure" || suite.conclusion === "timed_out");
          if (!failed) continue;
          found.push({
            event: "check_suite",
            body: {
              action: "completed",
              repository: { full_name: repository },
              sender: pull.user,
              check_suite: {
                ...failed,
                head_branch: head.ref,
                pull_requests: [{ number: pull.number, base: pull.base }],
              },
            },
          });
        }
        return found;
      }
      case "comment":
      case "mention": {
        const found: WorkflowGitHubRecentEvent[] = [];
        const comments = (yield* call(
          token,
          "GET",
          `${repo}/issues/comments?per_page=${RECENT_LIMIT}&sort=created&direction=desc`,
        ).pipe(Effect.map(records))).slice(0, RECENT_DETAIL_LIMIT);
        const issues = new Map<string, DynamicRecord | null>();
        for (const comment of comments) {
          const url = typeof comment.issue_url === "string" ? comment.issue_url : null;
          if (!url?.startsWith(`${API}${repo}/issues/`)) continue;
          if (!issues.has(url)) {
            const answer = yield* call(token, "GET", url.slice(API.length));
            issues.set(url, isDynamicRecord(answer) ? answer : null);
          }
          const issue = issues.get(url);
          if (!issue) continue;
          found.push({
            event: "issue_comment",
            body: { action: "created", repository: { full_name: repository }, sender: comment.user, issue, comment },
          });
        }
        if (event === "comment") return found;
        // A mention is also in the text of a new issue or pull request.
        const opened = (yield* list("issues", "state=all&sort=created&direction=desc")).map((item) =>
          shape(kindOf(item), "opened", item),
        );
        return [...found, ...opened].sort((left, right) => createdAt(right).localeCompare(createdAt(left)));
      }
    }
  });

  return { attachFiles, change, options: repositoryOptions, recentEvents };
}

/**
 * What the workflow editor offers from this host's GitHub connection: the repositories, and the labels
 * and people of one of them. Only an owner or admin reads it, as it shows what the sign-in reaches.
 */
export interface WorkflowGitHubDirectory {
  catalog(): Effect.Effect<WorkflowGitHubCatalog, GitHubOperationError>;
  /** A GitHub failure is a refusal of the workflow store, with the failure's message for the user. */
  options(repository: string): Effect.Effect<WorkflowGitHubRepositoryOptions, GitHubOperationError>;
}

export function workflowGitHubDirectory(
  catalog: () => Effect.Effect<WorkflowGitHubCatalog, GitHubOperationError>,
  api: Pick<WorkflowGitHubApi, "options">,
): WorkflowGitHubDirectory {
  return {
    catalog,
    options: (repository) =>
      api.options(repository).pipe(
        Effect.mapError(
          (failure) =>
            new GitHubOperationError({
              cause: new WorkflowStoreError({ code: "refused", message: failure.message }),
            }),
        ),
      ),
  };
}
