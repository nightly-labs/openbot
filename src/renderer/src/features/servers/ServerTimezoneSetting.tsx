import type { HostTimezoneSettings, OpenBotDesktopApi } from "@openbot/contracts/ipc";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle, SearchSelect } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";

export type HostTimezoneCalls = Pick<OpenBotDesktopApi["hostAdmin"], "getTimezone" | "setTimezone">;

export interface ServerTimezoneOptions {
  calls?: HostTimezoneCalls;
}

const zoneNameCache = new Map<string, string>();

function zoneNames(locale: string, zone: string): string {
  const key = `${locale} ${zone}`;
  let names = zoneNameCache.get(key);
  if (names === undefined) {
    names = [...new Set([locale, "en"])]
      .map((language) => {
        try {
          return new Intl.DateTimeFormat(language, { timeZone: zone, timeZoneName: "longGeneric" })
            .formatToParts()
            .find((part) => part.type === "timeZoneName")?.value;
        } catch {
          return undefined;
        }
      })
      .join(" ");
    zoneNameCache.set(key, names);
  }
  return names;
}

const AUTOMATIC = "automatic";

const lastSettings = new Map<string, HostTimezoneSettings>();

export function ServerTimezoneSetting(
  props: ServerTimezoneOptions & {
    serverId: string;
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage, locale } = useText();
  const calls = (): HostTimezoneCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<HostTimezoneSettings | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  let generation = 0;

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      setSettings(lastSettings.get(serverId) ?? null);
      setLoadError(null);
      untrack(calls)
        .getTimezone(serverId)
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
              setLoadError(errorMessage(error, t("server.settings.timezoneLoadFailed")));
            }
          },
        );
    },
  );

  const zones = () => {
    const chosen = settings()?.timezone;
    const known = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];
    return [AUTOMATIC, ...(chosen && !known.includes(chosen) ? [chosen] : []), ...known];
  };
  const label = (zone: string) =>
    zone === AUTOMATIC
      ? t("server.settings.timezoneAutomatic", { zone: settings()?.systemTimezone ?? "" })
      : zone.replaceAll("_", " ");
  const searchText = (zone: string) =>
    zone === AUTOMATIC ? label(zone) : `${zone} ${label(zone)} ${zoneNames(locale(), zone)}`;

  function choose(zone: string | null): void {
    const current = settings();
    if (zone === null || !current || zone === (current.timezone ?? AUTOMATIC)) return;
    const serverId = props.serverId;
    const request = ++generation;
    void props.run("timezone", async () => {
      const next = await calls().setTimezone(zone === AUTOMATIC ? null : zone, serverId);
      lastSettings.set(serverId, next);
      if (request === generation) setSettings(next);
    });
  }

  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-timezone-label">{t("server.settings.timezone")}</ItemTitle>
        <ItemDescription>{loadError() ?? t("server.settings.timezoneDescription")}</ItemDescription>
      </ItemContent>
      <Show
        when={settings()}
        fallback={
          <Show when={loadError() === null}>
            <ItemActions class="server-settings-timezone-pending" />
          </Show>
        }
      >
        {(current) => (
          <ItemActions>
            <SearchSelect<string>
              class="settings-modal-select settings-modal-link-select"
              options={zones()}
              value={current().timezone ?? AUTOMATIC}
              label={label}
              optionTextValue={searchText}
              disabled={props.disabled}
              placement="bottom-end"
              mount={props.menuMount}
              size="sm"
              aria-labelledby="server-settings-timezone-label"
              onChange={choose}
            />
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}
