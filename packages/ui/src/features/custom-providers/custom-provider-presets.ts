import { DEFAULT_MODEL_SERVERS, type DefaultModelServerId, detectedModelServerKey } from "@openbot/contracts/ipc";
import type { DetectedProvider, ProviderDetection } from "./detected-providers";

export type CustomProviderPresetId = "ollama" | "lmstudio" | "openai-compatible" | "acp";

export type LocalServerProbe = { status: "checking" } | { status: "running"; models: number };

function foundServer(detection: ProviderDetection | undefined, id: DefaultModelServerId) {
  const key = detectedModelServerKey(DEFAULT_MODEL_SERVERS[id].baseUrl);
  return detection?.found.find((row) => row.kind === "models" && row.key === key);
}

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
