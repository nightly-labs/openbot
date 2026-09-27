// The starting points of the add flow. A preset only fills the form: the user still sees and can
// change every field before OpenBot saves anything.

import type { DetectedProvider, ProviderDetection } from "./detected-providers";

export type CustomProviderPresetId = "ollama" | "lmstudio" | "openai-compatible" | "acp";

/** What the host found at a local server's default address. */
export type LocalServerProbe = { status: "checking" } | { status: "running"; models: number } | { status: "missing" };

// The default addresses of the two local servers. They are the same in each language.
const LOCAL_SERVERS = {
  ollama: { providerId: "ollama", displayName: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  lmstudio: { providerId: "lmstudio", displayName: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
} as const;

const LOCAL_SERVER_KEYS = {
  ollama: "models:http://127.0.0.1:11434/v1",
  lmstudio: "models:http://127.0.0.1:1234/v1",
} as const;

function foundServer(detection: ProviderDetection | undefined, id: keyof typeof LOCAL_SERVERS) {
  return detection?.found.find((row) => row.kind === "models" && row.key === LOCAL_SERVER_KEYS[id]);
}

/**
 * The status of each local server for the chooser. A server that the scan did not find has no
 * entry: it may be hidden, or on another address, so "not running" could be wrong.
 */
export function localServerProbes(
  detection: ProviderDetection | undefined,
): Partial<Record<keyof typeof LOCAL_SERVERS, LocalServerProbe>> {
  const probes: Partial<Record<keyof typeof LOCAL_SERVERS, LocalServerProbe>> = {};
  for (const id of ["ollama", "lmstudio"] as const) {
    const found = foundServer(detection, id);
    if (found?.kind === "models") probes[id] = { status: "running", models: found.models.length };
    else if (detection?.scanning) probes[id] = { status: "checking" };
  }
  return probes;
}

/**
 * The provider that a chosen preset opens the form for. A local server that the scan found opens
 * with its models, or as Edit when it is saved; any other preset opens with no values.
 */
export function presetSetupProvider(
  preset: CustomProviderPresetId,
  detection: ProviderDetection | undefined,
): DetectedProvider {
  if (preset === "acp") return { kind: "agent", key: "", id: "", name: "", command: "", args: "" };
  if (preset === "openai-compatible") return { kind: "models", key: "", id: "", name: "", baseUrl: "", models: [] };
  const found = foundServer(detection, preset);
  if (found) return found;
  const server = LOCAL_SERVERS[preset];
  return {
    kind: "models",
    key: LOCAL_SERVER_KEYS[preset],
    id: server.providerId,
    name: server.displayName,
    baseUrl: server.baseUrl,
    models: [],
  };
}
