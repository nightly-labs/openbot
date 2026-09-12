import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import type { StorybookConfig } from "storybook-solidjs-vite";
import { mergeConfig, type PluginOption } from "vite";

const config = {
  // The desktop renderer, and the public site's article components. A site story
  // brings its own stylesheet with it, because the two stylesheets set the same
  // global rules to different values and cannot both be loaded for every story.
  stories: ["../src/renderer/**/*.stories.@(ts|tsx)", "../apps/auth-api/src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  framework: {
    name: "storybook-solidjs-vite",
    options: {
      // CI checks compilation. Local Storybook keeps automatic prop documentation.
      docgen: process.env.OPENBOT_STORYBOOK_CHECK === "true" ? false : undefined,
    },
  },
  viteFinal: async (viteConfig) => {
    const mergedConfig = mergeConfig(viteConfig, {
      plugins: [tailwindcss({ optimize: false })],
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
