import { describe, expect, it } from "vitest";
import { type MobileFeatureConfig, parseMobileFeatureFlags, resolveMobileFeatures } from "./mobile-features";

function config(ios: string, android = "0"): MobileFeatureConfig {
  return { cloudServers: { ios, android }, browser: { ios: "0", android: "0" } };
}

// A wrong answer turns a feature on for a version that must not have it.
describe("mobile feature flags", () => {
  it("turns a feature on up to the last version, and off after it", () => {
    expect(resolveMobileFeatures(config("1.2.0"), "ios", "1.2.0").cloudServers).toBe(true);
    expect(resolveMobileFeatures(config("1.2.0"), "ios", "1.1.9").cloudServers).toBe(true);
    expect(resolveMobileFeatures(config("1.2.0"), "ios", "1.2.1").cloudServers).toBe(false);
    expect(resolveMobileFeatures(config("1.9.0"), "ios", "1.10.0").cloudServers).toBe(false);
  });

  it("reads a short version as zeros at the end", () => {
    expect(resolveMobileFeatures(config("1.2"), "ios", "1.2.0").cloudServers).toBe(true);
  });

  it("turns a feature off for every version when the last version is 0", () => {
    expect(resolveMobileFeatures(config("0"), "ios", "0.0.1").cloudServers).toBe(false);
  });

  it("uses the last version of the platform of the request", () => {
    expect(resolveMobileFeatures(config("1.2.0", "0"), "android", "1.0.0").cloudServers).toBe(false);
    expect(resolveMobileFeatures(config("0", "2.0.0"), "android", "1.0.0").cloudServers).toBe(true);
  });

  it("turns features off for a missing or unreadable version, or an unknown platform", () => {
    expect(resolveMobileFeatures(config("1.2.0"), "ios", null).cloudServers).toBe(false);
    expect(resolveMobileFeatures(config("1.2.0"), "ios", "1.0 (5)").cloudServers).toBe(false);
    expect(resolveMobileFeatures(config("1.2.0"), "web", "1.0.0").cloudServers).toBe(false);
  });

  it("reads a flag that is missing or not a boolean as off", () => {
    expect(parseMobileFeatureFlags({ features: { cloudServers: "true" } })?.cloudServers).toBe(false);
    expect(parseMobileFeatureFlags({ features: {} })?.cloudServers).toBe(false);
    expect(parseMobileFeatureFlags({})).toBeNull();
  });
});
