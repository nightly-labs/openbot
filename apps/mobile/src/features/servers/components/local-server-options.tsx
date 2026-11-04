import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import Monitor from "lucide-react-native/icons/monitor";
import { View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { useMobileWorkspace } from "@/features/workspace/context/mobile-workspace-context";
import { useText } from "@/shared/lib/text";

/** The create page of the sheet that shows these rows. */
export type LocalServerPathname = "/add-server/local" | "/hosted-server/local";

/**
 * One row for each computer where the owner can make another server (`local-servers-v1`): an online
 * server of the OpenBot desktop app that this account owns. Nothing when there is none.
 */
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
          // The row keeps 12 points between its parts. Beside two lines of text, the icon gets 16.
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
