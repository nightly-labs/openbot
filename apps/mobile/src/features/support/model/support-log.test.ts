import { describe, expect, it } from "vitest";
import {
  createSupportLog,
  parseSupportLog,
  parseSupportLogCache,
  supportLogCacheText,
  supportLogExcerpt,
  supportLogUrl,
} from "./support-log";

const now = () => 0;
const immediately = (run: () => void) => run();

describe("support log", () => {
  it("keeps no credential or email address from a message", () => {
    const log = createSupportLog(now, immediately);
    log.add("error", "console", 'Request failed {"Authorization":"Bearer abcdefghijklmnop"} for user@example.com');
    log.add("warn", "connection", "resume token=abcdefghijklmnop rejected");
    const text = log
      .entries()
      .map((entry) => entry.message)
      .join("\n");
    expect(text).not.toContain("abcdefghijklmnop");
    expect(text).not.toContain("user@example.com");
  });

  it("keeps only the origin and path of a request URL", () => {
    expect(supportLogUrl("https://user:secret@api.openbot.run/v1/mobile-auth/session?ticket=abc#frag")).toBe(
      "https://api.openbot.run/v1/mobile-auth/session",
    );
  });

  it("redacts entries read back from an earlier cache file and skips damaged ones", () => {
    const stored = JSON.stringify([
      { time: 1, level: "warn", source: "network", message: "apiKey=abcdefghijklmnop" },
      { time: 2, level: "verbose", source: "network", message: "unknown level" },
      "not an entry",
    ]);
    const restored = parseSupportLog(stored);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.message).not.toContain("abcdefghijklmnop");
    expect(parseSupportLog("{damaged")).toEqual([]);
  });

  it("redacts a version 2 cache again when another redaction wrote it", () => {
    const stored = `${JSON.stringify({ redaction: "1.4.5 (30) embedded" })}\n${JSON.stringify({
      time: 1,
      level: "warn",
      source: "network",
      message: "apiKey=abcdefghijklmnop",
    })}\n`;
    for (const key of ["1.4.6 (31) embedded", null]) {
      const restored = parseSupportLogCache(stored, key);
      expect(restored.entries).toHaveLength(1);
      expect(restored.entries[0]?.message).not.toContain("abcdefghijklmnop");
      expect(restored.rewrite).toBe(true);
    }
  });

  it("gives back the redacted entries of the same redaction and skips a damaged last line", () => {
    const log = createSupportLog(now, immediately);
    log.add("warn", "connection", "resume token=abcdefghijklmnop rejected");
    log.add("info", "app", "App state: active");
    const text = supportLogCacheText("1.4.6 (31) embedded", log.entries());
    const restored = parseSupportLogCache(text, "1.4.6 (31) embedded");
    expect(restored.entries.map((entry) => entry.message)).toEqual(log.entries().map((entry) => entry.message));
    expect(restored.entries[0]?.message).not.toContain("abcdefghijklmnop");
    expect(restored.rewrite).toBe(false);

    const damaged = parseSupportLogCache(`${text}{"time":3,"level":"in`, "1.4.6 (31) embedded");
    expect(damaged.entries).toHaveLength(2);
    expect(damaged.rewrite).toBe(true);
  });

  it("puts no credential, email address or network address in the excerpt of a public report", () => {
    const log = createSupportLog(now, immediately);
    log.add("info", "connection", "host-1 GET /v1/agents -> 200 (12 ms)");
    log.add("info", "network", "GET https://api.openbot.run/v1/me -> 200 (40 ms)");
    log.add("warn", "connection", "host-1 offline (ice_failed): resume token=abcdefghijklmnop for user@example.com");
    log.add(
      "info",
      "connection",
      "host-1 peer candidate: 203.0.113.77 and 192.168.1.20 and 2001:db8:85a3:0:0:8a2e:370:7334 and fe80::1",
    );
    log.add("warn", "network", "GET https://turn2.openbot.run/ -> failed: Error: resolved to 198.18.0.42. (30 ms)");
    const excerpt = supportLogExcerpt(log.entries(), 6_000);
    expect(excerpt).not.toContain("abcdefghijklmnop");
    expect(excerpt).not.toContain("user@example.com");
    expect(excerpt).not.toContain("203.0");
    expect(excerpt).not.toContain("192.168");
    expect(excerpt).not.toContain("8a2e");
    expect(excerpt).not.toContain("fe80");
    expect(excerpt).not.toContain("198.18");
    // The kind of an address stays: it tells a private network from the internet.
    expect(excerpt).toContain("peer candidate: [public-ip] and [private-ip] and [ipv6] and [ipv6]");
    // The warnings and the connection events are in it. A request that got an answer is not.
    expect(excerpt.split("\n")).toHaveLength(3);
    expect(excerpt).toContain("offline (ice_failed)");
    expect(excerpt).toContain("https://turn2.openbot.run/");
    expect(excerpt).not.toContain("-> 200");
  });

  it("puts nothing that points to the user or the server in the excerpt of a public report", () => {
    const log = createSupportLog(now, immediately);
    const server = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const other = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    log.add(
      "info",
      "connection",
      `${server} host OpenBot 1.9.0, protocol 3-9, capabilities: agents-v1 phone-feedback-v1 channels-v2`,
    );
    log.add("info", "connection", `${server} peer route: host/udp -> relay/udp`);
    log.add("warn", "connection", `${other} attempt 2 failed at signal (5021 ms): Error: ${server} is busy`);
    log.add("warn", "console", "Warning: the list of Anna Kowalska has no key");
    log.add("error", "console", "Possible unhandled rejection: chat text of the user");
    log.add(
      "warn",
      "network",
      "GET https://team.kowalska-family.example.com:8443/v1/hosts/4d2a9c1e7b3f5a6088c1d2e3f4a5b6c7/state -> failed: TypeError: Network request failed (12 ms)",
    );
    log.add("warn", "app", "Shortcut data not saved: Error: cannot write /Users/annakowalska/Library/Group/file.json");
    log.add("error", "app", "Uncaught error: Error: Failed to resolve nas.kowalska.pl");
    const excerpt = supportLogExcerpt(log.entries(), 6_000);
    for (const text of [server, other, "Kowalska", "kowalska", "chat text", "4d2a9c1e7b3f5a6088c1d2e3f4a5b6c7"])
      expect(excerpt).not.toContain(text);
    // A console line is not in the report: a library can write any value there.
    expect(excerpt).not.toContain("console");
    // Two servers stay different, without their IDs. The capability list is cut.
    expect(excerpt).toContain("server-1 host OpenBot 1.9.0, protocol 3-9");
    expect(excerpt).not.toContain("capabilities");
    expect(excerpt).toContain("server-1 peer route: host/udp -> relay/udp");
    expect(excerpt).toContain("server-2 attempt 2 failed at signal (5021 ms): Error: server-1 is busy");
    expect(excerpt).toContain(
      "GET https://[host]:8443/v1/hosts/[id]/state -> failed: TypeError: Network request failed",
    );
    expect(excerpt).toContain("cannot write /Users/[user]/Library/Group/file.json");
    expect(excerpt).toContain("Failed to resolve [host]");
  });

  it("keeps the newest lines of the excerpt inside the length of a report", () => {
    const log = createSupportLog(now, immediately);
    for (let index = 0; index < 200; index += 1) log.add("warn", "connection", `host-1 attempt ${index} failed`);
    const excerpt = supportLogExcerpt(log.entries(), 1_000);
    expect(excerpt.length).toBeLessThanOrEqual(1_000);
    expect(excerpt.length).toBeGreaterThan(800);
    expect(excerpt.endsWith("server-1 attempt 199 failed")).toBe(true);
    expect(supportLogExcerpt([], 1_000)).toBe("");
  });

  it("keeps the newest entries when it is full", () => {
    const log = createSupportLog(now, immediately);
    for (let index = 0; index < 5_005; index += 1) log.add("info", "app", `event ${index}`);
    expect(log.entries()).toHaveLength(5_000);
    expect(log.entries().at(-1)?.message).toBe("event 5004");
  });
});
