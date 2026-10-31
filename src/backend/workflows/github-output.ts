/**
 * The rules of a GitHub output step: which repository and item it changes, the change its fields and its
 * input give, the question that lets a model choose labels or a person, and the keys that the loop guard
 * keeps for the change.
 */

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import {
  isGitHubRepositoryName,
  WORKFLOW_GITHUB_ACTIONS,
  WORKFLOW_GITHUB_CLOSE_REASONS,
  WORKFLOW_GITHUB_PULL_REQUEST_ACTIONS,
  type WorkflowGitHubItem,
  type WorkflowGitHubRepositoryOptions,
  type WorkflowGraph,
  type WorkflowNode,
  workflowListField,
} from "@openbot/contracts/ipc";
import { isOneOf, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { extractJsonObject, StructuredOutputError } from "../structured-output";
import { EXTERNAL_EVENT_END, EXTERNAL_EVENT_START } from "../webhook-trigger";
import { githubObjectKey, githubTriggerRepository } from "./github-matching";
import type { WorkflowGitHubChange, WorkflowGitHubChangeResult } from "./workflow-github-api";
import { fieldText, inputText } from "./workflow-walk";

/** GitHub refuses a longer issue title. */
const TITLE_LIMIT = 256;
/** GitHub refuses a longer comment, review or issue text. */
const BODY_LIMIT = 65_536;

/** What a model chooses for the output, when its fields say "Agent chooses". */
export interface GitHubOutputChoice {
  labels: boolean;
  person: boolean;
}

export type GitHubOutputPlan =
  | { kind: "change"; change: WorkflowGitHubChange; choose: GitHubOutputChoice }
  /** Nothing to say: a comment with no text makes no change, as a quiet routine run posts nothing. */
  | { kind: "quiet" }
  | { kind: "failed"; error: string };

/**
 * The change of an output step. `graph` and `runItem` are those of its run: the trigger's repository and
 * the item of the event that started it.
 */
export function githubOutputPlan(
  node: WorkflowNode,
  input: string,
  graph: WorkflowGraph | null,
  triggerNodeId: string | null,
  runItem: WorkflowGitHubItem | null,
): GitHubOutputPlan {
  const action = node.fields.action;
  if (!isOneOf(WORKFLOW_GITHUB_ACTIONS, action))
    return { kind: "failed", error: sourceText("error.workflow.githubActionMissing") };
  const repository = outputRepository(node, graph, triggerNodeId);
  if (!repository) return { kind: "failed", error: sourceText("error.workflow.githubRepositoryMissing") };

  let number: number | null = null;
  if (action !== "issue.create") {
    const item = outputItem(node, input, repository, runItem);
    if (!item) return { kind: "failed", error: sourceText("error.workflow.githubItemMissing") };
    if (item.pullRequest === false && isOneOf(WORKFLOW_GITHUB_PULL_REQUEST_ACTIONS, action))
      return { kind: "failed", error: sourceText("error.workflow.githubPullRequestOnly") };
    number = item.number;
  }

  // The event of a trigger is data for an agent. GitHub does not get it as a comment, a review or an issue.
  const text = withoutEvents(input);
  const onlyEvent = text !== input && !text.trim();
  const body = text.trim().slice(0, BODY_LIMIT);
  const textMissing = sourceText(onlyEvent ? "error.workflow.githubEventText" : "error.workflow.githubTextMissing");
  const chooseLabels = fieldText(node, "labelsFrom") === "agent";
  const labels = chooseLabels ? [] : workflowListField(node.fields.labels);
  const person = fieldText(node, "person");
  const choosePerson = person === "agent";
  const reason = node.fields.reason;
  const change: WorkflowGitHubChange = {
    action,
    repository,
    number,
    body,
    title: "",
    labels,
    people: choosePerson || !person ? [] : [person],
    reason: isOneOf(WORKFLOW_GITHUB_CLOSE_REASONS, reason) ? reason : "completed",
  };
  const choose: GitHubOutputChoice = { labels: false, person: false };

  switch (action) {
    case "comment":
      if (onlyEvent) return { kind: "failed", error: textMissing };
      if (!body) return { kind: "quiet" };
      break;
    case "review.changes":
      // GitHub asks for the changes in the review text.
      if (!body) return { kind: "failed", error: textMissing };
      break;
    case "label.add":
    case "label.remove":
      if (!chooseLabels && labels.length === 0)
        return { kind: "failed", error: sourceText("error.workflow.githubChoiceMissing") };
      choose.labels = chooseLabels;
      break;
    case "assign":
    case "review.request":
      if (!choosePerson && !person) return { kind: "failed", error: sourceText("error.workflow.githubChoiceMissing") };
      choose.person = choosePerson;
      break;
    case "issue.create": {
      const title = (fieldText(node, "title") || body.split("\n", 1)[0] || "").trim().slice(0, TITLE_LIMIT);
      if (!title) return { kind: "failed", error: textMissing };
      change.title = title;
      choose.labels = chooseLabels;
      break;
    }
  }
  return { kind: "change", change, choose };
}

/**
 * The input of a GitHub output step: the text of the steps before it as one text, then the events of
 * triggers as framed data. The change leaves the events out; "Agent chooses" still reads them.
 */
export function githubOutputInput(inputs: readonly string[]): string {
  const events = inputs.map((input) => input.trim()).filter((input) => input.startsWith(EXTERNAL_EVENT_START));
  const text = inputText(inputs.filter((input) => !input.trim().startsWith(EXTERNAL_EVENT_START)));
  return [text, ...events].filter(Boolean).join("\n\n").slice(0, INPUT_LIMITS.workflowStepInput);
}

/** The name that `inputText` puts before each input it joins, with no text after it. */
const EMPTY_INPUT_NAME = /(?<=^|\n)Input \d+:\s*(?=Input \d+:\n|$)/gu;
const INPUT_NAME = /(?<=^|\n)Input \d+:\n\n/gu;

/**
 * The input without the framed events of triggers. A loop joins the event into the input of a later
 * pass, so the names of the joined inputs go with their events, and one text that stays keeps no name.
 */
function withoutEvents(input: string): string {
  let text = input;
  for (let start = text.indexOf(EXTERNAL_EVENT_START); start >= 0; start = text.indexOf(EXTERNAL_EVENT_START)) {
    const end = text.indexOf(EXTERNAL_EVENT_END, start);
    text = text.slice(0, start) + (end < 0 ? "" : text.slice(end + EXTERNAL_EVENT_END.length));
  }
  if (text === input) return text;
  text = text.replace(EMPTY_INPUT_NAME, "");
  const names = text.match(INPUT_NAME) ?? [];
  const rest = text.trimStart();
  const name = names.length === 1 ? names[0] : undefined;
  return name && rest.startsWith(name) ? rest.slice(name.length) : text;
}

/** The question that lets a model choose from the repository's own labels and people. */
export function githubChoicePrompt(
  input: string,
  options: WorkflowGitHubRepositoryOptions,
  choose: GitHubOutputChoice,
): string {
  const lines = [
    "Choose for the text below. Answer with one JSON object and nothing else.",
    choose.labels ? 'Put the labels that fit the text in "labels", as a list. Use only labels from the list.' : "",
    choose.person ? 'Put the one person who fits the text best in "person". Use only a login from the list.' : "",
    'Give an empty list or "" when nothing fits.',
    choose.labels ? `Labels:\n${options.labels.map((label) => `- ${label.name}`).join("\n")}` : "",
    choose.person ? `People:\n${options.people.map((login) => `- ${login}`).join("\n")}` : "",
    `Text:\n<<<\n${input}\n>>>`,
  ];
  return lines.filter(Boolean).join("\n\n");
}

/**
 * The labels and the person that a model chose, as the repository writes them. A value that the
 * repository does not have is dropped. Null when the model chose nothing that the change needs.
 */
export function githubChoices(
  answer: string,
  options: WorkflowGitHubRepositoryOptions,
  choose: GitHubOutputChoice,
): { labels: string[]; people: string[] } | null {
  let parsed: ReturnType<typeof extractJsonObject>;
  try {
    parsed = extractJsonObject(answer);
  } catch (error) {
    if (error instanceof StructuredOutputError) return null;
    throw error;
  }
  const known = (values: readonly string[], value: unknown) =>
    isString(value) ? values.find((candidate) => candidate.toLowerCase() === value.trim().toLowerCase()) : undefined;
  const labelNames = options.labels.map((label) => label.name);
  const labels = choose.labels
    ? [
        ...new Set(
          (Array.isArray(parsed.labels) ? parsed.labels : []).flatMap((value) => known(labelNames, value) ?? []),
        ),
      ]
    : [];
  const person = choose.person ? known(options.people, parsed.person) : undefined;
  if (choose.labels && labels.length === 0) return null;
  if (choose.person && !person) return null;
  return { labels, people: person ? [person] : [] };
}

/** The keys of what the change sets, known before GitHub answers. */
export function githubChangeKeys(change: WorkflowGitHubChange): string[] {
  switch (change.action) {
    case "label.add":
    case "label.remove":
    case "issue.create":
      return change.labels.map((name) => githubObjectKey({ kind: "label", name }));
    case "assign":
      return change.people.map((login) => githubObjectKey({ kind: "assignee", login }));
    case "review.request":
      return change.people.map((login) => githubObjectKey({ kind: "reviewer", login }));
    case "close":
    case "reopen":
      return [githubObjectKey({ kind: change.action })];
    default:
      return [];
  }
}

/** Every key of the change, with the comment, review or issue that GitHub made. */
export function githubResultKeys(change: WorkflowGitHubChange, result: WorkflowGitHubChangeResult): string[] {
  const created = result.created;
  if (!created) return githubChangeKeys(change);
  return [
    created.kind === "issue"
      ? githubObjectKey({ kind: "issue", number: created.number })
      : githubObjectKey({ kind: created.kind, id: created.id }),
    ...githubChangeKeys(change),
  ];
}

/** The text that a done GitHub output step keeps: the page of what changed. */
export function githubOutputText(change: WorkflowGitHubChange, result: WorkflowGitHubChangeResult | null): string {
  if (result?.url) return result.url;
  const number = result?.created?.kind === "issue" ? result.created.number : change.number;
  return number === null ? change.repository : `${change.repository}#${number}`;
}

/** The output's repository; "trigger", or none, names the repository of the trigger that started the run. */
function outputRepository(node: WorkflowNode, graph: WorkflowGraph | null, triggerNodeId: string | null) {
  const repository = fieldText(node, "repository");
  if (repository && repository !== "trigger") return isGitHubRepositoryName(repository) ? repository : null;
  const trigger = graph?.nodes.find((candidate) => candidate.id === triggerNodeId);
  return trigger ? githubTriggerRepository(trigger) : null;
}

/**
 * The item that the output changes: the item of the event that started the run, or the number in its
 * input (`#12`, or a link to the issue or the pull request). `pullRequest` is null when only GitHub knows.
 */
function outputItem(
  node: WorkflowNode,
  input: string,
  repository: string,
  runItem: WorkflowGitHubItem | null,
): { number: number; pullRequest: boolean | null } | null {
  if (fieldText(node, "item") === "input") {
    const number = itemNumberIn(input);
    return number === null ? null : { number, pullRequest: null };
  }
  if (!runItem || runItem.repository.toLowerCase() !== repository.toLowerCase()) return null;
  return { number: runItem.number, pullRequest: runItem.pullRequest };
}

function itemNumberIn(input: string): number | null {
  const match =
    /\/(?:issues|pull)\/(\d{1,9})\b/u.exec(input) ?? /#(\d{1,9})\b/u.exec(input) ?? /^\s*(\d{1,9})\s*$/u.exec(input);
  const number = match ? Number(match[1]) : 0;
  return number > 0 ? number : null;
}
