// @vitest-environment node
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
    ).toEqual({
      limits: [
        {
          id: "codex",
          primary: null,
          secondary: { usedPercent: 15, windowDurationMins: 10_080, resetsAt: null },
        },
      ],
    });
  });
});
