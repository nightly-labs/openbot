import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "storybook-solidjs-vite";
import { mergeConfig, type PluginOption } from "vite";
import { chatVisualPages } from "./chat-visual-pages";

const config = {
  stories: [
    "../src/renderer/**/*.stories.@(ts|tsx)",
    "../apps/auth-api/src/**/*.stories.@(ts|tsx)",
    "../apps/status/src/**/*.stories.@(ts|tsx)",
    // The browser extension's screens, with its own stylesheet and a story server of test data.
    "../apps/browser-extension/src/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-a11y"],
  previewHead: (head) => `${head}\n<link rel="icon" type="image/svg+xml" href="./favicon.svg" />`,
  framework: {
    name: "storybook-solidjs-vite",
    options: {
      docgen: process.env.OPENBOT_STORYBOOK_CHECK === "true" ? false : undefined,
    },
  },
  viteFinal: async (viteConfig) => {
    const mergedConfig = mergeConfig(viteConfig, {
      plugins: [tailwindcss({ optimize: false }), chatVisualPages()],
      build: {
        chunkSizeWarningLimit: 1_200,
      },
      optimizeDeps: {
        include: ["solid-recharts"],
        exclude: ["@norbert_bodziony/bloub", "@norbert_bodziony/bloub/plush"],
      },
      resolve: {
        alias: [{ find: "solid-js/web", replacement: "@solidjs/web" }],
        dedupe: ["solid-js", "@solidjs/web"],
      },
    });
    const plugins = (mergedConfig.plugins ?? []).filter((plugin: PluginOption) => !isLegacySolidPlugin(plugin));
    return {
      ...mergedConfig,
      plugins: [...plugins, solidPlugin({ performanceTracks: false })],
    };
  },
} satisfies StorybookConfig;

export default config;

function isLegacySolidPlugin(plugin: PluginOption): boolean {
  if (!plugin || Array.isArray(plugin) || "then" in plugin) return false;
  return "name" in plugin && plugin.name === "solid";
}
