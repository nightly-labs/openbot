// @vitest-environment node

// The boundary this file names is the disk bound: a failure that arrives in a
// retry loop must not be able to grow the log without limit, and a secret must
// never reach the file even though the record was built from raw process text.
import { mkdir, mkdtemp, readdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenBotLogger, type DiagnosticRecord, setDiagnosticSink } from "@openbot/logging";
import { describe, expect, it } from "vitest";
import { appendTextLog, createDiagnosticsLog } from "./diagnostics-log";
import { appendRemoteDiagnosticLog } from "./remote-diagnostics";

async function temporaryLogsTree(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "openbot-diagnostics-")), "logs");
}

async function readRecords(directory: string, fileName = "diagnostics.log"): Promise<DiagnosticRecord[]> {
  const text = await readFile(join(directory, fileName), "utf8");
  const records: DiagnosticRecord[] = [];
  for (const line of text.split("\n")) {
    if (line.length > 0) records.push(JSON.parse(line));
  }
  return records;
}

describe("appendTextLog", () => {
  it("redacts a secret out of raw process output and rotates once", async () => {
    const directory = join(await temporaryLogsTree(), "remote");
    await appendTextLog({
      directory,
      fileName: "remote-screen.log",
      text: "auth Bearer abcdef123456\n",
      maxFileBytes: 20,
    });
    await appendTextLog({ directory, fileName: "remote-screen.log", text: "connected\n", maxFileBytes: 20 });

    expect(await readdir(directory)).toEqual(["remote-screen.log", "remote-screen.log.1"]);
    expect(await readFile(join(directory, "remote-screen.log.1"), "utf8")).toBe("auth [redacted]\n");
    expect(await readFile(join(directory, "remote-screen.log"), "utf8")).toBe("connected\n");
  });
});

it("keeps remote whitespace tokens off disk", async () => {
  const directory = join(await temporaryLogsTree(), "remote");
  await appendRemoteDiagnosticLog(
    directory,
    "sunshine",
    "token abcdef123456 token=anothersecret123 token:thirdsecret123",
  );
  expect(await readFile(join(directory, "sunshine.log"), "utf8")).toBe("[redacted] [redacted] [redacted]");
});

it("bounds remote text in UTF-8 bytes after redaction", async () => {
  const directory = join(await temporaryLogsTree(), "remote");
  await appendTextLog({
    directory,
    fileName: "output.log",
    text: `token=abcdef123456 ${"界".repeat(100)}`,
    maxFileBytes: 40,
    maxTextBytes: 30,
  });
  const text = await readFile(join(directory, "output.log"), "utf8");
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(30);
  expect(text).toBe(`token=[redacted] ${"界".repeat(4)}`);
});

describe("createDiagnosticsLog", () => {
  it("keeps the newest records and bounds the file set", async () => {
    const directory = join(await temporaryLogsTree(), "diagnostics");
    const log = createDiagnosticsLog({
      directory,
      maxFileBytes: 400,
      retainedGenerations: 2,
      dedupeWindowMs: 0,
      rateLimit: { capacity: 1_000, refillPerSecond: 1 },
    });
    for (let index = 0; index < 40; index += 1) log.append({ code: `cli_resolve_failed_${index}`, detail: { index } });
    await log.flush();

    const names = (await readdir(directory)).sort();
    expect(names).toEqual(["diagnostics.log", "diagnostics.log.1", "diagnostics.log.2"]);
    for (const name of names) expect((await stat(join(directory, name))).size).toBeLessThanOrEqual(400);
    const latest = await readRecords(directory);
    expect(latest.at(-1)?.code).toBe("cli_resolve_failed_39");
  });

  it("caps one oversize record and says it was truncated", async () => {
    const directory = join(await temporaryLogsTree(), "diagnostics");
    const log = createDiagnosticsLog({ directory, maxLineBytes: 512 });
    log.append({
      code: "provider_runtime_http_failed",
      message: "download failed",
      detail: { status: 500, body: "x".repeat(4_000) },
    });
    await log.flush();

    const [record] = await readRecords(directory);
    expect(record).toMatchObject({ code: "provider_runtime_http_failed", message: "download failed", truncated: true });
    expect(record.detail).toMatchObject({ status: 500 });
  });

  it.each(["界", "\u0000", "😀"])("bounds a message with escaped or multibyte text %s", async (character) => {
    const directory = join(await temporaryLogsTree(), "diagnostics");
    const log = createDiagnosticsLog({ directory, maxLineBytes: 512 });
    log.append({ code: "log_error", message: character.repeat(4000) });
    await log.flush();
    const text = await readFile(join(directory, "diagnostics.log"), "utf8");
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(512);
    expect(await readRecords(directory)).toEqual([
      expect.objectContaining({
        code: "log_error",
        truncated: true,
        detail: { fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) },
      }),
    ]);
  });

  it("retains distinct failures and links their repeat counts", async () => {
    const directory = join(await temporaryLogsTree(), "diagnostics");
    const log = createDiagnosticsLog({ directory, now: () => 1000 });
    const logger = createOpenBotLogger("main", () => undefined);
    const prefix = `${"x".repeat(2100)} `;
    const dispose = setDiagnosticSink((record) => log.append(record));
    try {
      for (const message of ["Window position failed", "Browser storage failed"]) {
        logger.error(`${prefix}${message}`);
        logger.error(`${prefix}${message}`);
      }
    } finally {
      dispose();
    }
    await log.flush();
    const records = await readRecords(directory);
    expect(records.slice(0, 2).map((record) => record.message)).toEqual([
      `${prefix}Window position failed`,
      `${prefix}Browser storage failed`,
    ]);
    expect(records[2]).toMatchObject({
      area: "main",
      detail: { repeated: 1, fingerprint: records[0]?.detail?.fingerprint },
    });
    expect(records[3]).toMatchObject({
      area: "main",
      detail: { repeated: 1, fingerprint: records[1]?.detail?.fingerprint },
    });
    expect(records[0]?.detail?.fingerprint).not.toBe(records[1]?.detail?.fingerprint);
  });

  it("collapses a repeated failure into one record and one count", async () => {
    const directory = join(await temporaryLogsTree(), "diagnostics");
    const log = createDiagnosticsLog({ directory, now: () => 1_000, dedupeWindowMs: 60_000 });
    for (let index = 0; index < 500; index += 1) {
      log.append({ code: "cli_resolve_failed", detail: { provider: "codex", errno: "ENOENT", durationMs: index } });
    }
    await log.flush();

    const records = await readRecords(directory);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ code: "cli_resolve_failed", detail: { provider: "codex", errno: "ENOENT" } });
    expect(records[1]).toMatchObject({ code: "cli_resolve_failed", detail: { repeated: 499 } });
  });

  it("stops a flood of distinct failures at the rate cap and reports the drop count", async () => {
    const directory = join(await temporaryLogsTree(), "diagnostics");
    const log = createDiagnosticsLog({
      directory,
      now: () => 1_000,
      maxFileBytes: 10 * 1024 * 1024,
      rateLimit: { capacity: 120, refillPerSecond: 1 },
    });
    for (let index = 0; index < 10_000; index += 1)
      log.append({ code: "log_error", detail: { path: `/tmp/${index}` } });
    await log.flush();

    const records = await readRecords(directory);
    expect(records).toHaveLength(121);
    expect(records.at(-1)).toMatchObject({ code: "diagnostics_throttled", detail: { dropped: 9_880 } });
  });

  it("writes neither a secret nor a home path to disk", async () => {
    const directory = join(await temporaryLogsTree(), "diagnostics");
    const log = createDiagnosticsLog({
      directory,
      homeDirectory: "/Users/ada",
      userDataDirectory: "/Users/ada/Library/OpenBot",
    });
    log.append({
      code: "cli_resolve_failed",
      message: "spawn /Users/ada/.local/bin/codex failed",
      detail: {
        argv: ["codex", "--api-key", "sk-ant-abcdefgh1234"],
        database: "/Users/ada/Library/OpenBot/openbot.db",
      },
    });
    await log.flush();

    const text = await readFile(join(directory, "diagnostics.log"), "utf8");
    expect(text).not.toContain("sk-ant-abcdefgh1234");
    expect(text).not.toContain("/Users/ada");
    expect(text).toContain("~/.local/bin/codex");
    expect(text).toContain("<userData>/openbot.db");
  });

  it("sweeps an aged file and an orphan from the whole log tree", async () => {
    const logs = await temporaryLogsTree();
    const directory = join(logs, "diagnostics");
    await mkdir(join(logs, "remote"), { recursive: true });
    const aged = join(logs, "remote", "sunshine.log");
    const orphan = join(logs, "remote", "sunshine.txt");
    await mkdir(directory, { recursive: true });
    const previousLog = join(directory, "diagnostics.log");
    await writeFile(previousLog, '{"code":"old_failure"}\n');
    await writeFile(aged, "old\n");
    await writeFile(orphan, "orphan\n");
    const staleSeconds = (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1_000;
    await utimes(aged, staleSeconds, staleSeconds);
    await utimes(previousLog, staleSeconds, staleSeconds);

    const log = createDiagnosticsLog({ directory });
    await log.prune();

    expect(await readdir(join(logs, "remote"))).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
    log.append({ code: "log_error", message: "New startup failure" });
    await log.flush();
    expect(await readdir(directory)).toEqual(["diagnostics.log"]);
    expect(await readRecords(directory)).toEqual([
      expect.objectContaining({ code: "log_error", message: "New startup failure" }),
    ]);
  });
});
