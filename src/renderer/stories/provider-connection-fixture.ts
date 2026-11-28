import { type AgentProviderId, agentProviderDescriptor } from "@openbot/contracts/ipc";
import { toast } from "@openbot/ui";
import type { ProviderCodeLoginState } from "@openbot/ui/components/ProviderCodeLoginDialog";
import { createSignal } from "solid-js";
import type { ProviderConnectionApi, ProviderUseApp } from "../src/components/provider-connection-api";

export interface FakeConnectionOptions {
  finishAfterMs?: number;
  userCode?: string;
  connect?: readonly AgentProviderId[];
  alternative?: readonly AgentProviderId[];
  useApp?: readonly AgentProviderId[];
  browser?: (provider: AgentProviderId) => void | Promise<void>;
}

export function createFakeConnection(options: FakeConnectionOptions = {}): ProviderConnectionApi {
  const userCode = options.userCode ?? "KTQ4-B62MX";
  const finishAfterMs = options.finishAfterMs ?? 6_000;
  const [provider, setProvider] = createSignal<AgentProviderId | null>(null);
  const [state, setState] = createSignal<ProviderCodeLoginState>({ phase: "starting" });
  const [useApp, setUseApp] = createSignal<ProviderUseApp | null>(null);
  const useAppProviders = options.useApp ?? [];
  const timers: number[] = [];

  function clear(): void {
    while (timers.length > 0) window.clearTimeout(timers.pop());
  }

  function start(next: AgentProviderId): void {
    clear();
    setProvider(next);
    setState({ phase: "starting" });
    timers.push(
      window.setTimeout(() => {
        if (next === "claude") {
          setState({
            phase: "paste",
            verificationUrl: "https://claude.com/cai/oauth/authorize?code=true",
            expiresAt: Date.now() + 10 * 60_000,
          });
          return;
        }
        setState({
          phase: "waiting",
          userCode,
          verificationUrl: "https://auth.openai.com/codex/device",
          expiresAt: Date.now() + 5 * 60_000,
        });
        if (finishAfterMs <= 0) return;
        timers.push(
          window.setTimeout(() => {
            setState({ phase: "verifying" });
            timers.push(
              window.setTimeout(() => {
                close();
                toast.success(`${agentProviderDescriptor(next).displayName} connected`, {
                  description: "Signed in as person@example.com.",
                });
              }, 1_200),
            );
          }, finishAfterMs),
        );
      }, 700),
    );
  }

  function close(): void {
    clear();
    setProvider(null);
  }

  const dialogProviders = [...(options.connect ?? []), ...useAppProviders];
  return {
    connectKind: (id) => (dialogProviders.includes(id) ? "dialog" : options.browser ? "browser" : null),
    alternativeKind: (id) => ((options.alternative ?? ["codex"]).includes(id) ? "code" : null),
    provider,
    state,
    connect: async (id) => {
      if (useAppProviders.includes(id)) setUseApp({ provider: id, opener: null });
      else if (dialogProviders.includes(id)) start(id);
      else await options.browser?.(id);
    },
    alternative: start,
    useApp,
    closeUseApp: () => setUseApp(null),
    regionChoice: () => null,
    chooseRegion: () => undefined,
    openAppDownload: useAppProviders.length > 0 ? () => undefined : undefined,
    submit: () => {
      const current = provider();
      setState({ phase: "verifying" });
      if (!current) return;
      timers.push(
        window.setTimeout(() => {
          close();
          toast.success(`${agentProviderDescriptor(current).displayName} connected`, {
            description: "Signed in as person@example.com.",
          });
        }, 1_200),
      );
    },
    cancel: close,
    openVerificationUrl: () => undefined,
    openRelayPage: async () => undefined,
    pasteRelayAddress: async () => undefined,
    opener: () => null,
  };
}
