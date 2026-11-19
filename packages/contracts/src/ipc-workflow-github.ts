import { isBoundedString, isIdentifier } from "./ipc-bounded-values";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";
import { GITHUB_REPOSITORY_NAME_PATTERN } from "./signal-protocol/github-route";

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

export const WORKFLOW_GITHUB_FILTERS = ["notBot", "firstTime", "title", "branch"] as const;
export type WorkflowGitHubFilter = (typeof WORKFLOW_GITHUB_FILTERS)[number];

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

export const WORKFLOW_GITHUB_PULL_REQUEST_ACTIONS = [
  "review.request",
  "review.approve",
  "review.changes",
] as const satisfies readonly WorkflowGitHubAction[];

export const WORKFLOW_GITHUB_CLOSE_REASONS = ["completed", "notPlanned"] as const;
export type WorkflowGitHubCloseReason = (typeof WORKFLOW_GITHUB_CLOSE_REASONS)[number];

export type WorkflowGitHubItemKind = "issue" | "pullRequest" | "both";

export function workflowGitHubEventItemKind(event: WorkflowGitHubEvent): WorkflowGitHubItemKind {
  if (event.startsWith("issue.")) return "issue";
  return event.startsWith("pr.") ? "pullRequest" : "both";
}

export function workflowListField(value: unknown): string[] {
  if (!isString(value)) return [];
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isGitHubRepositoryName(value: unknown): value is string {
  return isString(value) && GITHUB_REPOSITORY_NAME_PATTERN.test(value);
}

export function workflowGitHubTriggerRepositories(fields: {
  readonly repository?: unknown;
  readonly repositories?: unknown;
}): string[] {
  const first = fields.repository;
  if (!isGitHubRepositoryName(first)) return [];
  const list = workflowListField(fields.repositories);
  if (list[0] !== first) return [first];
  const seen = new Set<string>();
  return list.filter((name) => {
    const key = name.toLowerCase();
    if (!isGitHubRepositoryName(name) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function workflowGitHubTriggerRepositoryFields(repositories: readonly string[]): {
  repository: string;
  repositories: string;
} {
  return { repository: repositories[0] ?? "", repositories: repositories.join("\n") };
}

export interface WorkflowGitHubItem {
  repository: string;
  number: number;
  pullRequest: boolean;
  title: string;
}

export const WORKFLOW_GITHUB_DELIVERY_OUTCOMES = ["started", "waiting", "skipped"] as const;
export type WorkflowGitHubDeliveryOutcome = (typeof WORKFLOW_GITHUB_DELIVERY_OUTCOMES)[number];

export const WORKFLOW_GITHUB_SKIP_REASONS = ["filter", "self", "chain", "offline", "refused"] as const;
export type WorkflowGitHubSkipReason = (typeof WORKFLOW_GITHUB_SKIP_REASONS)[number];

export interface WorkflowGitHubDelivery {
  id: string;
  nodeId: string;
  event: WorkflowGitHubEvent;
  item: WorkflowGitHubItem | null;
  receivedAt: string;
  outcome: WorkflowGitHubDeliveryOutcome;
  reason: WorkflowGitHubSkipReason | null;
  runId: string | null;
}

export interface WorkflowGitHubRunItem {
  runId: string;
  item: WorkflowGitHubItem;
}

export interface WorkflowGitHubHistory {
  deliveries: WorkflowGitHubDelivery[];
  runs: WorkflowGitHubRunItem[];
}

export interface WorkflowGitHubRepository {
  fullName: string;
  private: boolean;
  canWrite: boolean;
  events: boolean;
}

export interface WorkflowGitHubCatalog {
  connected: boolean;
  repositories: WorkflowGitHubRepository[];
}

export interface WorkflowGitHubLabel {
  name: string;
  color: string;
}

export interface WorkflowGitHubRepositoryOptions {
  labels: WorkflowGitHubLabel[];
  people: string[];
}

export interface WorkflowGitHubRepositoryInput {
  repository: string;
}

export interface WorkflowGitHubLastEventInput {
  workflowId: string;
  nodeId: string;
  requestId: string;
}

export const WORKFLOW_GITHUB_OPTION_LIMIT = 500;
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
