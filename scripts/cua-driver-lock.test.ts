import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { resolveCuaDriver } from "../src/main/cua-driver-artifact";
import {
  CUA_DRIVER_TARGETS,
  type CuaDriverLock,
  cuaDriverInstallRoot,
  cuaDriverTarget,
  cuaDriverTargets,
  loadCuaDriverLock,
  parseCuaDriverLock,
} from "./cua-driver-lock";

const lock = await loadCuaDriverLock();
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("the cua-driver pin", () => {
  it("names one asset and one digest per file for every target OpenBot packages", () => {
    for (const target of cuaDriverTargets) {
      const artifact = lock.artifacts[target];
      expect(artifact.asset).toContain(lock.version);
      expect(Object.keys(artifact.files).sort()).toEqual(CUA_DRIVER_TARGETS[target].files.map((f) => f.path).sort());
    }
  });

  it("rejects a tag that names another version", () => {
    expect(() => parseCuaDriverLock(withLock((value) => ({ ...value, tag: "cua-driver-rs-v9.9.9" })))).toThrow(
      /tag and version disagree/u,
    );
  });

  it("rejects an asset the release does not publish under that name", () => {
    expect(() =>
      parseCuaDriverLock(
        withLock((value) => ({
          ...value,
          artifacts: {
            ...value.artifacts,
            "linux-x64": { ...value.artifacts["linux-x64"], asset: "cua-driver.tar.gz" },
          },
        })),
      ),
    ).toThrow(/linux-x64 cua-driver asset/u);
  });

  it("rejects a pin that forgets a file OpenBot ships", () => {
    expect(() =>
      parseCuaDriverLock(
        withLock((value) => {
          const { "cua-driver": _dropped, ...files } = value.artifacts["darwin-arm64"].files;
          return {
            ...value,
            artifacts: { ...value.artifacts, "darwin-arm64": { ...value.artifacts["darwin-arm64"], files } },
          };
        }),
      ),
    ).toThrow(/does not list the files OpenBot ships/u);
  });
});

describe("the packaged driver layout", () => {
  it("is the layout the application reads in a checkout", async () => {
    for (const target of cuaDriverTargets) {
      const { platform, architecture, executable } = CUA_DRIVER_TARGETS[target];
      const sourceRoot = await makeTemporaryRoot();
      const installed = join(cuaDriverInstallRoot(sourceRoot, target), executable);
      await mkdir(dirname(installed), { recursive: true });
      await writeFile(installed, "", { mode: 0o755 });

      const found = await resolveCuaDriver({
        isPackaged: false,
        resourcesPath: join(sourceRoot, "resources"),
        sourceRoot,
        platform,
        architecture,
        homeDirectory: join(sourceRoot, "home"),
        pathVariable: null,
      });
      expect(found).toBe(installed);
    }
  });

  it("is the layout electron-builder copies into a packaged application", async () => {
    const builder = parse(readFileSync(resolve(import.meta.dirname, "../electron-builder.yml"), "utf8"));
    for (const target of cuaDriverTargets) {
      const { platform, architecture, executable } = CUA_DRIVER_TARGETS[target];
      const from = relative(resolve(import.meta.dirname, ".."), cuaDriverInstallRoot(".", target));
      const section = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
      expect(builder[section].extraResources).toContainEqual({ from, to: `cua-driver/${platform}/${architecture}` });

      const resourcesPath = await makeTemporaryRoot();
      const installed = join(resourcesPath, "cua-driver", platform, architecture, executable);
      await mkdir(dirname(installed), { recursive: true });
      await writeFile(installed, "", { mode: 0o755 });
      const found = await resolveCuaDriver({
        isPackaged: true,
        resourcesPath,
        sourceRoot: resourcesPath,
        platform,
        architecture,
        homeDirectory: join(resourcesPath, "home"),
        pathVariable: null,
      });
      expect(found).toBe(installed);
    }
  });

  it("reads this host's own target", () => {
    expect(cuaDriverTargets).toContain(cuaDriverTarget());
  });
});

/** A copy of the checked-in pin with one field spoiled, in the shape `parseCuaDriverLock` reads. */
function withLock(change: (value: CuaDriverLock) => CuaDriverLock): { cuaDriver: CuaDriverLock } {
  return { cuaDriver: change(structuredClone(lock)) };
}

async function makeTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "openbot-cua-driver-layout-"));
  temporaryRoots.push(root);
  return root;
}
