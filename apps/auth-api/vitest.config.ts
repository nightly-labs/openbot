import solidPlugin from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";
import { rendererPreviewAlias, rendererWebAlias } from "./renderer-preview-alias";

export default defineConfig({
  plugins: [solidPlugin({ ssr: true })],
  resolve: {
    alias: {
      "@openbot/renderer-preview": rendererPreviewAlias,
      "@openbot/renderer-web": rendererWebAlias,
    },
  },
  test: {
    environment: "node",
    execArgv: ["--disable-warning=ExperimentalWarning"],
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: [
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
