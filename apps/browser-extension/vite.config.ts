import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { build, defineConfig, type Plugin } from "vite";
import rootPackage from "../../package.json" with { type: "json" };
import { X_PAGE_RULES_ROUTE } from "../../packages/contracts/src/browser-extension-x";
import { lazyLanguageCatalogs } from "../../packages/i18n/src/vite-plugin";

const PRODUCTION_API_URL = "https://api.openbot.run";
/** The web app, where the extension's sign-in happens. A local stack serves it beside the account API. */
const PRODUCTION_WEB_URL = "https://openbot.run";

/** The content script on X. A content script cannot load modules, so it is one file of its own. */
const X_CONTENT_SCRIPT = "x-content.js";

/**
 * Writes `manifest.json` (Manifest V3). A development build may talk to a local account service, so
 * only it can reach `localhost`.
 */
function extensionManifest(apiUrl: string, development: boolean): Plugin {
  return {
    name: "openbot-extension-manifest",
    generateBundle() {
      const hostPermissions = [`${new URL(apiUrl).origin}/*`];
      if (development) hostPermissions.push("http://localhost/*", "http://127.0.0.1/*");
      const manifest = {
        manifest_version: 3,
        name: development ? "OpenBot (Dev)" : "OpenBot",
        description: "Chat with your OpenBot agents beside any page.",
        // The release version of the desktop app is the version of the extension.
        version: rootPackage.version,
        icons: { 16: "icons/icon-16.png", 32: "icons/icon-32.png", 48: "icons/icon-48.png", 128: "icons/icon-128.png" },
        action: { default_title: "OpenBot", default_icon: { 16: "icons/icon-16.png", 32: "icons/icon-32.png" } },
        side_panel: { default_path: "sidepanel.html" },
        background: { service_worker: "background.js", type: "module" },
        // `identity` opens the openbot.run sign-in window (`chrome.identity.launchWebAuthFlow`).
        // `offscreen` keeps the server connection for X and shared tabs while the side panel is closed.
        // `tabs`, `tabGroups` and `debugger`: agents read and use only the tabs of the "OpenBot" tab
        // group that the user made, after the user allows each site (`src/client-browser-*.ts`).
        // `downloads` holds a download that starts on a site where an agent works until the user
        // allows it; `chrome.debugger` cannot stop downloads.
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
        // On X, the script reads only the reply that the user writes and the post that it answers.
        // A development build also runs it on the E2E's copy of an X page.
        content_scripts: [
          {
            matches: [
              "https://x.com/*",
              "https://twitter.com/*",
              ...(development ? ["http://127.0.0.1/x-fixture/*"] : []),
            ],
            js: [X_CONTENT_SCRIPT],
            // From `public/`. Chrome adds it with the script, so the page's own rules cannot block it.
            css: ["x-content.css"],
            run_at: "document_idle",
          },
        ],
      };
      this.emitFile({ type: "asset", fileName: "manifest.json", source: `${JSON.stringify(manifest, null, 2)}\n` });
    },
  };
}

/** Builds the content script after the pages, as one script with no imports. */
function xContentScript(development: boolean): Plugin {
  return {
    name: "openbot-x-content-script",
    apply: "build",
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: "warn",
        // The script's console notes are in a development build only.
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
      // The E2E serves its own rules for its copy of an X page; a release reads the account service.
      "import.meta.env.VITE_OPENBOT_X_RULES_URL": JSON.stringify(
        (development && process.env.VITE_OPENBOT_X_RULES_URL) || `${apiUrl}${X_PAGE_RULES_ROUTE}`,
      ),
    },
    resolve: { dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"] },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // An extension page may not load remote code, and a readable bundle is easier to review in a store.
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
      extensionManifest(apiUrl, development),
      xContentScript(development),
    ],
  };
});
