import type { HostBrowsingMemory, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle, Switch } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";

export type HostBrowsingMemoryCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getBrowsingMemory" | "setBrowsingMemory">;

export interface ServerBrowsingMemoryOptions {
  calls?: HostBrowsingMemoryCalls;
}

const lastSettings = new Map<string, HostBrowsingMemory>();

export function ServerBrowsingMemorySetting(
  props: ServerBrowsingMemoryOptions & {
    serverId: string;
    disabled: boolean;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage } = useText();
  const calls = (): HostBrowsingMemoryCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<HostBrowsingMemory | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  let generation = 0;

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      setSettings(lastSettings.get(serverId) ?? null);
      setLoadError(null);
      untrack(calls)
        .getBrowsingMemory(serverId)
        .then(
          (next) => {
            if (current !== generation) return;
            lastSettings.set(serverId, next);
            setSettings(next);
          },
          (error: unknown) => {
            if (current === generation) {
              lastSettings.delete(serverId);
              setSettings(null);
              setLoadError(errorMessage(error, t("server.settings.browsingMemoryLoadFailed")));
            }
          },
        );
    },
  );

  function change(enabled: boolean): void {
    const current = settings();
    if (!current || enabled === current.enabled) return;
    const serverId = props.serverId;
    const request = ++generation;
    void props.run("browsingMemory", async () => {
      const next = await calls().setBrowsingMemory(enabled, serverId);
      lastSettings.set(serverId, next);
      if (request === generation) setSettings(next);
    });
  }

  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-browsing-memory-label">{t("server.settings.browsingMemory")}</ItemTitle>
        <ItemDescription>{loadError() ?? t("server.settings.browsingMemoryDescription")}</ItemDescription>
      </ItemContent>
      <Show when={settings()}>
        {(current) => (
          <ItemActions>
            <Switch
              checked={current().enabled}
              disabled={props.disabled}
              onChange={change}
              aria-labelledby="server-settings-browsing-memory-label"
            />
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}
