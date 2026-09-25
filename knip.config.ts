import type { KnipConfig } from "knip";

// Stylesheets load packages with `@import`. Knip reads only script files, so this turns each
// `@import "<package>"` into a script import that it can follow.
const CSS_IMPORT = /@import\s+["']([^"']+)["']/g;

function compileCss(text: string): string {
  return [...text.matchAll(CSS_IMPORT)].map(([, specifier]) => `import "${specifier}";`).join("\n");
}

const config: KnipConfig = {
  compilers: { css: compileCss },
  // A released Team API protocol keeps its whole frozen codec, including the parts that no current
  // code uses (packages/contracts/AGENTS.md).
  ignoreIssues: {
    "packages/contracts/src/team-protocol/v*.ts": ["exports", "types"],
    "packages/contracts/src/team-protocol/*-v*.ts": ["exports", "types"],
  },
  // Host tools that scripts and tests call. They are not npm packages.
  ignoreBinaries: [
    // Builds whisper.cpp and the remote desktop runtime.
    "cmake",
    // Rewrite and inspect macOS dylib load paths.
    "otool",
    "install_name_tool",
    // Fastlane runs on the system Ruby.
    "ruby",
    // Stops a stuck packaged app during Windows package verification.
    "taskkill.exe",
    // Makes throwaway certificates for the Sunshine port isolation test.
    "openssl",
  ],
  workspaces: {
    ".": {
      entry: [
        // electron-vite inputs in electron.vite.config.ts.
        "src/main/index.ts",
        "src/backend/agent-data/agent-database-host.ts",
        "src/preload/index.ts",
        "src/preload/team-webrtc.ts",
        // Modules that the renderer HTML pages load with <script type="module">.
        "src/renderer/src/index.tsx",
        "src/renderer/src/features/browser/browser-pip.tsx",
        "src/renderer/src/features/browser/browser-pip-controls.tsx",
        "src/renderer/src/features/team/team-webrtc.ts",
        // Each file in scripts/ is a command that package.json, CI or another script runs.
        "scripts/**/*.ts",
        "tools/**/*.ts",
      ],
      project: ["src/**/*.{ts,tsx,css}", "scripts/**/*.ts", "tools/**/*.ts"],
      ignoreDependencies: [
        // `packages/ui` declares and imports these. The root copies date from before the UI moved to
        // that package; removing them changes what electron-builder packs, so it needs a package check.
        "@speed-highlight/core",
        "@tanstack/virtual-core",
        "class-variance-authority",
        "marked",
        "qrcode",
        "solid-recharts",
        "solid-sonner",
        // `scripts/mobile-ios.ts` resolves the Expo CLI that `apps/mobile` installs.
        "expo",
      ],
      // Scripts start other scripts by path (`bun scripts/<name>.ts`), relative to the repository
      // root. Every file in scripts/ is already an entry.
      ignoreUnresolved: ["scripts/.+\\.ts"],
    },
    "apps/auth-api": {
      entry: ["src/worker-entry.ts", "*.ts"],
      project: ["src/**/*.{ts,tsx,css}", "test/**/*.ts", "*.ts"],
      // `cloudflare:workers` is a runtime module of the Workers platform, not an npm package.
      ignoreDependencies: ["cloudflare"],
    },
    "apps/site-router": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts", "test/**/*.ts"],
    },
    "apps/mobile": {
      entry: [
        "src/app/**/*.{ts,tsx}",
        "plugins/**/*.{js,ts}",
        // metro.config.js maps `solid-js` and `@solidjs/web` to these files by path.
        "src/shims/*.ts",
      ],
      project: ["src/**/*.{ts,tsx}", "plugins/**/*.{js,ts}"],
      ignoreDependencies: [
        // `expo` installs it; Expo config plugins import it by this name.
        "@expo/config-plugins",
        // A native module that `expo-router` imports. The direct entry keeps its native version
        // pinned to the Expo SDK and visible to autolinking.
        "expo-symbols",
      ],
    },
    "remote/api": {
      entry: ["src/index.ts"],
      project: ["src/**/*.ts", "test/**/*.ts"],
    },
    "packages/*": {
      project: ["src/**/*.{ts,tsx,css}"],
    },
  },
};

export default config;
