import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import solidPlugin from "@solidjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/solid-start/plugin/vite";
import { defineConfig, type Plugin } from "vite";
import { lazyLanguageCatalogs } from "../../packages/i18n/src/vite-plugin";
import { contentImages } from "./content-images";
import { DEVELOPMENT_APNS_PATH, developmentApnsProxy } from "./dev-apns-proxy";
import { developmentNetworkRequestAllowed } from "./dev-network-access";
import { rendererPreviewAlias, rendererWebAlias } from "./renderer-preview-alias";
import { readLocalRuntimeVars } from "./src/server/runtime-env";

export default defineConfig(({ command }) => {
  const port = readApiPort(process.env.OPENBOT_API_PORT);
  const localRuntimeVars: Record<string, string> =
    command === "serve"
      ? { CF_ACCESS_TEAM_DOMAIN: "", CF_ACCESS_ADMIN_AUD: "", ...readLocalRuntimeVars(process.env) }
      : {};
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
      exclude: ["@norbert_bodziony/bloub", "@norbert_bodziony/bloub/plush"],
    },
    // in each copy, so the minifier moves `/*!` and `@license` comments to the end of each file.
    esbuild: { legalComments: "eof" },
    build: {
      assetsInlineLimit: (file) => (file.endsWith(".vtt") ? false : undefined),
    },
    environments: {
      ssr: { build: { rolldownOptions: { output: { strictExecutionOrder: true } } } },
    },
    server: {
      host: readApiHost(process.env.OPENBOT_API_HOST),
      port,
      strictPort: true,
      allowedHosts: [".openbot.localhost", ".trycloudflare.com"],
    },
    plugins: [
      developmentLanGuard(),
      developmentApnsProxy(),
      cloudflare({
        viteEnvironment: { name: "ssr" },
        config(config) {
          if (command === "serve") {
            config.services = config.services?.filter((service) => service.binding !== "EMAIL_RELAY");
          }
          return { vars: { ...config.vars, ...localRuntimeVars } };
        },
      }),
      lazyLanguageCatalogs(),
      bloubServerBuild(),
      tanstackStart(),
      solidPlugin({ ssr: true }),
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

const BLOUB_ENTRIES = ["@norbert_bodziony/bloub", "@norbert_bodziony/bloub/plush"] as const;

const BLOUB_ASSET_URL = /new URL\(`(\.\/assets\/[\w.-]+\.webp)`,\s*import\.meta\.url\)\.href/g;

function bloubServerBuild(): Plugin {
  const serverEntries = new Map<string, string>(
    BLOUB_ENTRIES.map((entry) => [entry, fileURLToPath(import.meta.resolve(entry))]),
  );
  const serverFiles = new Set(serverEntries.values());
  return {
    name: "openbot-bloub-server-build",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.name === "ssr",
    resolveId(source) {
      return serverEntries.get(source) ?? null;
    },
    transform(code, id) {
      if (!serverFiles.has(id)) return null;
      const imports: string[] = [];
      const rewritten = code.replace(BLOUB_ASSET_URL, (_match, path: string) => {
        const name = `bloubAsset${imports.length}`;
        imports.push(`import ${name} from ${JSON.stringify(`${path}?url`)};`);
        return name;
      });
      return imports.length === 0 ? null : { code: `${imports.join("\n")}\n${rewritten}`, map: null };
    },
  };
}

function readApiHost(value: string | undefined): "127.0.0.1" | "0.0.0.0" {
  if (value === undefined || value.trim() === "") return "127.0.0.1";
  if (value === "127.0.0.1" || value === "0.0.0.0") return value;
  throw new Error("OPENBOT_API_HOST must be 127.0.0.1 or 0.0.0.0.");
}
