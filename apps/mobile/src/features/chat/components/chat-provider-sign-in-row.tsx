import { type AgentProviderId, providerDisplayName } from "@openbot/contracts/agent-providers";
import { router } from "expo-router";
import { Typography } from "heroui-native";
import { Pressable, View } from "react-native";
import { useServerProviders } from "@/features/servers/model/use-server-providers";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

export function useProviderSignInNeeded(serverId: string, provider: AgentProviderId | undefined): boolean {
  const { status } = useServerProviders(serverId);
  if (!provider) return false;
  return (status.data?.providers ?? []).some((entry) => entry.id === provider && entry.state === "sign-in-required");
}

export function ChatProviderSignInRow({ serverId, provider }: { serverId: string; provider: AgentProviderId }) {
  const { t } = useText();
  const label = t("mobile.chat.providerSignIn.title", { provider: providerDisplayName(provider) });
  return (
    <View className="items-start pb-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("mobile.chat.providerSignIn.open", { label })}
        className="max-w-[88%] gap-0.5 rounded-[18px] border border-separator bg-control/60 px-3.5 py-2.5"
        style={({ pressed }) => ({ borderCurve: "continuous", opacity: pressed ? 0.6 : 1 })}
        onPress={() => {
          void haptics.selection();
          router.push({ pathname: "/server-settings/provider", params: { serverId, provider } });
        }}
      >
        <Typography.Paragraph weight="semibold" numberOfLines={2} className="shrink">
          {label}
        </Typography.Paragraph>
        <Typography.Paragraph type="body-xs" className="text-accent">
          {t("mobile.chat.providerSignIn.action")}
        </Typography.Paragraph>
      </Pressable>
    </View>
  );
}
