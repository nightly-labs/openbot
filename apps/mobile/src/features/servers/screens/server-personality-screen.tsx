import { RESPONSE_STYLES, type ResponseStyle } from "@openbot/contracts/ipc";
import { useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Check from "lucide-react-native/icons/check";
import { useState } from "react";
import { useCSSVariable } from "uniwind";
import { RESPONSE_STYLE_LABEL_KEYS, useServerPersonality } from "@/features/servers/model/use-server-personality";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/**
 * Server settings > Agent personality: how the agents of this server talk while they work
 * (`host-personality-v1`), for an owner or admin. Natural agents send short updates and the chat
 * shows them; Classic agents answer once. The change applies from the next turn of each agent. The
 * host checks the role again.
 */
export function ServerPersonalityScreen() {
  const { t, errorMessage } = useText();
  const accent = String(useCSSVariable("--openbot-accent"));
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { canManage, query, save } = useServerPersonality(serverId);
  const [pending, setPending] = useState<ResponseStyle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = query.data?.responseStyle;
  if (!canManage || !current)
    return (
      <SettingsContent>
        {!canManage || query.isError ? (
          <SettingsNote>
            {!canManage
              ? t("mobile.server.settings.personalityUnsupported")
              : errorMessage(query.error, t("mobile.server.settings.personalityLoadFailed"))}
          </SettingsNote>
        ) : null}
      </SettingsContent>
    );

  function choose(style: ResponseStyle) {
    if (pending !== null || style === current) return;
    void haptics.selection();
    setPending(style);
    setError(null);
    save({ responseStyle: style })
      .then(() => void haptics.notification("success"))
      .catch((cause: unknown) => {
        void haptics.notification("error");
        setError(errorMessage(cause, t("mobile.server.settings.personalitySaveFailed")));
      })
      .finally(() => setPending(null));
  }

  return (
    <SettingsContent>
      <SettingsSection footer={error ?? t("mobile.server.settings.responseStyleDescription")}>
        {RESPONSE_STYLES.map((style) => {
          const selected = style === current;
          return (
            <SettingsRow
              key={style}
              checked={selected}
              disabled={pending !== null}
              disclosure={false}
              trailing={selected ? <Check size={18} color={accent} strokeWidth={2} /> : null}
              onPress={() => choose(style)}
            >
              <Typography.Paragraph>{t(RESPONSE_STYLE_LABEL_KEYS[style])}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
      </SettingsSection>
    </SettingsContent>
  );
}
