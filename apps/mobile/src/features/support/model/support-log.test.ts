import { describe, expect, it } from "vitest";
import {
  createSupportLog,
  parseSupportLog,
  parseSupportLogCache,
  supportLogCacheText,
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

  it("keeps the newest entries when it is full", () => {
    const log = createSupportLog(now, immediately);
    for (let index = 0; index < 5_005; index += 1) log.add("info", "app", `event ${index}`);
    expect(log.entries()).toHaveLength(5_000);
    expect(log.entries().at(-1)?.message).toBe("event 5004");
  });
});
