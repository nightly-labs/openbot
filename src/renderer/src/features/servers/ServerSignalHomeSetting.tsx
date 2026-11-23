import type { HostSignalHome, HostSignalHomeSettings, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";

export type HostSignalHomeCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getSignalHome" | "setSignalHome">;

export interface ServerSignalHomeOptions {
  calls?: HostSignalHomeCalls;
}

const AUTOMATIC = "automatic";

const SIGNAL_HOME_PLACES: Readonly<Record<string, AppTextKey>> = {
  a: "server.settings.signalHomePlaceHelsinki1",
  b: "server.settings.signalHomePlaceHelsinki2",
  us: "server.settings.signalHomePlaceSanJose",
  au: "server.settings.signalHomePlaceSydney",
  sg: "server.settings.signalHomePlaceSingapore",
};

const lastSettings = new Map<string, HostSignalHomeSettings>();

export function ServerSignalHomeSetting(
  props: ServerSignalHomeOptions & {
    serverId: string;
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage, format } = useText();
  const calls = (): HostSignalHomeCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<HostSignalHomeSettings | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [changed, setChanged] = createSignal(false);
  let generation = 0;

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      setSettings(lastSettings.get(serverId) ?? null);
      setLoadError(null);
      setChanged(false);
      untrack(calls)
        .getSignalHome(serverId)
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
              setLoadError(errorMessage(error, t("server.settings.signalHomeLoadFailed")));
            }
          },
        );
    },
  );

  const visible = () => loadError() !== null || (settings()?.homes.length ?? 0) > 1;
  const placeName = (id: string) => {
    const key = SIGNAL_HOME_PLACES[id];
    return key ? t(key) : id.toUpperCase();
  };
  const latencyText = (home: HostSignalHome | undefined) =>
    home?.latencyMs === null || home?.latencyMs === undefined
      ? t("server.settings.signalHomeNoAnswer")
      : t("server.settings.signalHomeLatency", { latency: format.number(home.latencyMs) });
  const homeOf = (id: string) => settings()?.homes.find((home) => home.id === id);
  const optionLabel = (choice: string) => {
    if (choice === AUTOMATIC) return t("server.settings.signalHomeAutomatic");
    return t("server.settings.signalHomeOption", { name: placeName(choice), latency: latencyText(homeOf(choice)) });
  };
  const valueLabel = (choice: string) => {
    if (choice !== AUTOMATIC) return placeName(choice);
    const current = settings()?.current ?? null;
    return current === null
      ? t("server.settings.signalHomeAutomatic")
      : t("server.settings.signalHomeAutomaticUsing", { name: placeName(current) });
  };
  const description = () => {
    const current = settings();
    if (current?.preferred && current.current && current.preferred !== current.current && changed())
      return t("server.settings.signalHomeMoving", { name: placeName(current.preferred) });
    if (current?.preferred && current.current && current.preferred !== current.current)
      return t("server.settings.signalHomeFallback", {
        chosen: placeName(current.preferred),
        name: placeName(current.current),
      });
    return t("server.settings.signalHomeDescription");
  };

  function choose(choice: string | null): void {
    const current = settings();
    if (choice === null || !current || choice === (current.preferred ?? AUTOMATIC)) return;
    const serverId = props.serverId;
    const request = ++generation;
    void props.run("signalHome", async () => {
      const next = await calls().setSignalHome(choice === AUTOMATIC ? null : choice, serverId);
      lastSettings.set(serverId, next);
      if (request !== generation) return;
      setSettings(next);
      setChanged(true);
    });
  }

  return (
    <Show when={visible()}>
      <SettingsSection title={t("server.settings.connectionTitle")}>
        <ItemGroup class="settings-modal-card">
          <Item>
            <ItemContent>
              <ItemTitle id="server-settings-signal-home-label">{t("server.settings.signalHome")}</ItemTitle>
              <ItemDescription>{loadError() ?? description()}</ItemDescription>
            </ItemContent>
            <Show when={settings()}>
              {(current) => (
                <ItemActions>
                  <Select<string>
                    class="settings-modal-select"
                    options={[AUTOMATIC, ...current().homes.map((home) => home.id)]}
                    value={current().preferred ?? AUTOMATIC}
                    disabled={props.disabled}
                    placement="bottom-end"
                    onChange={choose}
                    itemComponent={(item) => (
                      <SelectItem item={item.item}>{optionLabel(item.item.rawValue)}</SelectItem>
                    )}
                  >
                    <SelectTrigger size="sm" aria-labelledby="server-settings-signal-home-label">
                      <SelectValue<string>>{() => valueLabel(current().preferred ?? AUTOMATIC)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent mount={props.menuMount} />
                  </Select>
                </ItemActions>
              )}
            </Show>
          </Item>
        </ItemGroup>
      </SettingsSection>
    </Show>
  );
}
