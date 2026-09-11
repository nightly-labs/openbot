// Automation and diagnostic logs must never leak tokens or emails,
// even when a caller passes them as structured params.
import { describe, expect, it, vi } from "vitest";
import { createOpenBotLogger, type LogValue, redactText, redactValue, resolveLogLevel, toLogValue } from "./index";

describe("redactText", () => {
  it("redacts bearer tokens while keeping surrounding text", () => {
    expect(redactText("call with Bearer abcdef123456 and continue")).toBe("call with [redacted] and continue");
  });

  it("redacts provider secret prefixes", () => {
    expect(redactText("key sk-ant-abcdefgh1234 leaked")).toBe("key [redacted] leaked");
    expect(redactText("key xai-abcdefgh1234 leaked")).toBe("key [redacted] leaked");
  });

  it("leaves an ordinary word that starts like a provider prefix alone", () => {
    expect(redactText("marketplace agent risk-register failed to install")).toBe(
      "marketplace agent risk-register failed to install",
    );
  });

  it("redacts a bare JSON key in a payload too malformed to reparse", () => {
    expect(redactText('{"key":"pk_live_abcdefgh1234","truncated')).toBe('{"key":"[redacted]","truncated');
  });

  it("redacts a serialized payload no matter how long it is", () => {
    const padding = "x".repeat(200_000);
    expect(redactText(JSON.stringify({ key: "pk_live_abcdefgh1234", padding }))).toBe(
      JSON.stringify({ key: "[redacted]", padding }),
    );
  });

  it("redacts credential assignments and emails", () => {
    expect(redactText("password=hunter2 ok")).toBe("password=[redacted] ok");
    // The shape an OpenCode Zen key takes in CLI stderr. The key's own format is unknown, so the
    // assignment is the only thing a rule can match, and it has to match under the provider prefix.
    expect(redactText("OPENCODE_API_KEY=abc123def")).not.toContain("abc123def");
    expect(redactText("contact jan@example.com please")).toBe("contact [redacted-email] please");
  });

  it("redacts secrets inside a payload that arrives as one string", () => {
    expect(redactText('{"apiKey":"pk_live_9f2b3c4d5e"}')).not.toContain("pk_live_9f2b3c4d5e");
    expect(redactText('{"machineToken":"mt_abc123def456"}')).not.toContain("mt_abc123def456");
    expect(redactText('body={"password":"hunter2"}')).not.toContain("hunter2");
    // Only the key rules know that a bare `key` holds a secret, so this one
    // proves the payload is reparsed rather than pattern-matched as prose.
    expect(redactText('{"key":"pk_live_9f2b3c4d5e"}')).not.toContain("pk_live_9f2b3c4d5e");
  });

  it("redacts a quoted credential whole instead of stopping at the first space", () => {
    expect(redactText('password: "my secret pass"')).toBe('password: "[redacted]"');
  });

  it("leaves prose that mentions a secret without assigning one intact", () => {
    expect(redactText("SKILLS_ADMIN_TOKEN is missing")).toBe("SKILLS_ADMIN_TOKEN is missing");
    expect(redactText("Encrypted EMAIL_SMTP_PASSWORD for dev and production.")).toBe(
      "Encrypted EMAIL_SMTP_PASSWORD for dev and production.",
    );
  });

  it("redacts scheme-prefixed authorization values and cookies", () => {
    expect(redactText("Authorization: Basic YWxhZGRpbjpvcGVuc2VzYW1l")).toBe("Authorization: [redacted]");
    expect(redactText("set-cookie: session=9f2b3c4d5e6f")).not.toContain("9f2b3c4d5e6f");
  });

  it("leaves scheme words used as ordinary prose alone", () => {
    expect(redactText("Token validation failed")).toBe("Token validation failed");
    expect(redactText("Basic authentication unavailable")).toBe("Basic authentication unavailable");
  });

  it("leaves an already redacted line unchanged when it passes through twice", () => {
    const once = redactText('{"password":"hunter2"}');
    expect(redactText(once)).toBe(once);
    expect(redactText(redactText("password=hunter2"))).toBe("password=[redacted]");
  });

  // How a custom endpoint reaches OpenCode: one serialized config on an environment variable. A
  // spawn line echoed into a diagnostic must lose the key and keep the endpoint that failed.
  it("redacts the key inside a serialized OpenCode config and keeps the base URL", () => {
    const config = JSON.stringify({
      provider: {
        "studio-local": {
          options: { baseURL: "http://127.0.0.1:11434/v1", apiKey: "abcdef123456" },
        },
      },
    });
    const redacted = redactText(config);
    expect(redacted).not.toContain("abcdef123456");
    expect(redacted).toContain("http://127.0.0.1:11434/v1");
  });

  it("leaves identifiers such as agent UUIDs untouched", () => {
    const uuid = "agent-3fa85f64-5717-4562-b3fc-2c963f66afa6";
    expect(redactText(`loaded ${uuid}`)).toBe(`loaded ${uuid}`);
  });
  // A provider writes one stderr line that holds both prose and a payload, and that line reaches the
  // renderer through `redactText`. The payload has to be read as a payload even with a prefix.
  it("redacts a payload embedded in a longer line", () => {
    expect(redactText('ERROR request failed: {"headers":{"X-Tenant":"tenant-secret"}}')).toBe(
      'ERROR request failed: {"headers":{"X-Tenant":"[redacted]"}}',
    );
    expect(redactText('sent {"apiKey":"abcdef123456"} and got {"headers":{"A":"b"}} back')).toBe(
      'sent {"apiKey":"[redacted]"} and got {"headers":{"A":"[redacted]"}} back',
    );
  });

  it("leaves prose with an unbalanced brace alone", () => {
    expect(redactText("two headers were rejected { and the run never closes")).toBe(
      "two headers were rejected { and the run never closes",
    );
  });

  // A payload that parses is written back as JSON, so its spacing is the serializer's. The text
  // around it is untouched: only the run itself is read as data.
  // A line can hold more payloads than the bound allows, and the regex rules match no header name,
  // so what was not read must not be shown.
  it("drops the rest of a line whose payloads pass the scan bound", () => {
    const redacted = redactText(`${"{} ".repeat(16)}{"headers":{"X-Tenant":"tenant-secret"}}`);
    expect(redacted).not.toContain("tenant-secret");
    expect(redacted).toContain("[redacted-unscanned]");
  });

  // The scan is synchronous and runs on provider stderr, so a line of open braces must not cost one
  // full pass per brace. Every attempt counts against the bound, not only the ones that parse.
  it("bounds the work a line of open braces can cause", () => {
    const braces = "{".repeat(65_536);
    const started = performance.now();
    // Sixteen braces are read, and the unreadable rest of the line is dropped rather than shown.
    expect(redactText(braces)).toBe(`${"{".repeat(16)}[redacted-unscanned]`);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("keeps the text around an embedded payload", () => {
    expect(redactText("read [1, 2, 3] items")).toBe("read [1,2,3] items");
  });
});

describe("redactValue", () => {
  it("redacts secret-valued keys deep inside objects", () => {
    expect(redactValue({ nested: { machineToken: "abcdef123456", name: "alfred" } })).toEqual({
      nested: { machineToken: "[redacted]", name: "alfred" },
    });
  });

  // A custom endpoint sends its credential under a header the user names, so `apiKey` is not the
  // only label to cover. The names stay: which header was set is diagnostic, its text is the secret.
  it("redacts every value under a headers object, whatever the header is called", () => {
    expect(redactValue({ headers: { "X-Api-Token": "abcdef123456", "X-Tenant": "acme" } })).toEqual({
      headers: { "X-Api-Token": "[redacted]", "X-Tenant": "[redacted]" },
    });
    // The list form the renderer sends: every string under `headers` goes, so the header's own name
    // is redacted here as well. Only the object form keeps a name, because there it is a key.
    expect(redactValue({ headers: [{ name: "X-Api-Token", value: "abcdef123456" }] })).toEqual({
      headers: [{ name: "[redacted]", value: "[redacted]" }],
    });
  });

  it("leaves a headers count and the word in prose alone", () => {
    expect(redactValue({ headers: 3, note: "two headers were rejected" })).toEqual({
      headers: 3,
      note: "two headers were rejected",
    });
  });
});

describe("toLogValue", () => {
  it("bounds a deeply nested value instead of overflowing the stack", () => {
    let deep: LogValue = "leaf";
    for (let index = 0; index < 50_000; index += 1) deep = [deep];
    expect(() => toLogValue(deep)).not.toThrow();
    expect(JSON.stringify(toLogValue(deep))).toContain("[too deep]");
  });

  it("breaks reference cycles instead of overflowing", () => {
    const loop: { name: string; self?: unknown } = { name: "chief" };
    loop.self = loop;
    expect(() => toLogValue(loop)).not.toThrow();
    expect(toLogValue(loop)).toEqual({ name: "chief", self: "[circular]" });
  });

  it("serializes bigints instead of throwing in JSON.stringify", () => {
    const lines: string[] = [];
    const logger = createOpenBotLogger("automation", (line) => lines.push(line));
    expect(() => logger.info("count", 10n)).not.toThrow();
    expect(lines[0]).toContain("10n");
  });
  it("keeps error details while redacting secrets when logged", () => {
    const lines: string[] = [];
    const logger = createOpenBotLogger("automation", (line) => lines.push(line));
    logger.error("provider failed", toLogValue(new Error("failed with Bearer abcdef123456")));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("provider failed");
    expect(lines[0]).toContain("Error");
    expect(lines[0]).not.toContain("abcdef123456");
  });

  it("redacts a secret carried by a key or an error name", () => {
    expect(JSON.stringify(toLogValue({ "jan@example.com": "present" }))).not.toContain("jan@example.com");
    const named = new Error("failed");
    named.name = "Bearer abcdef123456";
    expect(JSON.stringify(toLogValue(named))).not.toContain("abcdef123456");
    expect(String(toLogValue(Symbol("jan@example.com")))).not.toContain("jan@example.com");
  });

  it("survives a value whose own getters throw", () => {
    const hostile = {
      get detail() {
        throw new Error("boom");
      },
    };
    expect(() => toLogValue(hostile)).not.toThrow();
    const proxy = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error("denied");
        },
      },
    );
    expect(toLogValue(proxy)).toBe("[unserializable]");
  });

  it("falls back to strings for values without a log shape", () => {
    expect(toLogValue(undefined)).toBe(undefined);
    expect(toLogValue(42)).toBe(42);
    expect(typeof toLogValue(Symbol("scope"))).toBe("string");
  });
});

describe("resolveLogLevel", () => {
  it("falls back to info for an unset or unknown value", () => {
    expect(resolveLogLevel(undefined)).toBe("info");
    expect(resolveLogLevel("verbose")).toBe("info");
    expect(resolveLogLevel("debug")).toBe("debug");
  });
});

describe("createOpenBotLogger", () => {
  it("prefixes lines and redacts secrets before they reach the sink", () => {
    const lines: string[] = [];
    const logger = createOpenBotLogger("automation", (line) => lines.push(line));
    logger.info("hello", { token: "abcdef123456" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[automation]");
    expect(lines[0]).toContain("hello");
    expect(lines[0]).not.toContain("abcdef123456");
  });

  it("drops calls below the configured level", () => {
    const lines: string[] = [];
    const logger = createOpenBotLogger("automation", (line) => lines.push(line), "warn");
    logger.debug("noisy");
    logger.info("routine");
    logger.warn("careful");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("careful");
  });

  it("keeps every level when asked for trace and none when silenced", () => {
    const traced: string[] = [];
    createOpenBotLogger("automation", (line) => traced.push(line), "trace").trace("deep");
    expect(traced).toHaveLength(1);
    const silenced: string[] = [];
    createOpenBotLogger("automation", (line) => silenced.push(line), "silent").error("boom");
    expect(silenced).toHaveLength(0);
  });

  it("routes warnings through the error sink when no sink is given", () => {
    const error = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    createOpenBotLogger("automation").warn("careful");
    expect(error).toHaveBeenCalledOnce();
  });
});
