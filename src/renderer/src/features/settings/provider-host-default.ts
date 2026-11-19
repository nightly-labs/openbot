import type { AgentModelId, AgentProviderId, HostDefaultProvider, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { createEffect, createSignal, untrack } from "solid-js";

type HostDefaultProviderCalls = Pick<
  OpenBotDesktopApi["providerAdmin"],
  "hostDefaultProvider" | "setHostDefaultProvider"
>;

export interface HostDefaultProviderOptions {
  calls?: HostDefaultProviderCalls;
}

export interface HostDefaultProviderSource extends HostDefaultProviderOptions {
  serverId: string;
}

export interface HostDefaultProviderSetting extends HostDefaultProvider {
  save: (provider: AgentProviderId, model?: AgentModelId | null) => Promise<void>;
}

export function createHostDefaultProvider(
  source: () => HostDefaultProviderSource | undefined,
): () => HostDefaultProviderSetting | undefined {
  const calls = (): HostDefaultProviderCalls => source()?.calls ?? window.openbot.providerAdmin;
  const [value, setValue] = createSignal<HostDefaultProvider | null>(null);
  let generation = 0;

  createEffect(
    () => source()?.serverId,
    (serverId) => {
      const current = ++generation;
      setValue(null);
      if (serverId === undefined) return;
      untrack(calls)
        .hostDefaultProvider(serverId)
        .then(
          (next) => {
            if (current === generation) setValue(next);
          },
          () => undefined,
        );
    },
  );

  async function save(provider: AgentProviderId, model?: AgentModelId | null): Promise<void> {
    const serverId = source()?.serverId;
    if (serverId === undefined) return;
    const request = generation;
    const previous = value();
    const preferredModel =
      model !== undefined ? model : previous?.preferredProvider === provider ? previous.preferredModel : null;
    const next = await calls().setHostDefaultProvider({ preferredProvider: provider, preferredModel }, serverId);
    if (request === generation) setValue(next);
  }

  const setting: HostDefaultProviderSetting = {
    get preferredProvider() {
      return value()?.preferredProvider ?? null;
    },
    get preferredModel() {
      return value()?.preferredModel ?? null;
    },
    save,
  };
  return () => (source() && value() ? setting : undefined);
}
