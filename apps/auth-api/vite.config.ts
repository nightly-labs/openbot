import { cloudflare } from "@cloudflare/vite-plugin";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { defineConfig, type Plugin } from "vite";
import { contentImages } from "./content-images";
import { developmentNetworkRequestAllowed } from "./dev-network-access";
import { rendererPreviewAlias } from "./renderer-preview-alias";
import { readLocalRuntimeVars } from "./src/server/runtime-env";

export default defineConfig(({ command }) => {
  const localRuntimeVars = command === "serve" ? readLocalRuntimeVars(process.env) : {};
  return {
    resolve: {
      alias: {
        "@openbot/renderer-preview": rendererPreviewAlias,
      },
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
      port: readApiPort(process.env.OPENBOT_API_PORT),
      strictPort: true,
      allowedHosts: [".openbot.localhost"],
    },
    plugins: [
      developmentLanGuard(),
      cloudflare({
        viteEnvironment: { name: "ssr" },
        config(config) {
          return { vars: { ...config.vars, ...localRuntimeVars } };
        },
      }),
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

function readApiHost(value: string | undefined): "127.0.0.1" | "0.0.0.0" {
  if (value === undefined || value.trim() === "") return "127.0.0.1";
  if (value === "127.0.0.1" || value === "0.0.0.0") return value;
  throw new Error("OPENBOT_API_HOST must be 127.0.0.1 or 0.0.0.0.");
}
