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

export type HostMemoryReviewCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getMemoryReview" | "setMemoryReview">;

export interface ServerMemoryReviewOptions {
  calls?: HostMemoryReviewCalls;
}

const lastSettings = new Map<string, HostMemoryReview>();

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
              class="settings-modal-select"
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
