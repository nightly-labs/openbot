import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "storybook-solidjs-vite";
import { mergeConfig, type PluginOption } from "vite";
import { chatVisualPages } from "./chat-visual-pages";

const config = {
  // The desktop renderer, the public site's article components and the status page. A site
  // or status story brings its own stylesheet with it, because the stylesheets set the same
  // global rules to different values and cannot all be loaded for every story.
  stories: [
    "../src/renderer/**/*.stories.@(ts|tsx)",
    "../apps/auth-api/src/**/*.stories.@(ts|tsx)",
    "../apps/status/src/**/*.stories.@(ts|tsx)",
  ],
  addons: ["@storybook/addon-a11y"],
  // The story iframe has no icon of its own. Without this link, Chrome requests /favicon.ico when
  // the iframe opens as a page, and the console shows a 404.
  previewHead: (head) => `${head}\n<link rel="icon" type="image/svg+xml" href="./favicon.svg" />`,
  framework: {
    name: "storybook-solidjs-vite",
    options: {
      // CI checks compilation. Local Storybook keeps automatic prop documentation.
      docgen: process.env.OPENBOT_STORYBOOK_CHECK === "true" ? false : undefined,
    },
  },
  viteFinal: async (viteConfig) => {
    const mergedConfig = mergeConfig(viteConfig, {
      plugins: [tailwindcss({ optimize: false }), chatVisualPages()],
      build: {
        // Storybook bundles axe and its preview runtime into intentionally large development-only chunks.
        chunkSizeWarningLimit: 1_200,
      },
      optimizeDeps: {
        include: ["@norbert_bodziony/bloub", "solid-recharts"],
      },
      resolve: {
        alias: [{ find: "solid-js/web", replacement: "@solidjs/web" }],
        dedupe: ["solid-js", "@solidjs/web"],
      },
    });
    const plugins = (mergedConfig.plugins ?? []).filter((plugin: PluginOption) => !isLegacySolidPlugin(plugin));
    return {
      ...mergedConfig,
      plugins: [...plugins, solidPlugin()],
    };
  },
} satisfies StorybookConfig;

export default config;

function isLegacySolidPlugin(plugin: PluginOption): boolean {
  if (!plugin || Array.isArray(plugin) || "then" in plugin) return false;
  return "name" in plugin && plugin.name === "solid";
}
