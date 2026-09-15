import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createDevVerificationReport,
  qaReadinessReasons,
  suggestedTestsForFiles,
  surfacesForFiles,
  verificationCommands,
} from "./dev-verify";

describe("dev verification planning", () => {
  it("maps changed files to affected product surfaces", () => {
    expect(
      surfacesForFiles([
        "src/renderer/src/App.tsx",
        "src/main/index.ts",
        "apps/mobile/app/index.tsx",
        "apps/auth-api/src/index.ts",
        "remote/api/src/index.ts",
        "packages/contracts/src/index.ts",
        "README.md",
      ]),
    ).toEqual(["api", "contracts", "desktop", "docs", "mobile", "remote", "renderer"]);
  });

  it("builds the narrow renderer verification loop", () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-dev-verify-"));
    mkdirSync(join(root, "src/renderer/src"), { recursive: true });
    writeFileSync(join(root, "src/renderer/src/App.test.tsx"), "export {};\n");
    expect(verificationCommands(["src/renderer/src/App.test.tsx"], ["renderer"], true, false, root)).toEqual({
      commands: [
        "bun run test:desktop -- src/renderer/src/App.test.tsx",
        "bun run lint",
        "bun run typecheck",
        "bun run check:ui",
        "bun run dev --isolated",
        "bun run dev:automation snapshot",
        "bun run dev:automation screenshot",
      ],
      runnableCommands: [
        "bun run test:desktop -- src/renderer/src/App.test.tsx",
        "bun run lint",
        "bun run typecheck",
        "bun run check:ui",
      ],
      qaCommands: ["bun run dev:automation snapshot", "bun run dev:automation screenshot"],
      suggestedTests: ["src/renderer/src/App.test.tsx"],
    });
  });

  it("finds a sibling test for a changed source file", () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-dev-verify-"));
    mkdirSync(join(root, "src/main"), { recursive: true });
    writeFileSync(join(root, "src/main/example.ts"), "export const value = 1;\n");
    writeFileSync(join(root, "src/main/example.test.ts"), "export {};\n");
    expect(suggestedTestsForFiles(["src/main/example.ts"], root)).toEqual(["src/main/example.test.ts"]);
  });

  it("routes delegated tests to their workspace runners", () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-dev-verify-"));
    const files = [
      "apps/auth-api/test/auth-service.test.ts",
      "apps/auth-api/test/content.test.tsx",
      "apps/site-router/test/router.test.ts",
      "remote/api/test/tokens.test.ts",
    ];
    for (const file of files) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), "export {};\n");
    }

    expect(verificationCommands(files, ["api", "remote"], true, true, root).runnableCommands).toEqual([
      "bun run --cwd apps/auth-api test:server -- test/auth-service.test.ts",
      "bun run --cwd apps/auth-api test:client -- test/content.test.tsx",
      "bun run --cwd apps/site-router test -- test/router.test.ts",
      "bun run --cwd remote/api test -- test/tokens.test.ts",
      "bun run lint",
      "bun run typecheck",
    ]);
  });

  it("does not suggest a deleted test", () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-dev-verify-"));
    expect(suggestedTestsForFiles(["src/main/deleted.test.ts"], root)).toEqual([]);
  });

  it("keeps API builds out of safe execution and avoids repeated typechecks", () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-dev-verify-"));
    const plan = verificationCommands(
      [
        "apps/auth-api/src/index.ts",
        "apps/site-router/src/index.ts",
        "remote/api/src/index.ts",
        "apps/mobile/app/index.tsx",
      ],
      ["api", "contracts", "mobile", "remote"],
      true,
      true,
      root,
    );
    expect(plan.runnableCommands).toEqual([
      "bun run lint",
      "bun run typecheck",
      "bun run test:api",
      "bun run test:sites",
      "bun run test:remote",
    ]);
    expect(plan.commands).toContain("bun run check:api");
    expect(plan.runnableCommands).not.toContain("bun run check:api");
    expect(plan.runnableCommands).not.toContain("bun run typecheck:mobile");
    expect(plan.runnableCommands).not.toContain("bun run typecheck:remote");
    expect(plan.runnableCommands).not.toContain("bun run typecheck:contracts");
  });

  it("reports renderer QA blockers before automation starts", () => {
    expect(
      qaReadinessReasons(["renderer"], false, {
        stackRunning: true,
        appRunning: false,
        isolatedApp: false,
        orphanedStack: true,
        ambiguousApp: false,
      }),
    ).toEqual([
      "Development setup is incomplete. Run bun run dev:prepare before renderer QA.",
      "This worktree has an orphaned dev stack. Inspect bun run dev:status.",
      "No running app matches this worktree.",
    ]);
  });

  it("reports ambiguous and shared renderer app state", () => {
    expect(
      qaReadinessReasons(["renderer"], true, {
        stackRunning: true,
        appRunning: false,
        isolatedApp: false,
        orphanedStack: false,
        ambiguousApp: true,
      }),
    ).toEqual(["More than one app instance matches this worktree."]);

    expect(
      qaReadinessReasons(["renderer"], true, {
        stackRunning: true,
        appRunning: true,
        isolatedApp: false,
        orphanedStack: false,
        ambiguousApp: false,
      }),
    ).toEqual(["The running app uses the default profile. Start bun run dev --isolated for isolated renderer QA."]);
  });

  it("reports setup blockers before dependencies are installed", async () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-dev-verify-fresh-"));
    mkdirSync(join(root, "apps/auth-api"), { recursive: true });
    writeFileSync(join(root, "README.md"), "fresh checkout\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "dev-verify@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Dev Verify"], { cwd: root });
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });

    const report = await createDevVerificationReport(root);

    expect(report.setup.dependencies).toBe(false);
    expect(report.reasons).toContain("node_modules is missing. Run bun run dev:prepare.");
    expect(report.commands).toContain("bun run dev:prepare");
    expect(report.runtime).toEqual({
      stackRunning: false,
      appRunning: false,
      isolatedApp: false,
      orphanedStack: false,
      ambiguousApp: false,
    });
  });

  it("prints setup blockers and skips --run checks when setup is incomplete", () => {
    const root = mkdtempSync(join(tmpdir(), "openbot-dev-verify-run-fresh-"));
    mkdirSync(join(root, "apps/auth-api"), { recursive: true });
    writeFileSync(join(root, "README.md"), "fresh checkout\n");
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["config", "user.email", "dev-verify@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Dev Verify"], { cwd: root });
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync("git", ["commit", "-m", "fixture"], { cwd: root });

    const result = spawnSync("bun", [join(dirname(fileURLToPath(import.meta.url)), "dev-verify.ts"), "--run"], {
      cwd: root,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("dev:verify running:");
    expect(JSON.parse(result.stdout)).toMatchObject({
      setup: { dependencies: false },
      commands: expect.arrayContaining(["bun run dev:prepare"]),
    });
  });
});
