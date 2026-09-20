import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPENBOT_CURSOR_THEME_ID } from "@openbot/brand/cursor-theme";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type CuaDriverArtifactInput,
  isSupportedCuaDriverTarget,
  resolveCuaCursorTheme,
  resolveCuaDriver,
} from "./cua-driver-artifact";

let root: string;

async function writeExecutable(...segments: string[]): Promise<string> {
  const path = join(root, ...segments);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\n");
  await chmod(path, 0o755);
  return path;
}

function input(overrides: Partial<CuaDriverArtifactInput> = {}): CuaDriverArtifactInput {
  return {
    isPackaged: false,
    resourcesPath: join(root, "resources"),
    sourceRoot: join(root, "source"),
    platform: "darwin",
    architecture: "arm64",
    homeDirectory: join(root, "home"),
    pathVariable: null,
    ...overrides,
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "openbot-cua-driver-"));
});

describe("resolveCuaDriver", () => {
  it("returns null when this computer has no driver", async () => {
    await expect(resolveCuaDriver(input())).resolves.toBeNull();
  });

  it("finds the checkout build before anything a machine installed", async () => {
    const built = await writeExecutable("source", "build", "cua-driver", "darwin", "arm64", "cua-driver");
    await writeExecutable("home", ".local", "bin", "cua-driver");
    await expect(resolveCuaDriver(input())).resolves.toBe(built);
  });

  it("finds the packaged resources copy", async () => {
    const packaged = await writeExecutable("resources", "cua-driver", "darwin", "arm64", "cua-driver");
    await expect(resolveCuaDriver(input({ isPackaged: true }))).resolves.toBe(packaged);
  });

  it("prefers an override over the checkout build", async () => {
    await writeExecutable("source", "build", "cua-driver", "darwin", "arm64", "cua-driver");
    const pinned = await writeExecutable("pinned", "cua-driver");
    await expect(resolveCuaDriver(input({ overrides: [pinned] }))).resolves.toBe(pinned);
  });

  it("takes the first override that exists", async () => {
    const second = await writeExecutable("second", "cua-driver");
    await expect(resolveCuaDriver(input({ overrides: [join(root, "missing", "cua-driver"), second] }))).resolves.toBe(
      second,
    );
  });

  it("ignores a relative override", async () => {
    await expect(resolveCuaDriver(input({ overrides: ["./cua-driver"] }))).resolves.toBeNull();
  });

  it("falls back to the install script's directory", async () => {
    const installed = await writeExecutable("home", ".local", "bin", "cua-driver");
    await expect(resolveCuaDriver(input())).resolves.toBe(installed);
  });

  it("reads the driver's own install directory before the default one", async () => {
    await writeExecutable("home", ".local", "bin", "cua-driver");
    const elsewhere = await writeExecutable("opt", "bin", "cua-driver");
    await expect(resolveCuaDriver(input({ installDirectory: join(root, "opt", "bin") }))).resolves.toBe(elsewhere);
  });

  it("scans PATH last", async () => {
    const onPath = await writeExecutable("usr", "local", "bin", "cua-driver");
    await expect(
      resolveCuaDriver(input({ pathVariable: `${join(root, "empty")}:${join(root, "usr", "local", "bin")}` })),
    ).resolves.toBe(onPath);
  });

  it("skips a file without the execute bit", async () => {
    const path = join(root, "home", ".local", "bin", "cua-driver");
    await mkdir(join(root, "home", ".local", "bin"), { recursive: true });
    await writeFile(path, "not executable");
    await chmod(path, 0o644);
    await expect(resolveCuaDriver(input())).resolves.toBeNull();
  });

  // The driver is one program on three desktops. The build directory is named for the target, and
  // only Windows puts an extension on the file, so a wrong name here reads as "driver not installed"
  // on a computer that has one.
  it.each([
    { platform: "darwin", architecture: "arm64", name: "cua-driver" },
    { platform: "darwin", architecture: "x64", name: "cua-driver" },
    { platform: "linux", architecture: "x64", name: "cua-driver" },
    { platform: "linux", architecture: "arm64", name: "cua-driver" },
    { platform: "win32", architecture: "x64", name: "cua-driver.exe" },
    { platform: "win32", architecture: "arm64", name: "cua-driver.exe" },
  ] as const)("finds the $platform $architecture build", async ({ platform, architecture, name }) => {
    const built = await writeExecutable("source", "build", "cua-driver", platform, architecture, name);
    await expect(resolveCuaDriver(input({ platform, architecture }))).resolves.toBe(built);
  });

  it("reads the per-user program directory the Windows installer writes to", async () => {
    const installed = await writeExecutable("local", "Programs", "Cua", "cua-driver", "bin", "cua-driver.exe");
    await expect(
      resolveCuaDriver(input({ platform: "win32", architecture: "x64", localAppDataDirectory: join(root, "local") })),
    ).resolves.toBe(installed);
  });

  // The driver renamed its Windows vendor folder in v0.2.14 and migrates an older install only when
  // its installer runs again, so a user who has not run it since still has a working driver.
  it("still reads the Windows layout the driver used before v0.2.14", async () => {
    const installed = await writeExecutable("local", "Programs", "trycua", "cua-driver-rs", "bin", "cua-driver.exe");
    await expect(
      resolveCuaDriver(input({ platform: "win32", architecture: "x64", localAppDataDirectory: join(root, "local") })),
    ).resolves.toBe(installed);
  });

  // The macOS installer puts the real binary in an application bundle and only a symlink in
  // `~/.local/bin`, so a cleared `~/.local/bin` must not read as "no driver".
  it("reads the macOS application bundle", async () => {
    const installed = await writeExecutable("apps", "CuaDriver.app", "Contents", "MacOS", "cua-driver");
    await expect(resolveCuaDriver(input({ applicationsDirectory: join(root, "apps") }))).resolves.toBe(installed);
  });

  // A target upstream publishes nothing for has nothing to install, so the resolver must not report a
  // file that happens to sit in the right place.
  it("returns null for a target the driver is not published for", async () => {
    await writeExecutable("source", "build", "cua-driver", "linux", "ppc64", "cua-driver");
    await expect(resolveCuaDriver(input({ platform: "linux", architecture: "ppc64" }))).resolves.toBeNull();
    await expect(resolveCuaDriver(input({ platform: "freebsd", architecture: "x64" }))).resolves.toBeNull();
  });

  it("names the three desktops as supported, and nothing else", () => {
    expect(isSupportedCuaDriverTarget("darwin", "arm64")).toBe(true);
    expect(isSupportedCuaDriverTarget("win32", "x64")).toBe(true);
    expect(isSupportedCuaDriverTarget("linux", "arm64")).toBe(true);
    expect(isSupportedCuaDriverTarget("linux", "ppc64")).toBe(false);
    expect(isSupportedCuaDriverTarget("freebsd", "x64")).toBe(false);
  });
});

describe("resolveCuaCursorTheme", () => {
  async function writeTheme(...segments: string[]): Promise<void> {
    const path = join(root, ...segments, `${OPENBOT_CURSOR_THEME_ID}.cua-theme`);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "theme");
  }

  it("returns null when the build ships no cursor, because the driver then draws its own", async () => {
    await expect(resolveCuaCursorTheme(input())).resolves.toBeNull();
  });

  it("finds the checkout theme a packaging run writes", async () => {
    await writeTheme("source", "build", "cua-driver-theme");

    await expect(resolveCuaCursorTheme(input())).resolves.toBe(join(root, "source", "build", "cua-driver-theme"));
  });

  it("finds the packaged theme, which is the one a user runs", async () => {
    await writeTheme("resources", "cua-driver-theme");

    await expect(resolveCuaCursorTheme(input({ isPackaged: true }))).resolves.toBe(
      join(root, "resources", "cua-driver-theme"),
    );
  });

  it("returns null when the directory holds no theme named after the id the daemon is given", async () => {
    await mkdir(join(root, "source", "build", "cua-driver-theme"), { recursive: true });
    await writeFile(join(root, "source", "build", "cua-driver-theme", "other.cua-theme"), "theme");

    await expect(resolveCuaCursorTheme(input())).resolves.toBeNull();
  });
});
