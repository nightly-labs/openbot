// The live provider test: one target for each provider, each with its own app. See
// docs/provider-live-e2e.md.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";
import {
  DEVTOOLS_ENDPOINT_FILE,
  LIVE_PROVIDERS,
  type LiveProvider,
  PROJECT_ROOT,
  profilePath,
  RENDERER_HOST,
} from "./targets";

/** The DevTools socket of one provider's app. `start-app.ts` writes it before `/__ready` answers. */
function devToolsEndpoint(provider: LiveProvider): string {
  const endpointFile = join(profilePath(provider), DEVTOOLS_ENDPOINT_FILE);
  if (!existsSync(endpointFile)) throw new Error(`The ${provider} app wrote no DevTools address.`);
  return readFileSync(endpointFile, "utf8").trim();
}

export default {
  tests: "*.e2e.ts",
  targets: LIVE_PROVIDERS.map((provider) => ({
    name: provider,
    engine: web({
      // The page fills the app window: the app has its own window size.
      viewport: null,
      connect: {
        cdpEndpoint: () => devToolsEndpoint(provider),
        // Electron cannot make a browser context. With `reconnectEndpoint`, e2e uses the window
        // that the app opened and makes no context of its own.
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
        // The provider CLIs read the user's sign-in, so they need the user's identity and locale.
        inheritEnv: ["USER", "LOGNAME", "SHELL", "LANG", "LC_*", "XDG_*", "OPENBOT_*"],
        startupTimeout: 120_000,
        log: `.e2e/${provider}-app.log`,
      },
    },
  })),
  // One app for each provider, and the tests at the same time.
  workers: LIVE_PROVIDERS.length,
  // An app serves one attempt: a second attempt would need a new app.
  retries: 0,
  // A first run also downloads the provider CLI.
  timeout: 600_000,
  assertionTimeout: 15_000,
  trace: "on",
  reporters: ["list", "markdown", "junit"],
} satisfies E2EConfig;
