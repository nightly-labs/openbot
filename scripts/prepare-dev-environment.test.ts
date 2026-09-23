import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSupportedBunVersion,
  copyWorktreeIncludes,
  type DevelopmentCommandRunner,
  prepareDevelopmentEnvironment,
  prepareDevelopmentWorktree,
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

    const outcome = prepareDevelopmentEnvironment({
      projectRoot: root,
      mainCheckoutRoot: root,
      executable: "bun",
      bunVersion: "1.4.0",
      run,
    });

    expect(envFilePresent).toEqual([true, true]);
    expect(outcome).toBe("created");
  });

  it("installs dependencies and migrates the local API in order", () => {
    const root = createTemporaryRoot();
    const calls: string[][] = [];
    const run: DevelopmentCommandRunner = (_executable, args) => calls.push(args);

    prepareDevelopmentEnvironment({
      projectRoot: root,
      mainCheckoutRoot: root,
      executable: "bun",
      bunVersion: "1.4.0",
      run,
    });

    expect(calls).toEqual([
      ["install", "--frozen-lockfile"],
      ["run", "api:migrate:local"],
    ]);
  });

  it("prepares the isolated worktree fixtures after the base environment", () => {
    const root = createTemporaryRoot();
    const calls: Array<{ args: string[]; instanceId?: string }> = [];
    const run: DevelopmentCommandRunner = (_executable, args, options) =>
      calls.push({ args, instanceId: options.env?.OPENBOT_DEV_INSTANCE_ID });

    prepareDevelopmentWorktree({
      projectRoot: root,
      mainCheckoutRoot: root,
      executable: "bun",
      bunVersion: "1.4.0",
      run,
    });

    expect(calls.map((call) => call.args)).toEqual([
      ["install", "--frozen-lockfile"],
      ["run", "api:migrate:local"],
      ["run", "dev:seed", "--if-missing"],
      ["run", "marketplace:seed:local"],
    ]);
    expect(calls[2]?.instanceId).toMatch(/^wt-[a-f0-9]{64}$/u);
  });

  it("copies missing listed files from the main checkout and keeps existing ones", () => {
    const main = createTemporaryRoot();
    const worktree = createTemporaryRoot();
    writeFileSync(join(worktree, ".worktreeinclude"), "# Keys\n.env.keys\nremote/.env.keys\napps/auth-api/.env.dev\n");
    writeFileSync(join(main, ".env.keys"), "main keys");
    mkdirSync(join(main, "remote"));
    writeFileSync(join(main, "remote", ".env.keys"), "remote keys");
    writeFileSync(join(main, "apps", "auth-api", ".env.dev"), "main identity");
    writeFileSync(join(worktree, "apps", "auth-api", ".env.dev"), "worktree identity");

    expect(copyWorktreeIncludes(worktree, main)).toEqual([".env.keys", "remote/.env.keys"]);
    expect(readFileSync(join(worktree, ".env.keys"), "utf8")).toBe("main keys");
    expect(readFileSync(join(worktree, "remote", ".env.keys"), "utf8")).toBe("remote keys");
    expect(readFileSync(join(worktree, "apps", "auth-api", ".env.dev"), "utf8")).toBe("worktree identity");
    expect(copyWorktreeIncludes(main, main)).toEqual([]);
  });
});

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openbot-dev-prepare-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "apps", "auth-api"), { recursive: true });
  return root;
}
