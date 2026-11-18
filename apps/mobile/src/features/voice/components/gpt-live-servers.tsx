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

/**
 * One row for each server: whether it can run GPT live voice. The host must serve `live-voice-v1`,
 * and its Codex must be signed in with ChatGPT. Only an owner or admin can read the Codex status of
 * the host, and can open its Codex page to sign in; a member sees "Supported", and the host says
 * why a start fails.
 */
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
