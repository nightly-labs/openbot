import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { APP_LOGO_COLORS } from "@openbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { appIconFileName, readAppVariant, resolveAppIconPath, resolveLogoColorIconPath } from "./app-icon";

describe("app icon variant", () => {
  it("defaults to dev for an unpackaged app and production for a packaged app", () => {
    expect(readAppVariant(undefined, false)).toBe("dev");
    expect(readAppVariant(undefined, true)).toBe("production");
  });

  it("accepts explicit dev, preview, and production variants", () => {
    expect(readAppVariant("dev", true)).toBe("dev");
    expect(readAppVariant("preview", false)).toBe("preview");
    expect(readAppVariant("production", false)).toBe("production");
  });

  it("falls back safely for unknown values", () => {
    expect(readAppVariant("staging", false)).toBe("dev");
    expect(readAppVariant("staging", true)).toBe("production");
  });

  it("resolves source and packaged icon paths", () => {
    expect(appIconFileName("preview", "win32")).toBe("icon-preview.png");
    expect(appIconFileName("preview", "darwin")).toBe("icon-preview-macos-safe-area.png");
    expect(
      resolveAppIconPath({
        variant: "dev",
        platform: "win32",
        isPackaged: false,
        resourcesPath: "/Applications/OpenBot.app/Contents/Resources",
        sourceRoot: "/workspace/openbot",
      }),
    ).toBe("/workspace/openbot/build/icon-dev.png");
    expect(
      resolveAppIconPath({
        variant: "production",
        platform: "darwin",
        isPackaged: true,
        resourcesPath: "/Applications/OpenBot.app/Contents/Resources",
        sourceRoot: "/workspace/openbot",
      }),
    ).toBe("/Applications/OpenBot.app/Contents/Resources/icons/icon-production-macos-safe-area.png");
  });

  it("finds an icon file for every logo color on every platform", () => {
    // A missing file leaves the Dock on the old color with no error, so each choice is checked.
    const sourceRoot = resolve(import.meta.dirname, "../..");
    for (const color of APP_LOGO_COLORS) {
      for (const platform of ["darwin", "win32", "linux"] as const) {
        const path = resolveLogoColorIconPath({ color, platform, isPackaged: false, resourcesPath: "", sourceRoot });
        expect(existsSync(path), `${color} on ${platform}: ${path}`).toBe(true);
      }
    }
  });
});
