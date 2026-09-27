// The local model server scan and the model list of one endpoint. Both run in main: see
// `model-server-probe.ts`.
//
// A scan sends no key to any address. A model list for a saved endpoint uses the stored key and
// headers only when the user leaves them blank and the address keeps the saved origin, so an edited
// address never receives the old credentials.

import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type {
  DetectedModelServer,
  DiscoverModelsInput,
  DiscoverModelsResult,
  ProviderDetectionSettings,
} from "@openbot/contracts/ipc";
import { customProviderEndpointKey, isNewCustomProviderId, sameCustomProviderOrigin } from "@openbot/contracts/ipc";
import type { CustomProviderConfig } from "../backend/opencode-config";
import type { ProbeModels } from "./model-server-probe";

/** A server on this computer answers at once, so a slow address is not held for long. */
export const SCAN_TIMEOUT_MS = 1_500;
/** The user asked for this list, and a remote server can be slow. */
export const DISCOVER_TIMEOUT_MS = 8_000;

interface KnownServer {
  id: string;
  name: string;
  baseUrl: string;
}

/** The default addresses of the servers that OpenBot knows. Product names are not translated. */
export const DEFAULT_MODEL_SERVERS: readonly KnownServer[] = [
  { id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { id: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
];

export interface ProviderDetectionDependencies {
  settings: { get(): ProviderDetectionSettings };
  customProviders: { configs(): readonly CustomProviderConfig[] };
  probe: ProbeModels;
}

export interface ProviderDetection {
  scanModelServers(): Promise<DetectedModelServer[]>;
  discoverModels(input: DiscoverModelsInput): Promise<DiscoverModelsResult>;
}

/**
 * A free endpoint id for a server: its known id, or `server-<host>-<port>`. A taken id gets `-2`,
 * `-3` and so on.
 */
export function suggestServerId(base: string, taken: ReadonlySet<string>): string {
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
  for (const server of DEFAULT_MODEL_SERVERS) add(server);
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

export function createProviderDetection({
  settings,
  customProviders,
  probe,
}: ProviderDetectionDependencies): ProviderDetection {
  /** Two windows, or a Settings tab and onboarding, that scan at once share one scan. */
  let inFlight: Promise<DetectedModelServer[]> | null = null;

  async function scan(): Promise<DetectedModelServer[]> {
    const current = settings.get();
    if (!current.enabled) return [];
    const targets = scanTargets(current.addresses);
    const results = await Promise.allSettled(
      targets.map((target) => probe({ baseUrl: target.baseUrl, apiKey: null, headers: [] }, SCAN_TIMEOUT_MS)),
    );
    const taken = new Set(customProviders.configs().map((config) => config.id));
    const found: DetectedModelServer[] = [];
    results.forEach((result, index) => {
      const target = targets[index];
      if (!target || result.status !== "fulfilled") return;
      const id = suggestServerId(target.id, taken);
      taken.add(id);
      found.push({ id, name: target.name, baseUrl: target.baseUrl, models: result.value });
    });
    return found;
  }

  return {
    scanModelServers() {
      if (!inFlight) {
        inFlight = scan().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    async discoverModels(input) {
      let apiKey = input.apiKey;
      let headers = input.headers;
      const saved = input.savedProviderId
        ? customProviders.configs().find((config) => config.id === input.savedProviderId)
        : undefined;
      // The same rule as `update`: a blank field keeps the stored value, and only for the same origin.
      if (saved && sameCustomProviderOrigin(saved.baseUrl, input.baseUrl)) {
        if (!apiKey) apiKey = saved.apiKey;
        if (headers.length === 0) headers = [...saved.headers];
      }
      return { models: await probe({ baseUrl: input.baseUrl, apiKey, headers }, DISCOVER_TIMEOUT_MS) };
    },
  };
}
