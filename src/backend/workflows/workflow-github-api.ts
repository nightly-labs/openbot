import type {
  WorkflowGitHubAction,
  WorkflowGitHubCloseReason,
  WorkflowGitHubEvent,
  WorkflowGitHubRepositoryOptions,
} from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import type { Effect } from "effect";

export const GITHUB_BODY_LIMIT = 65_536;

export interface WorkflowGitHubChange {
  action: WorkflowGitHubAction;
  repository: string;
  number: number | null;
  body: string;
  title: string;
  labels: string[];
  people: string[];
  reason: WorkflowGitHubCloseReason;
  files: WorkflowGitHubFiles | null;
}

export interface WorkflowGitHubFile {
  name: string;
  contentType: string;
  size: number;
  url: string;
}

export interface WorkflowGitHubFiles {
  folder: string;
  files: WorkflowGitHubFile[];
}

export interface WorkflowGitHubChangeResult {
  created: { kind: "comment" | "review"; id: number } | { kind: "issue"; number: number } | null;
  url: string | null;
}

const WORKFLOW_GITHUB_API_FAILURES = [
  "notConnected",
  "notSent",
  "noAccess",
  "noWrite",
  "locked",
  "invalid",
  "unreachable",
] as const;

export interface WorkflowGitHubApiFailure {
  readonly code: (typeof WORKFLOW_GITHUB_API_FAILURES)[number];
  readonly message: string;
}

export interface WorkflowGitHubRecentEvent {
  event: string;
  body: DynamicRecord;
}

export interface WorkflowGitHubApi {
  attachFiles(change: WorkflowGitHubChange): Effect.Effect<WorkflowGitHubChange>;
  change(change: WorkflowGitHubChange): Effect.Effect<WorkflowGitHubChangeResult, WorkflowGitHubApiFailure>;
  options(repository: string): Effect.Effect<WorkflowGitHubRepositoryOptions, WorkflowGitHubApiFailure>;
  recentEvents(
    repository: string,
    event: WorkflowGitHubEvent,
  ): Effect.Effect<WorkflowGitHubRecentEvent[], WorkflowGitHubApiFailure>;
}

export const REPEATABLE_GITHUB_ACTIONS: readonly WorkflowGitHubAction[] = [
  "label.add",
  "label.remove",
  "assign",
  "review.request",
  "close",
  "reopen",
];
