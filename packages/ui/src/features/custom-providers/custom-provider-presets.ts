// The starting points of the add flow. A preset only fills the form: the user still sees and can
// change every field before OpenBot saves anything.

import { DEFAULT_MODEL_SERVERS, type DefaultModelServerId, detectedModelServerKey } from "@openbot/contracts/ipc";
import type { DetectedProvider, ProviderDetection } from "./detected-providers";

export type CustomProviderPresetId = "ollama" | "lmstudio" | "openai-compatible" | "acp";

/** What the host found at a local server's default address. */
export type LocalServerProbe = { status: "checking" } | { status: "running"; models: number };

function foundServer(detection: ProviderDetection | undefined, id: DefaultModelServerId) {
  const key = detectedModelServerKey(DEFAULT_MODEL_SERVERS[id].baseUrl);
  return detection?.found.find((row) => row.kind === "models" && row.key === key);
}

/**
 * The status of each local server for the chooser. A server that the scan did not find has no
 * entry: it may be hidden, or on another address, so "not running" could be wrong.
 */
export function localServerProbes(
  detection: ProviderDetection | undefined,
): Partial<Record<DefaultModelServerId, LocalServerProbe>> {
  const probes: Partial<Record<DefaultModelServerId, LocalServerProbe>> = {};
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
  const server = DEFAULT_MODEL_SERVERS[preset];
  return {
    kind: "models",
    key: detectedModelServerKey(server.baseUrl),
    id: preset,
    name: server.name,
    baseUrl: server.baseUrl,
    models: [],
  };
}
