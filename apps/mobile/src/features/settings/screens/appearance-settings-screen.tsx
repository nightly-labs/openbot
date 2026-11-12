import { CHAT_COLOR_PRESETS, type ChatColorPresetId } from "@openbot/brand/chat-colors";
import { APP_INTERFACE_SIZES, type AppInterfaceSize } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useUniwind } from "uniwind";
import { readableOn } from "@/features/onboarding/model/onboarding-colors";
import { MessageColorPicker } from "@/features/settings/components/message-color-picker";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { saveAppearance, useAppearance } from "@/features/settings/model/appearance";
import {
  type MessageColorMode,
  type MessageColorValue,
  saveMessageColor,
  useMessageColor,
} from "@/features/settings/model/message-color";
import {
  saveRoutineCollapsePreference,
  useRoutineCollapsePreference,
} from "@/features/settings/model/routine-collapse";
import { saveTextSize, useTextSize } from "@/features/settings/model/text-size";
import { PauseSlider } from "@/features/voice/components/pause-slider";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

const PRESET_LABELS = {
  red: "mobile.agent.appearance.hue.red",
  orange: "mobile.agent.appearance.hue.orange",
  yellow: "mobile.agent.appearance.hue.yellow",
  green: "mobile.agent.appearance.hue.green",
  cyan: "mobile.agent.appearance.hue.cyan",
  sky: "mobile.agent.appearance.hue.sky",
  blue: "mobile.agent.appearance.hue.blue",
  indigo: "mobile.agent.appearance.hue.indigo",
  violet: "mobile.agent.appearance.hue.violet",
  magenta: "mobile.agent.appearance.hue.magenta",
  pink: "mobile.agent.appearance.hue.pink",
} as const satisfies Record<ChatColorPresetId, MobileTextKey>;

export function AppearanceSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const { value, ready, saving } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  const messageColor = useMessageColor();
  const [messageColorError, setMessageColorError] = useState<string | null>(null);
  const changeMessageColor = (change: Partial<MessageColorValue>) => {
    setMessageColorError(null);
    void haptics.selection();
    void saveMessageColor(change).catch(() => {
      setMessageColorError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  };
  return (
    <SettingsContent>
      <SettingsSection footer={error || t("mobile.settings.appearance.footer")}>
        <SettingsRow
          trailing={
            <SettingsPicker
              value={value}
              options={[
                { value: "system", label: t("mobile.settings.appearance.system") },
                { value: "light", label: t("mobile.settings.appearance.light") },
                { value: "dark", label: t("mobile.settings.appearance.dark") },
              ]}
              enabled={ready && !saving}
              dark={theme === "dark"}
              label={t("mobile.settings.appearance.theme")}
              onChange={(next) => {
                setError(null);
                void haptics.selection();
                void saveAppearance(next).catch(() => {
                  setError(t("mobile.settings.appearance.saveFailed"));
                  void haptics.notification("error");
                });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.appearance.theme")}</Typography.Paragraph>
        </SettingsRow>
      </SettingsSection>
      <TextSizeSection />
      <SettingsSection footer={messageColorError ?? t("mobile.settings.appearance.messageColorFooter")}>
        <SettingsRow
          trailing={
            <SettingsPicker<MessageColorMode>
              value={messageColor.mode}
              options={[
                { value: "none", label: t("mobile.settings.appearance.messageColorNone") },
                { value: "agent", label: t("mobile.settings.appearance.messageColorAgent") },
                { value: "custom", label: t("mobile.settings.appearance.messageColorCustom") },
              ]}
              enabled={messageColor.ready}
              dark={theme === "dark"}
              label={t("mobile.settings.appearance.messageColor")}
              onChange={(mode) => changeMessageColor({ mode })}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.appearance.messageColor")}</Typography.Paragraph>
        </SettingsRow>
        {messageColor.mode === "custom" ? (
          <View
            className="flex-row flex-wrap gap-3 px-4 py-3"
            accessibilityRole="radiogroup"
            accessibilityLabel={t("mobile.settings.appearance.messageColorCustom")}
          >
            {CHAT_COLOR_PRESETS.map(({ id, value: color }) => {
              const checked = color === messageColor.customColor;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="radio"
                  accessibilityLabel={t(PRESET_LABELS[id])}
                  accessibilityState={{ checked, disabled: !messageColor.ready }}
                  disabled={!messageColor.ready}
                  hitSlop={4}
                  onPress={() => {
                    if (!checked) changeMessageColor({ customColor: color });
                  }}
                >
                  {({ pressed }) => (
                    <View
                      className="size-8 items-center justify-center rounded-full"
                      style={{ backgroundColor: color, opacity: pressed && !checked ? 0.6 : 1 }}
                    >
                      {checked ? <Check size={18} strokeWidth={2.5} color={readableOn(color)} /> : null}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {messageColor.mode === "custom" ? (
          <MessageColorPicker
            value={messageColor.customColor}
            disabled={!messageColor.ready}
            dark={theme === "dark"}
            onChange={(customColor) => changeMessageColor({ customColor })}
          />
        ) : null}
      </SettingsSection>
      <RoutineCollapseSection dark={theme === "dark"} />
    </SettingsContent>
  );
}

/** Whether the rows of consecutive routine markers in a chat start closed. */
function RoutineCollapseSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const preference = useRoutineCollapsePreference();
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsSection footer={error ?? t("mobile.settings.appearance.collapseRoutinesFooter")}>
      <SettingsRow>
        <SettingsSwitch
          value={preference.enabled}
          disabled={!preference.ready || preference.saving}
          label={t("mobile.settings.appearance.collapseRoutines")}
          dark={dark}
          onValueChange={(enabled) => {
            setError(null);
            void saveRoutineCollapsePreference(enabled).catch(() => {
              setError(t("mobile.settings.saveFailed"));
              void haptics.notification("error");
            });
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * The text size, in the steps of the desktop interface size. The slider moves through the steps;
 * the size applies when the finger lifts, so the screen does not change its layout during a drag.
 */
function TextSizeSection() {
  const { t, format } = useText();
  const ready = useTextSize((state) => state.ready);
  const saved = useTextSize((state) => state.percent);
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<AppInterfaceSize | null>(null);
  const shown = dragged ?? saved;
  // The slider can report more than one value before the next render: a step plays one tick.
  const lastStep = useRef(shown);
  const step = (index: number) =>
    APP_INTERFACE_SIZES[Math.min(APP_INTERFACE_SIZES.length - 1, Math.max(0, Math.round(index)))] ?? saved;
  const label = t("mobile.settings.appearance.textSize");
  return (
    <SettingsSection footer={error ?? t("mobile.settings.appearance.textSizeFooter")}>
      <View className="gap-3 px-4 py-3">
        <View className="flex-row items-center justify-between">
          <Typography.Paragraph>{label}</Typography.Paragraph>
          <Typography.Paragraph className="text-grouped-secondary">{format.percent(shown / 100)}</Typography.Paragraph>
        </View>
        <PauseSlider
          value={APP_INTERFACE_SIZES.indexOf(shown)}
          minimum={0}
          maximum={APP_INTERFACE_SIZES.length - 1}
          step={1}
          disabled={!ready}
          label={label}
          onChange={(index) => {
            const next = step(index);
            if (next === lastStep.current) return;
            lastStep.current = next;
            void haptics.selection();
            setDragged(next);
          }}
          onChangeEnd={(index) => {
            const next = step(index);
            lastStep.current = next;
            setDragged(null);
            if (next === saved) return;
            setError(null);
            void saveTextSize(next).catch(() => {
              setError(t("mobile.settings.saveFailed"));
              void haptics.notification("error");
            });
          }}
        />
      </View>
    </SettingsSection>
  );
}
