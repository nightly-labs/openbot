import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { type CuaDriverArtifactInput, resolveCuaDriver } from "./cua-driver-artifact";

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

  it("returns null away from macOS arm64", async () => {
    await writeExecutable("source", "build", "cua-driver", "darwin", "arm64", "cua-driver");
    await expect(resolveCuaDriver(input({ platform: "linux" }))).resolves.toBeNull();
    await expect(resolveCuaDriver(input({ platform: "win32" }))).resolves.toBeNull();
    await expect(resolveCuaDriver(input({ architecture: "x64" }))).resolves.toBeNull();
  });
});
