// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  diffWatcherBlocks,
  filterWatcherNoise,
  hashWatcherBlocks,
  hashWatcherState,
  isThinWatcherText,
  looksLikeAppShell,
  normalizeWatcherText,
  scopeWatcherText,
  splitWatcherBlocks,
  truncateWatcherDiff,
  watcherMatchPrefix,
  watcherTextMatches,
} from "./watcher-content";

describe("watcher-content", () => {
  it("strips markup and collapses whitespace", () => {
    expect(normalizeWatcherText("<h1>Price:  42</h1><script>evil()</script>")).toBe("Price: 42");
  });

  it("hashes the same text to the same state", () => {
    expect(hashWatcherState("abc")).toBe(hashWatcherState("abc"));
    expect(hashWatcherState("abc")).not.toBe(hashWatcherState("abd"));
  });

  it("matches any change when no condition is set", () => {
    expect(watcherTextMatches("anything", undefined)).toBe(true);
  });

  it("matches conditions without case", () => {
    expect(watcherTextMatches("Invoice from ACME", "acme")).toBe(true);
    expect(watcherTextMatches("Nothing new", "acme")).toBe(false);
  });

  it("truncates long diffs", () => {
    expect(truncateWatcherDiff("x".repeat(5000), 100)).toHaveLength(101);
  });

  it("drops ages, counts, ranks, and dates but keeps words", () => {
    const filtered = filterWatcherNoise(
      "1. First story 245 points by alice 3 hours ago on 2026-09-01. We use cookies to improve. Second story stays.",
    );
    expect(filtered).not.toContain("245 points");
    expect(filtered).not.toContain("3 hours ago");
    expect(filtered).not.toContain("2026-09-01");
    expect(filtered).not.toContain("cookies");
    expect(filtered).toContain("First story");
    expect(filtered).toContain("Second story stays");
  });

  it("filters rank churn to the same block set", () => {
    const before = filterWatcherNoise("Story one is live today. Story two is live today.");
    const after = filterWatcherNoise(
      "2. Story two is live today 47 points 6 hours ago. 1. Story one is live today 121 points 4 hours ago.",
    );
    expect(hashWatcherBlocks(splitWatcherBlocks(after))).toBe(hashWatcherBlocks(splitWatcherBlocks(before)));
  });

  it("keys blocks by content so reorder alone never fires", () => {
    const first = splitWatcherBlocks("Alpha release is out today. Beta follows next week. Docs are updated now.");
    const reordered = splitWatcherBlocks("Docs are updated now. Alpha release is out today. Beta follows next week.");
    expect(hashWatcherBlocks(first)).toBe(hashWatcherBlocks(reordered));
    const edited = splitWatcherBlocks("Alpha release is out today. Beta follows tomorrow. Docs are updated now.");
    expect(hashWatcherBlocks(edited)).not.toBe(hashWatcherBlocks(first));
  });

  it("diffs added and removed blocks with signs", () => {
    const diff = diffWatcherBlocks(
      splitWatcherBlocks("Price is low today. In stock and ready to ship."),
      splitWatcherBlocks("Price is high today. In stock and ready to ship."),
    );
    expect(diff).toContain("- Price is low today.");
    expect(diff).toContain("+ Price is high today.");
    expect(diff).not.toContain("In stock");
  });

  it("diffs nothing when block sets match", () => {
    const blocks = splitWatcherBlocks("Same text here today. And another line here.");
    expect(diffWatcherBlocks(blocks, splitWatcherBlocks("And another line here. Same text here today."))).toBe("");
  });

  it("flags thin reads and app shells", () => {
    expect(isThinWatcherText("Loading")).toBe(true);
    expect(isThinWatcherText("word ".repeat(30))).toBe(false);
    expect(looksLikeAppShell('<html><body><div id="root"></div><script src="/_next/static/x.js"></script>')).toBe(true);
    expect(looksLikeAppShell("<html><body><article><h1>Real article text here</h1></article></body></html>")).toBe(
      false,
    );
  });

  it("drops feed dates in day-first and weekday order", () => {
    expect(filterWatcherNoise("New release is out Tue, 15 Sep 2026 19:25:03 +0000 today.")).toBe(
      "New release is out today.",
    );
    expect(filterWatcherNoise("Notes for 15 Sep 2026 are here to stay.")).toBe("Notes for are here to stay.");
  });

  it("scopes kept text to the anchor window", () => {
    const kept = `Long intro section with many words. Price block: £51.77 in stock now. ${"filler ".repeat(200)}`;
    const scope = scopeWatcherText(kept, "Price block");
    expect(scope.scoped).toBe(true);
    expect(scope.text).toContain("£51.77");
    expect(scope.text.length).toBeLessThan(kept.length);
    expect(scopeWatcherText(kept, "missing anchor").scoped).toBe(false);
    expect(scopeWatcherText(kept, undefined).text).toBe(kept);
  });

  it("builds a run-local match prefix", () => {
    const prefix = watcherMatchPrefix("Price watch", "Page text: https://example.com", "- £51.77\n+ £43.21");
    expect(prefix).toContain("--- watcher match ---");
    expect(prefix).toContain("Price watch");
    expect(prefix).toContain("+ £43.21");
  });
});
