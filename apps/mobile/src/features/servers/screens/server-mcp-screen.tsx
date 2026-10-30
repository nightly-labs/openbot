import { router, Stack, useLocalSearchParams } from "expo-router";
import { Typography } from "heroui-native";
import Plus from "lucide-react-native/icons/plus";
import { mcpServerDetail } from "@/features/servers/model/mcp-server-draft";
import { useServerMcp } from "@/features/servers/model/use-server-mcp";
import {
  SettingsContent,
  SettingsNote,
  SettingsRow,
  SettingsSection,
} from "@/features/settings/components/settings-content";
import { AndroidHeaderButton } from "@/shared/components/android-header-button";
import { haptics } from "@/shared/lib/haptics";
import { isAndroid, isIOS } from "@/shared/lib/platform";
import { useText } from "@/shared/lib/text";

/**
 * Server sheet > MCP servers: the MCP servers that the host gives its agents. An owner or admin
 * opens a server to change, test or remove it, and adds one with the header "+".
 */
export function ServerMcpScreen() {
  const { t, errorMessage } = useText();
  const { serverId } = useLocalSearchParams<{ serverId: string }>();
  const { server, canManage, list, signIns } = useServerMcp(serverId);
  if (!server || !canManage)
    return (
      <SettingsContent>
        <SettingsNote>{t(server ? "mobile.server.mcp.unavailable" : "mobile.server.unavailable")}</SettingsNote>
      </SettingsContent>
    );
  const signedIn = new Set(signIns.data?.filter((state) => state.signedIn).map((state) => state.mcpServerId));
  return (
    <SettingsContent>
      <AddAction onPress={() => router.push({ pathname: "/server-settings/mcp-server", params: { serverId } })} />
      <SettingsSection
        footer={
          list.isError
            ? errorMessage(list.error, t("mobile.server.mcp.loadFailed"))
            : t("mobile.server.mcp.description")
        }
      >
        {list.isPending && !list.isError ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.mcp.loading")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {list.data?.map((config) => {
          const status = signedIn.has(config.id)
            ? t("mobile.server.mcp.signedIn")
            : t(config.enabled ? "mobile.server.mcp.enabled" : "mobile.server.mcp.disabled");
          return (
            <SettingsRow
              key={config.id}
              supportingText={mcpServerDetail(config)}
              trailing={<Typography.Paragraph className="text-grouped-secondary">{status}</Typography.Paragraph>}
              accessibilityLabel={t("mobile.server.mcp.rowLabel", { name: config.name, status })}
              onPress={() =>
                router.push({ pathname: "/server-settings/mcp-server", params: { serverId, mcpServerId: config.id } })
              }
            >
              <Typography.Paragraph numberOfLines={1}>{config.name}</Typography.Paragraph>
            </SettingsRow>
          );
        })}
        {list.data?.length === 0 ? (
          <SettingsRow disclosure={false}>
            <Typography.Paragraph className="text-grouped-secondary">
              {t("mobile.server.mcp.empty")}
            </Typography.Paragraph>
          </SettingsRow>
        ) : null}
        {list.isError ? (
          <SettingsRow disclosure={false} disabled={list.isFetching} onPress={() => void list.refetch()}>
            <Typography.Paragraph className="text-accent">{t("mobile.server.mcp.retry")}</Typography.Paragraph>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsContent>
  );
}

/** The "+" of the header: the native toolbar on iOS. */
function AddAction({ onPress }: { onPress: () => void }) {
  const { t } = useText();
  const press = () => {
    void haptics.impact("light");
    onPress();
  };
  if (isAndroid)
    return (
      <AndroidHeaderButton
        placement="right"
        icon={Plus}
        accessibilityLabel={t("mobile.server.mcp.add")}
        onPress={press}
      />
    );
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        icon={isIOS ? "plus" : undefined}
        accessibilityLabel={t("mobile.server.mcp.add")}
        onPress={press}
      >
        {isIOS ? undefined : "+"}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
