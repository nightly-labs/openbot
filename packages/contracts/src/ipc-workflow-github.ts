import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";
import { GITHUB_REPOSITORY_NAME_PATTERN } from "./signal-protocol/github-route";

/**
 * GitHub triggers and outputs of workflows. A GitHub trigger starts a run when the OpenBot GitHub App
 * sends an event of a repository; a GitHub output acts on GitHub as the App's bot. The node fields are
 * in `WorkflowFields`. These types cross the Team API only through `workflows-github-v1`.
 */

/** The events that a GitHub trigger can start on. */
export const WORKFLOW_GITHUB_EVENTS = [
  "issue.opened",
  "issue.closed",
  "issue.labeled",
  "pr.opened",
  "pr.updated",
  "pr.reviewRequested",
  "pr.reviewSubmitted",
  "pr.checksFailed",
  "pr.merged",
  "comment",
  "mention",
  "assigned",
] as const;
export type WorkflowGitHubEvent = (typeof WORKFLOW_GITHUB_EVENTS)[number];

/** The filters of a GitHub trigger, besides its labels. `title` and `branch` read a field of the same name. */
export const WORKFLOW_GITHUB_FILTERS = ["notBot", "firstTime", "title", "branch"] as const;
export type WorkflowGitHubFilter = (typeof WORKFLOW_GITHUB_FILTERS)[number];

/** What a GitHub output can do. */
export const WORKFLOW_GITHUB_ACTIONS = [
  "comment",
  "label.add",
  "label.remove",
  "assign",
  "review.request",
  "review.approve",
  "review.changes",
  "close",
  "reopen",
  "issue.create",
] as const;
export type WorkflowGitHubAction = (typeof WORKFLOW_GITHUB_ACTIONS)[number];

/** The actions that GitHub has only on pull requests. */
export const WORKFLOW_GITHUB_PULL_REQUEST_ACTIONS = [
  "review.request",
  "review.approve",
  "review.changes",
] as const satisfies readonly WorkflowGitHubAction[];

export const WORKFLOW_GITHUB_CLOSE_REASONS = ["completed", "notPlanned"] as const;
export type WorkflowGitHubCloseReason = (typeof WORKFLOW_GITHUB_CLOSE_REASONS)[number];

/** What an event can start on: issues only, pull requests only, or both. */
export type WorkflowGitHubItemKind = "issue" | "pullRequest" | "both";

export function workflowGitHubEventItemKind(event: WorkflowGitHubEvent): WorkflowGitHubItemKind {
  if (event.startsWith("issue.")) return "issue";
  return event.startsWith("pr.") ? "pullRequest" : "both";
}

/** The value of a list field, such as `labels` or `filters`: one name a line, without empty lines. */
export function workflowListField(value: unknown): string[] {
  if (!isString(value)) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** `owner/name`, in the characters that GitHub allows. */
export function isGitHubRepositoryName(value: unknown): value is string {
  return isString(value) && GITHUB_REPOSITORY_NAME_PATTERN.test(value);
}

/** An issue or a pull request. */
export interface WorkflowGitHubItem {
  repository: string;
  number: number;
  pullRequest: boolean;
  title: string;
}

export const WORKFLOW_GITHUB_DELIVERY_OUTCOMES = ["started", "waiting", "skipped"] as const;
export type WorkflowGitHubDeliveryOutcome = (typeof WORKFLOW_GITHUB_DELIVERY_OUTCOMES)[number];

/**
 * Why an event did not start a run:
 * - `filter`: a filter of the trigger refused it.
 * - `self`: a step of this workflow caused it.
 * - `chain`: runs that the bot caused went on too long on one item.
 * - `offline`: the host was offline, so GitHub's events of that time are lost.
 */
export const WORKFLOW_GITHUB_SKIP_REASONS = ["filter", "self", "chain", "offline"] as const;
export type WorkflowGitHubSkipReason = (typeof WORKFLOW_GITHUB_SKIP_REASONS)[number];

/** One event that GitHub sent to a trigger, or a time when the host could not get them. */
export interface WorkflowGitHubDelivery {
  id: string;
  nodeId: string;
  event: WorkflowGitHubEvent;
  /** Null for a time when the host was offline. */
  item: WorkflowGitHubItem | null;
  receivedAt: string;
  outcome: WorkflowGitHubDeliveryOutcome;
  /** Set only when the event was skipped. */
  reason: WorkflowGitHubSkipReason | null;
  /** The run that the event started. */
  runId: string | null;
}

/** The item of a run that a GitHub event started. */
export interface WorkflowGitHubRunItem {
  runId: string;
  item: WorkflowGitHubItem;
}

/** The newest events of the GitHub triggers of a workflow, newest first, and the items of their runs. */
export interface WorkflowGitHubHistory {
  deliveries: WorkflowGitHubDelivery[];
  runs: WorkflowGitHubRunItem[];
}

/** A repository that the host's GitHub connection reaches. */
export interface WorkflowGitHubRepository {
  /** `owner/name`. */
  fullName: string;
  private: boolean;
  /** Whether the App can change issues and pull requests there. */
  canWrite: boolean;
  /** Whether the App's installation sends the events that triggers need. */
  events: boolean;
}

/** The GitHub connection of the host, as the trigger and output nodes need it. */
export interface WorkflowGitHubCatalog {
  connected: boolean;
  /** Sorted by `fullName`. */
  repositories: WorkflowGitHubRepository[];
}

export interface WorkflowGitHubLabel {
  name: string;
  /** Six hexadecimal digits, as GitHub gives it. */
  color: string;
}

/** The labels and the people that an output can choose in one repository. */
export interface WorkflowGitHubRepositoryOptions {
  labels: WorkflowGitHubLabel[];
  /** The logins that can be assigned or asked for a review. */
  people: string[];
}

export interface WorkflowGitHubRepositoryInput {
  repository: string;
}

/** Runs a GitHub trigger with the newest item that matches it, as GitHub has it now. */
export interface WorkflowGitHubLastEventInput {
  workflowId: string;
  nodeId: string;
  /** Repeats of one request start one run. */
  requestId: string;
}

/** The most labels or people that a repository's options carry. */
export const WORKFLOW_GITHUB_OPTION_LIMIT = 500;
/** The newest events that a GitHub trigger keeps. */
export const WORKFLOW_GITHUB_DELIVERY_LIMIT = 50;

const LABEL_NAME = 100;
const LOGIN = 39;
const TITLE = 1_024;

function isItemNumber(value: unknown): value is number {
  return isNumber(value) && Number.isSafeInteger(value) && value > 0;
}

function isItem(value: unknown): value is WorkflowGitHubItem {
  return (
    isDynamicRecord(value) &&
    isGitHubRepositoryName(value.repository) &&
    isItemNumber(value.number) &&
    isBoolean(value.pullRequest) &&
    isBoundedString(value.title, TITLE)
  );
}

function isDelivery(value: unknown): value is WorkflowGitHubDelivery {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.id) &&
    isIdentifier(value.nodeId) &&
    isOneOf(WORKFLOW_GITHUB_EVENTS, value.event) &&
    (value.item === null || isItem(value.item)) &&
    isString(value.receivedAt) &&
    isOneOf(WORKFLOW_GITHUB_DELIVERY_OUTCOMES, value.outcome) &&
    (value.reason === null || isOneOf(WORKFLOW_GITHUB_SKIP_REASONS, value.reason)) &&
    (value.runId === null || isIdentifier(value.runId))
  );
}

export function isWorkflowGitHubHistory(value: unknown): value is WorkflowGitHubHistory {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.deliveries) &&
    value.deliveries.every(isDelivery) &&
    Array.isArray(value.runs) &&
    value.runs.every((run) => isDynamicRecord(run) && isIdentifier(run.runId) && isItem(run.item))
  );
}

export function isWorkflowGitHubCatalog(value: unknown): value is WorkflowGitHubCatalog {
  return (
    isDynamicRecord(value) &&
    isBoolean(value.connected) &&
    Array.isArray(value.repositories) &&
    value.repositories.every(
      (repository) =>
        isDynamicRecord(repository) &&
        isGitHubRepositoryName(repository.fullName) &&
        isBoolean(repository.private) &&
        isBoolean(repository.canWrite) &&
        isBoolean(repository.events),
    )
  );
}

export function isWorkflowGitHubRepositoryOptions(value: unknown): value is WorkflowGitHubRepositoryOptions {
  return (
    isDynamicRecord(value) &&
    Array.isArray(value.labels) &&
    value.labels.length <= WORKFLOW_GITHUB_OPTION_LIMIT &&
    value.labels.every(
      (label) =>
        isDynamicRecord(label) &&
        isBoundedString(label.name, LABEL_NAME) &&
        isString(label.color) &&
        /^[0-9a-fA-F]{6}$/u.test(label.color),
    ) &&
    Array.isArray(value.people) &&
    value.people.length <= WORKFLOW_GITHUB_OPTION_LIMIT &&
    value.people.every((login) => isBoundedString(login, LOGIN) && login.length > 0)
  );
}

export function isWorkflowGitHubRepositoryInput(value: unknown): value is WorkflowGitHubRepositoryInput {
  return isDynamicRecord(value) && isGitHubRepositoryName(value.repository);
}

export function isWorkflowGitHubLastEventInput(value: unknown): value is WorkflowGitHubLastEventInput {
  return (
    isDynamicRecord(value) &&
    isIdentifier(value.workflowId) &&
    isIdentifier(value.nodeId) &&
    isIdentifier(value.requestId)
  );
}
