// @vitest-environment node

import { isAccountUsage } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { normalizeAccountUsage } from "./account-usage";

describe("normalizeAccountUsage", () => {
  it("keeps the account-wide bucket when no model is selected", () => {
    expect(
      normalizeAccountUsage({
        rateLimits: {
          limitId: "codex",
          primary: null,
          secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: null },
        },
        rateLimitsByLimitId: {
          luna: {
            limitId: "luna",
            primary: null,
            secondary: { usedPercent: 70, windowDurationMins: 10_080, resetsAt: null },
          },
        },
      }),
    ).toMatchObject({
      limits: [
        {
          id: "codex",
          primary: null,
          secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
    });
  });

  it("keeps every Codex model bucket and the credits in the account-wide reading", () => {
    const usage = normalizeAccountUsage({
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1_786_563_600 },
        secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: null },
        credits: { hasCredits: true, unlimited: false, balance: "1250.5" },
      },
      rateLimitsByLimitId: {
        codex: { limitId: "codex", secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: null } },
        luna: {
          limitId: "luna",
          limitName: "GPT-5.6 Luna",
          secondary: { usedPercent: 70, windowDurationMins: 10_080, resetsAt: null },
        },
        sol: { limitId: "sol", normalModelSlug: "gpt-5.6-sol", primary: { usedPercent: 5 } },
      },
    });
    expect(usage.limits).toHaveLength(1);
    expect(usage.limits[0]).toEqual({
      id: "codex",
      primary: { usedPercent: 28, windowDurationMins: 300, resetsAt: 1_786_563_600 },
      secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: null },
      windows: [
        { kind: "window", label: null, usedPercent: 28, windowDurationMins: 300, resetsAt: 1_786_563_600 },
        { kind: "window", label: null, usedPercent: 15, windowDurationMins: 10_080, resetsAt: null },
        { kind: "model", label: "GPT-5.6 Luna", usedPercent: 70, windowDurationMins: 10_080, resetsAt: null },
        { kind: "model", label: "gpt-5.6-sol", usedPercent: 5, windowDurationMins: null, resetsAt: null },
      ],
      credits: [{ kind: "credits", balance: 1250.5, unlimited: false }],
    });
  });

  it("reads unlimited credits and drops a balance that is not a number", () => {
    const credits = (value: { hasCredits?: boolean; unlimited?: boolean; balance?: string | null }) =>
      normalizeAccountUsage({ rateLimits: { limitId: "codex", primary: { usedPercent: 1 }, credits: value } }).limits[0]
        ?.credits;
    expect(credits({ hasCredits: true, unlimited: true, balance: null })).toEqual([
      { kind: "credits", balance: null, unlimited: true },
    ]);
    expect(credits({ hasCredits: true, unlimited: false, balance: "lots" })).toBeUndefined();
    expect(credits({ hasCredits: false, unlimited: false, balance: "0" })).toBeUndefined();
  });

  it("rounds a fractional window length and drops a negative one", () => {
    // The contract takes whole minutes, so one fraction would reject the whole reading.
    const usage = normalizeAccountUsage({
      rateLimits: {
        limitId: "grok",
        primary: { usedPercent: 10, windowDurationMins: -5 },
        secondary: { usedPercent: 8, windowDurationMins: 10_079.6, resetsAt: null },
        windows: [{ kind: "window", usedPercent: 8, windowDurationMins: 10_079.6, resetsAt: null }],
      },
    });
    expect(usage.limits[0]).toMatchObject({
      primary: { windowDurationMins: null },
      secondary: { windowDurationMins: 10_080 },
      windows: [{ windowDurationMins: 10_080 }],
    });
    expect(isAccountUsage(usage)).toBe(true);
  });
});
