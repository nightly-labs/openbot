import {
  accountUsageProviderRows,
  accountUsageRowLabel,
  accountUsageSummary,
  accountUsageWindowLabel,
  usageWindowReset,
} from "@openbot/ui/features/account/account-usage-view";
import { currentText } from "@openbot/ui/text";
import { assert, describe, expect, it } from "vitest";

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
    const [claudeRow] = rows;
    assert(claudeRow);
    expect(accountUsageRowLabel(claudeRow)).toContain("Claude, 0% left");
  });

  it("summarizes only the active agent's provider", () => {
    const rows = accountUsageProviderRows(
      {
        limits: [
          {
            id: "grok",
            primary: null,
            secondary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: null },
          },
          {
            id: "codex",
            primary: null,
            secondary: { usedPercent: 40, windowDurationMins: 10_080, resetsAt: null },
          },
        ],
      },
      [
        { id: "claude", state: "available" },
        { id: "codex", state: "available" },
        { id: "grok", state: "available" },
      ],
    );
    expect(accountUsageSummary(rows, "codex")).toMatchObject({ provider: "codex", remainingPercent: 60 });
    expect(accountUsageSummary(rows, "claude")).toMatchObject({ provider: "claude", remainingPercent: null });
    expect(accountUsageSummary(rows, "opencode")).toBeNull();
    expect(accountUsageSummary(rows, null)).toMatchObject({ provider: "grok", remainingPercent: 0 });
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

  it("lists every window in a fixed order and keeps the chip on the gating windows", () => {
    const rows = accountUsageProviderRows({
      limits: [
        {
          id: "claude",
          primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null },
          secondary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: null },
          windows: [
            {
              kind: "extra",
              label: null,
              usedPercent: 25,
              windowDurationMins: null,
              resetsAt: null,
              spentUsd: 12.5,
              limitUsd: 50,
            },
            { kind: "model", label: "Fable", usedPercent: 95, windowDurationMins: 10_080, resetsAt: null },
            { kind: "window", label: null, usedPercent: 20, windowDurationMins: 10_080, resetsAt: null },
            { kind: "window", label: null, usedPercent: 10, windowDurationMins: 300, resetsAt: null },
          ],
          credits: [
            { kind: "credits", balance: 1_250, unlimited: false },
            { kind: "credits", balance: null, unlimited: true },
          ],
        },
      ],
    });
    const { format } = currentText();
    const [claude] = rows;
    assert(claude);
    expect(claude.windows.map((window) => [window.label, window.detail, window.remainingPercent, window.tone])).toEqual(
      [
        ["5-hour", null, 90, "neutral"],
        ["Weekly", null, 80, "neutral"],
        ["Fable", "Weekly", 5, "critical"],
        ["Extra usage", `${format.currencyUsd(12.5)} of ${format.currencyUsd(50)}`, 75, "neutral"],
      ],
    );
    expect(claude.credits.map((credit) => [credit.label, credit.value])).toEqual([
      ["Credits", format.number(1_250)],
      ["Credits", "Unlimited"],
    ]);
    const fable = claude.windows[2];
    assert(fable);
    expect(accountUsageWindowLabel(fable)).toBe("Fable, 5% left, Weekly");
    // A model window does not move the dock chip, which reads `primary` and `secondary` only.
    expect(accountUsageSummary(rows)).toMatchObject({ provider: "claude", remainingPercent: 80 });
  });

  it("lists the two gating windows of a reading from a host that sends no windows", () => {
    const [codex] = accountUsageProviderRows({
      limits: [
        {
          id: "codex",
          primary: null,
          secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
    });
    expect(codex?.windows.map((window) => window.label)).toEqual(["Weekly"]);
    expect(codex?.credits).toEqual([]);
  });

  it("keeps a reading of credits alone, with no window", () => {
    const [codex] = accountUsageProviderRows({
      limits: [
        {
          id: "codex",
          primary: null,
          secondary: null,
          credits: [{ kind: "credits", balance: 1_250, unlimited: false }],
        },
      ],
    });
    assert(codex);
    const balance = currentText().format.number(1_250);
    expect(codex.remainingPercent).toBeNull();
    expect(codex.windows).toEqual([]);
    expect(codex.credits.map((credit) => [credit.label, credit.value])).toEqual([["Credits", balance]]);
    expect(accountUsageRowLabel(codex)).toBe(`ChatGPT, Credits ${balance}`);
  });

  it("shows only the time for a reset later today and the date for a later day", () => {
    const now = new Date(2026, 9, 8, 9, 0);
    const today = usageWindowReset(new Date(2026, 9, 8, 15, 0).getTime() / 1_000, currentText(), now);
    const later = usageWindowReset(new Date(2026, 9, 9, 15, 0).getTime() / 1_000, currentText(), now);
    expect(today).toMatch(/^Resets at /);
    expect(later).toMatch(/^Resets /);
    expect(later).not.toMatch(/^Resets at /);
    expect(later?.length).toBeGreaterThan(today?.length ?? 0);
  });
});
