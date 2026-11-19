import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Monitor from "lucide-react-native/icons/monitor";
import { View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

export type LocalServerPathname = "/add-server/local" | "/hosted-server/local";

export function LocalServerOptions({ pathname }: { pathname: LocalServerPathname }) {
  const { t } = useText();
  const [foreground] = useThemeColor(["foreground"]);
  const { servers, canCreateLocalServers } = useMobileWorkspace();
  const computers = servers.filter((server) => canCreateLocalServers(server.id));
  if (!computers.length) return null;
  return (
    <SettingsSection>
      {computers.map((server) => (
        <SettingsRow
          key={server.id}
          leading={
            <View className="mr-1">
              <Monitor color={foreground} size={22} strokeWidth={1.8} />
            </View>
          }
          supportingText={t("mobile.server.local.optionHint", { name: server.name })}
          onPress={() => router.push({ pathname, params: { serverId: server.id } })}
        >
          <Typography.Paragraph numberOfLines={1}>{t("mobile.server.local.option")}</Typography.Paragraph>
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}
