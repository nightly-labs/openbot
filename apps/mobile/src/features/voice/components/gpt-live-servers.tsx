import type { MobileTextKey } from "@openbot/i18n/mobile";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useState } from "react";
import { Alert } from "react-native";
import { useUniwind } from "uniwind";
import { useProviderAccountName } from "@/features/agents/components/agent-runtime-fields";
import { isProviderKeyAccount } from "@/features/servers/model/provider-admin";
import {
  useProviderAdmin,
  useServerProviderAccounts,
  useServerProviderStatus,
} from "@/features/servers/model/use-server-providers";
import { SettingsRow } from "@/features/settings/components/settings-content";
import { SettingsPicker } from "@/features/settings/components/settings-controls";
import { gptLiveAccess } from "@/features/voice/model/gpt-live-access";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import type { MobileServer } from "@/features/workspace/model/workspace-types";
import { useText } from "@/shared/lib/text";

const AUTOMATIC_ACCOUNT = "automatic";

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
  const providerStatus = useServerProviderStatus(server.id);
  const access = supported ? gptLiveAccess(providerStatus.data?.providers) : undefined;
  const status: GptLiveServerStatus = !online ? "offline" : !supported ? "update" : (access ?? "supported");
  return (
    <SettingsRow
      supportingText={t(STATUS_TEXT[status])}
      trailing={status === "ready" ? <LiveVoiceAccountPicker serverId={server.id} /> : undefined}
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

function LiveVoiceAccountPicker({ serverId }: { serverId: string }) {
  const { t } = useText();
  const { theme } = useUniwind();
  const accountName = useProviderAccountName();
  const { admin } = useProviderAdmin(serverId);
  const choose = admin?.accounts?.setLiveVoiceAccount ?? null;
  const { list, refresh } = useServerProviderAccounts(serverId, choose ? admin : null);
  const [saving, setSaving] = useState(false);
  const accounts = list.data?.providers.find((entry) => entry.provider === "codex")?.accounts ?? [];
  const chosen = list.data?.liveVoiceAccount ?? null;
  const planAccounts = accounts.filter((account) => !isProviderKeyAccount("codex", account.id));
  if (!choose || (planAccounts.length < 2 && chosen === null)) return null;
  const options = [
    { value: AUTOMATIC_ACCOUNT, label: t("mobile.settings.voice.gptLive.automatic") },
    ...planAccounts.map((account) => ({ value: account.id, label: accountName(account, accounts.indexOf(account)) })),
  ];
  return (
    <SettingsPicker
      value={chosen ?? AUTOMATIC_ACCOUNT}
      options={options}
      enabled={!saving}
      dark={theme === "dark"}
      label={t("mobile.settings.voice.gptLive.account")}
      onChange={(choice) => {
        setSaving(true);
        void choose(choice === AUTOMATIC_ACCOUNT ? null : choice)
          .then(refresh)
          .catch(() => Alert.alert(t("mobile.settings.saveFailed")))
          .finally(() => setSaving(false));
      }}
    />
  );
}
