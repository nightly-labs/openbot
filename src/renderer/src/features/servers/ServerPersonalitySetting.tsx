import { type HostPersonality, RESPONSE_STYLES, type ResponseStyle } from "@openbot/contracts/ipc";
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
import { type HostPersonalityCalls, rememberServerPersonality } from "./server-personality";

export interface ServerPersonalityOptions {
  calls?: HostPersonalityCalls;
}

export function ServerPersonalitySetting(
  props: ServerPersonalityOptions & {
    serverId: string;
    disabled: boolean;
    menuMount: HTMLElement | undefined;
    run: (key: string, action: () => Promise<void>) => Promise<boolean>;
  },
) {
  const { t, errorMessage } = useText();
  const calls = (): HostPersonalityCalls => props.calls ?? window.openbot.hostAdmin;
  const [settings, setSettings] = createSignal<HostPersonality | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  let generation = 0;

  function keep(serverId: string, next: HostPersonality): void {
    setSettings(next);
    rememberServerPersonality(serverId, next);
  }

  createEffect(
    () => props.serverId,
    (serverId) => {
      const current = ++generation;
      setSettings(null);
      setLoadError(null);
      untrack(calls)
        .getPersonality(serverId)
        .then(
          (next) => {
            if (current === generation) keep(serverId, next);
          },
          (error: unknown) => {
            if (current === generation) setLoadError(errorMessage(error, t("server.settings.personalityLoadFailed")));
          },
        );
    },
  );

  function label(style: ResponseStyle | undefined): string {
    if (style === "classic") return t("server.settings.responseStyleClassic");
    if (style === "natural") return t("server.settings.responseStyleNatural");
    return "";
  }

  function choose(style: ResponseStyle | null): void {
    const current = settings();
    if (style === null || !current || style === current.responseStyle) return;
    const serverId = props.serverId;
    const request = generation;
    void props.run("personality", async () => {
      const next = await calls().setPersonality({ responseStyle: style }, serverId);
      if (request === generation) keep(serverId, next);
    });
  }

  return (
    <Item>
      <ItemContent>
        <ItemTitle id="server-settings-response-style-label">{t("server.settings.responseStyle")}</ItemTitle>
        <ItemDescription>{loadError() ?? t("server.settings.responseStyleDescription")}</ItemDescription>
      </ItemContent>
      <Show when={settings()}>
        {(current) => (
          <ItemActions>
            <Select<ResponseStyle>
              class="settings-modal-select"
              options={[...RESPONSE_STYLES]}
              value={current().responseStyle}
              disabled={props.disabled}
              placement="bottom-end"
              onChange={choose}
              itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
            >
              <SelectTrigger size="sm" aria-labelledby="server-settings-response-style-label">
                <SelectValue<ResponseStyle>>{(state) => label(state.selectedOption())}</SelectValue>
              </SelectTrigger>
              <SelectContent mount={props.menuMount} />
            </Select>
          </ItemActions>
        )}
      </Show>
    </Item>
  );
}
