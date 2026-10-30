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
    "packages/contracts/src/team-protocol/provider-aware-codec.ts": ["exports", "types"],
    // A generator writes this file.
    "apps/auth-api/src/lib/plugin-catalog.generated.ts": ["exports", "types"],
  },
  // Host tools that scripts and tests call. They are not npm packages.
  ignoreBinaries: [
    // Opens the interactive provider sign-in CLI on Linux.
    "xterm",
    // Builds the remote desktop runtime.
    "cmake",
    // Rewrite and inspect macOS dylib load paths.
    "otool",
    "install_name_tool",
    // Finds the Linux libraries that the remote desktop runtime bundles.
    "ldd",
    // Stops a stuck packaged app during Windows package verification.
    "taskkill.exe",
    // Finds the parent process of the stand-in CLI in the Windows Claude `.cmd` E2E script.
    "tasklist",
    // Tunnels Slack to the local Signal and account API in `bun run dev:slack`.
    "cloudflared",
    // Copies a profile database read-only for the agent threads upgrade E2E script.
    "sqlite3",
    // Speaks the English samples of the macOS dictation smoke test.
    "say",
    // Finds the child processes of the dev app in the channel E2E scripts.
    "pgrep",
    // Captures the transparent main window in the appearance E2E script on macOS.
    "screencapture",
    // Lists the browsers that macOS knows for the external link setting.
    "osascript",
    // Makes the FIFO whose opens never finish in the exit watchdog E2E script.
    "mkfifo",
    // Runs variant D of the manual browser tools bench, only when the developer installed it.
    "browser-harness",
    // Reads the memory that programs can still use on macOS, for the machine part of Storage.
    "vm_stat",
  ],
  workspaces: {
    ".": {
      // The electron-vite plugin of knip reads the inputs of electron.vite.config.ts and the
      // <script type="module"> entries of the renderer HTML pages.
      entry: [
        // Each file in scripts/ is a command that package.json, CI or another script runs.
        "scripts/**/*.ts",
        "tools/**/*.ts",
        // The prototype skill builds its stories on this helper. No story on main uses it, because
        // prototype stories are deleted after the decision (.agents/skills/prototype/SKILL.md).
        "src/renderer/stories/prototype-support.tsx",
      ],
      project: ["src/**/*.{ts,tsx,css}", "scripts/**/*.ts", "tools/**/*.ts"],
      ignoreDependencies: [
        // `packages/ui` declares and imports these. The root copies date from before the UI moved to
        // that package; removing them changes what electron-builder packs, so it needs a package check.
        "@speed-highlight/core",
        "class-variance-authority",
        "marked",
        "solid-recharts",
        "solid-sonner",
        // `scripts/mobile-ios.ts` resolves the Expo CLI that `apps/mobile` installs.
        "expo",
        // `@openbot/team-client` imports it, and the main bundle keeps it external through this
        // entry. Bundled, a JSDoc `import` line in it takes the `__dirname` shim of electron-vite.
        "@noble/hashes",
      ],
      // Scripts start other scripts by path (`bun scripts/<name>.ts`), relative to the repository
      // root. Every file in scripts/ is already an entry.
      ignoreUnresolved: ["scripts/.+\\.ts"],
    },
    "apps/auth-api": {
      // The wrangler plugin of knip reads `main` (src/worker-entry.ts) from wrangler.jsonc.
      entry: ["*.ts"],
      project: ["src/**/*.{ts,tsx,css}", "test/**/*.ts", "*.ts"],
      // `cloudflare:workers` is a runtime module of the Workers platform, not an npm package.
      ignoreDependencies: ["cloudflare"],
    },
    // The wrangler plugin of knip reads `main` from wrangler.jsonc.
    "apps/site-router": {
      project: ["src/**/*.ts"],
    },
    "apps/mobile": {
      entry: [
        "src/app/**/*.{ts,tsx}",
        "plugins/**/*.{js,ts}",
        // metro.config.js maps `solid-js` and `@solidjs/web` to these files by path.
        "src/shims/*.ts",
        // metro.config.js loads this stylesheet by path (`cssEntryFile`).
        "global.css",
        // scripts/mobile-share-sender.ts builds the share extension page from this file by path.
        "src/features/share/extension/share-sender.ts",
      ],
      project: ["src/**/*.{ts,tsx}", "plugins/**/*.{js,ts}"],
      ignoreDependencies: [
        // `expo` installs it; Expo config plugins import it by this name.
        "@expo/config-plugins",
        // Expo CLI loads it as a dev tools plugin (the simulators in a browser tab); no code imports it.
        "expo-device-hub",
        // `expo` installs it too; plugins/with-share-target.js edits the extension's plist files with it.
        "@expo/plist",
        // A native module that `expo-router` imports. The direct entry keeps its native version
        // pinned to the Expo SDK and visible to autolinking.
        "expo-symbols",
      ],
    },
    // src/index.ts is a default entry of knip. The capacity-report Compose service runs
    // src/capacity-report.ts.
    "remote/api": {
      entry: ["src/capacity-report.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/i18n": {
      // apps/auth-api/vite.config.ts puts this file in place of the static catalog modules by path.
      // Metro resolves mobile-catalogs.native.ts in place of mobile-catalogs.ts.
      entry: ["src/lazy-catalogs.ts", "src/mobile-catalogs.native.ts"],
      project: ["src/**/*.{ts,tsx,css}"],
    },
    "packages/*": {
      project: ["src/**/*.{ts,tsx,css}"],
    },
  },
};

export default config;
