import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { qaReadinessReasons, suggestedTestsForFiles, surfacesForFiles, verificationCommands } from "./dev-verify";

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
    expect(verificationCommands(["src/renderer/src/App.test.tsx"], ["renderer"], true, false)).toEqual({
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

  it("adds checks for changed non-desktop surfaces", () => {
    expect(verificationCommands([], ["api", "contracts", "mobile", "remote"], true, true).runnableCommands).toEqual([
      "bun run lint",
      "bun run typecheck",
      "bun run typecheck:mobile",
      "bun run check:api",
      "bun run test:remote",
      "bun run typecheck:remote",
      "bun run typecheck:contracts",
    ]);
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
});
