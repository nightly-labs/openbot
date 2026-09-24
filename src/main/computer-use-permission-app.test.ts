import { describe, expect, it } from "vitest";
import { applicationBundlePath, applicationIconName } from "./computer-use-permission-app";

describe("applicationBundlePath", () => {
  it("finds the bundle a packaged executable sits inside", () => {
    expect(applicationBundlePath("/Applications/OpenBot.app/Contents/MacOS/OpenBot", "darwin")).toBe(
      "/Applications/OpenBot.app",
    );
  });

  // A development build runs Electron, and Electron is the application the grant is attached to.
  it("finds the bundle of a development build", () => {
    expect(
      applicationBundlePath("/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron", "darwin"),
    ).toBe("/repo/node_modules/electron/dist/Electron.app");
  });

  it("finds nothing for an executable in a plain directory", () => {
    expect(applicationBundlePath("/usr/local/bin/openbot", "darwin")).toBeNull();
  });

  // Only macOS asks for a bundle in a permission list, so there is nothing to drag anywhere else.
  it("finds nothing away from macOS", () => {
    expect(applicationBundlePath("/Applications/OpenBot.app/Contents/MacOS/OpenBot", "linux")).toBeNull();
  });
});

describe("applicationIconName", () => {
  it("prefers the icon named after the bundle", () => {
    expect(applicationIconName("/Applications/OpenBot.app", ["document.icns", "openbot.icns", "en.lproj"])).toBe(
      "openbot.icns",
    );
  });

  it("takes any icon the bundle carries", () => {
    expect(applicationIconName("/Applications/OpenBot.app", ["app-picture.icns"])).toBe("app-picture.icns");
  });

  // A drag with no image is refused, so the caller has to know there is nothing to draw.
  it("finds nothing in a bundle with no icon", () => {
    expect(applicationIconName("/Applications/OpenBot.app", ["Info.plist"])).toBeNull();
  });
});
