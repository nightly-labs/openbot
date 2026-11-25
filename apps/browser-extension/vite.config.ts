import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { build, defineConfig, type Plugin } from "vite";
import rootPackage from "../../package.json" with { type: "json" };
import { X_PAGE_RULES_ROUTE } from "../../packages/contracts/src/browser-extension-x";
import { lazyLanguageCatalogs } from "../../packages/i18n/src/vite-plugin";

const PRODUCTION_API_URL = "https://api.openbot.run";
const PRODUCTION_WEB_URL = "https://openbot.run";
const PRODUCTION_ANALYTICS_URL = "https://analytics.openbot.run/api";

function loopbackCaptureUrl(value: string | undefined): string | null {
  if (!value || !URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost") ? url.origin : null;
}

function analyticsUrl(apiUrl: string, development: boolean): string {
  const capture = loopbackCaptureUrl(process.env.OPENBOT_ANALYTICS_CAPTURE_URL);
  if (capture) return capture;
  return !development && apiUrl === PRODUCTION_API_URL ? PRODUCTION_ANALYTICS_URL : "";
}

const X_CONTENT_SCRIPT = "x-content.js";

function extensionManifest(apiUrl: string, webUrl: string, development: boolean): Plugin {
  return {
    name: "openbot-extension-manifest",
    generateBundle() {
      const hostPermissions = [`${new URL(apiUrl).origin}/*`];
      if (development) hostPermissions.push("http://localhost/*", "http://127.0.0.1/*");
      const manifest = {
        manifest_version: 3,
        name: development ? "OpenBot (Dev)" : "OpenBot",
        description: "Chat with your OpenBot agents beside any page.",
        version: rootPackage.version,
        icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
        action: { default_title: "OpenBot", default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" } },
        side_panel: { default_path: "sidepanel.html" },
        background: { service_worker: "background.js", type: "module" },
        permissions: [
          "sidePanel",
          "storage",
          "identity",
          "offscreen",
          "alarms",
          "notifications",
          "tabs",
          "tabGroups",
          "debugger",
          "downloads",
        ],
        host_permissions: hostPermissions,
        externally_connectable: {
          matches: [
            `${new URL(webUrl).origin}/*`,
            ...(development ? ["http://localhost/*", "http://127.0.0.1/*"] : []),
          ],
        },
        content_scripts: [
          {
            matches: [
              "https://x.com/*",
              "https://twitter.com/*",
              ...(development ? ["http://127.0.0.1/x-fixture/*"] : []),
            ],
            js: [X_CONTENT_SCRIPT],
            css: ["x-content.css"],
            run_at: "document_idle",
          },
        ],
      };
      this.emitFile({ type: "asset", fileName: "manifest.json", source: `${JSON.stringify(manifest, null, 2)}\n` });
    },
  };
}

function xContentScript(development: boolean): Plugin {
  return {
    name: "openbot-x-content-script",
    apply: "build",
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: "warn",
        define: { __OPENBOT_X_NOTES__: JSON.stringify(development) },
        build: {
          outDir: "dist",
          emptyOutDir: false,
          minify: !development,
          sourcemap: development ? "inline" : false,
          lib: { entry: "src/x-content.ts", formats: ["iife"], name: "openbotX", fileName: () => X_CONTENT_SCRIPT },
        },
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const development = mode === "development";
  const apiUrl = process.env.VITE_OPENBOT_API_URL ?? PRODUCTION_API_URL;
  const webUrl = process.env.VITE_OPENBOT_WEB_URL ?? (process.env.VITE_OPENBOT_API_URL ? apiUrl : PRODUCTION_WEB_URL);
  return {
    base: "./",
    define: {
      "import.meta.env.VITE_OPENBOT_API_URL": JSON.stringify(apiUrl),
      "import.meta.env.VITE_OPENBOT_WEB_URL": JSON.stringify(webUrl),
      "import.meta.env.VITE_OPENBOT_ANALYTICS_URL": JSON.stringify(analyticsUrl(apiUrl, development)),
      "import.meta.env.VITE_OPENBOT_X_RULES_URL": JSON.stringify(
        (development && process.env.VITE_OPENBOT_X_RULES_URL) || `${apiUrl}${X_PAGE_RULES_ROUTE}`,
      ),
    },
    resolve: { dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      minify: !development,
      sourcemap: development,
      rolldownOptions: {
        input: {
          sidepanel: "sidepanel.html",
          microphone: "microphone.html",
          offscreen: "offscreen.html",
          background: "src/background.ts",
        },
        output: {
          entryFileNames: (chunk) => (chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js"),
        },
      },
    },
    plugins: [
      lazyLanguageCatalogs(),
      tailwindcss(),
      solidPlugin(),
      extensionManifest(apiUrl, webUrl, development),
      xContentScript(development),
    ],
  };
});
