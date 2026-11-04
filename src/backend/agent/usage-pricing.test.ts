// DeepSeek bills off-peak at half the peak rate, on a schedule that has to be read from the turn's
// own UTC timestamp. These pin the window edges, a weekend, and that the other providers are
// untouched. 2026-11-02 is a Monday.
import { describe, expect, it } from "vitest";
import { estimateUsageCost } from "./usage-pricing";

const ONE_MILLION_INPUT = { uncachedInput: 1_000_000, cachedInput: 0, cacheCreation: 0, output: 0 };
const at = (occurredAt: string, model = "deepseek-flash") =>
  estimateUsageCost("deepseek", model, ONE_MILLION_INPUT, null, null, occurredAt);
// The basis is a JSON string in the row, so a test reads back the keys it asks about.
const basisOf = (basis: string | null) => JSON.parse(basis ?? "{}");

// An unreadable time keeps the peak rate, so the estimate errs high rather than low.
const SCHEDULE: ReadonlyArray<{ at: string; period: string; cost: number }> = [
  { at: "2026-11-02T00:59:00.000Z", period: "off-peak", cost: 0.15 },
  { at: "2026-11-02T01:00:00.000Z", period: "peak", cost: 0.3 },
  { at: "2026-11-02T03:59:59.999Z", period: "peak", cost: 0.3 },
  { at: "2026-11-02T04:00:00.000Z", period: "off-peak", cost: 0.15 },
  { at: "2026-11-02T05:59:00.000Z", period: "off-peak", cost: 0.15 },
  { at: "2026-11-02T06:00:00.000Z", period: "peak", cost: 0.3 },
  { at: "2026-11-02T09:59:00.000Z", period: "peak", cost: 0.3 },
  { at: "2026-11-02T10:00:00.000Z", period: "off-peak", cost: 0.15 },
  // A Saturday and a Sunday, at hours that are peak on a weekday.
  { at: "2026-10-31T02:00:00.000Z", period: "off-peak", cost: 0.15 },
  { at: "2026-11-01T07:00:00.000Z", period: "off-peak", cost: 0.15 },
  { at: "not a date", period: "peak", cost: 0.3 },
];

describe("estimateUsageCost", () => {
  for (const { at: occurredAt, period, cost } of SCHEDULE) {
    it(`prices a deepseek turn at ${occurredAt} as ${period}`, () => {
      const priced = at(occurredAt);
      expect(priced.cost).toBeCloseTo(cost, 10);
      expect(basisOf(priced.basis).period).toBe(period);
    });
  }

  it("halves every rate off-peak, not just the input rate", () => {
    const tokens = { uncachedInput: 0, cachedInput: 0, cacheCreation: 0, output: 1_000_000 };
    const peak = estimateUsageCost("deepseek", "deepseek-v4-pro", tokens, null, null, "2026-11-02T02:00:00.000Z");
    const offPeak = estimateUsageCost("deepseek", "deepseek-v4-pro", tokens, null, null, "2026-11-02T05:00:00.000Z");
    expect(peak.cost).toBeCloseTo(3.96, 10);
    expect(offPeak.cost).toBeCloseTo(1.98, 10);
    expect(Number(basisOf(offPeak.basis).cached)).toBeCloseTo(0.022, 10);
  });

  it("records the rates it used, so a stored row can be explained", () => {
    const basis = basisOf(at("2026-11-02T02:00:00.000Z").basis);
    expect(basis).toMatchObject({
      model: "deepseek-flash",
      input: 0.3,
      cached: 0.006,
      cacheWrite: 0,
      output: 1.2,
    });
  });

  it("leaves a provider with no off-peak schedule alone", () => {
    const tokens = { uncachedInput: 1_000, cachedInput: 0, cacheCreation: 0, output: 0 };
    const priced = estimateUsageCost("codex", "gpt-6-astra", tokens, null, null, "2026-11-02T02:00:00.000Z");
    expect(priced.cost).toBeCloseTo(0.01, 10);
    expect(basisOf(priced.basis)).not.toHaveProperty("period");
  });
});
