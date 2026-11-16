import type { HostAgentMemoryLimit, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";

/** The memory limit calls of one server's host. The desktop reaches them through main. */
export type HostMemoryLimitCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getAgentMemoryLimit" | "setAgentMemoryLimit">;

export interface ServerMemoryLimitOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostMemoryLimitCalls;
}

/**
 * The last value that this window read for each server. The row shows it at once when the settings
 * open again, so the row does not change its size when the host answers.
 */
const lastSettings = new Map<string, HostAgentMemoryLimit>();

/**
 * Server Settings > General: how many memories each agent of this computer or a joined server can
 * keep (`agent-memory-limit-v1`). The values come from the host. The host checks the role again.
 */
export function ServerMemoryLimitSetting(
  props: ServerMemoryLimitOptions & {
    serverId: string;
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage } = useText();
  const calls = (): HostMemoryLimitCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<HostAgentMemoryLimit | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  /** Bumped for each server and each change, so an earlier answer is dropped. */
  let generation = 0;

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      setSettings(lastSettings.get(serverId) ?? null);
      setLoadError(null);
      untrack(calls)
        .getAgentMemoryLimit(serverId)
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
              setLoadError(errorMessage(error, t("server.settings.memoryLimitLoadFailed")));
            }
          },
        );
    },
  );

  function choose(limit: number | null): void {
    const current = settings();
    if (limit === null || !current || limit === current.limit) return;
    const serverId = props.serverId;
    const request = ++generation;
    void props.run("memoryLimit", async () => {
      const next = await calls().setAgentMemoryLimit(limit, serverId);
      lastSettings.set(serverId, next);
      if (request === generation) setSettings(next);
    });
  }

  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-memory-limit-label">{t("server.settings.memoryLimit")}</ItemTitle>
        <ItemDescription>{loadError() ?? t("server.settings.memoryLimitDescription")}</ItemDescription>
      </ItemContent>
      <Show when={settings()}>
        {(current) => (
          <ItemActions>
            <Select<number>
              class="settings-modal-select"
              // A host that no longer permits its stored value still shows it.
              options={
                current().choices.includes(current().limit)
                  ? current().choices
                  : [current().limit, ...current().choices]
              }
              value={current().limit}
              disabled={props.disabled}
              placement="bottom-end"
              onChange={choose}
              itemComponent={(item) => <SelectItem item={item.item}>{String(item.item.rawValue)}</SelectItem>}
            >
              <SelectTrigger size="sm" aria-labelledby="server-settings-memory-limit-label">
                <SelectValue<number>>{(state) => String(state.selectedOption() ?? "")}</SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.menuMount} />
            </Select>
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}
