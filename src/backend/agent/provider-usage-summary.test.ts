import { describe, expect, it } from "vitest";
import { summarizeProviderUsage } from "./provider-usage-summary";

describe("summarizeProviderUsage", () => {
  it("calculates pacing independently for each account reset", () => {
    const now = Date.parse("2026-06-01T00:00:00.000Z");
    const summary = summarizeProviderUsage(
      {
        limits: [
          {
            id: "claude",
            primary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: (now + 2 * 86_400_000) / 1_000 },
            secondary: null,
          },
          {
            id: "codex",
            primary: { usedPercent: 20, windowDurationMins: 10_080, resetsAt: (now + 5 * 86_400_000) / 1_000 },
            secondary: null,
          },
        ],
      },
      now,
    );

    expect(summary.accounts[0]?.windows[0]?.targetUsePercentPerDay).toBeCloseTo(40);
    expect(summary.accounts[1]?.windows[0]?.targetUsePercentPerDay).toBeCloseTo(16);
    expect(summary.accounts[0]?.windows[0]?.paceGapPercent).not.toBe(summary.accounts[1]?.windows[0]?.paceGapPercent);
    expect(summary.exactTokenCountsAvailable).toBe(false);
  });

  it("does not estimate weekly pacing for short or unknown windows", () => {
    const summary = summarizeProviderUsage(
      {
        limits: [
          {
            id: "provider",
            primary: { usedPercent: 35, windowDurationMins: 300, resetsAt: null },
            secondary: null,
          },
        ],
      },
      Date.parse("2026-06-01T00:00:00.000Z"),
    );

    expect(summary.accounts[0]?.windows[0]).toMatchObject({
      isWeeklyWindow: false,
      daysUntilReset: null,
      targetUsePercentPerDay: null,
      expectedRemainingPercent: null,
      paceGapPercent: null,
    });
  });

  it("marks an expired weekly window without estimating further use", () => {
    const now = Date.parse("2026-06-08T00:00:00.000Z");
    const summary = summarizeProviderUsage(
      {
        limits: [
          {
            id: "provider",
            primary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: (now - 1_000) / 1_000 },
            secondary: null,
          },
        ],
      },
      now,
    );

    expect(summary.accounts[0]?.windows[0]).toMatchObject({
      resetDue: true,
      remainingPercent: 0,
      targetUsePercentPerDay: null,
      paceGapPercent: null,
    });
  });

  it("keeps grouped and tertiary windows", () => {
    const now = Date.parse("2026-06-01T00:00:00.000Z");
    const summary = summarizeProviderUsage(
      {
        limits: [
          {
            id: "provider",
            primary: null,
            secondary: null,
            groups: [
              {
                name: "model-group",
                models: ["model"],
                primary: null,
                secondary: { usedPercent: 50, windowDurationMins: 300, resetsAt: null },
              },
            ],
            tertiary: { usedPercent: 25, windowDurationMins: 10_080, resetsAt: (now + 2 * 86_400_000) / 1_000 },
          },
        ],
      },
      now,
    );

    expect(summary.accounts[0]?.windows.map((window) => window.name)).toEqual(["model-group:secondary", "tertiary"]);
  });
});
