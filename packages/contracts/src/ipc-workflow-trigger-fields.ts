import type { WorkflowAnswerField, WorkflowAnswerType } from "./ipc-workflow-answers";
import type { WorkflowNode, WorkflowTriggerType } from "./ipc-workflows";
import { type DynamicRecord, isDynamicRecord } from "./runtime-values";

export interface WorkflowTriggerField extends WorkflowAnswerField {
  readonly path: readonly string[];
}

export const WORKFLOW_TRIGGER_FIELDS_FORMAT = 3;

const field = (
  name: string,
  type: Exclude<WorkflowAnswerType, "choice">,
  path: readonly string[],
  optional = false,
): WorkflowTriggerField => ({ name, type, labels: [], optional, path });

const data = (...path: string[]) => ["data", ...path];

const SCHEDULE: readonly WorkflowTriggerField[] = [
  field("run_time", "text", ["runTime"]),
  field("local_date", "text", ["localDate"], true),
  field("local_time", "text", ["localTime"], true),
  field("weekday", "text", ["weekday"], true),
];

const GITHUB: readonly WorkflowTriggerField[] = [
  field("repository", "text", data("repository")),
  field("actor", "text", data("actor")),
  field("action", "text", data("action"), true),
  field("number", "integer", data("number")),
  field("pull_request", "yes/no", data("pullRequest")),
  field("url", "text", data("url")),
  field("title", "text", data("title"), true),
  field("body", "text", data("body"), true),
  field("author", "text", data("author"), true),
  field("state", "text", data("state"), true),
  field("labels", "list", data("labels"), true),
  field("label", "text", data("label"), true),
  field("assignee", "text", data("assignee"), true),
  field("reviewer", "text", data("reviewer"), true),
  field("comment_author", "text", data("comment", "author"), true),
  field("comment_body", "text", data("comment", "body"), true),
  field("comment_url", "text", data("comment", "url"), true),
  field("review_author", "text", data("review", "author"), true),
  field("review_state", "text", data("review", "state"), true),
  field("review_body", "text", data("review", "body"), true),
  field("review_url", "text", data("review", "url"), true),
  field("check_conclusion", "text", data("checks", "conclusion"), true),
  field("check_app", "text", data("checks", "app"), true),
  field("head_branch", "text", data("checks", "headBranch"), true),
];

const MESSAGE: readonly WorkflowTriggerField[] = [
  field("text", "text", data("text")),
  field("author", "text", data("author")),
  field("author_id", "text", data("authorId")),
  field("message_id", "text", data("messageId")),
];

const DISCORD: readonly WorkflowTriggerField[] = [
  ...MESSAGE,
  field("channel", "text", data("channel")),
  field("channel_id", "text", data("channelId")),
  field("server", "text", data("server")),
];

const TELEGRAM: readonly WorkflowTriggerField[] = [
  ...MESSAGE,
  field("chat", "text", data("chat")),
  field("chat_id", "text", data("chatId")),
];

const SLACK: readonly WorkflowTriggerField[] = [
  ...MESSAGE,
  field("channel", "text", data("channel")),
  field("channel_id", "text", data("channelId")),
  field("workspace", "text", data("workspace")),
  field("thread_id", "text", data("threadId"), true),
];

const TRIGGER_FIELDS: ReadonlyMap<string, readonly WorkflowTriggerField[]> = new Map<
  WorkflowTriggerType,
  readonly WorkflowTriggerField[]
>([
  ["schedule", SCHEDULE],
  ["github", GITHUB],
  ["discord", DISCORD],
  ["telegram", TELEGRAM],
  ["slack", SLACK],
]);

export function workflowTriggerFields(node: Pick<WorkflowNode, "kind" | "fields">): readonly WorkflowTriggerField[] {
  if (node.kind !== "trigger") return [];
  const trigger = node.fields.trigger;
  return (typeof trigger === "string" && TRIGGER_FIELDS.get(trigger)) || [];
}

export function workflowTriggerRecord(fields: readonly WorkflowTriggerField[], record: DynamicRecord): DynamicRecord {
  return Object.fromEntries(
    fields.flatMap(({ name, path }) => {
      const value = path.reduce<unknown>(
        (at, key) => (isDynamicRecord(at) && Object.hasOwn(at, key) ? at[key] : undefined),
        record,
      );
      return value === undefined || value === null || value === "" ? [] : [[name, value]];
    }),
  );
}
