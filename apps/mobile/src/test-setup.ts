import { vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

// UI tests exercise product behavior without loading native analytics modules or sending events.
vi.mock("@/features/analytics/mobile-analytics", async () => {
  const { MobileAnalytics } = await import("./features/analytics/analytics-core");
  return { mobileAnalytics: new MobileAnalytics(() => null) };
});
