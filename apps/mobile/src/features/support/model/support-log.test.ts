import { describe, expect, it } from "vitest";
import { createSupportLog, parseSupportLog, supportLogUrl } from "./support-log";

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

  it("keeps the newest entries when it is full", () => {
    const log = createSupportLog(now, immediately);
    for (let index = 0; index < 1_005; index += 1) log.add("info", "app", `event ${index}`);
    expect(log.entries()).toHaveLength(1_000);
    expect(log.entries().at(-1)?.message).toBe("event 1004");
  });
});
