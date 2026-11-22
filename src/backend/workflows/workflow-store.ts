import {
  isRoutineSchedule,
  isWorkflowEdge,
  isWorkflowGraph,
  isWorkflowNode,
  nodeAgentId,
  type RoutineSchedule,
  WORKFLOW_AUTO_VERSION_INTERVAL_MS,
  WORKFLOW_MAX_VERSIONS,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_VERSION_KINDS,
  type WorkflowDetail,
  type WorkflowEdge,
  type WorkflowGraph,
  type WorkflowGraphProblem,
  type WorkflowNode,
  type WorkflowSaveResult,
  type WorkflowSummary,
  type WorkflowTriggerState,
  type WorkflowVersion,
  type WorkflowVersionKind,
  workflowGraphProblem,
} from "@openbot/contracts/ipc";
import { type DynamicRecord, isOneOf } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Schema } from "effect";
import {
  checkedColumn,
  databaseRow,
  databaseRows,
  optionalStringColumn,
  requiredNumberColumn,
  requiredStringColumn,
} from "../database/database-rows";
import type { OpenBotDatabase } from "../openbot-database";
import { nodeTimezone } from "./workflow-graph";
import { workflowTransaction } from "./workflow-transaction";

export class WorkflowStoreError extends Schema.TaggedError<WorkflowStoreError>()("WorkflowStoreError", {
  code: Schema.Literals(["missing", "refused"]),
  message: Schema.String,
}) {}

const NO_OPEN_RUN = `NOT EXISTS (SELECT 1 FROM workflow_runs AS r WHERE r.workflow_id = t.workflow_id
  AND r.status IN ('running', 'approval', 'stopping'))`;

const STORED_TRIGGER_KINDS = ["manual", "schedule", "webhook"] as const;
type StoredTriggerKind = (typeof STORED_TRIGGER_KINDS)[number];

const PROBLEM_TEXT = {
  annotation: "error.workflow.annotation",
  port: "error.workflow.port",
  branch: "error.workflow.branch",
  "condition-branch": "error.workflow.conditionBranch",
  duplicate: "error.workflow.duplicateEdge",
} as const satisfies Record<WorkflowGraphProblem, string>;

export interface DueWorkflowTrigger {
  workflowId: string;
  nodeId: string;
  schedule: RoutineSchedule;
  timezone: string | null;
  dueAt: string;
}

export interface WorkflowStoreOptions {
  database: OpenBotDatabase;
  createId?: () => string;
  nextDueAt?: (schedule: RoutineSchedule, timezone: string | null, now: Date) => string | null;
}

export class WorkflowStore {
  readonly #database: OpenBotDatabase;
  readonly #createId: () => string;
  readonly #nextDueAt: (schedule: RoutineSchedule, timezone: string | null, now: Date) => string | null;

  constructor(options: WorkflowStoreOptions) {
    this.#database = options.database;
    this.#createId = options.createId ?? (() => crypto.randomUUID());
    this.#nextDueAt = options.nextDueAt ?? (() => null);
  }

  list(): WorkflowSummary[] {
    return databaseRows(
      this.#database.connection.prepare(`${SUMMARY_SELECT} ORDER BY w.updated_at DESC, w.workflow_id`).all(),
    ).map(toSummary);
  }

  listWithGraphs(): { summary: WorkflowSummary; graph: WorkflowGraph }[] {
    const db = this.#database.connection;
    const rows = databaseRows(db.prepare(`${SUMMARY_SELECT} ORDER BY w.updated_at DESC, w.workflow_id`).all());
    const nodes = byWorkflow(
      databaseRows(db.prepare("SELECT * FROM workflow_nodes ORDER BY workflow_id, position, node_id").all()),
    );
    const edges = byWorkflow(
      databaseRows(db.prepare("SELECT * FROM workflow_edges ORDER BY workflow_id, position, edge_id").all()),
    );
    return rows.map((row) => {
      const workflowId = requiredStringColumn(row, "workflow_id");
      return {
        summary: toSummary(row),
        graph: toGraph(
          nodes.get(workflowId) ?? [],
          edges.get(workflowId) ?? [],
          requiredStringColumn(row, "strokes_json"),
        ),
      };
    });
  }

  workflowsOfAgent(agentId: string): string[] {
    return databaseRows(
      this.#database.connection
        .prepare("SELECT DISTINCT workflow_id FROM workflow_nodes WHERE agent_id = ? ORDER BY workflow_id")
        .all(agentId),
    ).map((row) => requiredStringColumn(row, "workflow_id"));
  }

  detail(workflowId: string): WorkflowDetail | null {
    const row = databaseRow(
      this.#database.connection.prepare(`${SUMMARY_SELECT} WHERE w.workflow_id = ?`).get(workflowId),
    );
    if (!row) return null;
    return {
      summary: toSummary(row),
      graph: this.#graph(workflowId, requiredStringColumn(row, "strokes_json")),
      revision: requiredNumberColumn(row, "graph_revision"),
      triggers: this.#triggers(workflowId),
    };
  }

  create(input: { title: string; graph?: WorkflowGraph; paused?: true }, now = new Date()): WorkflowDetail {
    const graph = input.graph ?? { nodes: [], edges: [], strokes: [] };
    assertRunnable(graph);
    const workflowId = this.#createId();
    return this.#transaction(() => {
      const at = now.toISOString();
      this.#database.connection
        .prepare("INSERT INTO workflows (workflow_id, title, paused, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(workflowId, input.title.trim(), input.paused ? 1 : 0, at, at);
      this.#writeGraph(workflowId, graph, now);
      return this.#requireDetail(workflowId);
    });
  }

  rename(workflowId: string, title: string, now = new Date()): WorkflowSummary {
    const result = this.#database.connection
      .prepare("UPDATE workflows SET title = ?, updated_at = ? WHERE workflow_id = ?")
      .run(title.trim(), now.toISOString(), workflowId);
    if (Number(result.changes) === 0) throw missing();
    return this.#requireDetail(workflowId).summary;
  }

  setPaused(workflowId: string, paused: boolean, now = new Date()): WorkflowSummary {
    const result = this.#database.connection
      .prepare("UPDATE workflows SET paused = ?, updated_at = ? WHERE workflow_id = ?")
      .run(paused ? 1 : 0, now.toISOString(), workflowId);
    if (Number(result.changes) === 0) throw missing();
    return this.#requireDetail(workflowId).summary;
  }

  remove(workflowId: string, now = new Date()): boolean {
    return this.#transaction(() => {
      this.#database.connection
        .prepare(
          `INSERT OR IGNORE INTO projection_webhook_route_revocations (route_id, created_at)
           SELECT route_id, ? FROM workflow_trigger_webhooks WHERE workflow_id = ?`,
        )
        .run(now.toISOString(), workflowId);
      const result = this.#database.connection.prepare("DELETE FROM workflows WHERE workflow_id = ?").run(workflowId);
      return Number(result.changes) > 0;
    });
  }

  saveGraph(workflowId: string, baseRevision: number, graph: WorkflowGraph, now = new Date()): WorkflowSaveResult {
    assertRunnable(graph);
    return this.#transaction(() => {
      const revision = this.#revision(workflowId);
      if (revision !== baseRevision) return { ok: false, conflict: this.#requireDetail(workflowId) };
      this.#writeGraph(workflowId, graph, now);
      const next = this.#bumpRevision(workflowId, now);
      const last = this.#lastVersionAt(workflowId);
      if (last === null || now.getTime() - last >= WORKFLOW_AUTO_VERSION_INTERVAL_MS)
        this.#addVersion(workflowId, next, "auto", graph, now);
      return { ok: true, revision: next };
    });
  }

  nextTriggerDueAt(): string | null {
    const row = databaseRow(
      this.#database.connection
        .prepare(
          `SELECT MIN(t.next_due_at) AS due FROM workflow_triggers AS t
           WHERE t.kind = 'schedule' AND t.next_due_at IS NOT NULL AND ${NO_OPEN_RUN}`,
        )
        .get(),
    );
    return row ? optionalStringColumn(row, "due") : null;
  }

  dueTriggers(now: Date): DueWorkflowTrigger[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT t.workflow_id, t.node_id, t.schedule_json, t.timezone, t.next_due_at FROM workflow_triggers AS t
           WHERE t.kind = 'schedule' AND t.next_due_at IS NOT NULL AND t.next_due_at <= ? AND ${NO_OPEN_RUN}
           ORDER BY t.next_due_at, t.workflow_id, t.node_id`,
        )
        .all(now.toISOString()),
    ).flatMap((row) => {
      const schedule = JSON.parse(optionalStringColumn(row, "schedule_json") ?? "null");
      if (!isRoutineSchedule(schedule)) return [];
      return [
        {
          workflowId: requiredStringColumn(row, "workflow_id"),
          nodeId: requiredStringColumn(row, "node_id"),
          schedule,
          timezone: optionalStringColumn(row, "timezone"),
          dueAt: requiredStringColumn(row, "next_due_at"),
        },
      ];
    });
  }

  advanceTrigger(due: DueWorkflowTrigger, nextDueAt: string | null, now = new Date()): boolean {
    const result = this.#database.connection
      .prepare(
        `UPDATE workflow_triggers SET next_due_at = ?, updated_at = ?
         WHERE workflow_id = ? AND node_id = ? AND next_due_at = ?`,
      )
      .run(nextDueAt, now.toISOString(), due.workflowId, due.nodeId, due.dueAt);
    return Number(result.changes) > 0;
  }

  versions(workflowId: string): WorkflowVersion[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT version_id, graph_revision, kind, created_at FROM workflow_versions WHERE workflow_id = ?
           ORDER BY created_at DESC, version_id DESC`,
        )
        .all(workflowId),
    ).map(toVersion);
  }

  versionGraph(workflowId: string, versionId: string): WorkflowGraph | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT graph_json FROM workflow_versions WHERE workflow_id = ? AND version_id = ?")
        .get(workflowId, versionId),
    );
    return row ? storedGraph(requiredStringColumn(row, "graph_json")) : null;
  }

  restoreVersion(workflowId: string, versionId: string, now = new Date()): WorkflowDetail {
    return this.#transaction(() => {
      const row = databaseRow(
        this.#database.connection
          .prepare("SELECT graph_json FROM workflow_versions WHERE workflow_id = ? AND version_id = ?")
          .get(workflowId, versionId),
      );
      if (!row) throw new WorkflowStoreError({ code: "missing", message: sourceText("error.workflow.versionMissing") });
      const graph = storedGraph(requiredStringColumn(row, "graph_json"));
      assertRunnable(graph);
      const current = this.#requireDetail(workflowId);
      this.#addVersion(workflowId, current.revision, "restore", current.graph, now);
      this.#writeGraph(workflowId, graph, now);
      this.#bumpRevision(workflowId, now);
      return this.#requireDetail(workflowId);
    });
  }

  addRunVersion(workflowId: string, revision: number, graph: WorkflowGraph, now = new Date()): void {
    const newest = databaseRow(
      this.#database.connection
        .prepare(
          `SELECT graph_revision FROM workflow_versions WHERE workflow_id = ?
           ORDER BY created_at DESC, version_id DESC LIMIT 1`,
        )
        .get(workflowId),
    );
    if (newest && requiredNumberColumn(newest, "graph_revision") === revision) return;
    this.#addVersion(workflowId, revision, "run", graph, now);
  }

  #graph(workflowId: string, strokesJson: string): WorkflowGraph {
    const db = this.#database.connection;
    return toGraph(
      databaseRows(
        db.prepare("SELECT * FROM workflow_nodes WHERE workflow_id = ? ORDER BY position, node_id").all(workflowId),
      ),
      databaseRows(
        db.prepare("SELECT * FROM workflow_edges WHERE workflow_id = ? ORDER BY position, edge_id").all(workflowId),
      ),
      strokesJson,
    );
  }

  #triggers(workflowId: string): WorkflowTriggerState[] {
    return databaseRows(
      this.#database.connection
        .prepare(
          `SELECT t.node_id, t.kind, t.next_due_at, h.url FROM workflow_triggers AS t
           LEFT JOIN workflow_trigger_webhooks AS h ON h.workflow_id = t.workflow_id AND h.node_id = t.node_id
           WHERE t.workflow_id = ? ORDER BY t.node_id`,
        )
        .all(workflowId),
    ).map((row) => ({
      nodeId: requiredStringColumn(row, "node_id"),
      type: checkedColumn(row, "kind", STORED_TRIGGER_KINDS),
      nextDueAt: optionalStringColumn(row, "next_due_at"),
      webhookUrl: optionalStringColumn(row, "url"),
    }));
  }

  #writeGraph(workflowId: string, graph: WorkflowGraph, now: Date): void {
    const db = this.#database.connection;
    const at = now.toISOString();
    const kept = new Set(graph.nodes.map((node) => node.id));
    const desired = new Map(
      graph.nodes.flatMap((node) => {
        const kind = triggerKind(node);
        return kind ? [[node.id, { node, kind }] as const] : [];
      }),
    );
    const revoke = db.prepare(
      `INSERT OR IGNORE INTO projection_webhook_route_revocations (route_id, created_at)
       SELECT route_id, ? FROM workflow_trigger_webhooks WHERE workflow_id = ? AND node_id = ?`,
    );
    const existing = databaseRows(
      db
        .prepare("SELECT node_id, kind, schedule_json, timezone FROM workflow_triggers WHERE workflow_id = ?")
        .all(workflowId),
    );
    for (const row of existing) {
      const nodeId = requiredStringColumn(row, "node_id");
      const next = desired.get(nodeId);
      if (row.kind === "webhook" && next?.kind !== "webhook") {
        revoke.run(at, workflowId, nodeId);
        db.prepare("DELETE FROM workflow_trigger_webhooks WHERE workflow_id = ? AND node_id = ?").run(
          workflowId,
          nodeId,
        );
      }
      if (!next)
        db.prepare("DELETE FROM workflow_triggers WHERE workflow_id = ? AND node_id = ?").run(workflowId, nodeId);
    }
    for (const row of databaseRows(
      db.prepare("SELECT node_id FROM workflow_nodes WHERE workflow_id = ?").all(workflowId),
    )) {
      const nodeId = requiredStringColumn(row, "node_id");
      if (!kept.has(nodeId))
        db.prepare("DELETE FROM workflow_nodes WHERE workflow_id = ? AND node_id = ?").run(workflowId, nodeId);
    }
    db.prepare("DELETE FROM workflow_edges WHERE workflow_id = ?").run(workflowId);

    const upsertNode = db.prepare(
      `INSERT INTO workflow_nodes (workflow_id, node_id, position, kind, agent_id, x, y, width, height, font, locked,
         fields_json, schedule_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workflow_id, node_id) DO UPDATE SET position = excluded.position, kind = excluded.kind,
         agent_id = excluded.agent_id, x = excluded.x, y = excluded.y, width = excluded.width,
         height = excluded.height, font = excluded.font, locked = excluded.locked,
         fields_json = excluded.fields_json, schedule_json = excluded.schedule_json`,
    );
    graph.nodes.forEach((node, position) => {
      upsertNode.run(
        workflowId,
        node.id,
        position,
        node.kind,
        nodeAgentId(node),
        node.at.x,
        node.at.y,
        node.size?.width ?? null,
        node.size?.height ?? null,
        node.size?.font ?? null,
        node.locked ? 1 : 0,
        JSON.stringify(node.fields),
        node.schedule ? JSON.stringify(node.schedule) : null,
      );
    });
    const insertEdge = db.prepare(
      `INSERT INTO workflow_edges (workflow_id, edge_id, position, from_node_id, to_node_id, port_type, branch)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    graph.edges.forEach((edge, position) => {
      insertEdge.run(workflowId, edge.id, position, edge.from, edge.to, edge.type, edge.branch ?? null);
    });

    const previous = new Map(existing.map((row) => [requiredStringColumn(row, "node_id"), row]));
    const upsertTrigger = db.prepare(
      `INSERT INTO workflow_triggers (workflow_id, node_id, kind, timezone, schedule_json, next_due_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workflow_id, node_id) DO UPDATE SET kind = excluded.kind, timezone = excluded.timezone,
         schedule_json = excluded.schedule_json, next_due_at = excluded.next_due_at, updated_at = excluded.updated_at`,
    );
    for (const [nodeId, { node, kind }] of desired) {
      const timezone = nodeTimezone(node);
      const scheduleJson = kind === "schedule" && node.schedule ? JSON.stringify(node.schedule) : null;
      const before = previous.get(nodeId);
      if (before?.kind === kind && before.schedule_json === scheduleJson && before.timezone === timezone) continue;
      const nextDueAt = kind === "schedule" && node.schedule ? this.#nextDueAt(node.schedule, timezone, now) : null;
      upsertTrigger.run(workflowId, nodeId, kind, timezone, scheduleJson, nextDueAt, at);
    }
    db.prepare("UPDATE workflows SET strokes_json = ?, updated_at = ? WHERE workflow_id = ?").run(
      JSON.stringify(graph.strokes),
      at,
      workflowId,
    );
  }

  #revision(workflowId: string): number {
    const row = databaseRow(
      this.#database.connection.prepare("SELECT graph_revision FROM workflows WHERE workflow_id = ?").get(workflowId),
    );
    if (!row) throw missing();
    return requiredNumberColumn(row, "graph_revision");
  }

  #bumpRevision(workflowId: string, now: Date): number {
    this.#database.connection
      .prepare("UPDATE workflows SET graph_revision = graph_revision + 1, updated_at = ? WHERE workflow_id = ?")
      .run(now.toISOString(), workflowId);
    return this.#revision(workflowId);
  }

  #lastVersionAt(workflowId: string): number | null {
    const row = databaseRow(
      this.#database.connection
        .prepare("SELECT MAX(created_at) AS created_at FROM workflow_versions WHERE workflow_id = ?")
        .get(workflowId),
    );
    const at = row ? optionalStringColumn(row, "created_at") : null;
    return at === null ? null : Date.parse(at);
  }

  #addVersion(workflowId: string, revision: number, kind: WorkflowVersionKind, graph: WorkflowGraph, now: Date): void {
    const db = this.#database.connection;
    db.prepare(
      `INSERT INTO workflow_versions (version_id, workflow_id, graph_revision, kind, graph_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(this.#createId(), workflowId, revision, kind, JSON.stringify(graph), now.toISOString());
    db.prepare(
      `DELETE FROM workflow_versions WHERE workflow_id = ? AND version_id NOT IN (
         SELECT version_id FROM workflow_versions WHERE workflow_id = ?
         ORDER BY created_at DESC, version_id DESC LIMIT ?
       )`,
    ).run(workflowId, workflowId, WORKFLOW_MAX_VERSIONS);
  }

  #requireDetail(workflowId: string): WorkflowDetail {
    const detail = this.detail(workflowId);
    if (!detail) throw missing();
    return detail;
  }

  #transaction<T>(work: () => T): T {
    return workflowTransaction(this.#database, work);
  }
}

const SUMMARY_SELECT = `
  SELECT w.workflow_id, w.title, w.graph_revision, w.strokes_json, w.updated_at, w.paused,
    (SELECT COUNT(*) FROM workflow_nodes AS n
      WHERE n.workflow_id = w.workflow_id AND n.kind NOT IN ('text', 'note', 'shape')) AS steps,
    (SELECT r.status FROM workflow_runs AS r WHERE r.workflow_id = w.workflow_id
      ORDER BY r.started_at DESC, r.run_id DESC LIMIT 1) AS last_run_status,
    (SELECT COALESCE(r.ended_at, r.started_at) FROM workflow_runs AS r WHERE r.workflow_id = w.workflow_id
      ORDER BY r.started_at DESC, r.run_id DESC LIMIT 1) AS last_run_at
  FROM workflows AS w`;

function assertRunnable(graph: WorkflowGraph): void {
  const problem = workflowGraphProblem(graph);
  if (problem) throw new WorkflowStoreError({ code: "refused", message: sourceText(PROBLEM_TEXT[problem]) });
}

function missing(): WorkflowStoreError {
  return new WorkflowStoreError({ code: "missing", message: sourceText("error.workflow.missing") });
}

function triggerKind(node: WorkflowNode): StoredTriggerKind | null {
  if (node.kind !== "trigger") return null;
  const value = node.fields.trigger ?? "manual";
  return isOneOf(STORED_TRIGGER_KINDS, value) ? value : null;
}

function storedGraph(json: string): WorkflowGraph {
  const graph = JSON.parse(json);
  if (!isWorkflowGraph(graph)) throw new Error("The stored workflow graph is invalid.");
  return graph;
}

function byWorkflow(rows: readonly DynamicRecord[]): Map<string, DynamicRecord[]> {
  const groups = new Map<string, DynamicRecord[]>();
  for (const row of rows) {
    const workflowId = requiredStringColumn(row, "workflow_id");
    const group = groups.get(workflowId);
    if (group) group.push(row);
    else groups.set(workflowId, [row]);
  }
  return groups;
}

function toGraph(nodeRows: readonly DynamicRecord[], edgeRows: readonly DynamicRecord[], strokesJson: string) {
  const graph = { nodes: nodeRows.map(toNode), edges: edgeRows.map(toEdge), strokes: JSON.parse(strokesJson) };
  if (!isWorkflowGraph(graph)) throw new Error("The stored workflow graph is invalid.");
  return graph;
}

function optionalNumber(row: DynamicRecord, key: string): number | undefined {
  const value = row[key];
  return value === null || value === undefined ? undefined : Number(value);
}

function toNode(row: DynamicRecord): WorkflowNode {
  const width = optionalNumber(row, "width");
  const height = optionalNumber(row, "height");
  const font = optionalNumber(row, "font");
  const schedule = optionalStringColumn(row, "schedule_json");
  const node = {
    id: requiredStringColumn(row, "node_id"),
    kind: requiredStringColumn(row, "kind"),
    at: { x: Number(row.x), y: Number(row.y) },
    ...(width === undefined && height === undefined && font === undefined
      ? {}
      : {
          size: {
            ...(width === undefined ? {} : { width }),
            ...(height === undefined ? {} : { height }),
            ...(font === undefined ? {} : { font }),
          },
        }),
    ...(row.locked === 1 ? { locked: true } : {}),
    fields: JSON.parse(requiredStringColumn(row, "fields_json")),
    ...(schedule === null ? {} : { schedule: JSON.parse(schedule) }),
  };
  if (!isWorkflowNode(node)) throw new Error("Invalid SQLite column: workflow_nodes");
  return node;
}

function toEdge(row: DynamicRecord): WorkflowEdge {
  const branch = optionalStringColumn(row, "branch");
  const edge = {
    id: requiredStringColumn(row, "edge_id"),
    from: requiredStringColumn(row, "from_node_id"),
    to: requiredStringColumn(row, "to_node_id"),
    type: requiredStringColumn(row, "port_type"),
    ...(branch === null ? {} : { branch }),
  };
  if (!isWorkflowEdge(edge)) throw new Error("Invalid SQLite column: workflow_edges");
  return edge;
}

function toSummary(row: DynamicRecord): WorkflowSummary {
  const status = row.last_run_status;
  const at = optionalStringColumn(row, "last_run_at");
  return {
    id: requiredStringColumn(row, "workflow_id"),
    title: requiredStringColumn(row, "title"),
    steps: requiredNumberColumn(row, "steps"),
    updatedAt: requiredStringColumn(row, "updated_at"),
    lastRun: isOneOf(WORKFLOW_RUN_STATUSES, status) && at !== null ? { status, at } : null,
    ...(requiredNumberColumn(row, "paused") === 1 ? { paused: true } : {}),
  };
}

function toVersion(row: DynamicRecord): WorkflowVersion {
  return {
    id: requiredStringColumn(row, "version_id"),
    at: requiredStringColumn(row, "created_at"),
    kind: checkedColumn(row, "kind", WORKFLOW_VERSION_KINDS),
    revision: requiredNumberColumn(row, "graph_revision"),
  };
}
