// @vitest-environment node

import { redactText } from "@openbot/logging";
import { describe, expect, it } from "vitest";
import { createDiagnosticStream } from "./stderr-diagnostics";

function collect(limit?: number) {
  const messages: string[] = [];
  const stream = createDiagnosticStream({
    redact: redactText,
    emit: (message) => messages.push(message),
    ...(limit === undefined ? {} : { limit }),
  });
  return { messages, stream };
}

describe("stderr diagnostics", () => {
  it("redacts a record that arrives in two chunks", () => {
    const { messages, stream } = collect();
    stream.push('ERROR request failed: {"headers":{"X-Tenant":"');
    expect(messages).toEqual([]);

    stream.push('tenant-secret"}}\n');

    expect(messages).toEqual(['ERROR request failed: {"headers":{"X-Tenant":"[redacted]"}}']);
  });

  it("keeps a record whole when its payload runs over several lines", () => {
    const { messages, stream } = collect();
    stream.push('ERROR {"headers":\n{"X-Tenant":"tenant-secret"},"message":"request failed"}\nplain line\n');

    expect(messages).toEqual(['ERROR {"headers":{"X-Tenant":"[redacted]"},"message":"request failed"}', "plain line"]);
    expect(messages.join("\n")).not.toContain("tenant-secret");
  });

  it("waits for the text that says what an opening bracket is", () => {
    const { messages, stream } = collect();
    stream.push("ERROR {");
    expect(messages).toEqual([]);

    stream.push('\n"headers":\n{"X-Tenant":"tenant-secret"},"message":"request failed"}\n');

    expect(messages).toEqual(['ERROR {"headers":{"X-Tenant":"[redacted]"},"message":"request failed"}']);
    expect(messages.join("\n")).not.toContain("tenant-secret");
  });

  it("ends a record on a bracket that opens no payload", () => {
    const { messages, stream } = collect();
    stream.push("the agent wrote {\nand then stopped\n");

    expect(messages).toEqual(["the agent wrote {", "and then stopped"]);
  });

  it("keeps a util.inspect dump whole and ends it at the first line that is not indented", () => {
    const { messages, stream } = collect();
    const dump = [
      "Error handling request {",
      "  jsonrpc: '2.0',",
      "  id: 3,",
      "  method: 'session/prompt',",
      "  params: { sessionId: 'abc', text: 'it is {open' }",
      "} {",
      "  code: -32603,",
      "  message: 'Internal error',",
      "  data: { details: '401 Unauthorized' }",
      "}",
    ].join("\n");
    stream.push(dump.slice(0, 30));
    stream.push(`${dump.slice(30)}\nnext line\nError: can't {connect\n`);

    expect(messages).toEqual([dump, "next line", "Error: can't {connect"]);
  });

  it("reads a long unterminated payload without rescanning it", () => {
    const { messages, stream } = collect();
    const start = Date.now();
    stream.push(`ERROR {"headers":${"\n".repeat(60_000)}`);

    expect(Date.now() - start).toBeLessThan(1_000);
    expect(messages).toEqual([]);
  });

  it("emits every complete record in one chunk and holds the rest", () => {
    const { messages, stream } = collect();
    stream.push('first line\nsecond line\n{"apiKey":"abcdef123456"');
    expect(messages).toEqual(["first line", "second line"]);

    stream.push("}\n");
    expect(messages).toEqual(["first line", "second line", '{"apiKey":"[redacted]"}']);
  });

  it("reads what is held when the process exits without a newline", () => {
    const { messages, stream } = collect();
    stream.push("the agent stopped");
    stream.flush();
    expect(messages).toEqual(["the agent stopped"]);

    stream.flush();
    expect(messages).toHaveLength(1);
  });

  it("keeps no more than the bound, and shows no credential it could not read", () => {
    const { messages, stream } = collect(32);
    stream.push('ERROR request failed: {"headers":{"X-Tenant":"');
    expect(messages).toEqual(["ERROR request failed: [redacted-unscanned]"]);

    stream.push('tenant-secret"},"message":"request failed"}\nplain line\n');

    expect(messages).toEqual(["ERROR request failed: [redacted-unscanned]", "plain line"]);
    expect(messages.join(" ")).not.toContain("tenant-secret");
  });

  it("holds nothing from a record it threw away when the process exits", () => {
    const { messages, stream } = collect(32);
    stream.push('ERROR request failed: {"headers":{"X-Tenant":"');
    stream.push('tenant-secret"},"message":"request');
    stream.flush();

    expect(messages).toEqual(["ERROR request failed: [redacted-unscanned]"]);
  });

  it("removes terminal colour before redacting and before showing a record", () => {
    const { messages, stream } = collect();
    const esc = String.fromCharCode(27);
    stream.push(
      `${esc}[2m2026-09-14T08:28:39.022673Z${esc}[0m ${esc}[31mERROR${esc}[0m ${esc}[3mname${esc}[0m${esc}[2m=${esc}[0m"BatchSpanProcessor.ExporterError"\n`,
    );
    stream.push(`${esc}[3mapiKey${esc}[0m${esc}[2m=${esc}[0mabcdef123456\n`);

    expect(messages).toEqual([
      '2026-09-14T08:28:39.022673Z ERROR name="BatchSpanProcessor.ExporterError"',
      "apiKey=[redacted]",
    ]);
  });
});
