import { execFile, spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { dirname } from "node:path";
import { text as readText } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { redactText } from "@openbot/logging";
import { Schema } from "effect";
import { loadSharedDevelopmentEnvironment } from "./development-environment";
import { readScriptArguments } from "./script-arguments";

// Read-only SQL on the OpenPanel ClickHouse, for the openpanel skill. The user openbot_readonly can only
// SELECT from the view openbot_readonly.events (openpanel.events of project openbot). The server sets
// readonly=1 and the time, memory, thread and result limits. ClickHouse has no public port: the script
// opens an SSH tunnel to the container, or uses OPENPANEL_CLICKHOUSE_URL when a tunnel is already open.
// The credentials are OPENPANEL_CLICKHOUSE_USER and OPENPANEL_CLICKHOUSE_PASSWORD in
// apps/auth-api/.env.dev and .env.production. They are decrypted for each run and never written out.

const USAGE = `Usage:
  bun scripts/openpanel-sql.ts query '<sql>' [options]   SELECT from \`events\` (no FORMAT clause)
  bun scripts/openpanel-sql.ts query - [options]         read the SQL from stdin
  bun scripts/openpanel-sql.ts preset <name> [options]   percentiles with sample sizes
  bun scripts/openpanel-sql.ts presets                   list the presets

Options:
  --format table|json     output (default table)
  --show-identifiers      do not redact emails and profile, device and session IDs

Preset options:
  --days <n>              last n days (default 30); or --since/--until YYYY-MM-DD (until is exclusive)
  --by <keys>             group by these properties, comma-separated (default: the preset's)
  --metric <keys>         numeric properties to measure (default: the preset's)
  --min-n <n>             hide groups with fewer samples (default 20)
  --all-results           keep failed, cancelled and interrupted events
  --environment <name>    environment property (default production; "any" for all)
  --print-sql             print the SQL and do not run it`;

const SSH_HOST = process.env.OPENPANEL_SSH_HOST || "sui-alexandria";
const CONTAINER = "self-hosting-op-ch-1";
const CLICKHOUSE_HTTP_PORT = 8123;
const TUNNEL_TIMEOUT_MS = 15_000;

const GROUP_KEYS = new Set([
  "platform",
  "app_version",
  "provider",
  "model",
  "provider_auth",
  "origin",
  "status",
  "result",
  "surface",
  "event_schema_version",
  "host_kind",
  "ram_class",
  "cpu_class",
  "arch",
  "server_kind",
  "agent_source",
  "reasoning_effort",
  "token_usage",
]);

interface Preset {
  readonly description: string;
  readonly event: string;
  readonly metrics: readonly string[];
  readonly by: readonly string[];
  /** Keeps the successful events. --all-results removes it. */
  readonly success?: string;
}

const PRESETS: Record<string, Preset> = {
  "turn-duration": {
    description: "system_turn_completed duration_ms of completed turns, by provider",
    event: "system_turn_completed",
    metrics: ["duration_ms"],
    by: ["provider"],
    success: "properties['status'] = 'completed'",
  },
  resources: {
    description: "system_resources daily DB, main-loop, memory and CPU summaries, by platform",
    event: "system_resources",
    metrics: [
      "db_request_ms_p95",
      "db_request_ms_max",
      "main_loop_delay_ms_p95",
      "main_loop_delay_ms_max",
      "total_rss_mb_p95",
      "total_cpu_pct_p95",
      "window_rss_mb_p95",
      "window_js_heap_mb_p95",
    ],
    by: ["platform"],
  },
  "conversation-open": {
    description: "conversation_opened duration_ms (mobile) of succeeded opens, by platform",
    event: "conversation_opened",
    metrics: ["duration_ms"],
    by: ["platform"],
    success: "properties['result'] = 'succeeded'",
  },
  "voice-turn": {
    description: "voice_turn duration_ms (transcription) of succeeded turns, by platform",
    event: "voice_turn",
    metrics: ["duration_ms"],
    by: ["platform"],
    success: "properties['result'] = 'succeeded'",
  },
};

const PROPERTY_KEY = /^[a-z][a-z0-9_]*$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const EMAIL = /[^\s@"'<>,;]+@[^\s@"'<>,;]+\.[a-z]{2,}/giu;
const IDENTIFIER_COLUMN = /profile_id|device_id|session_id|email/iu;
// uniqExact(profile_id) and other counts of identifiers are numbers, not identifiers.
const NUMERIC_TYPE = /^(Nullable\()?(U?Int|Float|Decimal)/u;

const decodeResult = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      meta: Schema.Array(Schema.Struct({ name: Schema.String, type: Schema.String })),
      data: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
      rows: Schema.Number,
      statistics: Schema.optional(
        Schema.Struct({ elapsed: Schema.Number, rows_read: Schema.Number, bytes_read: Schema.Number }),
      ),
    }),
  ),
);
export type QueryResult = ReturnType<typeof decodeResult>;

export interface Connection {
  readonly url: string;
  readonly close: () => void;
}

const execFileAsync = promisify(execFile);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() =>
        typeof address === "object" && address ? resolve(address.port) : reject(new Error("No free port.")),
      );
    });
  });
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function openTunnel(): Promise<Connection> {
  // The container IP changes when Docker recreates the container, so read it for each tunnel.
  const { stdout } = await execFileAsync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      SSH_HOST,
      `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${CONTAINER}`,
    ],
    { timeout: TUNNEL_TIMEOUT_MS },
  );
  const containerIp = stdout.trim();
  if (!/^\d{1,3}(\.\d{1,3}){3}$/u.test(containerIp)) {
    throw new Error(`Cannot find the IP address of ${CONTAINER} on ${SSH_HOST}.`);
  }
  const port = await freePort();
  const tunnel = spawn(
    "ssh",
    [
      "-N",
      "-o",
      "BatchMode=yes",
      "-o",
      "ExitOnForwardFailure=yes",
      "-L",
      `127.0.0.1:${port}:${containerIp}:${CLICKHOUSE_HTTP_PORT}`,
      SSH_HOST,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  tunnel.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  let exited = false;
  tunnel.once("exit", () => {
    exited = true;
  });
  const close = () => {
    if (!exited) tunnel.kill();
  };
  const deadline = Date.now() + TUNNEL_TIMEOUT_MS;
  while (!(await canConnect(port))) {
    if (exited || Date.now() > deadline) {
      close();
      throw new Error(`The SSH tunnel to ${SSH_HOST} did not open. ${redactText(stderr.trim())}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { url: `http://127.0.0.1:${port}/`, close };
}

/** Uses OPENPANEL_CLICKHOUSE_URL when a tunnel is already open, for example in CI. */
export async function connectClickHouse(): Promise<Connection> {
  const existing = process.env.OPENPANEL_CLICKHOUSE_URL;
  return existing ? { url: existing, close: () => {} } : openTunnel();
}

export interface QueryRequest {
  readonly user: string;
  readonly password: string;
  readonly sql: string;
  readonly showIdentifiers: boolean;
}

// A limit can stop a query after ClickHouse sent part of the rows, with HTTP 500 or, after the
// headers, HTTP 200. Show only the exception, because those rows are not redacted.
function clickHouseError(status: number, body: string): Error {
  const exception = /Code: \d+\. DB::Exception: (?:[^\n"\\]|\\.)*/u.exec(body)?.[0];
  const detail = exception ? redactText(exception.replace(EMAIL, "<email>")) : "The output is not valid JSON.";
  return new Error(`ClickHouse returned HTTP ${status}. ${detail}`);
}

export async function runQuery(connection: Connection, request: QueryRequest): Promise<QueryResult> {
  // readonly=1 blocks every setting, also default_format, so the format goes in the query.
  const response = await fetch(connection.url, {
    method: "POST",
    headers: { "X-ClickHouse-User": request.user, "X-ClickHouse-Key": request.password },
    body: `${request.sql.trim().replace(/;+$/u, "")}\nFORMAT JSON`,
  });
  const text = await response.text();
  if (!response.ok) throw clickHouseError(response.status, text);
  let result: QueryResult;
  try {
    // The email pattern stops at a quote, so it cannot change the JSON structure.
    result = decodeResult(request.showIdentifiers ? text : text.replace(EMAIL, "<email>"));
  } catch {
    throw clickHouseError(response.status, text);
  }
  // JSON output quotes 64-bit integers.
  const integers = result.meta.filter((column) => /^(Nullable\()?U?Int64/u.test(column.type)).map((c) => c.name);
  const identifiers = request.showIdentifiers
    ? []
    : result.meta
        .filter((column) => IDENTIFIER_COLUMN.test(column.name) && !NUMERIC_TYPE.test(column.type))
        .map((c) => c.name);
  const data = result.data.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([name, value]) => {
        if (identifiers.includes(name) && value !== "" && value !== null) return [name, "<redacted>"];
        if (integers.includes(name) && typeof value === "string") return [name, Number(value)];
        return [name, value];
      }),
    ),
  );
  return { ...result, data };
}

function propertyKeys(value: string | undefined, fallback: readonly string[], allowed?: Set<string>): string[] {
  if (value === undefined) return [...fallback];
  const keys = value
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  for (const key of keys) {
    if (!PROPERTY_KEY.test(key) || (allowed && !allowed.has(key))) {
      throw new Error(
        `'${key}' is not a valid property key here.${allowed ? ` Use: ${[...allowed].join(", ")}.` : ""}`,
      );
    }
  }
  return keys;
}

function wholeNumber(value: string | undefined, fallback: number, name: string, minimum: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(`--${name} must be a whole number of ${minimum} or more.`);
  }
  return number;
}

interface PresetOptions {
  readonly days?: string;
  readonly since?: string;
  readonly until?: string;
  readonly by?: string;
  readonly metric?: string;
  readonly "min-n"?: string;
  readonly "all-results"?: boolean;
  readonly environment?: string;
}

function presetSql(preset: Preset, options: PresetOptions): string {
  const by = propertyKeys(options.by, preset.by, GROUP_KEYS);
  const metrics = propertyKeys(options.metric, preset.metrics);
  if (metrics.length === 0) throw new Error("Give at least one metric.");
  const minN = wholeNumber(options["min-n"], 20, "min-n", 0);
  const where = [`name = '${preset.event}'`];
  if (options.since !== undefined || options.until !== undefined) {
    if (options.days !== undefined) throw new Error("Use --days or --since and --until, not both.");
    for (const date of [options.since, options.until]) {
      if (date !== undefined && !DATE.test(date)) throw new Error("--since and --until take YYYY-MM-DD.");
    }
    if (options.since) where.push(`created_at >= toDateTime64('${options.since} 00:00:00', 3, 'UTC')`);
    if (options.until) where.push(`created_at < toDateTime64('${options.until} 00:00:00', 3, 'UTC')`);
  } else {
    where.push(`created_at >= now() - INTERVAL ${wholeNumber(options.days, 30, "days", 1)} DAY`);
  }
  const environment = options.environment ?? "production";
  if (environment !== "any") {
    if (!PROPERTY_KEY.test(environment)) throw new Error("--environment takes a name such as production.");
    where.push(`properties['environment'] = '${environment}'`);
  }
  if (preset.success && !options["all-results"]) where.push(preset.success);
  const inner = by.map((key) => `if(properties['${key}'] = '', '(none)', properties['${key}']) AS k_${key}`);
  const labels = by.map((key) => `if(grouping(k_${key}) = 1, '(all)', k_${key}) AS ${key}`);
  const keys = by.map((key) => `k_${key}`);
  const sets = by.length > 0 ? `GROUPING SETS ((metric, ${keys.join(", ")}), (metric))` : "metric";
  const allFirst = by.length > 0 ? `grouping(${keys[0]}) DESC, ` : "";
  return `SELECT
  metric,
  ${[...labels, ""].join(",\n  ")}count() AS n,
  uniqExact(profile_id) AS profiles,
  quantilesExact(0.5, 0.9, 0.99)(value) AS q,
  round(q[1], 1) AS p50,
  round(q[2], 1) AS p90,
  round(q[3], 1) AS p99,
  round(max(value), 1) AS max
FROM (
  SELECT
    metric,
    profile_id,
    ${[...inner, ""].join(",\n    ")}toFloat64OrNull(properties[metric]) AS value
  FROM events
  ARRAY JOIN [${metrics.map((metric) => `'${metric}'`).join(", ")}] AS metric
  WHERE ${where.join("\n    AND ")}
)
WHERE value IS NOT NULL AND value >= 0
GROUP BY ${sets}
HAVING n >= ${minN}
ORDER BY metric, ${allFirst}n DESC`;
}

function printTable(result: QueryResult, hidden: ReadonlySet<string>): void {
  const columns = result.meta.map((column) => column.name).filter((name) => !hidden.has(name));
  const cell = (value: unknown) =>
    value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const rows = result.data.map((row) => columns.map((name) => cell(row[name])));
  const widths = columns.map((name, index) => Math.max(name.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const numeric = columns.map((name) => result.data.every((row) => typeof row[name] === "number"));
  const line = (values: readonly string[]) =>
    values
      .map((value, index) => (numeric[index] ? value.padStart(widths[index] ?? 0) : value.padEnd(widths[index] ?? 0)))
      .join("  ")
      .trimEnd();
  process.stdout.write(`${line(columns)}\n${line(widths.map((width) => "-".repeat(width)))}\n`);
  for (const row of rows) process.stdout.write(`${line(row)}\n`);
  const stats = result.statistics;
  process.stdout.write(
    `\n${result.rows} rows${stats ? `, ${stats.rows_read.toLocaleString("en")} rows read in ${stats.elapsed.toFixed(2)} s` : ""}\n`,
  );
}

export async function credentials(): Promise<{ user: string; password: string }> {
  let user = process.env.OPENPANEL_CLICKHOUSE_USER;
  let password = process.env.OPENPANEL_CLICKHOUSE_PASSWORD;
  if (!user || !password) {
    const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const shared = await loadSharedDevelopmentEnvironment(projectRoot);
    user ||= shared.OPENPANEL_CLICKHOUSE_USER;
    password ||= shared.OPENPANEL_CLICKHOUSE_PASSWORD;
  }
  if (!user || !password) {
    throw new Error(
      "OPENPANEL_CLICKHOUSE_USER and OPENPANEL_CLICKHOUSE_PASSWORD are not available. See .agents/skills/openpanel/SKILL.md to load the key.",
    );
  }
  return { user, password };
}

async function main(): Promise<void> {
  const parsed = readScriptArguments({
    usage: USAGE,
    maxPositionals: 2,
    options: {
      format: { type: "string" },
      "show-identifiers": { type: "boolean" },
      days: { type: "string" },
      since: { type: "string" },
      until: { type: "string" },
      by: { type: "string" },
      metric: { type: "string" },
      "min-n": { type: "string" },
      "all-results": { type: "boolean" },
      environment: { type: "string" },
      "print-sql": { type: "boolean" },
    },
  });
  if (!parsed) return;
  const [command, argument] = parsed.positionals;
  const { values } = parsed;
  const format = values.format ?? "table";
  if (format !== "table" && format !== "json") throw new Error("--format takes table or json.");

  if (command === "presets") {
    for (const [name, preset] of Object.entries(PRESETS)) process.stdout.write(`${name}: ${preset.description}\n`);
    return;
  }
  let sql: string;
  let hidden = new Set<string>();
  if (command === "query" && argument) {
    sql = argument === "-" ? await readText(process.stdin) : argument;
  } else if (command === "preset" && argument) {
    const preset = PRESETS[argument];
    if (!preset) throw new Error(`Unknown preset '${argument}'. Run: bun scripts/openpanel-sql.ts presets`);
    sql = presetSql(preset, values);
    hidden = new Set(["q"]);
  } else {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  if (values["print-sql"]) {
    process.stdout.write(`${sql}\n`);
    return;
  }

  const { user, password } = await credentials();
  const connection = await connectClickHouse();
  try {
    const showIdentifiers = values["show-identifiers"] === true;
    const result = await runQuery(connection, { user, password, sql, showIdentifiers });
    if (format === "json") {
      const data = result.data.map((row) =>
        Object.fromEntries(Object.entries(row).filter(([key]) => !hidden.has(key))),
      );
      process.stdout.write(`${JSON.stringify({ rows: result.rows, statistics: result.statistics, data }, null, 2)}\n`);
    } else {
      printTable(result, hidden);
    }
  } finally {
    connection.close();
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write(`${redactText(error instanceof Error ? error.message : String(error))}\n`);
    process.exitCode = 1;
  });
}
