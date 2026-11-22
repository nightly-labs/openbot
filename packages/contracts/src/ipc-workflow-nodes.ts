import { AGENT_REASONING_EFFORTS } from "./ipc-agent-identity";
import { WORKFLOW_DISCORD_ACTIONS, WORKFLOW_DISCORD_EMOJI, WORKFLOW_DISCORD_EVENTS } from "./ipc-workflow-discord";
import {
  WORKFLOW_GITHUB_ACTIONS,
  WORKFLOW_GITHUB_CLOSE_REASONS,
  WORKFLOW_GITHUB_EVENTS,
  WORKFLOW_GITHUB_FILTERS,
  workflowListField,
} from "./ipc-workflow-github";
import { WORKFLOW_SLACK_ACTIONS, WORKFLOW_SLACK_EMOJI, WORKFLOW_SLACK_EVENTS } from "./ipc-workflow-slack";
import { WORKFLOW_TELEGRAM_ACTIONS, WORKFLOW_TELEGRAM_EMOJI, WORKFLOW_TELEGRAM_EVENTS } from "./ipc-workflow-telegram";
import {
  WORKFLOW_MEDIA_ASPECTS,
  WORKFLOW_MEDIA_CUSTOM_ASPECT,
  WORKFLOW_MEDIA_KINDS,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_OUTPUT_TARGETS,
  WORKFLOW_TRIGGER_TYPES,
  WORKFLOW_VIDEO_VOICES,
  type WorkflowFields,
  type WorkflowNode,
  type WorkflowNodeKind,
} from "./ipc-workflows";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

type WorkflowIdKind = "agent" | "channel" | "connection" | "place" | "file" | "account";

interface WorkflowFieldSpec {
  readonly runtime?: true;
  readonly template?: true;
  readonly values?: readonly string[];
  readonly list?: true;
  readonly admin?: readonly string[];
  readonly id?: WorkflowIdKind;
}

type WorkflowNodeSpec = Readonly<Record<string, WorkflowFieldSpec>>;

function known(...lists: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(lists.flat())];
}

const RUNTIME: WorkflowFieldSpec = { runtime: true };
const TEMPLATE: WorkflowFieldSpec = { runtime: true, template: true };
const EFFORT: WorkflowFieldSpec = { runtime: true, values: AGENT_REASONING_EFFORTS };
const CONNECTION: WorkflowFieldSpec = { runtime: true, id: "connection" };
const PLACE: WorkflowFieldSpec = { runtime: true, id: "place" };
const CHAT_APPS = ["github", "discord", "telegram", "slack"] as const;
const TEXT_ONLY: WorkflowNodeSpec = { text: RUNTIME };

const WORKFLOW_NODE_REGISTRY: Readonly<Record<WorkflowNodeKind, WorkflowNodeSpec>> = {
  trigger: {
    trigger: { runtime: true, values: WORKFLOW_TRIGGER_TYPES, admin: CHAT_APPS },
    timezone: RUNTIME,
    repositories: RUNTIME,
    event: {
      runtime: true,
      values: known(WORKFLOW_GITHUB_EVENTS, WORKFLOW_DISCORD_EVENTS, WORKFLOW_TELEGRAM_EVENTS, WORKFLOW_SLACK_EVENTS),
    },
    filters: { runtime: true, values: WORKFLOW_GITHUB_FILTERS, list: true },
    labels: RUNTIME,
    titleText: RUNTIME,
    branch: RUNTIME,
    connectionId: CONNECTION,
    placeId: PLACE,
    roles: RUNTIME,
    text: RUNTIME,
    answer: RUNTIME,
  },
  agent: {
    agentId: { runtime: true, id: "agent" },
    task: TEMPLATE,
    answer: RUNTIME,
  },
  llm: {
    provider: RUNTIME,
    model: RUNTIME,
    effort: EFFORT,
    prompt: TEMPLATE,
    system: TEMPLATE,
    answer: RUNTIME,
  },
  condition: {
    rule: RUNTIME,
    provider: RUNTIME,
    model: RUNTIME,
    effort: EFFORT,
    check: RUNTIME,
  },
  approval: {
    question: TEMPLATE,
  },
  output: {
    target: { runtime: true, values: WORKFLOW_OUTPUT_TARGETS, admin: [...CHAT_APPS, "chat-channel"] },
    connectionId: CONNECTION,
    placeId: PLACE,
    channelId: { runtime: true, id: "channel" },
    repository: RUNTIME,
    item: { runtime: true, values: ["event", "input"] },
    action: {
      runtime: true,
      values: known(
        WORKFLOW_GITHUB_ACTIONS,
        WORKFLOW_DISCORD_ACTIONS,
        WORKFLOW_TELEGRAM_ACTIONS,
        WORKFLOW_SLACK_ACTIONS,
      ),
    },
    labels: TEMPLATE,
    labelsFrom: { runtime: true, values: ["agent", "list"] },
    person: TEMPLATE,
    reason: { runtime: true, values: WORKFLOW_GITHUB_CLOSE_REASONS },
    title: TEMPLATE,
    message: TEMPLATE,
    emoji: {
      runtime: true,
      values: known(WORKFLOW_DISCORD_EMOJI, WORKFLOW_TELEGRAM_EMOJI, WORKFLOW_SLACK_EMOJI),
    },
  },
  prompt: TEXT_ONLY,
  text: TEXT_ONLY,
  note: TEXT_ONLY,
  shape: TEXT_ONLY,
  asset: {
    fileId: { runtime: true, id: "file" },
  },
  image: {
    media: { runtime: true, values: WORKFLOW_MEDIA_KINDS },
    model: RUNTIME,
    account: { runtime: true, id: "account" },
    prompt: RUNTIME,
    aspect: { runtime: true, values: [...WORKFLOW_MEDIA_ASPECTS, WORKFLOW_MEDIA_CUSTOM_ASPECT] },
    width: RUNTIME,
    height: RUNTIME,
    background: { runtime: true, values: ["solid", "transparent"] },
    duration: RUNTIME,
    resolution: RUNTIME,
    firstFrame: RUNTIME,
    lastFrame: RUNTIME,
    voice: { runtime: true, values: WORKFLOW_VIDEO_VOICES.map((voice) => voice.id) },
    options: RUNTIME,
  },
};

function fieldNames(kind: WorkflowNodeKind, has: (spec: WorkflowFieldSpec) => boolean): readonly string[] {
  return Object.entries(WORKFLOW_NODE_REGISTRY[kind]).flatMap(([name, spec]) => (has(spec) ? [name] : []));
}

function byKind(has: (spec: WorkflowFieldSpec) => boolean): Record<WorkflowNodeKind, readonly string[]> {
  const names = (kind: WorkflowNodeKind) => fieldNames(kind, has);
  return {
    text: names("text"),
    prompt: names("prompt"),
    asset: names("asset"),
    llm: names("llm"),
    agent: names("agent"),
    image: names("image"),
    trigger: names("trigger"),
    condition: names("condition"),
    approval: names("approval"),
    output: names("output"),
    note: names("note"),
    shape: names("shape"),
  };
}

export const WORKFLOW_RUNTIME_FIELDS: Readonly<Record<WorkflowNodeKind, readonly string[]>> = byKind(
  (spec) => spec.runtime === true,
);

export const WORKFLOW_TEMPLATE_FIELDS: Readonly<Partial<Record<WorkflowNodeKind, readonly string[]>>> =
  Object.fromEntries(Object.entries(byKind((spec) => spec.template === true)).filter(([, names]) => names.length > 0));

function knownValue(spec: WorkflowFieldSpec, value: unknown): boolean {
  const { values } = spec;
  if (!values || !isString(value) || value === "") return true;
  return spec.list ? workflowListField(value).every((item) => isOneOf(values, item)) : isOneOf(values, value);
}

export function workflowUnknownFields(
  kind: WorkflowNodeKind,
  fields: WorkflowFields,
): { name: string; values: readonly string[] }[] {
  return Object.entries(WORKFLOW_NODE_REGISTRY[kind]).flatMap(([name, spec]) =>
    knownValue(spec, fields[name]) ? [] : [{ name, values: spec.values ?? [] }],
  );
}

export function workflowNodeHasUnknownValue(node: unknown): boolean {
  if (!isDynamicRecord(node) || !isString(node.kind) || !isOneOf(WORKFLOW_NODE_KINDS, node.kind)) return false;
  const fields = isDynamicRecord(node.fields) ? node.fields : {};
  return Object.entries(WORKFLOW_NODE_REGISTRY[node.kind]).some(([name, spec]) => !knownValue(spec, fields[name]));
}

export function workflowNeedsAdmin(node: WorkflowNode): boolean {
  return Object.entries(WORKFLOW_NODE_REGISTRY[node.kind]).some(([name, spec]) => {
    const value = node.fields[name];
    if (!spec.admin || !isString(value)) return false;
    return isOneOf(spec.admin, value) || !knownValue(spec, value);
  });
}
