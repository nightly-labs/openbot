import {
  WORKFLOW_GITHUB_ACTIONS,
  WORKFLOW_GITHUB_CLOSE_REASONS,
  WORKFLOW_GITHUB_EVENTS,
  WORKFLOW_GITHUB_FILTERS,
  WORKFLOW_GITHUB_PULL_REQUEST_ACTIONS,
  type WorkflowGitHubAction,
  type WorkflowGitHubCatalog,
  type WorkflowGitHubCloseReason,
  type WorkflowGitHubDelivery,
  type WorkflowGitHubEvent,
  type WorkflowGitHubFilter,
  type WorkflowGitHubItem,
  type WorkflowGitHubRelayProblem,
  type WorkflowGitHubSkipReason,
  type WorkflowGraph,
  type WorkflowNode,
  workflowGitHubEventItemKind,
  workflowGitHubRelayProblem,
  workflowGitHubTriggerRepositories,
  workflowListField,
} from "@openbot/contracts/ipc";
import { isOneOf } from "@openbot/contracts/runtime-values";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { fieldOneOf, fieldText } from "./workflow-node-fields";

export const GITHUB_TRIGGER_DEFAULTS = { event: "issue.opened", filters: "notBot" } as const;
export const GITHUB_OUTPUT_DEFAULTS = { action: "comment" } as const;

export const GITHUB_EVENT_LABEL = {
  "issue.opened": "mobile.workflow.github.event.issue.opened",
  "issue.closed": "mobile.workflow.github.event.issue.closed",
  "issue.labeled": "mobile.workflow.github.event.issue.labeled",
  "pr.opened": "mobile.workflow.github.event.pr.opened",
  "pr.updated": "mobile.workflow.github.event.pr.updated",
  "pr.reviewRequested": "mobile.workflow.github.event.pr.reviewRequested",
  "pr.reviewSubmitted": "mobile.workflow.github.event.pr.reviewSubmitted",
  "pr.checksFailed": "mobile.workflow.github.event.pr.checksFailed",
  "pr.merged": "mobile.workflow.github.event.pr.merged",
  comment: "mobile.workflow.github.event.comment",
  mention: "mobile.workflow.github.event.mention",
  assigned: "mobile.workflow.github.event.assigned",
} as const satisfies Record<WorkflowGitHubEvent, MobileTextKey>;

export const GITHUB_ACTION_LABEL = {
  comment: "mobile.workflow.github.action.comment",
  "label.add": "mobile.workflow.github.action.label.add",
  "label.remove": "mobile.workflow.github.action.label.remove",
  assign: "mobile.workflow.github.action.assign",
  "review.request": "mobile.workflow.github.action.review.request",
  "review.approve": "mobile.workflow.github.action.review.approve",
  "review.changes": "mobile.workflow.github.action.review.changes",
  close: "mobile.workflow.github.action.close",
  reopen: "mobile.workflow.github.action.reopen",
  "issue.create": "mobile.workflow.github.action.issue.create",
} as const satisfies Record<WorkflowGitHubAction, MobileTextKey>;

export const GITHUB_FILTER_LABEL = {
  notBot: "mobile.workflow.github.filter.notBot",
  firstTime: "mobile.workflow.github.filter.firstTime",
  title: "mobile.workflow.github.filter.title",
  branch: "mobile.workflow.github.filter.branch",
} as const satisfies Record<WorkflowGitHubFilter, MobileTextKey>;

export const GITHUB_REASON_LABEL = {
  completed: "mobile.workflow.github.reason.completed",
  notPlanned: "mobile.workflow.github.reason.notPlanned",
} as const satisfies Record<WorkflowGitHubCloseReason, MobileTextKey>;

export const GITHUB_SKIP_LABEL = {
  filter: "mobile.workflow.github.skip.filter",
  self: "mobile.workflow.github.skip.self",
  chain: "mobile.workflow.github.skip.chain",
  offline: "mobile.workflow.github.skip.offline",
  refused: "mobile.workflow.github.skip.refused",
} as const satisfies Record<WorkflowGitHubSkipReason, MobileTextKey>;

export const SAME_REPOSITORY = "trigger";
export const AGENT_CHOOSES = "agent";

export type GitHubOutputItem = "event" | "input";
type GitHubLabelsFrom = "agent" | "list";

export interface GitHubTriggerSettings {
  repository: string;
  repositories: string[];
  event: WorkflowGitHubEvent;
  labels: string[];
  filterOptions: WorkflowGitHubFilter[];
  filters: WorkflowGitHubFilter[];
  titleText: string;
  branch: string;
}

export function githubTrigger(node: WorkflowNode | undefined): GitHubTriggerSettings {
  const event = fieldOneOf(node, "event", WORKFLOW_GITHUB_EVENTS, GITHUB_TRIGGER_DEFAULTS.event);
  const filterOptions = WORKFLOW_GITHUB_FILTERS.filter(
    (filter) => filter !== "branch" || workflowGitHubEventItemKind(event) === "pullRequest",
  );
  const filters = workflowListField(node?.fields.filters).filter((filter): filter is WorkflowGitHubFilter =>
    isOneOf(filterOptions, filter),
  );
  const repositories = workflowGitHubTriggerRepositories(node?.fields ?? {});
  return {
    repository: repositories[0] ?? fieldText(node, "repository"),
    repositories,
    event,
    labels: workflowListField(node?.fields.labels),
    filterOptions,
    filters,
    titleText: fieldText(node, "titleText"),
    branch: fieldText(node, "branch"),
  };
}

function githubTriggersBefore(graph: WorkflowGraph, nodeId: string): WorkflowNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const found: WorkflowNode[] = [];
  const seen = new Set([nodeId]);
  let layer = [nodeId];
  while (layer.length > 0) {
    const next: string[] = [];
    for (const edge of graph.edges) {
      if (!layer.includes(edge.to) || seen.has(edge.from)) continue;
      seen.add(edge.from);
      const node = byId.get(edge.from);
      if (node?.kind === "trigger" && node.fields.trigger === "github") found.push(node);
      else next.push(edge.from);
    }
    layer = next;
  }
  return found;
}

export interface GitHubOutputSettings {
  repository: string;
  target: string;
  item: GitHubOutputItem;
  action: WorkflowGitHubAction;
  labels: string[];
  labelsFrom: GitHubLabelsFrom;
  person: string;
  reason: WorkflowGitHubCloseReason;
  title: string;
  fromEvent: boolean;
  triggerEvent: WorkflowGitHubEvent;
  creates: boolean;
  noEvent: boolean;
  issuesOnly: boolean;
  pullRequestOnly: boolean;
  usesLabels: boolean;
  usesPerson: boolean;
  hasReason: boolean;
}

export function isPullRequestAction(action: WorkflowGitHubAction): boolean {
  return WORKFLOW_GITHUB_PULL_REQUEST_ACTIONS.some((value) => value === action);
}

export function githubOutput(node: WorkflowNode, graph: WorkflowGraph): GitHubOutputSettings {
  const trigger = githubTriggersBefore(graph, node.id)[0];
  const triggerSettings = githubTrigger(trigger);
  const fromEvent = trigger !== undefined;
  const repository = fieldText(node, "repository") || SAME_REPOSITORY;
  const storedItem = fieldText(node, "item");
  const item: GitHubOutputItem = storedItem === "input" ? "input" : "event";
  const action = fieldOneOf(node, "action", WORKFLOW_GITHUB_ACTIONS, GITHUB_OUTPUT_DEFAULTS.action);
  const reason = fieldOneOf(node, "reason", WORKFLOW_GITHUB_CLOSE_REASONS, "completed");
  const creates = action === "issue.create";
  const issuesOnly =
    fromEvent && !creates && item === "event" && workflowGitHubEventItemKind(triggerSettings.event) === "issue";
  return {
    repository,
    target: repository === SAME_REPOSITORY ? triggerSettings.repository : repository,
    item,
    action,
    labels: workflowListField(node.fields.labels),
    labelsFrom: fieldText(node, "labelsFrom") === "agent" ? "agent" : "list",
    person: fieldText(node, "person"),
    reason,
    title: fieldText(node, "title"),
    fromEvent,
    triggerEvent: triggerSettings.event,
    creates,
    noEvent: !fromEvent && (repository === SAME_REPOSITORY || (!creates && item === "event")),
    issuesOnly,
    pullRequestOnly: isPullRequestAction(action) && issuesOnly,
    usesLabels: action === "label.add" || action === "label.remove" || creates,
    usesPerson: action === "assign" || action === "review.request",
    hasReason:
      action === "close" &&
      !(fromEvent && item === "event" && workflowGitHubEventItemKind(triggerSettings.event) === "pullRequest"),
  };
}

export type GitHubAccessProblem = "missing" | "readOnly" | "eventsOff" | WorkflowGitHubRelayProblem;

export function githubAccessProblem(
  catalog: WorkflowGitHubCatalog | undefined,
  repository: string,
  need: { write: boolean; events: boolean },
): GitHubAccessProblem | null {
  if (!repository || repository === SAME_REPOSITORY || !catalog?.connected) return null;
  const name = repository.toLowerCase();
  const entry = catalog.repositories.find((candidate) => candidate.fullName.toLowerCase() === name);
  if (!entry) return "missing";
  if (need.write && !entry.canWrite) return "readOnly";
  if (need.events && !entry.events) return "eventsOff";
  return (need.events && workflowGitHubRelayProblem(catalog.relay, repository)) || null;
}

export const GITHUB_ACCESS_LABEL = {
  missing: "mobile.workflow.github.alert.missing",
  readOnly: "mobile.workflow.github.alert.readOnly",
  eventsOff: "mobile.workflow.github.alert.eventsOff",
  waiting: "mobile.workflow.github.alert.relayWaiting",
  unrouted: "mobile.workflow.github.alert.relayUnrouted",
} as const satisfies Record<GitHubAccessProblem, string>;

export function githubItemUrl(item: WorkflowGitHubItem): string {
  return `https://github.com/${item.repository}/${item.pullRequest ? "pull" : "issues"}/${item.number}`;
}

export function githubItemLabel(item: WorkflowGitHubItem): string {
  return `#${item.number} ${item.title}`;
}

export function sameGitHubItem(left: WorkflowGitHubItem, right: WorkflowGitHubItem): boolean {
  return left.number === right.number && left.repository.toLowerCase() === right.repository.toLowerCase();
}

export function triggerDeliveries(deliveries: readonly WorkflowGitHubDelivery[], nodeId: string) {
  return deliveries.filter((delivery) => delivery.nodeId === nodeId);
}
