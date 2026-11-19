import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

type GptLiveServerStatus = "ready" | "supported" | "offline" | "update" | "signIn";

const STATUS_TEXT: Record<GptLiveServerStatus, MobileTextKey> = {
  ready: "mobile.settings.voice.gptLive.status.ready",
  supported: "mobile.settings.voice.gptLive.status.supported",
  offline: "mobile.settings.voice.gptLive.status.offline",
  update: "mobile.settings.voice.gptLive.status.update",
  signIn: "mobile.settings.voice.gptLive.status.signIn",
};

export function GptLiveServerRows() {
  const servers = useMobileWorkspaceSelector((current) => current.servers);
  return servers.map((server) => <GptLiveServerRow key={server.id} server={server} />);
}

function GptLiveServerRow({ server }: { server: MobileServer }) {
  const { t } = useText();
  const online = server.state === "online";
  const supported = useMobileWorkspaceSelector((current) => online && current.canUseLiveVoice(server.id));
  const { rows } = useServerProviders(server.id);
  const codex = supported ? rows.find((row) => row.id === "codex")?.status : undefined;
  const status: GptLiveServerStatus = !online
    ? "offline"
    : !supported
      ? "update"
      : !codex
        ? "supported"
        : codex.state === "sign-in-required" ||
            codex.state === "not-installed" ||
            (codex.state === "available" && codex.apiKeyInUse)
          ? "signIn"
          : codex.state === "available"
            ? "ready"
            : "supported";
  return (
    <SettingsRow
      supportingText={t(STATUS_TEXT[status])}
      onPress={
        status === "signIn"
          ? () =>
              router.push({ pathname: "/server-settings/provider", params: { serverId: server.id, provider: "codex" } })
          : undefined
      }
    >
      <Typography.Paragraph numberOfLines={1}>{server.name}</Typography.Paragraph>
    </SettingsRow>
  );
}
