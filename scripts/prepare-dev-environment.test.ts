import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSupportedBunVersion,
  type DevelopmentCommandRunner,
  prepareDevelopmentEnvironment,
} from "./prepare-dev-environment";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("development environment preparation", () => {
  it("accepts the supported stable Bun version", () => {
    expect(() => assertSupportedBunVersion("1.4.0")).not.toThrow();
  });

  it.each(["1.4.0-canary.1", "1.3.11"])("rejects unsupported Bun %s with upgrade instructions", (version) => {
    expect(() => assertSupportedBunVersion(version)).toThrow("OpenBot development requires stable Bun 1.4.0");
  });

  it("generates the development env file before running any command", () => {
    const root = createTemporaryRoot();
    const envFilePresent: boolean[] = [];
    const run: DevelopmentCommandRunner = () =>
      envFilePresent.push(existsSync(join(root, "apps", "auth-api", ".env.dev")));

    const outcome = prepareDevelopmentEnvironment({ projectRoot: root, executable: "bun", bunVersion: "1.4.0", run });

    expect(envFilePresent).toEqual([true, true]);
    expect(outcome).toBe("created");
  });

  it("installs dependencies and migrates the local API in order", () => {
    const root = createTemporaryRoot();
    const calls: string[][] = [];
    const run: DevelopmentCommandRunner = (_executable, args) => calls.push(args);

    prepareDevelopmentEnvironment({ projectRoot: root, executable: "bun", bunVersion: "1.4.0", run });

    expect(calls).toEqual([
      ["install", "--frozen-lockfile"],
      ["run", "api:migrate:local"],
    ]);
  });
});

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openbot-dev-prepare-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "apps", "auth-api"), { recursive: true });
  return root;
}
