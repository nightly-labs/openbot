/**
 * What workflows need from GitHub, as the main process gives it: the changes of GitHub outputs, made as
 * OpenBot's bot, the labels and people of a repository, and its newest events for "Run with last event".
 * The backend keeps the rules (which item, which change, the loop guard); the adapter keeps the tokens.
 */

import type {
  WorkflowGitHubAction,
  WorkflowGitHubCloseReason,
  WorkflowGitHubEvent,
  WorkflowGitHubRepositoryOptions,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import type { Effect } from "effect";

/** One change that a GitHub output makes. */
export interface WorkflowGitHubChange {
  action: WorkflowGitHubAction;
  repository: string;
  /** The issue or the pull request; null for `issue.create`. */
  number: number | null;
  /** The text of a comment, a review or a new issue. */
  body: string;
  /** The title of a new issue. */
  title: string;
  labels: string[];
  /** The logins to assign, or to ask for a review. */
  people: string[];
  reason: WorkflowGitHubCloseReason;
}

/** What GitHub made: the comment, the review or the issue, when the change makes one. */
export interface WorkflowGitHubChangeResult {
  created: { kind: "comment" | "review"; id: number } | { kind: "issue"; number: number } | null;
  /** The page of what changed. */
  url: string | null;
}

/** `unreachable`: the call went out and no answer came, so GitHub may have made the change. `notSent`: nothing went out. */
const WORKFLOW_GITHUB_API_FAILURES = [
  "notConnected",
  "notSent",
  "noAccess",
  "noWrite",
  "locked",
  "invalid",
  "unreachable",
] as const;

/** A failure of a GitHub call; `message` is for the user, in `sourceText`. */
export interface WorkflowGitHubApiFailure {
  readonly code: (typeof WORKFLOW_GITHUB_API_FAILURES)[number];
  readonly message: string;
}

/** One event body, as the App would send it, made from what GitHub has now. */
export interface WorkflowGitHubRecentEvent {
  /** The `X-GitHub-Event` name. */
  event: string;
  body: DynamicRecord;
}

export interface WorkflowGitHubApi {
  change(change: WorkflowGitHubChange): Effect.Effect<WorkflowGitHubChangeResult, WorkflowGitHubApiFailure>;
  options(repository: string): Effect.Effect<WorkflowGitHubRepositoryOptions, WorkflowGitHubApiFailure>;
  /** The newest events of the repository that can be `event`, newest first. */
  recentEvents(
    repository: string,
    event: WorkflowGitHubEvent,
  ): Effect.Effect<WorkflowGitHubRecentEvent[], WorkflowGitHubApiFailure>;
}

/** The changes that a second call does not repeat, so a restart can send them again. */
export const REPEATABLE_GITHUB_ACTIONS: readonly WorkflowGitHubAction[] = [
  "label.add",
  "label.remove",
  "assign",
  "review.request",
  "close",
  "reopen",
];
