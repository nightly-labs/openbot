import solidPlugin from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    environment: "jsdom",
    // Some tests render a whole content collection: 1.6 s locally, and more than 5 s on CI runners
    // that also run the server suite. A failure still names its own assertion well before this limit.
    testTimeout: 20_000,
    environmentOptions: { jsdom: { url: "https://openbot.run/" } },
    setupFiles: ["@testing-library/jest-dom/vitest", "./test/dialog-methods.ts"],
    include: [
      "test/analytics.test.ts",
      "test/hero-download-selector.test.tsx",
      "test/join-page.test.tsx",
      "test/page-error.test.tsx",
      "test/landing-app-preview.test.tsx",
      "test/landing-glow.test.tsx",
      "test/landing-reveal.test.tsx",
      "test/content.test.tsx",
      "test/plugins-page.test.tsx",
    ],
  },
});
