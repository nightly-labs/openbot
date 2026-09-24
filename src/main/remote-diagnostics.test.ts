// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { appendRemoteDiagnosticLog, forwardDiagnosticLines } from "./remote-diagnostics";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Pipes chunks through one process stream into the log, as the runtimes do, and reads the file. */
async function logOf(chunks: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-remote-diagnostics-"));
  roots.push(root);
  const stream = new PassThrough();
  const writes: Promise<void>[] = [];
  forwardDiagnosticLines(stream, (text) => writes.push(appendRemoteDiagnosticLog(root, "sunshine", text)));
  const ended = new Promise((resolve) => stream.once("end", resolve));
  for (const chunk of chunks) stream.write(chunk);
  stream.end();
  stream.resume();
  await ended;
  await Promise.all(writes);
  return readFile(join(root, "sunshine.log"), "utf8");
}

describe("remote diagnostic log", () => {
  it("redacts a credential split across chunks and keeps a last line without a newline", async () => {
    const log = await logOf(["starting stream api_key=sk-live-", "0123456789abcdef for owner@example.com\n", "fatal"]);

    expect(log).toContain("starting stream");
    expect(log).toContain("fatal\n");
    expect(log).not.toContain("0123456789abcdef");
    expect(log).not.toContain("owner@example.com");
  });

  it("drops the rest of an overlong line instead of writing it unredacted", async () => {
    const log = await logOf(["x".repeat(8_010), "api_key=sk-live-", "0123456789abcdef\n", "next line\n"]);

    expect(log).not.toContain("0123456789abcdef");
    expect(log).toContain("next line\n");
  });
});
