import type { HostMemoryReview, OpenBotDesktopApi } from "@openbot/contracts/ipc";
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

/** The memory review calls of one server's host. The desktop reaches them through main. */
export type HostMemoryReviewCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getMemoryReview" | "setMemoryReview">;

export interface ServerMemoryReviewOptions {
  /** The calls of a client with no `window.openbot`, such as the web client. */
  calls?: HostMemoryReviewCalls;
}

/**
 * The last value that this window read for each server. The row shows it at once when the settings
 * open again, so the row does not change its size when the host answers.
 */
const lastSettings = new Map<string, HostMemoryReview>();

/**
 * Server Settings > General: how many completed turns of one conversation pass between two
 * background memory reviews of the agents of this computer or a joined server, or Off
 * (`memory-review-v1`). The values come from the host. The host checks the role again.
 */
export function ServerMemoryReviewSetting(
  props: ServerMemoryReviewOptions & {
    serverId: string;
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage } = useText();
  const calls = (): HostMemoryReviewCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<HostMemoryReview | null>(null);
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
        .getMemoryReview(serverId)
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
              setLoadError(errorMessage(error, t("server.settings.memoryReviewLoadFailed")));
            }
          },
        );
    },
  );

  const label = (interval: number | null) =>
    interval === null
      ? ""
      : interval === 0
        ? t("server.settings.memoryReviewOff")
        : t("server.settings.memoryReviewTurns", { count: interval });

  function choose(interval: number | null): void {
    const current = settings();
    if (interval === null || !current || interval === current.interval) return;
    const serverId = props.serverId;
    const request = ++generation;
    void props.run("memoryReview", async () => {
      const next = await calls().setMemoryReview(interval, serverId);
      lastSettings.set(serverId, next);
      if (request === generation) setSettings(next);
    });
  }

  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-memory-review-label">{t("server.settings.memoryReview")}</ItemTitle>
        <ItemDescription>{loadError() ?? t("server.settings.memoryReviewDescription")}</ItemDescription>
      </ItemContent>
      <Show when={settings()}>
        {(current) => (
          <ItemActions>
            <Select<number>
              // A host that no longer permits its stored value still shows it.
              options={
                current().choices.includes(current().interval)
                  ? current().choices
                  : [current().interval, ...current().choices]
              }
              value={current().interval}
              disabled={props.disabled}
              placement="bottom-end"
              onChange={choose}
              itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
            >
              <SelectTrigger size="sm" aria-labelledby="server-settings-memory-review-label">
                <SelectValue<number>>{(state) => label(state.selectedOption() ?? null)}</SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.menuMount} />
            </Select>
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}
