import { emptyAnalyticsTotals } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { readHostAnalytics } from "./host-analytics";

const input = { startDate: "2026-09-01", endDate: "2026-09-07", timeZone: "UTC" };
const report = {
  ...input,
  collectionStartedAt: "2026-09-01T00:00:00Z",
  updatedAt: null,
  totals: emptyAnalyticsTotals(),
  daily: [],
  models: [],
  agents: [],
  providerDaily: [],
};
describe("host analytics client", () => {
  it("does not send an unsupported request and rejects data from another filter", async () => {
    const requests: string[] = [];
    async function request<T>(_method: "GET", path: string, decode: (value: unknown) => T): Promise<T> {
      requests.push(path);
      return decode(report);
    }
    expect(await readHostAnalytics(request, [], input)).toBeNull();
    expect(requests).toEqual([]);
    expect(await readHostAnalytics(request, ["host-analytics"], input)).toEqual(report);
    expect(requests).toEqual(["/v1/analytics?startDate=2026-09-01&endDate=2026-09-07&timeZone=UTC"]);
    await expect(readHostAnalytics(request, ["host-analytics"], { ...input, agentId: "agent-a" })).rejects.toThrow(
      "does not match",
    );
  });
});
