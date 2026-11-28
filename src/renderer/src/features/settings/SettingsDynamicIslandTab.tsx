import {
  type AppInfo,
  type AppVariant,
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  DYNAMIC_ISLAND_SIZE_LIMITS,
  type DynamicIslandGeometry,
  type DynamicIslandNotchSize,
  IDLE_DYNAMIC_ISLAND_PRESENTATION,
  isDynamicIslandServerVisible,
  type ServerSummary,
} from "@openbot/contracts/ipc";
import {
  Button,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  SettingsSection,
  SliderField,
  Switch,
  SwitchField,
} from "@openbot/ui";
import {
  OpenBotDynamicIsland,
  openBotIdleCompactWidth,
} from "@openbot/ui/features/dynamic-island/OpenBotDynamicIsland";
import { ServerMark, serverStatusLabels } from "@openbot/ui/features/servers/ServerRail";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import type { JSX } from "@solidjs/web";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { useI18n } from "../../i18n-context";
import { usePlatform } from "../../platform";
import { settingsPort } from "./settings-port";
import { XWaylandRestartRow } from "./XWaylandRestartRow";

const PREVIEW_NOTCH_SIZE: DynamicIslandNotchSize = { width: 192, height: 32 };
const PREVIEW_FIT_INSET = 12;

export interface SettingsDynamicIslandTabProps {
  value: GeneralSettingsValue;
  variant: AppVariant;
  platform: AppInfo["platform"] | undefined;
  builtInDisplayGeometry?: DynamicIslandGeometry | undefined;
  servers: readonly ServerSummary[];
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  onUpdateSettings: (patch: Partial<GeneralSettingsValue>) => void;
}

export function SettingsDynamicIslandTab(props: SettingsDynamicIslandTabProps) {
  const i18n = useI18n();
  const isMac = () => props.platform === "darwin";
  const showKey = () => (isMac() ? "settings.notch.show.title" : "settings.notch.show.titleTopOfScreen");
  const platform = usePlatform();
  const linux = () => props.platform === "linux";
  const screenSupport = () => (linux() && props.value.macBookNotch ? platform.appInfo()?.aboveAppsSupport : undefined);
  const widthPercent = () => props.value.macBookNotchWidthPercent;
  const heightPercent = () => props.value.macBookNotchHeightPercent;
  const widestBuiltInWidth = () =>
    openBotIdleCompactWidth("notch", builtInNotchSize(), DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent.max);
  const widestExternalWidth = openBotIdleCompactWidth("island", undefined, DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent.max);
  const builtInNotchSize = (): DynamicIslandNotchSize | undefined =>
    props.builtInDisplayGeometry === null ? undefined : (props.builtInDisplayGeometry ?? PREVIEW_NOTCH_SIZE);
  const isDefaultSize = () =>
    props.value.macBookNotchWidthPercent === DEFAULT_DYNAMIC_ISLAND_PREFERENCE.widthPercent &&
    props.value.macBookNotchHeightPercent === DEFAULT_DYNAMIC_ISLAND_PREFERENCE.heightPercent;

  const serverShown = (serverId: string) =>
    isDynamicIslandServerVisible(
      { serverVisibility: props.value.macBookNotchServers, newServersVisible: props.value.macBookNotchNewServers },
      serverId,
    );

  function saveServerChoices(patch: Record<string, boolean>, newServersVisible: boolean): void {
    props.onUpdateSettings({
      macBookNotchServers: {
        ...Object.fromEntries(props.servers.map((server) => [server.id, serverShown(server.id)])),
        ...patch,
      },
      macBookNotchNewServers: newServersVisible,
    });
  }

  function resetSize(): void {
    props.onUpdateSettings({
      macBookNotchWidthPercent: DEFAULT_DYNAMIC_ISLAND_PREFERENCE.widthPercent,
      macBookNotchHeightPercent: DEFAULT_DYNAMIC_ISLAND_PREFERENCE.heightPercent,
    });
  }

  return (
    <>
      <SettingsSection title={i18n.t("settings.notch.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            data-settings-row={showKey()}
            checked={props.value.macBookNotch}
            onChange={(checked) => props.onUpdateSetting("macBookNotch", checked)}
            label={i18n.t(showKey())}
            description={i18n.t("settings.notch.show.description")}
          />
          <XWaylandRestartRow
            support={screenSupport()}
            keys={{
              title: "settings.notch.xwayland.title",
              description: "settings.notch.xwayland.description",
              unsupported: "settings.notch.xwayland.unsupported",
              restart: "settings.notch.xwayland.restart",
            }}
            onRestart={() => settingsPort().dynamicIsland.setXWayland({ enabled: true })}
          />
          <SwitchField
            data-settings-row="settings.notch.idle.title"
            checked={props.value.macBookNotchIdle}
            disabled={!props.value.macBookNotch}
            onChange={(checked) => props.onUpdateSetting("macBookNotchIdle", checked)}
            label={i18n.t("settings.notch.idle.title")}
            description={i18n.t("settings.notch.idle.description")}
          />
          <SwitchField
            data-settings-row="settings.notch.displays.title"
            checked={props.value.macBookNotchAdditionalDisplays}
            disabled={!props.value.macBookNotch}
            onChange={(checked) => props.onUpdateSetting("macBookNotchAdditionalDisplays", checked)}
            label={i18n.t("settings.notch.displays.title")}
            description={i18n.t("settings.notch.displays.description")}
          />
          <Show when={isMac()}>
            <SwitchField
              data-settings-row="settings.notch.haptics.title"
              checked={props.value.macBookNotchHaptics}
              disabled={!props.value.macBookNotch}
              onChange={(checked) => props.onUpdateSetting("macBookNotchHaptics", checked)}
              label={i18n.t("settings.notch.haptics.title")}
              description={i18n.t("settings.notch.haptics.description")}
            />
          </Show>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection
        data-settings-row="settings.notch.servers.title"
        title={i18n.t("settings.notch.servers.title")}
        description={i18n.t("settings.notch.servers.description")}
      >
        <ItemGroup class="settings-modal-card">
          <For each={props.servers}>
            {(server) => (
              <IslandServerRow
                server={server}
                shown={serverShown(server.id)}
                disabled={!props.value.macBookNotch}
                onChange={(shown) => saveServerChoices({ [server.id]: shown }, props.value.macBookNotchNewServers)}
              />
            )}
          </For>
          <SwitchField
            checked={props.value.macBookNotchNewServers}
            disabled={!props.value.macBookNotch}
            onChange={(checked) => saveServerChoices({}, checked)}
            label={i18n.t("settings.notch.servers.later")}
          />
        </ItemGroup>
      </SettingsSection>

      <SettingsSection
        data-settings-row="settings.notch.size.title"
        title={i18n.t("settings.notch.size.title")}
        description={isMac() ? i18n.t("settings.notch.size.description") : undefined}
        actions={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!props.value.macBookNotch || isDefaultSize()}
            onClick={resetSize}
          >
            {i18n.t("settings.notch.size.reset")}
          </Button>
        }
      >
        <ItemGroup class="settings-modal-card settings-dynamic-island-size">
          <div class="settings-dynamic-island-preview">
            <Show when={isMac()}>
              <figure class="settings-dynamic-island-preview-display">
                <PreviewFit widestWidth={widestBuiltInWidth()}>
                  <OpenBotDynamicIsland
                    presentation={IDLE_DYNAMIC_ISLAND_PRESENTATION}
                    state="compact"
                    displayMode="notch"
                    notchSize={builtInNotchSize()}
                    variant={props.variant}
                    widthPercent={widthPercent()}
                    heightPercent={heightPercent()}
                    onStateChange={() => undefined}
                    onAction={() => undefined}
                  />
                </PreviewFit>
                <figcaption class="settings-dynamic-island-preview-caption">
                  {i18n.t("settings.notch.size.previewNotch")}
                </figcaption>
              </figure>
            </Show>
            <figure class="settings-dynamic-island-preview-display">
              <PreviewFit widestWidth={widestExternalWidth}>
                <OpenBotDynamicIsland
                  presentation={IDLE_DYNAMIC_ISLAND_PRESENTATION}
                  state="compact"
                  displayMode="island"
                  variant={props.variant}
                  widthPercent={widthPercent()}
                  heightPercent={heightPercent()}
                  onStateChange={() => undefined}
                  onAction={() => undefined}
                />
              </PreviewFit>
              <Show when={isMac()}>
                <figcaption class="settings-dynamic-island-preview-caption">
                  {i18n.t("settings.notch.size.previewIsland")}
                </figcaption>
              </Show>
            </figure>
          </div>
          <SliderField
            label={i18n.t("settings.notch.size.width")}
            value={widthPercent()}
            minValue={DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent.min}
            maxValue={DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent.max}
            step={DYNAMIC_ISLAND_SIZE_LIMITS.widthPercent.step}
            disabled={!props.value.macBookNotch}
            formatValue={(value) => `${value}%`}
            onChange={(value) => props.onUpdateSetting("macBookNotchWidthPercent", value)}
          />
          <SliderField
            label={i18n.t("settings.notch.size.height")}
            value={heightPercent()}
            minValue={DYNAMIC_ISLAND_SIZE_LIMITS.heightPercent.min}
            maxValue={DYNAMIC_ISLAND_SIZE_LIMITS.heightPercent.max}
            step={DYNAMIC_ISLAND_SIZE_LIMITS.heightPercent.step}
            disabled={!props.value.macBookNotch}
            formatValue={(value) => `${value}%`}
            onChange={(value) => props.onUpdateSetting("macBookNotchHeightPercent", value)}
          />
        </ItemGroup>
      </SettingsSection>
    </>
  );
}

function IslandServerRow(props: {
  server: ServerSummary;
  shown: boolean;
  disabled: boolean;
  onChange: (shown: boolean) => void;
}): JSX.Element {
  const i18n = useI18n();
  const titleId = createUniqueId();
  const status = () => serverStatusLabels(props.server, i18n.t).join(" · ");
  return (
    <Item>
      <ItemMedia class="settings-dynamic-island-server-mark" aria-hidden="true">
        <ServerMark server={props.server} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle id={titleId}>{props.server.name}</ItemTitle>
        <Show when={status()}>{(text) => <ItemDescription>{text()}</ItemDescription>}</Show>
      </ItemContent>
      <ItemActions>
        <Switch
          checked={props.shown && !props.server.notificationsMuted}
          disabled={props.disabled || props.server.notificationsMuted}
          onChange={props.onChange}
          aria-labelledby={titleId}
        />
      </ItemActions>
    </Item>
  );
}

function PreviewFit(props: { widestWidth: number | undefined; children: JSX.Element }): JSX.Element {
  let frame: HTMLDivElement | undefined;
  const [available, setAvailable] = createSignal(0);
  const scale = () => {
    const widest = props.widestWidth ?? 0;
    const room = available() - PREVIEW_FIT_INSET * 2;
    return widest > room && room > 0 ? room / widest : 1;
  };
  onSettled(() => {
    const root = frame;
    if (!root) return;
    const resize = new ResizeObserver(() => setAvailable(root.clientWidth));
    resize.observe(root);
    return () => resize.disconnect();
  });
  return (
    <div ref={frame} class="settings-dynamic-island-preview-bar" inert>
      <div class="settings-dynamic-island-preview-fit" style={{ "--settings-dynamic-island-preview-scale": scale() }}>
        {props.children}
      </div>
    </div>
  );
}
