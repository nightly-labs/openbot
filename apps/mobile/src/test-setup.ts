import { vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

// UI tests exercise product behavior without loading native analytics modules or sending events.
vi.mock("@/features/analytics/mobile-analytics", async () => {
  const { MobileAnalytics } = await import("./features/analytics/analytics-core");
  return { mobileAnalytics: new MobileAnalytics(() => null) };
});

// `@/shared/lib/text` reads the saved language and the phone's languages through native modules.
// UI tests read English, which is also what the app shows before the language loads.
vi.mock("@/shared/lib/text", async () => {
  const { textFor } = await import("./shared/lib/text-value");
  const english = textFor("en");
  return { currentText: () => english, useText: () => english };
});
