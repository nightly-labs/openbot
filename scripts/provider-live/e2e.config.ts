import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";
import {
  BENCH_ENV,
  BENCH_PROVIDERS,
  DEVTOOLS_ENDPOINT_FILE,
  LIVE_PROVIDERS,
  type LiveProvider,
  PROJECT_ROOT,
  profilePath,
  RENDERER_HOST,
} from "./targets";

function devToolsEndpoint(provider: LiveProvider): string {
  const endpointFile = join(profilePath(provider), DEVTOOLS_ENDPOINT_FILE);
  if (!existsSync(endpointFile)) throw new Error(`The ${provider} app wrote no DevTools address.`);
  return readFileSync(endpointFile, "utf8").trim();
}

const providers = process.env[BENCH_ENV] === "1" ? BENCH_PROVIDERS : LIVE_PROVIDERS;

export default {
  tests: "*.e2e.ts",
  targets: providers.map((provider) => ({
    name: provider,
    engine: web({
      viewport: null,
      connect: {
        cdpEndpoint: () => devToolsEndpoint(provider),
        reconnectEndpoint: () => devToolsEndpoint(provider),
      },
    }),
    app: {
      url: `http://${RENDERER_HOST}:0`,
      readyUrl: `http://${RENDERER_HOST}:{port}/__ready`,
      command: {
        executable: "bun",
        args: [join(PROJECT_ROOT, "scripts/provider-live/start-app.ts"), provider, "{port}"],
        cwd: PROJECT_ROOT,
        inheritEnv: ["USER", "LOGNAME", "SHELL", "LANG", "LC_*", "XDG_*", "OPENBOT_*"],
        startupTimeout: 120_000,
        log: `.e2e/${provider}-app.log`,
      },
    },
  })),
  workers: providers.length,
  retries: 0,
  timeout: 600_000,
  assertionTimeout: 15_000,
  trace: "on",
  reporters: ["list", "markdown", "junit"],
} satisfies E2EConfig;
