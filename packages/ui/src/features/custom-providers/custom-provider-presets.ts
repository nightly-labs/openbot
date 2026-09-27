// The starting points of the add flow. A preset only fills the form: the user still sees and can
// change every field before OpenBot saves anything.

import type { CustomProviderDraft } from "./custom-provider-form";

export type CustomProviderPresetId = "ollama" | "lmstudio" | "openai-compatible" | "acp";

/** What the host found at a local server's default address. */
export type LocalServerProbe = { status: "checking" } | { status: "running"; models: number } | { status: "missing" };

// The default addresses of the two local servers. They are the same in each language.
const LOCAL_SERVERS = {
  ollama: { providerId: "ollama", displayName: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  lmstudio: { providerId: "lmstudio", displayName: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
} as const;

/** The form for a local server, filled with its default address and no key. */
export function localServerDraft(id: keyof typeof LOCAL_SERVERS): CustomProviderDraft {
  return {
    ...LOCAL_SERVERS[id],
    apiKey: "",
    models: [{ id: "", name: "" }],
    headers: [{ name: "", value: "" }],
  };
}
