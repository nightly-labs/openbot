import {
  DEFAULT_DYNAMIC_ISLAND_PREFERENCE,
  DYNAMIC_ISLAND_SIZE_LIMITS,
  IDLE_DYNAMIC_ISLAND_PRESENTATION,
} from "@openbot/contracts/ipc";
import { Button, ItemGroup, SettingsSection, SliderField, SwitchField } from "@openbot/ui";
import { OpenBotDynamicIsland } from "@openbot/ui/features/dynamic-island/OpenBotDynamicIsland";
import type { GeneralSettingsValue } from "@openbot/ui/features/settings/app-settings";
import { useI18n } from "../../i18n-context";

export interface SettingsDynamicIslandTabProps {
  value: GeneralSettingsValue;
  onUpdateSetting: <Key extends keyof GeneralSettingsValue>(key: Key, value: GeneralSettingsValue[Key]) => void;
  /** Saves several fields as one change, so a reset writes the preference once. */
  onUpdateSettings: (patch: Partial<GeneralSettingsValue>) => void;
}

/**
 * The Dynamic Island switches and its size.
 *
 * Each slider step saves at once, so the island on the screen follows the thumb during a drag. A
 * step is 5%, so one drag across the track writes the preference at most 12 times.
 */
export function SettingsDynamicIslandTab(props: SettingsDynamicIslandTabProps) {
  const i18n = useI18n();
  const widthPercent = () => props.value.macBookNotchWidthPercent;
  const heightPercent = () => props.value.macBookNotchHeightPercent;
  const isDefaultSize = () =>
    props.value.macBookNotchWidthPercent === DEFAULT_DYNAMIC_ISLAND_PREFERENCE.widthPercent &&
    props.value.macBookNotchHeightPercent === DEFAULT_DYNAMIC_ISLAND_PREFERENCE.heightPercent;

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
            checked={props.value.macBookNotch}
            onChange={(checked) => props.onUpdateSetting("macBookNotch", checked)}
            label={i18n.t("settings.notch.show.title")}
            description={i18n.t("settings.notch.show.description")}
          />
          <SwitchField
            checked={props.value.macBookNotchIdle}
            disabled={!props.value.macBookNotch}
            onChange={(checked) => props.onUpdateSetting("macBookNotchIdle", checked)}
            label={i18n.t("settings.notch.idle.title")}
            description={i18n.t("settings.notch.idle.description")}
          />
          <SwitchField
            checked={props.value.macBookNotchAdditionalDisplays}
            disabled={!props.value.macBookNotch}
            onChange={(checked) => props.onUpdateSetting("macBookNotchAdditionalDisplays", checked)}
            label={i18n.t("settings.notch.displays.title")}
            description={i18n.t("settings.notch.displays.description")}
          />
          <SwitchField
            checked={props.value.macBookNotchHaptics}
            disabled={!props.value.macBookNotch}
            onChange={(checked) => props.onUpdateSetting("macBookNotchHaptics", checked)}
            label={i18n.t("settings.notch.haptics.title")}
            description={i18n.t("settings.notch.haptics.description")}
          />
        </ItemGroup>
      </SettingsSection>

      <SettingsSection
        title={i18n.t("settings.notch.size.title")}
        description={i18n.t("settings.notch.size.description")}
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
            <figure class="settings-dynamic-island-preview-display">
              <div class="settings-dynamic-island-preview-bar" inert>
                <OpenBotDynamicIsland
                  presentation={IDLE_DYNAMIC_ISLAND_PRESENTATION}
                  state="compact"
                  displayMode="notch"
                  notchSize={{ width: 192, height: 32 }}
                  widthPercent={widthPercent()}
                  heightPercent={heightPercent()}
                  onStateChange={() => undefined}
                  onAction={() => undefined}
                />
              </div>
              <figcaption class="settings-dynamic-island-preview-caption">
                {i18n.t("settings.notch.size.previewNotch")}
              </figcaption>
            </figure>
            <figure class="settings-dynamic-island-preview-display">
              <div class="settings-dynamic-island-preview-bar" inert>
                <OpenBotDynamicIsland
                  presentation={IDLE_DYNAMIC_ISLAND_PRESENTATION}
                  state="compact"
                  displayMode="island"
                  widthPercent={widthPercent()}
                  heightPercent={heightPercent()}
                  onStateChange={() => undefined}
                  onAction={() => undefined}
                />
              </div>
              <figcaption class="settings-dynamic-island-preview-caption">
                {i18n.t("settings.notch.size.previewIsland")}
              </figcaption>
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
