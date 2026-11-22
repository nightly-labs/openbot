import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import { lazyLanguageCatalogs } from "./packages/i18n/src/vite-plugin";
import { devWorktree } from "./scripts/dev-worktree-vite-plugin";

const rendererPort = readRendererPort(process.env.OPENBOT_DEV_RENDERER_PORT);

const devWatch = { exclude: ["**/node_modules/**"] };

const benchBuild = process.env.OPENBOT_BENCH_BUILD === "1";
const perfProbesDefine = { __OPENBOT_PERF_PROBES__: JSON.stringify(benchBuild) };

const SIGNALS_CHUNK = "signals";

const benchRendererOutput = {
  manualChunks: (id: string) => (id.includes("/@solidjs/signals/") ? SIGNALS_CHUNK : undefined),
  chunkFileNames: (chunk: { name: string }) =>
    chunk.name === SIGNALS_CHUNK ? "assets/signals/dist/[name]-[hash].js" : "assets/[name]-[hash].js",
};

export default defineConfig({
  main: {
    define: perfProbesDefine,
    plugins: [
      benchBuildMarker(),
      externalizeDepsPlugin({
        exclude: [
          "@openbot/brand",
          "@openbot/contracts",
          "@openbot/i18n",
          "@openbot/logging",
          "@openbot/team-client",
          "@openbot/telemetry",
          "@openbot/user-errors",
          "@openbot/whatsapp",
        ],
      }),
    ],
    build: {
      watch: devWatch,
      rollupOptions: {
        external: ["jimp", "sharp", "audio-decode", "link-preview-js"],
        input: {
          start: resolve("src/main/start.ts"),
          index: resolve("src/main/index.ts"),
          "agent-database-host": resolve("src/backend/agent-data/agent-database-host.ts"),
          "voice-transcription-host": resolve("src/main/voice-transcription-host.ts"),
          "voice-speech-host": resolve("src/main/voice-speech-host.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@openbot/contracts"] })],
    build: {
      watch: devWatch,
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          teamWebrtc: resolve("src/preload/team-webrtc.ts"),
          browserPage: resolve("src/preload/browser-page.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    define: perfProbesDefine,
    plugins: [
      solidPlugin({
        performanceTracks: false,
        observe: benchBuild,
        ...(benchBuild ? { solid: { sourceNames: { locations: true } } } : {}),
      }),
      tailwindcss({ optimize: false }),
      lazyLanguageCatalogs(),
      devWorktree(resolve(".")),
    ],
    optimizeDeps: {
      exclude: ["@norbert_bodziony/bloub", "@norbert_bodziony/bloub/plush"],
    },
    resolve: {
      dedupe: ["solid-js", "@solidjs/web"],
    },
    ...(rendererPort ? { server: { port: rendererPort, strictPort: true } } : {}),
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          helper: resolve("src/renderer/helper.html"),
          browserPip: resolve("src/renderer/browser-pip.html"),
          browserPipControls: resolve("src/renderer/browser-pip-controls.html"),
          browserWindow: resolve("src/renderer/browser-window.html"),
          teamWebrtc: resolve("src/renderer/team-webrtc.html"),
          serverSetup: resolve("src/renderer/server-setup.html"),
        },
        ...(benchBuild ? { output: benchRendererOutput } : {}),
      },
      ...(benchBuild ? { minify: false } : {}),
    },
  },
});

function benchBuildMarker(): Plugin {
  return {
    name: "openbot-bench-build-marker",
    apply: "build",
    writeBundle(options) {
      if (!benchBuild || !options.dir) return;
      mkdirSync(options.dir, { recursive: true });
      writeFileSync(
        resolve(options.dir, "bench-build.json"),
        `${JSON.stringify({ perfProbes: true, solidObserve: true, builtAt: new Date().toISOString() })}\n`,
      );
    },
  };
}

function readRendererPort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("OPENBOT_DEV_RENDERER_PORT must be an integer from 1024 to 65535.");
  }
  return port;
}
