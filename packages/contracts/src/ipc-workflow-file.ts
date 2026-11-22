import { ATTACHMENT_LIMITS, INPUT_LIMITS } from "./input-limits";
import { integerInRange, isBoundedString, isIdentifier } from "./ipc-bounded-values";
import {
  isWorkflowFormat,
  WORKFLOW_FORMAT,
  workflowGraphFormat,
  workflowGraphHasUnknownKey,
} from "./ipc-workflow-format";
import {
  type WorkflowIdField,
  type WorkflowIdKind,
  workflowIdFields,
  workflowNodeHasUnknownValue,
} from "./ipc-workflow-nodes";
import {
  isWorkflowGraph,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_STEP_NAME_FIELD,
  type WorkflowFields,
  type WorkflowGraph,
  type WorkflowNode,
} from "./ipc-workflows";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "./runtime-values";

export const WORKFLOW_FILE_FORMAT = "openbot.workflow";
export const WORKFLOW_FILE_VERSION = 1;
export const WORKFLOW_FILE_MAX_BYTES =
  2 * INPUT_LIMITS.workflowGraphBytes + Math.ceil((ATTACHMENT_LIMITS.totalBytes * 4) / 3) + 64 * 1024;

const REFERENCE_KINDS = ["agent", "channel"] as const;
export type WorkflowFileReferenceKind = (typeof REFERENCE_KINDS)[number];

const NAME_LIMIT = 255;
const VERSION_LIMIT = 32;

export interface WorkflowFileReference {
  kind: WorkflowFileReferenceKind;
  name: string;
  title?: string;
}

export interface WorkflowFileLink {
  node: string;
  app: string;
}

export interface WorkflowFileAsset {
  name: string;
  type: string;
  data: string;
}

export interface WorkflowFile {
  format: typeof WORKFLOW_FILE_FORMAT;
  version: number;
  graphFormat: number;
  minAppVersion: string;
  title: string;
  graph: WorkflowGraph;
  references: Record<string, WorkflowFileReference>;
  links: WorkflowFileLink[];
  assets: Record<string, WorkflowFileAsset>;
}

export interface WorkflowFileNeeds {
  agents: string[];
  channels: string[];
  files: string[];
}

export interface WorkflowFileSourceAsset {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface WorkflowFileSource {
  title: string;
  graph: WorkflowGraph;
  appVersion: string;
  timezone: string;
  agents: ReadonlyMap<string, { name: string; title?: string }>;
  channels: ReadonlyMap<string, { name: string }>;
  assets: ReadonlyMap<string, WorkflowFileSourceAsset>;
  hasSecret: (text: string) => boolean;
}

export interface WorkflowFileField {
  node: string;
  step: string;
  field: string;
}

export type WorkflowFileExportProblem =
  | { kind: "secret"; fields: WorkflowFileField[] }
  | { kind: "asset-missing"; node: string; step: string }
  | { kind: "asset-too-large"; node: string; step: string }
  | { kind: "too-large" };

export type WorkflowFileExport = { ok: true; file: WorkflowFile } | { ok: false; problem: WorkflowFileExportProblem };

export type WorkflowFileImportProblem =
  | { kind: "not-file" }
  | { kind: "invalid" }
  | { kind: "newer"; minAppVersion: string | null; steps: string[] };

export type WorkflowFileDecode = { ok: true; file: WorkflowFile } | { ok: false; problem: WorkflowFileImportProblem };

export interface WorkflowFileTargets {
  references: ReadonlyMap<string, string>;
  assets: ReadonlyMap<string, { id: string; name: string }>;
}

export interface WorkflowFileCandidate {
  id: string;
  name: string;
  title?: string;
}

const REFERENCE_PREFIX: Readonly<Record<WorkflowFileReferenceKind, string>> = { agent: "agent-", channel: "channel-" };
const ASSET_PREFIX = "file-";
const LINK_FIELDS: ReadonlySet<WorkflowIdKind> = new Set(["connection", "place"]);
const APP_FIELD: Readonly<Partial<Record<WorkflowNode["kind"], string>>> = { trigger: "trigger", output: "target" };
const FILE_KEYS = {
  format: true,
  version: true,
  graphFormat: true,
  minAppVersion: true,
  title: true,
  graph: true,
  references: true,
  links: true,
  assets: true,
} as const satisfies Record<keyof WorkflowFile, true>;

function stringField(fields: WorkflowFields, name: string): string {
  const value = fields[name];
  return isString(value) ? value : "";
}

export function workflowFileStepName(node: Pick<WorkflowNode, "kind" | "fields">): string {
  return stringField(node.fields, WORKFLOW_STEP_NAME_FIELD).trim() || node.kind;
}

function idValues(graph: WorkflowGraph, kind: WorkflowIdKind): string[] {
  const values = graph.nodes.flatMap((node) =>
    workflowIdFields(node.kind).flatMap((field) => {
      const value = field.id === kind ? stringField(node.fields, field.name) : "";
      return value ? [value] : [];
    }),
  );
  return [...new Set(values)];
}

export function workflowFileNeeds(graph: WorkflowGraph): WorkflowFileNeeds {
  return { agents: idValues(graph, "agent"), channels: idValues(graph, "channel"), files: idValues(graph, "file") };
}

function base64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

function base64Length(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function assetBytes(assets: Readonly<Record<string, WorkflowFileAsset>>): number {
  return Object.values(assets).reduce((sum, asset) => sum + base64Length(asset.data), 0);
}

export function workflowFileAssetBytes(asset: WorkflowFileAsset): Uint8Array {
  return Uint8Array.from(atob(asset.data), (character) => character.charCodeAt(0));
}

interface Keyed<T> {
  key: (id: string, make: () => T) => string;
  values: Record<string, T>;
}

function keyed<T>(prefix: string): Keyed<T> {
  const keys = new Map<string, string>();
  const values: Record<string, T> = {};
  return {
    values,
    key: (id, make) => {
      const known = keys.get(id);
      if (known) return known;
      const next = `${prefix}${keys.size + 1}`;
      keys.set(id, next);
      values[next] = make();
      return next;
    },
  };
}

function resolvedTimezone(node: WorkflowNode, timezone: string): WorkflowFields {
  if (node.kind !== "trigger" || !node.schedule || stringField(node.fields, "timezone")) return {};
  return { timezone };
}

function secretFields(source: WorkflowFileSource, graph: WorkflowGraph): WorkflowFileField[] {
  const title = source.hasSecret(source.title) ? [{ node: "", step: "", field: "title" }] : [];
  return [
    ...title,
    ...graph.nodes.flatMap((node) =>
      Object.entries(node.fields).flatMap(([field, value]) =>
        isString(value) && value && source.hasSecret(value)
          ? [{ node: node.id, step: workflowFileStepName(node), field }]
          : [],
      ),
    ),
  ];
}

function portableField(
  source: WorkflowFileSource,
  keys: {
    agents: Keyed<WorkflowFileReference>;
    channels: Keyed<WorkflowFileReference>;
    assets: Keyed<WorkflowFileAsset>;
  },
  node: WorkflowNode,
  field: WorkflowIdField,
  value: string,
  problems: WorkflowFileExportProblem[],
): string {
  if (field.id === "agent") {
    const agent = source.agents.get(value);
    if (!agent) return "";
    const title = agent.title ? { title: agent.title } : {};
    return keys.agents.key(value, () => ({ kind: "agent", name: agent.name, ...title }));
  }
  if (field.id === "channel") {
    const channel = source.channels.get(value);
    return channel ? keys.channels.key(value, () => ({ kind: "channel", name: channel.name })) : "";
  }
  if (field.id !== "file") return "";
  const asset = source.assets.get(value);
  const step = workflowFileStepName(node);
  if (!asset) problems.push({ kind: "asset-missing", node: node.id, step });
  else if (asset.bytes.byteLength > ATTACHMENT_LIMITS.fileBytes)
    problems.push({ kind: "asset-too-large", node: node.id, step });
  if (!asset || asset.bytes.byteLength > ATTACHMENT_LIMITS.fileBytes) return "";
  return keys.assets.key(value, () => ({ name: asset.name, type: asset.type, data: base64(asset.bytes) }));
}

function graphBytes(graph: WorkflowGraph): number {
  return new TextEncoder().encode(JSON.stringify(graph)).byteLength;
}

export function encodeWorkflowFile(source: WorkflowFileSource): WorkflowFileExport {
  const keys = {
    agents: keyed<WorkflowFileReference>(REFERENCE_PREFIX.agent),
    channels: keyed<WorkflowFileReference>(REFERENCE_PREFIX.channel),
    assets: keyed<WorkflowFileAsset>(ASSET_PREFIX),
  };
  const links: WorkflowFileLink[] = [];
  const problems: WorkflowFileExportProblem[] = [];
  const nodes = source.graph.nodes.map((node): WorkflowNode => {
    const fields: WorkflowFields = { ...node.fields, ...resolvedTimezone(node, source.timezone) };
    let needsLink = false;
    for (const field of workflowIdFields(node.kind)) {
      const value = stringField(node.fields, field.name);
      if (!value) continue;
      needsLink ||= LINK_FIELDS.has(field.id);
      fields[field.name] = portableField(source, keys, node, field, value, problems);
    }
    const appField = APP_FIELD[node.kind];
    if (needsLink && appField) links.push({ node: node.id, app: stringField(node.fields, appField) });
    return { ...node, fields };
  });
  const [problem] = problems;
  if (problem) return { ok: false, problem };
  const assets = keys.assets.values;
  const graph: WorkflowGraph = { ...source.graph, nodes };
  if (assetBytes(assets) > ATTACHMENT_LIMITS.totalBytes || graphBytes(graph) > INPUT_LIMITS.workflowGraphBytes)
    return { ok: false, problem: { kind: "too-large" } };
  const secrets = secretFields(source, graph);
  if (secrets.length > 0) return { ok: false, problem: { kind: "secret", fields: secrets } };
  return {
    ok: true,
    file: {
      format: WORKFLOW_FILE_FORMAT,
      version: WORKFLOW_FILE_VERSION,
      graphFormat: workflowGraphFormat(graph),
      minAppVersion: source.appVersion,
      title: source.title,
      graph,
      references: { ...keys.agents.values, ...keys.channels.values },
      links,
      assets,
    },
  };
}

export function serializeWorkflowFile(file: WorkflowFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function parseRecord(text: string): DynamicRecord | null {
  try {
    const value = JSON.parse(text);
    return isDynamicRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function newerSteps(graph: unknown): string[] {
  if (!isDynamicRecord(graph) || !Array.isArray(graph.nodes)) return [];
  return graph.nodes.flatMap((node: unknown) => {
    if (!isDynamicRecord(node)) return [];
    const fields = isDynamicRecord(node.fields) ? node.fields : {};
    const stepName = fields[WORKFLOW_STEP_NAME_FIELD];
    const name = isString(stepName) && stepName.trim() ? stepName.trim() : isString(node.kind) ? node.kind : "";
    const unknownKind = !isOneOf(WORKFLOW_NODE_KINDS, node.kind);
    return name && (unknownKind || workflowNodeHasUnknownValue(node)) ? [name.slice(0, NAME_LIMIT)] : [];
  });
}

function isNewer(value: DynamicRecord): boolean {
  const version = value.version;
  const graphFormat = value.graphFormat;
  return (
    (integerInRange(version, 1, Number.MAX_SAFE_INTEGER) && version > WORKFLOW_FILE_VERSION) ||
    (isWorkflowFormat(graphFormat) && graphFormat > WORKFLOW_FORMAT) ||
    Object.keys(value).some((key) => !Object.hasOwn(FILE_KEYS, key)) ||
    workflowGraphHasUnknownKey(value.graph) ||
    newerSteps(value.graph).length > 0
  );
}

function isReference(value: unknown): value is WorkflowFileReference {
  return (
    isDynamicRecord(value) &&
    isOneOf(REFERENCE_KINDS, value.kind) &&
    isBoundedString(value.name, NAME_LIMIT) &&
    value.name.trim().length > 0 &&
    (value.title === undefined || isBoundedString(value.title, NAME_LIMIT))
  );
}

function isAsset(value: unknown): value is WorkflowFileAsset {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.name, NAME_LIMIT) &&
    value.name.trim().length > 0 &&
    isBoundedString(value.type, NAME_LIMIT) &&
    isString(value.data) &&
    BASE64.test(value.data) &&
    base64Length(value.data) <= ATTACHMENT_LIMITS.fileBytes
  );
}

function isRecordOf<T>(value: unknown, is: (item: unknown) => item is T): value is Record<string, T> {
  if (!isDynamicRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= INPUT_LIMITS.workflowNodes && entries.every(([key, item]) => isIdentifier(key) && is(item));
}

function isLink(value: unknown): value is WorkflowFileLink {
  return isDynamicRecord(value) && isIdentifier(value.node) && isBoundedString(value.app, NAME_LIMIT);
}

function referencesResolve(
  graph: WorkflowGraph,
  references: Readonly<Record<string, WorkflowFileReference>>,
  assets: Readonly<Record<string, WorkflowFileAsset>>,
): boolean {
  return graph.nodes.every((node) =>
    workflowIdFields(node.kind).every((field) => {
      const value = stringField(node.fields, field.name);
      if (!value) return true;
      if (field.id === "file") return Object.hasOwn(assets, value);
      if (field.id !== "agent" && field.id !== "channel") return false;
      return Object.hasOwn(references, value) && references[value]?.kind === field.id;
    }),
  );
}

function isWorkflowFileBody(value: DynamicRecord): value is DynamicRecord & WorkflowFile {
  if (
    !(
      value.format === WORKFLOW_FILE_FORMAT &&
      integerInRange(value.version, 1, WORKFLOW_FILE_VERSION) &&
      isWorkflowFormat(value.graphFormat) &&
      isBoundedString(value.minAppVersion, VERSION_LIMIT) &&
      isBoundedString(value.title, INPUT_LIMITS.workflowTitle) &&
      value.title.trim().length > 0 &&
      isWorkflowGraph(value.graph) &&
      graphBytes(value.graph) <= INPUT_LIMITS.workflowGraphBytes &&
      isRecordOf(value.references, isReference) &&
      isRecordOf(value.assets, isAsset) &&
      Array.isArray(value.links) &&
      value.links.length <= INPUT_LIMITS.workflowNodes &&
      value.links.every(isLink)
    )
  )
    return false;
  const nodes = new Set(value.graph.nodes.map((node) => node.id));
  return (
    assetBytes(value.assets) <= ATTACHMENT_LIMITS.totalBytes &&
    value.links.every((link) => nodes.has(link.node)) &&
    referencesResolve(value.graph, value.references, value.assets)
  );
}

export function decodeWorkflowFile(text: string): WorkflowFileDecode {
  if (text.length > WORKFLOW_FILE_MAX_BYTES) return { ok: false, problem: { kind: "invalid" } };
  const value = parseRecord(text);
  if (!value || value.format !== WORKFLOW_FILE_FORMAT) return { ok: false, problem: { kind: "not-file" } };
  if (isNewer(value)) {
    const minAppVersion = isBoundedString(value.minAppVersion, VERSION_LIMIT) ? value.minAppVersion : null;
    return { ok: false, problem: { kind: "newer", minAppVersion, steps: newerSteps(value.graph) } };
  }
  if (!isWorkflowFileBody(value)) return { ok: false, problem: { kind: "invalid" } };
  return {
    ok: true,
    file: {
      format: WORKFLOW_FILE_FORMAT,
      version: value.version,
      graphFormat: value.graphFormat,
      minAppVersion: value.minAppVersion,
      title: value.title,
      graph: value.graph,
      references: value.references,
      links: value.links,
      assets: value.assets,
    },
  };
}

function normalized(text: string): string {
  return text.trim().toLocaleLowerCase();
}

export function matchWorkflowFileReferences(
  file: WorkflowFile,
  candidates: Readonly<Record<WorkflowFileReferenceKind, readonly WorkflowFileCandidate[]>>,
): Map<string, string> {
  const matches = new Map<string, string>();
  for (const [key, reference] of Object.entries(file.references)) {
    const list = candidates[reference.kind];
    const byName = list.filter((candidate) => normalized(candidate.name) === normalized(reference.name));
    const title = reference.title;
    const byTitle =
      byName.length > 1 && title
        ? byName.filter((candidate) => normalized(candidate.title ?? "") === normalized(title))
        : byName;
    const match = byTitle.length === 1 ? byTitle[0] : undefined;
    if (match) matches.set(key, match.id);
  }
  return matches;
}

export function workflowFromFile(
  file: WorkflowFile,
  targets: WorkflowFileTargets,
): { title: string; graph: WorkflowGraph } {
  const nodes = file.graph.nodes.map((node): WorkflowNode => {
    const fields: WorkflowFields = { ...node.fields };
    for (const field of workflowIdFields(node.kind)) {
      const value = stringField(node.fields, field.name);
      if (!value) continue;
      if (field.id === "file") {
        const asset = targets.assets.get(value);
        fields[field.name] = asset?.id ?? "";
        if (asset) fields.file = asset.name;
      } else fields[field.name] = targets.references.get(value) ?? "";
    }
    return { ...node, fields };
  });
  return { title: file.title, graph: { ...file.graph, nodes } };
}
