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
  writeInstallStamp,
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

  it("generates development state before running any command", () => {
    const root = createTemporaryRoot();
    const envFilePresent: boolean[] = [];
    const run: DevelopmentCommandRunner = () =>
      envFilePresent.push(existsSync(join(root, ".openbot", "dev-state.json")));

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

  it("skips the install and the migration while their inputs are unchanged", () => {
    const root = createTemporaryRoot();
    writeFileSync(join(root, "bun.lock"), "lock v1");
    mkdirSync(join(root, "apps", "auth-api", "migrations"));
    writeFileSync(join(root, "apps", "auth-api", "migrations", "0001_init.sql"), "create table a (id text);");
    const calls: string[] = [];
    const run: DevelopmentCommandRunner = (_executable, args) => {
      calls.push(args.join(" "));
      // Wrangler creates the local D1 state on the first migration.
      mkdirSync(join(root, "apps", "auth-api", ".wrangler", "state", "v3", "d1"), { recursive: true });
    };
    const prepare = () =>
      prepareDevelopmentEnvironment({ projectRoot: root, mainCheckoutRoot: root, bunVersion: "1.4.0", run });

    prepare();
    prepare();
    expect(calls).toEqual(["install --frozen-lockfile", "run api:migrate:local"]);

    writeFileSync(join(root, "bun.lock"), "lock v2");
    writeFileSync(join(root, "apps", "auth-api", "migrations", "0002_next.sql"), "create table b (id text);");
    prepare();
    rmSync(join(root, "apps", "auth-api", ".wrangler", "state"), { recursive: true });
    prepare();
    expect(calls.slice(2)).toEqual(["install --frozen-lockfile", "run api:migrate:local", "run api:migrate:local"]);

    // A plain `bun install` on another branch stamps that branch, so the return installs again.
    writeFileSync(join(root, "bun.lock"), "lock v3");
    writeInstallStamp(root);
    writeFileSync(join(root, "bun.lock"), "lock v2");
    prepare();
    expect(calls.slice(5)).toEqual(["install --frozen-lockfile"]);
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
    // Each checkout sits one folder deep, so a "../" entry has a real file to reach.
    const mainParent = createTemporaryRoot();
    const main = join(mainParent, "main");
    const worktree = join(createTemporaryRoot(), "worktree");
    mkdirSync(join(main, "apps", "auth-api"), { recursive: true });
    mkdirSync(join(worktree, "apps", "auth-api"), { recursive: true });
    writeFileSync(
      join(worktree, ".worktreeinclude"),
      "# Keys\n.env.keys\nremote/.env.keys\napps/auth-api/.env.dev\n../outside.keys\nremote/../../outside.keys\n/etc/hosts\n",
    );
    writeFileSync(join(main, ".env.keys"), "main keys");
    writeFileSync(join(mainParent, "outside.keys"), "outside keys");
    mkdirSync(join(main, "remote"));
    writeFileSync(join(main, "remote", ".env.keys"), "remote keys");
    writeFileSync(join(main, "apps", "auth-api", ".env.dev"), "main identity");
    writeFileSync(join(worktree, "apps", "auth-api", ".env.dev"), "worktree identity");

    expect(copyWorktreeIncludes(worktree, main)).toEqual([".env.keys", "remote/.env.keys"]);
    expect(readFileSync(join(worktree, ".env.keys"), "utf8")).toBe("main keys");
    expect(readFileSync(join(worktree, "remote", ".env.keys"), "utf8")).toBe("remote keys");
    expect(readFileSync(join(worktree, "apps", "auth-api", ".env.dev"), "utf8")).toBe("worktree identity");
    expect(existsSync(join(worktree, "..", "outside.keys"))).toBe(false);
    expect(copyWorktreeIncludes(main, main)).toEqual([]);
  });
});

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openbot-dev-prepare-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "apps", "auth-api"), { recursive: true });
  return root;
}
