import { describe, expect, it } from "vitest";
import { interfaceFontStack, normalizeInterfaceFontFamily } from "./interface-font-preference";

describe("interface font preference", () => {
  it("keeps a family name with the punctuation that font names use", () => {
    expect(normalizeInterfaceFontFamily("Vazirmatn")).toBe("Vazirmatn");
    expect(normalizeInterfaceFontFamily("  SF Pro  Rounded ")).toBe("SF Pro Rounded");
    expect(normalizeInterfaceFontFamily("IRANSansWeb(FaNum)")).toBe("IRANSansWeb(FaNum)");
    expect(normalizeInterfaceFontFamily("IBM Plex Sans Arabic")).toBe("IBM Plex Sans Arabic");
  });

  it("reads an empty or unusable value as the default font", () => {
    expect(normalizeInterfaceFontFamily(null)).toBeNull();
    expect(normalizeInterfaceFontFamily(undefined)).toBeNull();
    expect(normalizeInterfaceFontFamily("   ")).toBeNull();
    expect(normalizeInterfaceFontFamily('Bad"Font')).toBeNull();
    expect(normalizeInterfaceFontFamily("Bad;Font")).toBeNull();
    expect(normalizeInterfaceFontFamily("A".repeat(65))).toBeNull();
  });

  it("puts the chosen family before the default stack, so a missing font falls back", () => {
    expect(interfaceFontStack("Vazirmatn")).toBe(
      '"Vazirmatn", "Inter Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
    expect(interfaceFontStack(null)).toBeNull();
  });
});
