// @vitest-environment node

import { redactText } from "@openbot/logging";
import { describe, expect, it } from "vitest";
import { createDiagnosticStream } from "./stderr-diagnostics";

function collect(limit?: number) {
  const messages: string[] = [];
  const stream = createDiagnosticStream({ redact: redactText, emit: (message) => messages.push(message), limit });
  return { messages, stream };
}

/*
 * A provider CLI writes its failures to stderr, and OpenBot shows them and logs them. The pipe
 * decides where a chunk ends, so the record boundary has to be found here: redaction reads one
 * string, and half a record reads as prose that happens to hold a credential.
 */
describe("stderr diagnostics", () => {
  it("redacts a record that arrives in two chunks", () => {
    const { messages, stream } = collect();
    stream.push('ERROR request failed: {"headers":{"X-Tenant":"');
    // Nothing yet: the record has no newline, so it is not a record yet.
    expect(messages).toEqual([]);

    stream.push('tenant-secret"}}\n');

    expect(messages).toEqual(['ERROR request failed: {"headers":{"X-Tenant":"[redacted]"}}']);
  });

  it("keeps a record whole when its payload runs over several lines", () => {
    const { messages, stream } = collect();
    // The CLI pretty-prints its payload, so the newline inside it ends no record. Read line by line,
    // `{"X-Tenant":"tenant-secret"}` arrives without the `headers` name that redacts what is under
    // it, and the credential is emitted and shown.
    stream.push('ERROR {"headers":\n{"X-Tenant":"tenant-secret"},"message":"request failed"}\nplain line\n');

    expect(messages).toEqual(['ERROR {"headers":{"X-Tenant":"[redacted]"},"message":"request failed"}', "plain line"]);
    expect(messages.join("\n")).not.toContain("tenant-secret");
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

    // Nothing is held twice: a second flush after the first has nothing to say.
    stream.flush();
    expect(messages).toHaveLength(1);
  });

  it("keeps no more than the bound, and shows no credential it could not read", () => {
    const { messages, stream } = collect(32);
    stream.push('ERROR request failed: {"headers":{"X-Tenant":"');
    expect(messages).toEqual(["ERROR request failed: [redacted-unscanned]"]);

    // The rest of that record is thrown away with it. Read as a record of its own it is plain text,
    // and the credential in it matches no rule.
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
});
