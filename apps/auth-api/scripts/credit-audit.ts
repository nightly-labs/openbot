import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { normalizeEmailAddress } from "@openbot/contracts/validation";

const AUTH_API_ROOT = resolve(import.meta.dirname, "..");
const WRANGLER = join(AUTH_API_ROOT, "..", "..", "node_modules", ".bin", "wrangler");
const DAY_MS = 24 * 60 * 60 * 1_000;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,200}$/;

type Target = "local" | "test" | "production";

interface Options {
  target: Target;
  persistTo: string | null;
  user: string | null;
  server: string | null;
  reference: string | null;
  failed: boolean;
  sinceDays: number;
  limit: number;
}

function usage(): never {
  process.stdout.write(
    [
      "Usage: bun apps/auth-api/scripts/credit-audit.ts <command> [filters] [target]",
      "Commands:",
      "  list       Show audit rows, newest first",
      "  summary    Count rows by event and code, credits by model, and the accounts that spend most",
      "Filters: --user <id|email> --server <id> --ref <job, checkout or transfer id> --failed",
      "         --days <n> (default 30) --limit <n> (default 100, list only)",
      "Targets: --local [--persist-to <dir>] (default), --test, --production",
      "The script only reads.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

function positiveInteger(value: string | undefined, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) usage();
  return parsed;
}

function identifier(value: string | undefined): string {
  if (!value || !ID_PATTERN.test(value)) usage();
  return value;
}

function readOptions(args: string[]): Options {
  const options: Options = {
    target: "local",
    persistTo: null,
    user: null,
    server: null,
    reference: null,
    failed: false,
    sinceDays: 30,
    limit: 100,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const next = args[index + 1];
    if (arg === "--local") options.target = "local";
    else if (arg === "--test") options.target = "test";
    else if (arg === "--production") options.target = "production";
    else if (arg === "--failed") options.failed = true;
    else if (arg === "--user") {
      options.user = next?.includes("@") ? (normalizeEmailAddress(next) ?? usage()) : identifier(next);
      index += 1;
    } else if (arg === "--server") {
      options.server = identifier(next);
      index += 1;
    } else if (arg === "--ref") {
      options.reference = identifier(next);
      index += 1;
    } else if (arg === "--days") {
      options.sinceDays = positiveInteger(next, 400);
      index += 1;
    } else if (arg === "--limit") {
      options.limit = positiveInteger(next, 1_000);
      index += 1;
    } else if (arg === "--persist-to") {
      options.persistTo = next ? resolve(next) : null;
      index += 1;
    } else usage();
  }
  if (options.persistTo !== null && options.target !== "local") usage();
  return options;
}

function sql(value: string | number): string {
  if (isNumber(value)) return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function wranglerArgs(options: Options): string[] {
  const database = options.target === "test" ? "openbot-auth-test" : "openbot-auth";
  const mode = options.target === "local" ? ["--local"] : ["--remote"];
  const environment = options.target === "test" ? ["--env", "test"] : [];
  const persist = options.persistTo ? ["--persist-to", options.persistTo] : [];
  return ["d1", "execute", database, ...mode, ...environment, ...persist];
}

function runWrangler(args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(WRANGLER, args, { cwd: AUTH_API_ROOT, stdio: ["ignore", "pipe", "inherit"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolvePromise(output) : reject(new Error(`wrangler failed with exit code ${code ?? "unknown"}.`)),
    );
  });
}

async function query(options: Options, statement: string): Promise<DynamicRecord[]> {
  const output = await runWrangler([...wranglerArgs(options), "--json", "--command", statement]);
  const parsed = JSON.parse(output.slice(output.indexOf("[")));
  const first = Array.isArray(parsed) ? parsed[0] : null;
  if (!isDynamicRecord(first) || !Array.isArray(first.results)) throw new Error("wrangler returned no results.");
  return first.results.filter(isDynamicRecord);
}

function userIdSql(user: string): string {
  return user.includes("@") ? `(SELECT id FROM users WHERE email = ${sql(user)})` : sql(user);
}

function filters(options: Options): string {
  const conditions = [`a.created_at >= ${sql(Date.now() - options.sinceDays * DAY_MS)}`];
  if (options.user !== null) {
    const id = userIdSql(options.user);
    conditions.push(`(a.user_id = ${id} OR a.actor_user_id = ${id})`);
  }
  if (options.server !== null) conditions.push(`a.server_id = ${sql(options.server)}`);
  if (options.reference !== null) conditions.push(`a.reference = ${sql(options.reference)}`);
  if (options.failed) conditions.push("a.result = 'failed'");
  return conditions.join(" AND ");
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isString(value)) return value;
  if (isNumber(value)) return String(value);
  return JSON.stringify(value);
}

function print(rows: readonly DynamicRecord[], columns: readonly string[]): void {
  if (rows.length === 0) {
    process.stdout.write("No rows.\n");
    return;
  }
  const widths = columns.map((column) =>
    Math.min(60, Math.max(column.length, ...rows.map((row) => cell(row[column]).length))),
  );
  const line = (values: readonly string[]) =>
    `${values.map((value, index) => value.slice(0, widths[index]).padEnd(widths[index] ?? 0)).join("  ")}\n`;
  process.stdout.write(line(columns));
  for (const row of rows) process.stdout.write(line(columns.map((column) => cell(row[column]))));
}

async function list(options: Options): Promise<void> {
  const rows = await query(
    options,
    `SELECT strftime('%Y-%m-%d %H:%M:%S', a.created_at / 1000, 'unixepoch') AS time, a.event, a.result, a.code,
            CASE WHEN a.server_id IS NOT NULL THEN 'server:' || a.server_id ELSE 'user:' || a.user_id END AS wallet,
            u.email AS actor, a.credits_tenths / 10.0 AS credits, a.model_id AS model, a.reference, a.detail
       FROM credit_audit a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${filters(options)}
      ORDER BY a.created_at DESC, a.rowid DESC
      LIMIT ${sql(options.limit)}`,
  );
  print(rows, ["time", "event", "result", "code", "wallet", "actor", "credits", "model", "reference", "detail"]);
}

async function summary(options: Options): Promise<void> {
  const where = filters(options);
  process.stdout.write(`Last ${options.sinceDays} days on ${options.target}.\n\nBy event:\n`);
  print(
    await query(
      options,
      `SELECT a.event, a.result, a.code, COUNT(*) AS rows, SUM(a.credits_tenths) / 10.0 AS credits
         FROM credit_audit a WHERE ${where}
        GROUP BY a.event, a.result, a.code ORDER BY rows DESC`,
    ),
    ["event", "result", "code", "rows", "credits"],
  );
  process.stdout.write("\nGenerations by model:\n");
  print(
    await query(
      options,
      `SELECT a.model_id AS model,
              SUM(a.event = 'charged') AS charged, SUM(a.event = 'released') AS released,
              SUM(CASE WHEN a.event = 'charged' THEN a.credits_tenths ELSE 0 END) / 10.0 AS credits_spent,
              SUM(a.event = 'media_submit') AS failed_requests
         FROM credit_audit a
        WHERE ${where} AND a.model_id IS NOT NULL
        GROUP BY a.model_id ORDER BY credits_spent DESC`,
    ),
    ["model", "charged", "released", "credits_spent", "failed_requests"],
  );
  process.stdout.write("\nAccounts that spend most:\n");
  print(
    await query(
      options,
      `SELECT COALESCE(u.email, a.actor_user_id, 'server:' || a.server_id) AS account,
              COUNT(*) AS generations, SUM(a.credits_tenths) / 10.0 AS credits_spent
         FROM credit_audit a LEFT JOIN users u ON u.id = COALESCE(a.actor_user_id, a.user_id)
        WHERE ${where} AND a.event = 'charged'
        GROUP BY account ORDER BY credits_spent DESC LIMIT 20`,
    ),
    ["account", "generations", "credits_spent"],
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const options = readOptions(rest);
  if (command === "list") return list(options);
  if (command === "summary") return summary(options);
  usage();
}

await main();
