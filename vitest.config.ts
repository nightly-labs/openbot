import solidPlugin from "@solidjs/vite-plugin";
import { configDefaults, defineConfig } from "vitest/config";
import { TEST_TIMEOUT_MS } from "./src/backend/test-deadlines";
import BalancedSequencer from "./tools/vitest/balanced-sequencer";

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    execArgv: ["--disable-warning=ExperimentalWarning"],
    globals: true,
    restoreMocks: true,
    vmMemoryLimit: "1GiB",
    sequence: { sequencer: BalancedSequencer },
    forceRerunTriggers: [],
    onConsoleLog(log) {
      if (log.includes("[STRICT_READ_UNTRACKED]")) return false;
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          testTimeout: TEST_TIMEOUT_MS,
          setupFiles: ["./tools/vitest/hermetic-setup.ts"],
          include: [
            "src/backend/**/*.test.ts",
            "src/main/**/*.test.ts",
            "src/preload/**/*.test.ts",
            "src/renderer/**/*.test.ts",
            "scripts/**/*.test.ts",
            "packages/logging/**/*.test.ts",
            "apps/mobile/src/**/*.test.ts",
          ],
          exclude: [...configDefaults.exclude, "**/*.dom.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "renderer",
          pool: "vmThreads",
          environment: "jsdom",
          testTimeout: TEST_TIMEOUT_MS,
          include: ["src/renderer/**/*.test.tsx", "**/*.dom.test.ts"],
          globalSetup: ["./tools/vitest/hermetic-global-setup.ts"],
          setupFiles: ["./tools/vitest/hermetic-setup.ts", "./src/renderer/src/setupTests.ts"],
        },
      },
    ],
    exclude: [
      ...configDefaults.exclude,
      "apps/auth-api/**",
      "tests/visual/**",
      ".openbot-build/**",
      "**/.worktrees/**",
      "**/.claude/worktrees/**",
      "**/.codex/**",
    ],
  },
});
