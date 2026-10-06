// The local model server scan and the model list of one endpoint. Both run in main: see
// `model-server-probe.ts`.
//
// A scan sends no key to any address. A model list for a saved endpoint uses the stored key and
// headers only when the user leaves them blank and the address keeps the saved origin, so an edited
// address never receives the old credentials.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  DetectedAcpAgent,
  DetectedModelServer,
  DiscoverModelsInput,
  DiscoverModelsResult,
  ProviderDetectionSettings,
} from "@openbot/contracts/ipc";
import {
  customProviderEndpointKey,
  DEFAULT_MODEL_SERVERS,
  isNewCustomProviderId,
  sameCustomProviderOrigin,
} from "@openbot/contracts/ipc";
import { Context, Effect, Exit, Fiber, Layer, ManagedRuntime, Scope } from "effect";
import { scanAcpAgents } from "../backend/acp-agent-scan";
import type { CustomProviderConfig } from "../backend/opencode-config";
import { ModelServerProbe, type ProbeError } from "./model-server-probe";

/** A server on this computer answers at once, so a slow address is not held for long. */
const SCAN_TIMEOUT_MS = 1_500;
/** The user asked for this list, and a remote server can be slow. */
const DISCOVER_TIMEOUT_MS = 8_000;

interface KnownServer {
  id: string;
  name: string;
  baseUrl: string;
}

export interface ProviderDetectionDependencies {
  settings: { get(): ProviderDetectionSettings };
  customProviders: { configs(): readonly CustomProviderConfig[] };
  customAgents: { configs(): readonly { id: string }[] };
  probe?: Context.Service.Shape<typeof ModelServerProbe>["probe"];
  scanAgents?: typeof scanAcpAgents;
}

export type ProviderDetection = Context.Service.Shape<typeof ProviderDiscovery>;

/**
 * A free endpoint id for a server: its known id, or `server-<host>-<port>`. A taken id gets `-2`,
 * `-3` and so on.
 */
function suggestServerId(base: string, taken: ReadonlySet<string>): string {
  const limit = INPUT_LIMITS.identifier - 4;
  const stem =
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, limit)
      .replace(/-+$/, "") || "server";
  if (!taken.has(stem) && isNewCustomProviderId(stem)) return stem;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}`;
    if (!taken.has(candidate) && isNewCustomProviderId(candidate)) return candidate;
  }
}

/** The servers to probe: the defaults, then the user's addresses, one row for each endpoint key. */
function scanTargets(addresses: readonly string[]): KnownServer[] {
  const targets: KnownServer[] = [];
  const keys = new Set<string>();
  const add = (server: KnownServer) => {
    const key = customProviderEndpointKey(server.baseUrl);
    if (!key || keys.has(key)) return;
    keys.add(key);
    targets.push(server);
  };
  for (const [id, server] of Object.entries(DEFAULT_MODEL_SERVERS)) add({ id, ...server });
  for (const address of addresses) {
    const baseUrl = address.trim();
    if (!baseUrl) continue;
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      continue;
    }
    // The settings parser refuses these already. A file edited by hand is checked again here.
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) continue;
    add({ id: `server-${url.hostname}-${url.port || url.protocol.slice(0, -1)}`, name: url.host, baseUrl });
  }
  return targets;
}

class ProviderDiscovery extends Context.Service<
  ProviderDiscovery,
  {
    scanModelServers(): Effect.Effect<DetectedModelServer[]>;
    scanAgents(): Effect.Effect<DetectedAcpAgent[]>;
    discoverModels(input: DiscoverModelsInput): Effect.Effect<DiscoverModelsResult, ProbeError>;
  }
>()("openbot/main/ProviderDiscovery") {
  static layer(dependencies: ProviderDetectionDependencies) {
    return Layer.effect(
      ProviderDiscovery,
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        let modelScan: Fiber.Fiber<DetectedModelServer[]> | null = null;
        let agentScan: Fiber.Fiber<DetectedAcpAgent[]> | null = null;
        const modelProbe = yield* ModelServerProbe;
        const injectedProbe = dependencies.probe;
        const injectedScanAgents = dependencies.scanAgents;
        const probe = injectedProbe ?? modelProbe.probe;
        const scan = Effect.fn("ProviderDiscovery.scanModelServers")(function* () {
          if (modelScan) return yield* Fiber.join(modelScan);
          const fiber = yield* Effect.forkIn(
            Effect.gen(function* () {
              const current = dependencies.settings.get();
              if (!current.enabled) return [];
              const targets = scanTargets(current.addresses);
              const results = yield* Effect.forEach(
                targets,
                (target) =>
                  probe({ baseUrl: target.baseUrl, apiKey: null, headers: [] }, SCAN_TIMEOUT_MS).pipe(
                    Effect.map((models) => ({ target, models })),
                    Effect.catch(() => Effect.succeed(null)),
                  ),
                { concurrency: "unbounded" },
              );
              const taken = new Set(dependencies.customProviders.configs().map((config) => config.id));
              const found: DetectedModelServer[] = [];
              for (const result of results) {
                if (!result) continue;
                const id = suggestServerId(result.target.id, taken);
                taken.add(id);
                found.push({ id, name: result.target.name, baseUrl: result.target.baseUrl, models: result.models });
              }
              return found;
            }),
            scope,
            { startImmediately: true },
          );
          modelScan = fiber;
          fiber.addObserver(() => {
            if (modelScan === fiber) modelScan = null;
          });
          return yield* Fiber.join(fiber);
        });
        const scanAgents = Effect.fn("ProviderDiscovery.scanAgents")(function* () {
          if (agentScan) return yield* Fiber.join(agentScan);
          const fiber = yield* Effect.forkIn(
            Effect.gen(function* () {
              const current = dependencies.settings.get();
              if (!current.enabled) return [];
              const input = {
                folders: current.folders,
                takenIds: new Set(dependencies.customAgents.configs().map((config) => config.id)),
              };
              return yield* (injectedScanAgents ?? scanAcpAgents)(input);
            }),
            scope,
            { startImmediately: true },
          );
          agentScan = fiber;
          fiber.addObserver(() => {
            if (agentScan === fiber) agentScan = null;
          });
          return yield* Fiber.join(fiber);
        });
        const discoverModels = Effect.fn("ProviderDiscovery.discoverModels")(function* (input: DiscoverModelsInput) {
          let apiKey = input.apiKey;
          let headers = input.headers;
          const saved = input.savedProviderId
            ? dependencies.customProviders.configs().find((config) => config.id === input.savedProviderId)
            : undefined;
          // Blank fields retain credentials only when the destination keeps the stored origin.
          if (saved && sameCustomProviderOrigin(saved.baseUrl, input.baseUrl)) {
            if (!apiKey) apiKey = saved.apiKey;
            if (headers.length === 0) headers = [...saved.headers];
          }
          const request = yield* Effect.forkIn(
            probe({ baseUrl: input.baseUrl, apiKey, headers }, DISCOVER_TIMEOUT_MS),
            scope,
            { startImmediately: true },
          );
          return { models: yield* Fiber.join(request) };
        });
        return ProviderDiscovery.of({
          scanModelServers: scan,
          scanAgents,
          discoverModels,
        });
      }),
    ).pipe(Layer.provide(ModelServerProbe.layer));
  }
}

/** Constructs the service once; the application executes its operations and owns shutdown. */
export const createProviderDetection = Effect.fn("ProviderDiscovery.create")(function* (
  dependencies: ProviderDetectionDependencies,
) {
  const runtime = ManagedRuntime.make(ProviderDiscovery.layer(dependencies));
  const context = yield* runtime.contextEffect.pipe(
    Effect.onExit((exit) => (Exit.isFailure(exit) ? runtime.disposeEffect : Effect.void)),
  );
  return { ...Context.get(context, ProviderDiscovery), close: () => runtime.disposeEffect };
});
