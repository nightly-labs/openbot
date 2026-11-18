import type { AgentModelId, AgentProviderId, HostDefaultProvider, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { createEffect, createSignal, untrack } from "solid-js";

/** The default provider calls of a joined server's host. The desktop reaches them through main. */
type HostDefaultProviderCalls = Pick<
  OpenBotDesktopApi["providerAdmin"],
  "hostDefaultProvider" | "setHostDefaultProvider"
>;

export interface HostDefaultProviderOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostDefaultProviderCalls;
}

export interface HostDefaultProviderSource extends HostDefaultProviderOptions {
  serverId: string;
}

export interface HostDefaultProviderSetting extends HostDefaultProvider {
  save: (provider: AgentProviderId, model?: AgentModelId | null) => Promise<void>;
}

/**
 * The Default provider of a joined server's host (`provider-default-v1`). The host checks the role
 * again. Undefined until the host answers, so the row never shows a default that the host does not have.
 */
export function createHostDefaultProvider(
  source: () => HostDefaultProviderSource | undefined,
): () => HostDefaultProviderSetting | undefined {
  const calls = (): HostDefaultProviderCalls => source()?.calls ?? window.openbot.providerAdmin;
  const [value, setValue] = createSignal<HostDefaultProvider | null>(null);
  /** Bumped for each server, so an answer for an earlier one is dropped. */
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
          // Without the host's answer the row stays hidden, as it was before.
          () => undefined,
        );
    },
  );

  /** As on this computer, an omitted model keeps the model of the same provider. A failure reaches the row. */
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
