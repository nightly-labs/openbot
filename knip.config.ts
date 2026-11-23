import type { KnipConfig } from "knip";

const CSS_IMPORT = /@import\s+["']([^"']+)["']/g;

function compileCss(text: string): string {
  return [...text.matchAll(CSS_IMPORT)].map(([, specifier]) => `import "${specifier}";`).join("\n");
}

const config: KnipConfig = {
  compilers: { css: compileCss },
  ignoreIssues: {
    "packages/contracts/src/team-protocol/v*.ts": ["exports", "types"],
    "packages/contracts/src/team-protocol/*-v*.ts": ["exports", "types"],
    "packages/contracts/src/team-protocol/provider-aware-codec.ts": ["exports", "types"],
    "src/backend/migrations/[0-9]*.ts": ["exports"],
    "apps/auth-api/src/lib/plugin-catalog.generated.ts": ["exports", "types"],
  },
  ignoreBinaries: [
    "xterm",
    "ssh-keygen",
    "ssh-keyscan",
    "ssh-add",
    "cmake",
    "ccache",
    "otool",
    "install_name_tool",
    "ldd",
    "taskkill.exe",
    "tasklist",
    "cloudflared",
    "sqlite3",
    "ditto",
    "say",
    "pgrep",
    "screencapture",
    "osascript",
    "mkfifo",
    "browser-harness",
    "vm_stat",
    "dbus-run-session",
    "xcode-select",
    "sips",
    "iconutil",
    "Xvfb",
    "xdpyinfo",
    "openbox",
    "wmctrl",
    "picom",
    "ffmpeg",
    "gdbus",
    "import",
  ],
  workspaces: {
    ".": {
      entry: ["scripts/**/*.ts", "tools/**/*.ts", "src/renderer/stories/prototype-support.tsx"],
      project: ["src/**/*.{ts,tsx,css}", "scripts/**/*.ts", "tools/**/*.ts"],
      ignoreDependencies: [
        "@speed-highlight/core",
        "class-variance-authority",
        "marked",
        "solid-recharts",
        "solid-sonner",
        "expo",
        "@noble/hashes",
        "@cacheable/node-cache",
        "@hapi/boom",
        "@noble/curves",
        "async-mutex",
        "long",
        "lru-cache",
        "music-metadata",
        "p-queue",
        "pino",
        "protobufjs",
      ],
      ignoreUnresolved: ["scripts/.+\\.ts"],
    },
    "apps/auth-api": {
      entry: ["*.ts", "src/email-relay-entry.ts", "scripts/*.ts"],
      project: ["src/**/*.{ts,tsx,css}", "test/**/*.ts", "scripts/**/*.ts", "*.ts"],
      ignoreDependencies: ["cloudflare"],
    },
    "apps/site-router": {
      project: ["src/**/*.ts"],
    },
    "apps/mobile-updates": {
      entry: ["scripts/*.ts"],
      project: ["src/**/*.ts", "scripts/**/*.ts"],
    },
    "apps/mobile": {
      entry: [
        "src/app/**/*.{ts,tsx}",
        "plugins/**/*.{js,ts}",
        "src/shims/*.{ts,js}",
        "global.css",
        "src/features/share/extension/share-sender.ts",
      ],
      project: ["src/**/*.{ts,tsx}", "plugins/**/*.{js,ts}"],
      ignoreDependencies: [
        "openbot-original-react-native",
        "@expo/config-plugins",
        "expo-device-hub",
        "@expo/plist",
        "expo-symbols",
      ],
    },
    "remote/api": {
      entry: ["src/capacity-report.ts"],
      project: ["src/**/*.ts"],
    },
    "packages/i18n": {
      entry: ["src/lazy-catalogs.ts", "src/mobile-catalogs.native.ts"],
      project: ["src/**/*.{ts,tsx,css}"],
    },
    "packages/whatsapp": {
      entry: ["src/*.ts", "scripts/*.ts"],
      project: ["src/**/*.ts", "scripts/*.ts"],
      ignoreDependencies: [
        "@cacheable/node-cache",
        "@hapi/boom",
        "async-mutex",
        "long",
        "lru-cache",
        "music-metadata",
        "p-queue",
        "pino",
        "protobufjs",
        "ws",
        "@types/ws",
      ],
    },
    "packages/*": {
      project: ["src/**/*.{ts,tsx,css}"],
    },
  },
};

export default config;
