import { CHAT_BACKGROUND_PRESETS, CHAT_COLOR_PRESETS, type ChatColorPresetId } from "@openbot/brand/chat-colors";
import { APP_INTERFACE_SIZES, type AppInterfaceSize, type AvatarColor, isAvatarColor } from "@openbot/contracts/ipc";
import type { MobileTextKey } from "@openbot/i18n/mobile";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Check from "lucide-react-native/icons/check";
import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useUniwind } from "uniwind";
import { UsageSegments } from "@/features/agents/components/usage-segments";
import { readableOn } from "@/features/onboarding/model/onboarding-colors";
import { AppIconSection } from "@/features/settings/components/app-icon-row";
import { AppearancePreview } from "@/features/settings/components/appearance-preview";
import { ChatBackdropSection } from "@/features/settings/components/chat-backdrop-section";
import { MessageColorPicker } from "@/features/settings/components/message-color-picker";
import { SettingsContent, SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SettingsPicker, SettingsSwitch } from "@/features/settings/components/settings-controls";
import { SettingsPictureChoice } from "@/features/settings/components/settings-picture-choice";
import { MessageColorPicture, ThemePicture } from "@/features/settings/components/settings-pictures";
import { type Appearance, saveAppearance, useAppearance } from "@/features/settings/model/appearance";
import { useChatBackdrop } from "@/features/settings/model/chat-backdrop";
import { saveChatBackground, useChatBackground } from "@/features/settings/model/chat-background";
import {
  type ChatDetailPreference,
  saveMemoryChangesDisplayPreference,
  saveSubagentsDisplayPreference,
  saveThinkingDisplayPreference,
  useMemoryChangesDisplayPreference,
  useSubagentsDisplayPreference,
  useThinkingDisplayPreference,
} from "@/features/settings/model/chat-details";
import {
  type MessageColorMode,
  type MessageColorStyle,
  type MessageColorValue,
  saveMessageColor,
  useMessageColor,
} from "@/features/settings/model/message-color";
import {
  saveRoutineCollapsePreference,
  useRoutineCollapsePreference,
} from "@/features/settings/model/routine-collapse";
import { saveTextSize, useTextSize } from "@/features/settings/model/text-size";
import { saveFullVisualPreference, useFullVisualPreference } from "@/features/settings/model/visual-preview";
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

type AppearanceTab = "theme" | "colors" | "backdrop" | "chat";

export function AppearanceSettingsScreen() {
  const { t } = useText();
  const { theme } = useUniwind();
  const dark = theme === "dark";
  const [tab, setTab] = useState<AppearanceTab>("theme");
  return (
    <SettingsContent>
      <View className="gap-3">
        <AppearancePreview />
        <UsageSegments<AppearanceTab>
          options={[
            { value: "theme", label: t("mobile.settings.appearance.theme") },
            { value: "colors", label: t("mobile.settings.appearance.tab.colors") },
            { value: "backdrop", label: t("mobile.settings.appearance.backdrop.title") },
            { value: "chat", label: t("mobile.settings.appearance.tab.chat") },
          ]}
          value={tab}
          accessibilityLabel={t("mobile.settings.appearance.title")}
          onChange={setTab}
        />
      </View>
      {tab === "theme" ? (
        <>
          <ThemeSection />
          <TextSizeSection />
          <AppIconSection />
        </>
      ) : null}
      {tab === "colors" ? (
        <>
          <MessageColorSection dark={dark} />
          <ChatBackgroundSection dark={dark} />
        </>
      ) : null}
      {tab === "backdrop" ? <ChatBackdropSection dark={dark} /> : null}
      {tab === "chat" ? (
        <>
          <ChatDetailsSection dark={dark} />
          <RoutineCollapseSection dark={dark} />
          <FullVisualSection dark={dark} />
        </>
      ) : null}
    </SettingsContent>
  );
}

function ThemeSection() {
  const { t } = useText();
  const { value, ready } = useAppearance();
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsSection
      title={t("mobile.settings.appearance.theme")}
      footer={error || t("mobile.settings.appearance.footer")}
    >
      <SettingsPictureChoice<Appearance>
        label={t("mobile.settings.appearance.theme")}
        value={value}
        disabled={!ready}
        options={(
          [
            ["light", t("mobile.settings.appearance.light")],
            ["dark", t("mobile.settings.appearance.dark")],
            ["system", t("mobile.settings.appearance.system")],
          ] as const
        ).map(([mode, label]) => ({
          value: mode,
          label,
          picture: (play: number) => <ThemePicture mode={mode} play={play} />,
        }))}
        onChange={(next) => {
          setError(null);
          void saveAppearance(next).catch(() => {
            setError(t("mobile.settings.appearance.saveFailed"));
            void haptics.notification("error");
          });
        }}
      />
    </SettingsSection>
  );
}

function MessageColorSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const messageColor = useMessageColor();
  const [messageColorError, setMessageColorError] = useState<string | null>(null);
  const changeMessageColor = (change: Partial<MessageColorValue>, { haptic = true } = {}) => {
    setMessageColorError(null);
    if (haptic) void haptics.selection();
    void saveMessageColor(change).catch(() => {
      setMessageColorError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  };
  return (
    <SettingsSection
      title={t("mobile.settings.appearance.messageColor")}
      footer={messageColorError ?? t("mobile.settings.appearance.messageColorFooter")}
    >
      <SettingsPictureChoice<MessageColorMode>
        label={t("mobile.settings.appearance.messageColor")}
        value={messageColor.mode}
        disabled={!messageColor.ready}
        options={(
          [
            ["none", t("mobile.settings.appearance.messageColorNone")],
            ["agent", t("mobile.settings.appearance.messageColorAgent")],
            ["custom", t("mobile.settings.appearance.messageColorCustom")],
          ] as const
        ).map(([mode, label]) => ({
          value: mode,
          label,
          picture: (play: number) => (
            <MessageColorPicture mode={mode} customColor={messageColor.customColor} play={play} />
          ),
        }))}
        onChange={(mode) => changeMessageColor({ mode }, { haptic: false })}
      />
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
          dark={dark}
          onChange={(customColor) => changeMessageColor({ customColor })}
        />
      ) : null}
      {messageColor.mode === "none" ? null : (
        <SettingsRow
          trailing={
            <SettingsPicker<MessageColorStyle>
              value={messageColor.style}
              options={[
                { value: "solid", label: t("mobile.settings.appearance.bubbleStyleSolid") },
                { value: "tint", label: t("mobile.settings.appearance.bubbleStyleTint") },
              ]}
              enabled={messageColor.ready}
              dark={dark}
              label={t("mobile.settings.appearance.bubbleStyle")}
              onChange={(style) => {
                if (style !== messageColor.style) changeMessageColor({ style });
              }}
            />
          }
        >
          <Typography.Paragraph>{t("mobile.settings.appearance.bubbleStyle")}</Typography.Paragraph>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

function ChatBackgroundSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const scheme = dark ? "dark" : "light";
  const saved = useChatBackground((state) => state[scheme]);
  const backdropShown = useChatBackdrop((state) => state.ready && state.choice !== "none");
  const ready = useChatBackground((state) => state.ready) && !backdropShown;
  const themeBackground = String(useThemeColor("background"));
  const [error, setError] = useState<string | null>(null);
  const change = (color: AvatarColor | null) => {
    setError(null);
    void haptics.selection();
    void saveChatBackground(scheme, color).catch(() => {
      setError(t("mobile.settings.saveFailed"));
      void haptics.notification("error");
    });
  };
  const choices: { id: string; label: string; value: AvatarColor | null; swatch: string }[] = [
    {
      id: "default",
      label: t("mobile.settings.appearance.chatBackgroundDefault"),
      value: null,
      swatch: themeBackground,
    },
    ...CHAT_BACKGROUND_PRESETS[scheme].map((preset) => ({
      id: preset.id,
      label: t(PRESET_LABELS[preset.id]),
      value: preset.value,
      swatch: preset.value,
    })),
  ];
  return (
    <SettingsSection
      title={t("mobile.settings.appearance.chatBackground")}
      footer={
        error ??
        (backdropShown
          ? t("mobile.settings.appearance.chatBackgroundBackdropFooter")
          : t("mobile.settings.appearance.chatBackgroundFooter"))
      }
    >
      <View
        className="flex-row flex-wrap gap-3 px-4 py-3"
        accessibilityRole="radiogroup"
        accessibilityLabel={t("mobile.settings.appearance.chatBackground")}
      >
        {choices.map((choice) => {
          const checked = choice.value === saved;
          return (
            <Pressable
              key={choice.id}
              accessibilityRole="radio"
              accessibilityLabel={choice.label}
              accessibilityState={{ checked, disabled: !ready }}
              disabled={!ready}
              hitSlop={4}
              onPress={() => {
                if (!checked) change(choice.value);
              }}
            >
              {({ pressed }) => (
                <View
                  className="size-8 items-center justify-center rounded-full border border-border"
                  style={{ backgroundColor: choice.swatch, opacity: pressed && !checked ? 0.6 : 1 }}
                >
                  {checked ? <Check size={18} strokeWidth={2.5} color={readableOn(choice.swatch)} /> : null}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
      <MessageColorPicker
        value={saved ?? (isAvatarColor(themeBackground) ? themeBackground : CHAT_BACKGROUND_PRESETS[scheme][0].value)}
        disabled={!ready}
        dark={dark}
        onChange={change}
      />
    </SettingsSection>
  );
}

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

function ChatDetailsSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const [error, setError] = useState<string | null>(null);
  const details = [
    {
      label: t("mobile.settings.appearance.showThinking"),
      state: useThinkingDisplayPreference(),
      save: saveThinkingDisplayPreference,
    },
    {
      label: t("mobile.settings.appearance.showSubagents"),
      state: useSubagentsDisplayPreference(),
      save: saveSubagentsDisplayPreference,
    },
    {
      label: t("mobile.settings.appearance.showMemoryChanges"),
      state: useMemoryChangesDisplayPreference(),
      save: saveMemoryChangesDisplayPreference,
    },
  ] satisfies { label: string; state: ChatDetailPreference; save: (enabled: boolean) => Promise<void> }[];
  return (
    <SettingsSection
      title={t("mobile.settings.appearance.replyDetails")}
      footer={error ?? t("mobile.settings.appearance.replyDetailsFooter")}
    >
      {details.map(({ label, state, save }) => (
        <SettingsRow key={label}>
          <SettingsSwitch
            value={state.enabled}
            disabled={!state.ready || state.saving}
            label={label}
            dark={dark}
            onValueChange={(enabled) => {
              setError(null);
              void save(enabled).catch(() => {
                setError(t("mobile.settings.saveFailed"));
                void haptics.notification("error");
              });
            }}
          />
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}

function FullVisualSection({ dark }: { dark: boolean }) {
  const { t } = useText();
  const preference = useFullVisualPreference();
  const [error, setError] = useState<string | null>(null);
  return (
    <SettingsSection footer={error ?? t("mobile.settings.appearance.fullVisualsFooter")}>
      <SettingsRow>
        <SettingsSwitch
          value={preference.enabled}
          disabled={!preference.ready || preference.saving}
          label={t("mobile.settings.appearance.fullVisuals")}
          dark={dark}
          onValueChange={(enabled) => {
            setError(null);
            void saveFullVisualPreference(enabled).catch(() => {
              setError(t("mobile.settings.saveFailed"));
              void haptics.notification("error");
            });
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}

function TextSizeSection() {
  const { t, format } = useText();
  const ready = useTextSize((state) => state.ready);
  const saved = useTextSize((state) => state.percent);
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<AppInterfaceSize | null>(null);
  const shown = dragged ?? saved;
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
