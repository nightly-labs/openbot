// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "./effect-boundary";
import { readOpenCodeGoUsage } from "./opencode-usage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readOpenCodeGoUsage", () => {
  it("lists the rolling, weekly and monthly windows and gates on the tighter long one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          usage: {
            rolling: { percent: 12, resetsAt: "2026-09-03T16:00:00Z" },
            weekly: { percent: 30, resetsAt: "2026-09-08T00:00:00Z" },
            monthly: { percent: 47, resetsAt: "2026-10-01T00:00:00Z" },
          },
        }),
      ),
    );

    const usage = await runCauseEffect(readOpenCodeGoUsage("go-key"));

    expect(usage.rateLimits).toMatchObject({
      primary: { usedPercent: 12, windowDurationMins: 300 },
      secondary: { usedPercent: 47, windowDurationMins: 43_200 },
      windows: [
        { kind: "window", usedPercent: 12, windowDurationMins: 300 },
        { kind: "window", usedPercent: 30, windowDurationMins: 10_080 },
        { kind: "window", usedPercent: 47, windowDurationMins: 43_200 },
      ],
    });
  });
});
