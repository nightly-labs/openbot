import { fileURLToPath } from "node:url";
import solidPlugin from "@solidjs/vite-plugin";
import { configDefaults, defineConfig } from "vitest/config";
import { TEST_TIMEOUT_MS } from "./src/backend/test-deadlines";
import BalancedSequencer from "./tools/vitest/balanced-sequencer";

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    execArgv: ["--disable-warning=ExperimentalWarning"],
    globals: true,
    // The worker count is left to vitest, which uses one less than the machine
    // reports: the CI runner reports four vCPUs, so it runs three. Asking that
    // runner for a fourth was measured and is slower, not faster - 125.7s
    // against 100.6s - because the workers then contend with the main process.
    // Every spy, global patch and fake timer a test file installs is undone
    // after each test, in both projects, so nothing depends on file order.
    restoreMocks: true,
    // Only `shard()` is overridden, so a local run orders files exactly as before. See the
    // sequencer for why `--shard` alone splits this suite badly.
    sequence: { sequencer: BalancedSequencer },
    onConsoleLog(log) {
      // Solid 2 RC dependencies still emit this dev-only diagnostic while
      // their components initialize. Keep other console output visible.
      if (log.includes("[STRICT_READ_UNTRACKED]")) return false;
    },
    projects: [
      {
        esbuild: { jsx: "automatic" },
        resolve: { alias: { "@": fileURLToPath(new URL("./apps/mobile/src", import.meta.url)) } },
        test: {
          name: "mobile-ui",
          environment: "jsdom",
          pool: "vmThreads",
          include: ["apps/mobile/src/**/*.test.tsx"],
          restoreMocks: true,
          setupFiles: ["./apps/mobile/src/test-setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          server: { deps: { inline: ["@openpanel/react-native"] } },
          environment: "node",
          // Strictly longer than the harness deadline, so a stalled wait fails
          // with the predicate that never held rather than with vitest's
          // generic "test timed out" - see src/backend/test-deadlines.ts.
          testTimeout: TEST_TIMEOUT_MS,
          // No test inherits the developer's HOME, provider keys or time zone -
          // see tools/vitest/hermetic-environment.ts.
          setupFiles: ["./tools/vitest/hermetic-setup.ts"],
          // The file name routes the file, so the project is never a decision:
          // `*.test.ts` runs here without a DOM, `*.test.tsx` needs JSX and
          // gets jsdom, and `*.dom.test.ts` is the narrow case of needing a DOM
          // without rendering a component. Reaching for one of the latter two
          // in a logic test means the logic is not separable from the DOM yet.
          include: [
            "src/backend/**/*.test.ts",
            "src/main/**/*.test.ts",
            "src/preload/**/*.test.ts",
            "src/renderer/**/*.test.ts",
            "scripts/**/*.test.ts",
            "tools/vitest/**/*.test.ts",
            "packages/brand/**/*.test.ts",
            "packages/contracts/**/*.test.ts",
            "packages/i18n/**/*.test.ts",
            "packages/logging/**/*.test.ts",
            "packages/user-errors/**/*.test.ts",
            "packages/team-client/**/*.test.ts",
            "packages/ui/**/*.test.ts",
            "apps/mobile/src/**/*.test.ts",
          ],
          exclude: [...configDefaults.exclude, "**/*.dom.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "renderer",
          // jsdom is the cost here, not the tests: a fresh environment per file
          // was 14.6s of a 32.6s run. `vmThreads` builds the jsdom once per
          // worker and gives each file its own module registry inside a VM
          // context, so isolation is unchanged - `--sequence.shuffle.files`
          // passes, and it fails under `isolate: false`, which is why that
          // faster option is not used here.
          pool: "vmThreads",
          environment: "jsdom",
          // Strictly longer than the DOM wait deadline, for the reason the node
          // project states: a slow runner should fail with the query that never
          // matched, not with vitest's generic "test timed out".
          testTimeout: TEST_TIMEOUT_MS,
          // The `*.dom.test.ts` half of the include mirrors the node project's exclude of the same
          // pattern, so a DOM test lands here wherever it lives: a page script the main process
          // injects needs a document as much as a renderer module does.
          include: ["src/renderer/**/*.test.tsx", "packages/ui/**/*.test.tsx", "**/*.dom.test.ts"],
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
      "build/whisper/**",
    ],
  },
});
