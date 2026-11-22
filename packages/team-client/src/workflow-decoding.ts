import {
  isWorkflowDetail,
  isWorkflowFields,
  isWorkflowGitHubCatalog,
  isWorkflowGitHubHistory,
  isWorkflowGitHubRepositoryOptions,
  isWorkflowGraph,
  isWorkflowMediaAccountCredits,
  isWorkflowMediaCatalogModel,
  isWorkflowMediaCreditBalance,
  isWorkflowMediaPrice,
  isWorkflowMediaServiceAccount,
  isWorkflowRunDetail,
  isWorkflowRunPage,
  isWorkflowSaveResult,
  isWorkflowStep,
  isWorkflowStepSource,
  isWorkflowSummary,
  isWorkflowVersion,
  isWorkflowWebhookSecret,
  WORKFLOW_GITHUB_DELIVERY_OUTCOMES,
  WORKFLOW_GITHUB_EVENTS,
  WORKFLOW_GITHUB_SKIP_REASONS,
  WORKFLOW_MEDIA_CATALOG_MAX,
  WORKFLOW_MEDIA_SERVICE_ACCOUNT_MAX,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_OUTPUT_TARGETS,
  WORKFLOW_PORT_TYPES,
  WORKFLOW_RUN_SOURCES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_STEP_STATUSES,
  WORKFLOW_TRIGGER_TYPES,
  WORKFLOW_VERSION_KINDS,
  type WorkflowCatalogProvider,
  type WorkflowMediaAccountCredits,
  type WorkflowMediaCatalog,
  type WorkflowMediaCreditBalance,
  type WorkflowMediaCredits,
  type WorkflowMediaPrice,
  type WorkflowMediaProviders,
  type WorkflowMediaServiceAccount,
  type WorkflowStepSettings,
} from "@openbot/contracts/ipc";
import { guardedDecoder, guardedListDecoder } from "@openbot/contracts/ipc-decoding";
import { type DynamicRecord, isDynamicRecord, isOneOf, isString } from "@openbot/contracts/runtime-values";

type Json = DynamicRecord;

function withKnown(record: Json, key: string, choices: readonly string[], fallback: string): Json {
  return isUnknownName(choices, record[key]) ? { ...record, [key]: fallback } : record;
}

function isUnknownName(choices: readonly string[], value: unknown): boolean {
  return isString(value) && !isOneOf(choices, value);
}

const onRecord =
  (map: (record: Json) => Json) =>
  (value: unknown): unknown =>
    isDynamicRecord(value) ? map(value) : value;

function mapList(record: Json, key: string, map: (item: unknown) => unknown): Json {
  const items = record[key];
  return Array.isArray(items) ? { ...record, [key]: items.map(map) } : record;
}

const runStatus = (record: Json) => withKnown(record, "status", WORKFLOW_RUN_STATUSES, "stopped");

const summary = onRecord((record) =>
  isDynamicRecord(record.lastRun) ? { ...record, lastRun: runStatus(record.lastRun) } : record,
);

const run = onRecord((record) => runStatus(withKnown(record, "source", WORKFLOW_RUN_SOURCES, "manual")));

const step = onRecord((record) => withKnown(record, "status", WORKFLOW_STEP_STATUSES, "stopped"));

const runDetail = onRecord((record) => mapList({ ...record, run: run(record.run) }, "steps", step));

const version = onRecord((record) => withKnown(record, "kind", WORKFLOW_VERSION_KINDS, "auto"));

const trigger = onRecord((record) => withKnown(record, "type", WORKFLOW_TRIGGER_TYPES, "manual"));

function hasUnknownSetting(node: Json): boolean {
  const fields = isDynamicRecord(node.fields) ? node.fields : {};
  if (node.kind === "trigger") return isUnknownName(WORKFLOW_TRIGGER_TYPES, fields.trigger);
  if (node.kind === "output") return isUnknownName(WORKFLOW_OUTPUT_TARGETS, fields.target);
  return false;
}

const detail = onRecord((record) => {
  const base = mapList({ ...record, summary: summary(record.summary) }, "triggers", trigger);
  const graph = base.graph;
  if (!isDynamicRecord(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return base;
  const placeholders = new Set<unknown>();
  const settings = graph.nodes.some((node) => isDynamicRecord(node) && hasUnknownSetting(node));
  const nodes = graph.nodes.map(
    onRecord((node) => {
      if (!isUnknownName(WORKFLOW_NODE_KINDS, node.kind)) return node;
      placeholders.add(node.id);
      const { schedule: _schedule, ...rest } = node;
      return { ...rest, kind: "note", locked: true };
    }),
  );
  const edges = graph.edges.filter(
    (edge) =>
      !isDynamicRecord(edge) ||
      !(isUnknownName(WORKFLOW_PORT_TYPES, edge.type) || placeholders.has(edge.from) || placeholders.has(edge.to)),
  );
  const newer = settings || placeholders.size > 0 || edges.length < graph.edges.length;
  return { ...base, graph: { ...graph, nodes, edges }, ...(newer ? { needsNewerApp: true } : {}) };
});

const saveResult = onRecord((record) =>
  record.ok === false ? { ...record, conflict: detail(record.conflict) } : record,
);

const runPage = onRecord((record) => mapList(mapList(record, "runs", runDetail), "soloSteps", step));

function mapped<T>(map: (value: unknown) => unknown, decode: (value: unknown) => T) {
  return (value: unknown): T => decode(map(value));
}

export const decodeRemoteWorkflowSummary = mapped(summary, guardedDecoder(isWorkflowSummary, "remote workflow"));
export const decodeRemoteWorkflowDetail = mapped(detail, guardedDecoder(isWorkflowDetail, "remote workflow"));
export function decodeRemoteWorkflowVersionGraph(value: unknown) {
  if (!isDynamicRecord(value)) throw new Error("Invalid remote workflow version.");
  const mappedDetail = detail({ graph: value.graph });
  if (!isDynamicRecord(mappedDetail)) throw new Error("Invalid remote workflow version.");
  return decodeVersionGraph(mappedDetail.graph);
}
export const decodeRemoteWorkflowSaveResult = mapped(
  saveResult,
  guardedDecoder(isWorkflowSaveResult, "remote workflow save result"),
);
export const decodeRemoteWorkflowRunDetail = mapped(
  runDetail,
  guardedDecoder(isWorkflowRunDetail, "remote workflow run"),
);
export const decodeRemoteWorkflowRunPage = mapped(runPage, guardedDecoder(isWorkflowRunPage, "remote workflow runs"));
export const decodeRemoteWorkflowStep = mapped(step, guardedDecoder(isWorkflowStep, "remote workflow step"));
export function decodeRemoteWorkflowStepSettings(value: unknown): WorkflowStepSettings {
  if (
    !isDynamicRecord(value) ||
    !(value.settings === null || isWorkflowFields(value.settings)) ||
    !(value.sources === null || Array.isArray(value.sources))
  )
    throw new Error("Invalid remote workflow step settings.");
  return {
    settings: value.settings,
    sources:
      value.sources === null
        ? null
        : value.sources
            .filter(isWorkflowStepSource)
            .map(({ from, type, stepId, attachmentId }) => ({ from, type, stepId, attachmentId })),
  };
}
export const decodeRemoteWorkflowSecret = guardedDecoder(isWorkflowWebhookSecret, "remote workflow webhook secret");
const decodeVersionGraph = guardedDecoder(isWorkflowGraph, "remote workflow version");
const decodeWorkflowSummaries = guardedListDecoder(isWorkflowSummary, "remote workflow list");
const decodeWorkflowVersions = guardedListDecoder(isWorkflowVersion, "remote workflow versions");

export function decodeRemoteWorkflowPicture(value: unknown): string {
  if (!isDynamicRecord(value) || typeof value.fileId !== "string" || !value.fileId)
    throw new Error("Invalid remote workflow picture.");
  return value.fileId;
}

export function decodeRemoteWorkflowMediaProviders(value: unknown): { sunra: boolean } {
  if (!isDynamicRecord(value) || typeof value.sunra !== "boolean")
    throw new Error("Invalid remote workflow providers.");
  return { sunra: value.sunra };
}

export function decodeRemoteHiggsfieldProviders(value: unknown): { higgsfield: boolean } {
  if (!isDynamicRecord(value) || typeof value.higgsfield !== "boolean")
    throw new Error("Invalid remote workflow providers.");
  return { higgsfield: value.higgsfield };
}

function remoteCreditBalance(value: unknown): WorkflowMediaCreditBalance | null {
  if (value === null) return null;
  if (!isWorkflowMediaCreditBalance(value)) throw new Error("Invalid remote workflow credits.");
  return { available: value.available, quota: value.quota };
}

export function decodeRemoteWorkflowMediaCredits(value: unknown): { sunra: WorkflowMediaCreditBalance | null } {
  if (!isDynamicRecord(value)) throw new Error("Invalid remote workflow credits.");
  return { sunra: remoteCreditBalance(value.sunra) };
}

export function decodeRemoteHiggsfieldCredits(value: unknown): { higgsfield: WorkflowMediaCreditBalance | null } {
  if (!isDynamicRecord(value)) throw new Error("Invalid remote workflow credits.");
  return { higgsfield: remoteCreditBalance(value.higgsfield) };
}

export function decodeRemoteCreditMediaCredits(value: unknown): { openbot: WorkflowMediaCreditBalance | null } {
  if (!isDynamicRecord(value)) throw new Error("Invalid remote workflow credits.");
  return { openbot: remoteCreditBalance(value.openbot) };
}

function remoteAccountList<T>(value: unknown, item: (entry: unknown) => entry is T): T[] {
  if (
    !isDynamicRecord(value) ||
    !Array.isArray(value.accounts) ||
    value.accounts.length > WORKFLOW_MEDIA_SERVICE_ACCOUNT_MAX
  )
    throw new Error("Invalid remote workflow accounts.");
  return value.accounts.filter(item);
}

export function decodeRemoteMediaServiceAccounts(value: unknown): WorkflowMediaServiceAccount[] {
  return remoteAccountList(value, isWorkflowMediaServiceAccount).map(({ provider, id, name }) => ({
    provider,
    id,
    name,
  }));
}

export function decodeRemoteMediaServiceCredits(value: unknown): WorkflowMediaAccountCredits[] {
  return remoteAccountList(value, isWorkflowMediaAccountCredits).map(({ provider, id, name, credits }) => ({
    provider,
    id,
    name,
    credits: credits && { available: credits.available, quota: credits.quota },
  }));
}

export function workflowMediaProvidersOf(accounts: readonly WorkflowMediaServiceAccount[]): WorkflowMediaProviders {
  return {
    sunra: accounts.some((account) => account.provider === "sunra"),
    higgsfield: accounts.some((account) => account.provider === "higgsfield"),
    accounts,
  };
}

export function workflowMediaCreditsOf(accounts: readonly WorkflowMediaAccountCredits[]): WorkflowMediaCredits {
  const first = (provider: WorkflowCatalogProvider) =>
    accounts.find((account) => account.provider === provider)?.credits ?? null;
  return { sunra: first("sunra"), higgsfield: first("higgsfield"), accounts };
}

export function decodeRemoteWorkflowMediaCatalog(value: unknown): WorkflowMediaCatalog {
  if (!isDynamicRecord(value) || !Array.isArray(value.models) || value.models.length > WORKFLOW_MEDIA_CATALOG_MAX)
    throw new Error("Invalid remote workflow catalog.");
  return {
    models: value.models.filter(isWorkflowMediaCatalogModel).map((model) => ({
      id: model.id,
      provider: model.provider,
      providerModel: model.providerModel,
      name: model.name,
      maker: model.maker,
      kinds: [...model.kinds],
      aspects: [...model.aspects],
      durations: [...model.durations],
      resolutions: [...model.resolutions],
      transparent: model.transparent,
      ...(model.options?.length
        ? {
            options: model.options.map((option) => ({
              name: option.name,
              kind: option.kind,
              values: [...option.values],
              default: option.default,
            })),
          }
        : {}),
      ...(model.inputs ? { inputs: [...model.inputs] } : {}),
      ...(model.modes?.length
        ? { modes: model.modes.map((mode) => ({ value: mode.value, inputs: [...mode.inputs] })) }
        : {}),
    })),
  };
}

export function decodeRemoteWorkflowMediaPrice(value: unknown): WorkflowMediaPrice {
  if (!isWorkflowMediaPrice(value)) throw new Error("Invalid remote workflow price.");
  return { credits: value.credits };
}

export function decodeRemoteWorkflowList(value: unknown) {
  if (!isDynamicRecord(value) || !Array.isArray(value.workflows)) throw new Error("Invalid remote workflow list.");
  return decodeWorkflowSummaries(value.workflows.map(summary));
}

export function decodeRemoteWorkflowVersions(value: unknown) {
  if (!isDynamicRecord(value) || !Array.isArray(value.versions)) throw new Error("Invalid remote workflow versions.");
  return decodeWorkflowVersions(value.versions.map(version));
}

const githubDelivery = (value: unknown): unknown[] => {
  if (!isDynamicRecord(value)) return [value];
  if (isUnknownName(WORKFLOW_GITHUB_EVENTS, value.event)) return [];
  const outcome = withKnown(value, "outcome", WORKFLOW_GITHUB_DELIVERY_OUTCOMES, "skipped");
  return [isUnknownName(WORKFLOW_GITHUB_SKIP_REASONS, outcome.reason) ? { ...outcome, reason: null } : outcome];
};

const githubHistory = onRecord((record) =>
  Array.isArray(record.deliveries) ? { ...record, deliveries: record.deliveries.flatMap(githubDelivery) } : record,
);

export const decodeRemoteWorkflowGitHubHistory = mapped(
  githubHistory,
  guardedDecoder(isWorkflowGitHubHistory, "remote workflow GitHub history"),
);
export const decodeRemoteWorkflowGitHubCatalog = guardedDecoder(
  isWorkflowGitHubCatalog,
  "remote workflow GitHub catalog",
);
export const decodeRemoteWorkflowGitHubOptions = guardedDecoder(
  isWorkflowGitHubRepositoryOptions,
  "remote workflow GitHub options",
);
