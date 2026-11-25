import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { creditsFromTenths, creditTenths, formatCreditCode } from "@openbot/contracts/credits";
import { type DynamicRecord, isDynamicRecord, isNumber } from "@openbot/contracts/runtime-values";
import { CREDIT_CODE_CAMPAIGN_PATTERN, creditCodeHash, generateCreditCode } from "../src/server/credit-codes";

const AUTH_API_ROOT = resolve(import.meta.dirname, "..");
const WRANGLER = join(AUTH_API_ROOT, "..", "..", "node_modules", ".bin", "wrangler");
const MAX_COUNT = 1_000;
const MAX_CREDITS = 100_000;
const MAX_REDEMPTIONS = 1_000_000;
const DEFAULT_GRANT_DAYS = 365;
const CODE_ID_PATTERN = /^[0-9a-f-]{36}$/;

type Target = "local" | "test" | "production";

interface Options {
  target: Target;
  apply: boolean;
  persistTo: string | null;
  credits: number | null;
  count: number;
  maxRedemptions: number;
  expiresAt: number | null;
  grantDays: number;
  note: string;
  campaign: string | null;
  out: string | null;
  limit: number;
  positional: string[];
}

interface NewCode {
  id: string;
  code: string;
  hash: string;
}

function usage(): never {
  process.stdout.write(
    [
      "Usage: bun apps/auth-api/scripts/credit-codes.ts <command> [options] [target] [--apply]",
      "Commands:",
      "  create --credits <n> [--count <k>] [--max-redemptions <m>] [--expires <YYYY-MM-DD>]",
      "         [--grant-days <d>] [--note <text>] [--campaign <name>] [--out <file.csv>]",
      "                       Make <k> random codes (default 1). Each code gives <n> credits to up to <m>",
      "                       accounts (default 1), one time per account. The credits expire <d> days",
      `                       after a redemption (default ${DEFAULT_GRANT_DAYS}). The codes show only once;`,
      "                       the database keeps only their SHA-256 hash. --campaign groups the codes in",
      "                       analytics (lower-case letters, digits and dashes, up to 40). --out writes",
      "                       the codes to a new CSV file that only you can read.",
      "  list [--campaign <name>] [--limit <n>]",
      "                       Show codes, newest first (ID, state, credits, redemptions, campaign, note)",
      "  disable <id>...      Stop codes; credits that accounts already redeemed stay",
      "Targets: --local [--persist-to <dir>] (default), --test, --production --confirm-production",
      "create and disable change data only with --apply.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

function positiveInteger(value: string | undefined, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) usage();
  return number;
}

function readDate(value: string | undefined): number {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) usage();
  const time = Date.parse(`${value}T23:59:59.999Z`);
  if (!Number.isFinite(time) || time <= Date.now()) usage();
  return time;
}

function readOptions(args: string[]): Options {
  const options: Options = {
    target: "local",
    apply: false,
    persistTo: null,
    credits: null,
    count: 1,
    maxRedemptions: 1,
    expiresAt: null,
    grantDays: DEFAULT_GRANT_DAYS,
    note: "",
    campaign: null,
    out: null,
    limit: 50,
    positional: [],
  };
  let confirmed = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const value = args[index + 1];
    const takesValue = [
      "--credits",
      "--count",
      "--max-redemptions",
      "--expires",
      "--grant-days",
      "--note",
      "--campaign",
      "--out",
      "--limit",
      "--persist-to",
    ].includes(arg);
    if (takesValue && (value === undefined || value.startsWith("--"))) usage();
    if (arg === "--local") options.target = "local";
    else if (arg === "--test") options.target = "test";
    else if (arg === "--production") options.target = "production";
    else if (arg === "--confirm-production") confirmed = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--credits") {
      const credits = Number(value);
      if (!Number.isFinite(credits) || creditTenths(credits) < 1 || credits > MAX_CREDITS) usage();
      options.credits = creditsFromTenths(creditTenths(credits));
    } else if (arg === "--count") options.count = positiveInteger(value, MAX_COUNT);
    else if (arg === "--max-redemptions") options.maxRedemptions = positiveInteger(value, MAX_REDEMPTIONS);
    else if (arg === "--expires") options.expiresAt = readDate(value);
    else if (arg === "--grant-days") options.grantDays = positiveInteger(value, 3_650);
    else if (arg === "--limit") options.limit = positiveInteger(value, 1_000);
    else if (arg === "--note") {
      if ((value ?? "").length > 200) usage();
      options.note = value ?? "";
    } else if (arg === "--campaign") {
      if (!CREDIT_CODE_CAMPAIGN_PATTERN.test(value ?? "")) usage();
      options.campaign = value ?? null;
    } else if (arg === "--out") options.out = resolve(value ?? "");
    else if (arg === "--persist-to") options.persistTo = resolve(value ?? "");
    else if (arg.startsWith("--")) usage();
    else options.positional.push(arg);
    if (takesValue) index += 1;
  }
  if (options.persistTo !== null && options.target !== "local") usage();
  if (options.target === "production" && options.apply && !confirmed) {
    throw new Error("Production changes need --confirm-production.");
  }
  return options;
}

function sql(value: string | number | null): string {
  if (value === null) return "NULL";
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

async function execute(options: Options, statements: string[]): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "openbot-credit-codes-"));
  try {
    const file = join(directory, "change.sql");
    await writeFile(file, `${statements.join("\n")}\n`, { mode: 0o600 });
    await runWrangler([...wranglerArgs(options), "--file", file, "--yes"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function newCodes(count: number): Promise<NewCode[]> {
  const codes = new Map<string, NewCode>();
  while (codes.size < count) {
    const code = generateCreditCode();
    const hash = await creditCodeHash(code);
    codes.set(hash, { id: crypto.randomUUID(), code, hash });
  }
  return [...codes.values()];
}

function summary(options: Options, credits: number): string {
  const expires =
    options.expiresAt === null ? "with no end date" : `until ${new Date(options.expiresAt).toISOString()}`;
  return [
    `${options.count} code(s) of ${credits} credits`,
    `${options.maxRedemptions} account(s) each`,
    `redeemable ${expires}`,
    `credits last ${options.grantDays} days`,
  ].join(", ");
}

async function create(options: Options): Promise<void> {
  const credits = options.credits;
  if (credits === null || options.positional.length > 0) usage();
  if (options.out !== null && existsSync(options.out)) throw new Error(`${options.out} exists. Choose a new file.`);
  if (!options.apply) {
    process.stdout.write(`Dry run on ${options.target}: ${summary(options, credits)}. Add --apply to write.\n`);
    return;
  }
  const codes = await newCodes(options.count);
  const out = options.out;
  if (out !== null) {
    const rows = codes.map((entry) => `${formatCreditCode(entry.code)},${entry.id}`);
    await writeFile(out, `code,id\n${rows.join("\n")}\n`, { mode: 0o600, flag: "wx" });
  }
  const now = Date.now();
  try {
    await execute(
      options,
      codes.map(
        (entry) =>
          `INSERT INTO credit_codes(code_id, code_hash, credits_tenths, max_redemptions, grant_days, expires_at, note, campaign, created_at)
           VALUES (${sql(entry.id)}, ${sql(entry.hash)}, ${creditTenths(credits)}, ${options.maxRedemptions},
                   ${options.grantDays}, ${sql(options.expiresAt)}, ${sql(options.note)}, ${sql(options.campaign ?? "")}, ${now});`,
      ),
    );
  } catch (error) {
    if (out !== null) await rm(out, { force: true });
    throw error;
  }
  process.stdout.write(`Created on ${options.target}: ${summary(options, credits)}.\n`);
  if (out !== null) {
    process.stdout.write(`Wrote ${codes.length} codes to ${out}. Keep the file safe; the codes do not show again.\n`);
    return;
  }
  process.stdout.write("Save the codes now. They do not show again.\n");
  for (const entry of codes) process.stdout.write(`${formatCreditCode(entry.code)}  ${entry.id}\n`);
}

function state(row: DynamicRecord, now: number): "disabled" | "expired" | "used" | "active" {
  if (row.disabled_at !== null) return "disabled";
  if (isNumber(row.expires_at) && row.expires_at <= now) return "expired";
  if (isNumber(row.redemptions) && isNumber(row.max_redemptions) && row.redemptions >= row.max_redemptions)
    return "used";
  return "active";
}

async function list(options: Options): Promise<void> {
  const filter = options.campaign === null ? "" : `WHERE campaign = ${sql(options.campaign)}`;
  const rows = await query(
    options,
    `SELECT code_id, credits_tenths, redemptions, max_redemptions, grant_days, expires_at, disabled_at, campaign, note, created_at
       FROM credit_codes ${filter} ORDER BY created_at DESC LIMIT ${options.limit}`,
  );
  const now = Date.now();
  for (const row of rows) {
    const credits = isNumber(row.credits_tenths) ? creditsFromTenths(row.credits_tenths) : 0;
    const expires = isNumber(row.expires_at) ? new Date(row.expires_at).toISOString().slice(0, 10) : "never";
    const created = isNumber(row.created_at) ? new Date(row.created_at).toISOString().slice(0, 10) : "";
    process.stdout.write(
      `${String(row.code_id)}  ${state(row, now).padEnd(8)} ${String(credits).padStart(8)} credits  ` +
        `${row.redemptions}/${row.max_redemptions}  created ${created}  expires ${expires}  ${row.grant_days}d  ` +
        `${row.campaign || "-"}  ${row.note ?? ""}\n`,
    );
  }
  process.stdout.write(`${rows.length} codes on ${options.target}.\n`);
}

async function disable(options: Options): Promise<void> {
  const ids = options.positional;
  if (ids.length === 0 || !ids.every((id) => CODE_ID_PATTERN.test(id))) usage();
  if (!options.apply) {
    process.stdout.write(`Dry run on ${options.target}: disable ${ids.join(", ")}. Add --apply to write.\n`);
    return;
  }
  const now = Date.now();
  await execute(options, [
    `UPDATE credit_codes SET disabled_at = ${now}
      WHERE disabled_at IS NULL AND code_id IN (${ids.map(sql).join(", ")});`,
  ]);
  process.stdout.write(`Disabled on ${options.target}: ${ids.join(", ")}.\n`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const options = readOptions(rest);
  if (command === "create") return create(options);
  if (command === "list") return list(options);
  if (command === "disable") return disable(options);
  usage();
}

await main();
