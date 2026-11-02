import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { defineConfig, normalizePath, type Plugin } from "vite";
import { contentImages } from "./content-images";
import { DEVELOPMENT_APNS_PATH, developmentApnsProxy } from "./dev-apns-proxy";
import { developmentNetworkRequestAllowed } from "./dev-network-access";
import { rendererPreviewAlias, rendererWebAlias } from "./renderer-preview-alias";
import { readLocalRuntimeVars } from "./src/server/runtime-env";

export default defineConfig(({ command }) => {
  const port = readApiPort(process.env.OPENBOT_API_PORT);
  const localRuntimeVars = command === "serve" ? readLocalRuntimeVars(process.env) : {};
  // The local Worker cannot reach Apple over HTTP/2, so it sends Live Activity updates to this server.
  if (localRuntimeVars.APNS_PRIVATE_KEY) {
    localRuntimeVars.APNS_ORIGIN = `http://127.0.0.1:${port}${DEVELOPMENT_APNS_PATH}`;
  }
  return {
    resolve: {
      dedupe: ["solid-js", "@solidjs/web", "@solidjs/signals"],
      alias: {
        "@openbot/renderer-preview": rendererPreviewAlias,
        "@openbot/renderer-web": rendererWebAlias,
      },
    },
    optimizeDeps: {
      // bloub finds its plush images with `new URL(..., import.meta.url)`. A pre-bundle moves the
      // code away from the images, so Vite serves the package as it is.
      exclude: ["@norbert_bodziony/bloub", "@norbert_bodziony/bloub/plush"],
    },
    build: {
      // A caption file has to stay a file. It is small enough for Vite to fold
      // into the bundle as a `data:` URL, and a text track fetched from one is
      // cross-origin to the page that asks for it, so the player drops it and the
      // video plays with no captions at all. Everything else keeps the default.
      assetsInlineLimit: (file) => (file.endsWith(".vtt") ? false : undefined),
    },
    server: {
      host: readApiHost(process.env.OPENBOT_API_HOST),
      port,
      strictPort: true,
      // `bun run dev:slack` tunnels Slack's install return to this server.
      allowedHosts: [".openbot.localhost", ".trycloudflare.com"],
    },
    plugins: [
      developmentLanGuard(),
      developmentApnsProxy(),
      cloudflare({
        viteEnvironment: { name: "ssr" },
        config(config) {
          return { vars: { ...config.vars, ...localRuntimeVars } };
        },
      }),
      lazyLanguageCatalogs(),
      tanstackStart(),
      solidPlugin({ ssr: true }),
      // Lightning CSS currently reports valid named highlight selectors as
      // unsupported. Let Vite handle the final CSS bundle until that upstream
      // parser false positive is fixed.
      tailwindcss({ optimize: false }),
      contentImages(),
    ],
  };
});

function readApiPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 3_100;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error("OPENBOT_API_PORT must be an integer from 1024 to 65535.");
  }
  return port;
}

function developmentLanGuard(): Plugin {
  return {
    name: "openbot-development-lan-guard",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (developmentNetworkRequestAllowed(request.socket.remoteAddress, request.url ?? "/")) {
          next();
          return;
        }
        response.statusCode = 404;
        response.end();
      });
    },
  };
}

const I18N_SOURCE = normalizePath(fileURLToPath(new URL("../../packages/i18n/src/", import.meta.url)));
const EAGER_CATALOG_MODULES = new Set(["./app-catalogs", "./source-catalogs", "./format-catalogs", "./locale-loading"]);

/**
 * The browser bundle loads each language other than English on first use (see
 * `packages/i18n/src/lazy-catalogs.ts`). The Worker keeps every language in its bundle.
 */
function lazyLanguageCatalogs(): Plugin {
  return {
    name: "openbot-lazy-language-catalogs",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.name === "client",
    resolveId(source, importer) {
      if (!importer || !EAGER_CATALOG_MODULES.has(source)) return null;
      if (!normalizePath(importer).startsWith(I18N_SOURCE)) return null;
      return `${I18N_SOURCE}lazy-catalogs.ts`;
    },
  };
}

function readApiHost(value: string | undefined): "127.0.0.1" | "0.0.0.0" {
  if (value === undefined || value.trim() === "") return "127.0.0.1";
  if (value === "127.0.0.1" || value === "0.0.0.0") return value;
  throw new Error("OPENBOT_API_HOST must be 127.0.0.1 or 0.0.0.0.");
}
