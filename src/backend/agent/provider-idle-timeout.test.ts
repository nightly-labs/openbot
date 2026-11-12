import { describe, expect, it } from "vitest";
import { DEFAULT_PROVIDER_IDLE_RELEASE_MS, configuredProviderIdleReleaseMs } from "./provider-idle-timeout";

describe("configuredProviderIdleReleaseMs", () => {
  it("defaults to 10 minutes when unset or empty", () => {
    expect(configuredProviderIdleReleaseMs(undefined)).toBe(DEFAULT_PROVIDER_IDLE_RELEASE_MS);
    expect(configuredProviderIdleReleaseMs("")).toBe(DEFAULT_PROVIDER_IDLE_RELEASE_MS);
    expect(configuredProviderIdleReleaseMs("   ")).toBe(DEFAULT_PROVIDER_IDLE_RELEASE_MS);
  });

  it("returns null when set to 0 to disable idle process release", () => {
    expect(configuredProviderIdleReleaseMs("0")).toBeNull();
  });

  it("parses valid positive millisecond timeouts", () => {
    expect(configuredProviderIdleReleaseMs("60000")).toBe(60_000);
    expect(configuredProviderIdleReleaseMs("3600000")).toBe(3_600_000);
  });

  it("falls back to default when value is negative or non-numeric", () => {
    expect(configuredProviderIdleReleaseMs("-1000")).toBe(DEFAULT_PROVIDER_IDLE_RELEASE_MS);
    expect(configuredProviderIdleReleaseMs("invalid")).toBe(DEFAULT_PROVIDER_IDLE_RELEASE_MS);
    expect(configuredProviderIdleReleaseMs("NaN")).toBe(DEFAULT_PROVIDER_IDLE_RELEASE_MS);
  });
});
