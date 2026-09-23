import {
  accountUsageProviderRows,
  accountUsageRowLabel,
  accountUsageSummary,
  usageRemainingPercent,
  usageTone,
  usageWindowLabel,
} from "@openbot/ui/features/account/account-usage-view";
import { describe, expect, it } from "vitest";

describe("account usage view", () => {
  it("keeps one named row per provider and warns from the tightest window", () => {
    const rows = accountUsageProviderRows({
      limits: [
        {
          id: "codex",
          primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1_786_563_600 },
          secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
        },
        {
          id: "claude",
          primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_786_563_600 },
          secondary: { usedPercent: 64, windowDurationMins: 10_080, resetsAt: 1_787_040_000 },
        },
        {
          id: "luna",
          primary: null,
          secondary: { usedPercent: 90, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
    });

    expect(rows.map((row) => row.provider)).toEqual(["claude", "codex"]);
    expect(rows[0]).toMatchObject({
      name: "Claude",
      remainingPercent: 0,
      windowLabel: "5-hour",
      tone: "critical",
    });
    expect(rows[1]).toMatchObject({
      name: "ChatGPT",
      remainingPercent: 72,
      windowLabel: "5-hour",
      tone: "neutral",
    });
    expect(accountUsageSummary(rows)).toMatchObject({ provider: "claude", remainingPercent: 0 });
    expect(accountUsageRowLabel(rows[0])).toContain("Claude, 0% left");
  });

  it("keeps connected providers visible when they have not reported a limit yet", () => {
    const rows = accountUsageProviderRows(
      {
        limits: [
          {
            id: "codex",
            primary: null,
            secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: null },
          },
        ],
      },
      [
        { id: "claude", state: "available" },
        { id: "codex", state: "available" },
        { id: "grok", state: "available" },
        { id: "opencode", state: "available" },
      ],
    );
    expect(rows.map((row) => row.provider)).toEqual(["claude", "codex", "grok"]);
    expect(rows[0]).toMatchObject({ name: "Claude", remainingPercent: null });
    expect(rows[2]).toMatchObject({ name: "Grok", remainingPercent: null });
  });

  it("labels common windows and remaining quota", () => {
    expect(usageRemainingPercent(41)).toBe(59);
    expect(usageTone(59)).toBe("neutral");
    expect(usageTone(29)).toBe("warning");
    expect(usageTone(9)).toBe("critical");
    expect(usageWindowLabel(10_080)).toBe("Weekly");
    expect(usageWindowLabel(43_200)).toBe("Monthly");
    expect(usageWindowLabel(300)).toBe("5-hour");
    expect(usageWindowLabel(1_440)).toBe("Daily");
    expect(usageWindowLabel(null)).toBe("Limit");
  });
});
