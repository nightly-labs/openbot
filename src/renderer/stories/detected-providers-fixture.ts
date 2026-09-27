import type {
  DetectedProvider,
  DetectedProviderApi,
  DetectedProviderValue,
  ProviderDetection,
} from "@openbot/ui/features/custom-providers/detected-providers";
import { createSignal, onCleanup } from "solid-js";

/** What a scan could find on a developer's computer. The paths, versions and models are examples only. */
export const STORY_DETECTED_PROVIDERS: readonly DetectedProvider[] = [
  {
    key: "models:http://127.0.0.1:11434/v1",
    id: "ollama",
    kind: "models",
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [
      { id: "qwen3-coder:30b", name: "Qwen3 Coder 30B" },
      { id: "gpt-oss:20b", name: "gpt-oss 20B" },
      { id: "llama3.2:3b", name: "Llama 3.2 3B" },
      { id: "deepseek-r1:14b", name: "DeepSeek R1 14B" },
    ],
  },
  {
    key: "models:http://127.0.0.1:1234/v1",
    id: "lmstudio",
    kind: "models",
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    models: [{ id: "mistralai/devstral-small-2507", name: "Devstral Small" }],
  },
  {
    key: "agent:/Users/you/.local/bin/goose",
    id: "goose",
    kind: "agent",
    name: "Goose",
    command: "/Users/you/.local/bin/goose",
    args: "acp",
    version: "1.9.0",
  },
];

const FOUND_EVERY_MS = 450;
const REPLY_MS = 500;

interface StoryDetectionOptions {
  /** Detection keys that the user hid in an earlier run. */
  hidden?: readonly string[];
  /** Without it there is no Scan again, as on the first-run step. */
  rescan?: boolean;
  onSaved?: (value: DetectedProviderValue) => void;
}

interface StoryDetectionState {
  scanning: boolean;
  found: readonly DetectedProvider[];
  hidden: ReadonlySet<string>;
}

/**
 * A fake host: each provider appears after the one before it, as a host that probes one address or
 * command at a time would report them. Save marks the row as added, and Hide and Show hidden change
 * only this story's list.
 */
export function createStoryDetection(initial: ProviderDetection, options: StoryDetectionOptions = {}) {
  const [state, setState] = createSignal<StoryDetectionState>({
    scanning: initial.scanning,
    found: initial.found,
    hidden: new Set(options.hidden),
  });
  const timers = new Set<ReturnType<typeof setTimeout>>();
  onCleanup(() => {
    for (const timer of timers) clearTimeout(timer);
  });

  function later(run: () => void, ms: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  }

  const reply = <T>(value: () => T) => new Promise<T>((resolve) => later(() => resolve(value()), REPLY_MS));

  const detection = (): ProviderDetection => {
    const { scanning, found, hidden } = state();
    return {
      scanning,
      found: found.filter((provider) => !hidden.has(provider.key)),
      hidden: found.filter((provider) => hidden.has(provider.key)).length,
    };
  };

  function update(id: string, change: (provider: DetectedProvider) => DetectedProvider): void {
    setState((current) => ({
      ...current,
      found: current.found.map((provider) => (provider.id === id ? change(provider) : provider)),
    }));
  }

  function scan(): void {
    const added = new Set(state().found.flatMap((provider) => (provider.added ? [provider.id] : [])));
    setState((current) => ({ ...current, scanning: true, found: [] }));
    STORY_DETECTED_PROVIDERS.forEach((provider, index) => {
      later(
        () =>
          setState((current) => ({
            ...current,
            found: [...current.found, { ...provider, added: added.has(provider.id) }],
          })),
        FOUND_EVERY_MS * (index + 1),
      );
    });
    later(
      () => setState((current) => ({ ...current, scanning: false })),
      FOUND_EVERY_MS * (STORY_DETECTED_PROVIDERS.length + 1),
    );
  }

  const api: DetectedProviderApi = {
    save: async (provider, value) => {
      const restart = await reply(() => (value.kind === "models" ? ("restarted" as const) : undefined));
      update(provider.id, (current) =>
        value.kind === "models"
          ? { ...current, added: true, name: value.value.name }
          : { ...current, added: true, name: value.value.displayName },
      );
      options.onSaved?.(value);
      return restart;
    },
    hide: (provider) => setState((current) => ({ ...current, hidden: new Set([...current.hidden, provider.key]) })),
    showHidden: () => setState((current) => ({ ...current, hidden: new Set() })),
    scan: options.rescan ? scan : undefined,
    // The fake server lists what the scan found at the same address.
    discoverModels: (endpoint) =>
      reply(() => {
        const server = STORY_DETECTED_PROVIDERS.find(
          (provider) => provider.kind === "models" && provider.baseUrl === endpoint.baseUrl.trim(),
        );
        return server?.kind === "models" ? server.models : [];
      }),
    checkAgent: (value) =>
      reply(() => ({
        status: "ok" as const,
        agentName: value.displayName || value.command,
        version: "1.9.0",
        protocolVersion: 1,
        capabilities: ["loadSession", "image"],
      })),
  };

  return { detection, api, scan };
}
