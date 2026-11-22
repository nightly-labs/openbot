import { router } from "expo-router";
import { Typography } from "heroui-native";
import AudioLines from "lucide-react-native/icons/audio-lines";
import { serverVoiceModels, useServerVoiceModel } from "@/features/servers/model/use-server-voice-model";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { RowIcon } from "@/features/settings/components/settings-row-icon";
import { useText } from "@/shared/lib/text";

export function ServerVoiceModelRow({ serverId }: { serverId: string }) {
  const { t, errorMessage } = useText();
  const { query } = useServerVoiceModel(serverId);
  const snapshot = query.data;
  const selected = snapshot ? serverVoiceModels(snapshot).find((model) => model.id === snapshot.modelId) : undefined;
  return (
    <SettingsSection
      footer={
        query.isError
          ? errorMessage(query.error, t("mobile.server.settings.voiceModelLoadFailed"))
          : t("mobile.server.settings.voiceModelDescription")
      }
    >
      <SettingsRow
        leading={<RowIcon icon={AudioLines} />}
        value={selected?.name}
        disabled={!snapshot}
        onPress={() => router.push({ pathname: "/server-settings/voice-model", params: { serverId } })}
      >
        <Typography.Paragraph>{t("mobile.server.route.voiceModel")}</Typography.Paragraph>
      </SettingsRow>
    </SettingsSection>
  );
}
