import type { McpServerConfig } from "@openbot/contracts/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Spinner, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Lock from "lucide-react-native/icons/lock";
import Plug from "lucide-react-native/icons/plug";
import { useState } from "react";
import { View, type ViewStyle } from "react-native";
import { useCSSVariable } from "uniwind";
import { useQueryScope } from "@/features/auth/context/mobile-session-context";
import { useMcpSignInRelay } from "@/features/servers/model/use-mcp-sign-in-relay";
import { useMcpServerList, useMcpSignInList } from "@/features/servers/model/use-server-mcp";
import { useMobileWorkspaceSelector } from "@/features/workspace/context/mobile-workspace-context";
import { queryKeys } from "@/features/workspace/model/query-keys";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";

/** The server address, without its query, as the desktop card shows it. */
function serverAddress(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

/**
 * An MCP server that an agent saved and that waits for the person's sign-in, as the desktop card.
 * Sign in runs the relayed sign-in (`sign-in-relay-v1`), so the host keeps the grant; Continue tells
 * the agent to test the server again. A reader who cannot list the host's MCP servers sees the marker.
 */
export function ChatMcpSignInCard({
  mcpServerId,
  serverId,
  canSend,
  onContinue,
  muted,
}: {
  mcpServerId: string;
  serverId: string;
  canSend: boolean;
  /** Sends the message that tells the agent to test again. Absent where the chat cannot send it. */
  onContinue?: (body: string) => void;
  muted: ViewStyle["backgroundColor"];
}) {
  const { t } = useText();
  const { canManage, list } = useMcpServerList(serverId);
  const config = list.data?.find((item) => item.id === mcpServerId && item.transport === "http");
  if (!config)
    return (
      <View accessible className="flex-row flex-wrap items-center justify-center gap-1.5 py-2">
        <Plug size={16} color={String(muted)} strokeWidth={1.75} />
        <Typography.Paragraph type="body-sm" style={{ color: muted }}>
          {t("mobile.chat.mcpSignIn.marker")}
        </Typography.Paragraph>
      </View>
    );
  return (
    <McpSignInCardBody
      config={config}
      serverId={serverId}
      canManage={canManage}
      canSend={canSend}
      onContinue={onContinue}
    />
  );
}

function McpSignInCardBody({
  config,
  serverId,
  canManage,
  canSend,
  onContinue,
}: {
  config: McpServerConfig;
  serverId: string;
  canManage: boolean;
  canSend: boolean;
  onContinue?: (body: string) => void;
}) {
  const { t, errorMessage } = useText();
  const [muted] = useThemeColor(["muted"]);
  const [success] = useCSSVariable(["--openbot-success-text"]);
  const queryClient = useQueryClient();
  const queryScope = useQueryScope();
  const canRelay = useMobileWorkspaceSelector((workspace) => workspace.canRelayMcpSignIn(serverId));
  const signIns = useMcpSignInList(serverId, canManage);
  const relay = useMcpSignInRelay(serverId);
  const [working, setWorking] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const signedIn = Boolean(signIns.data?.some((state) => state.mcpServerId === config.id && state.signedIn));
  const signingIn = relay.state?.phase === "signIn" ? relay.state : null;
  const name = config.name;

  async function signIn() {
    if (working) return;
    void haptics.selection();
    setWorking(true);
    setFailed(null);
    setAddress("");
    try {
      await relay.signIn(config);
      void haptics.notification("success");
      await queryClient.invalidateQueries({ queryKey: queryKeys.mcpSignIns(queryScope, serverId), exact: true });
    } catch (cause) {
      void haptics.notification("error");
      setFailed(errorMessage(cause, t("mobile.chat.mcpSignIn.failed")));
    } finally {
      setWorking(false);
    }
  }

  function sendContinue() {
    if (!onContinue || !canSend) return;
    onContinue(t("mobile.chat.mcpSignIn.message", { name }));
    setSent(true);
  }

  const error = failed ?? relay.error;
  return (
    <View className="w-full gap-2.5" accessibilityState={{ busy: working }}>
      <View
        className="max-w-[88%] self-start gap-2.5 rounded-[30px] bg-control/60 px-4 py-3"
        style={{ borderCurve: "circular" }}
      >
        <View className="flex-row items-center gap-2.5">
          <Plug color={String(muted)} size={18} strokeWidth={2} />
          <View className="min-w-0 shrink">
            <Typography.Paragraph weight="semibold" accessibilityRole="header" numberOfLines={1}>
              {name}
            </Typography.Paragraph>
            <Typography.Paragraph type="body-xs" className="text-text-secondary" numberOfLines={1}>
              {serverAddress(config.url)}
            </Typography.Paragraph>
          </View>
        </View>
        {!canRelay && !sent ? (
          <View className="flex-row items-start gap-2">
            <Lock color={String(muted)} size={14} strokeWidth={2} style={{ marginTop: 2 }} />
            <Typography.Paragraph type="body-xs" className="shrink text-text-secondary">
              {t("mobile.chat.mcpSignIn.unavailable", { name })}
            </Typography.Paragraph>
          </View>
        ) : null}
        {signingIn?.paste ? (
          <View className="gap-2">
            <Typography.Paragraph type="body-xs" className="text-text-secondary">
              {t("mobile.marketplace.app.pasteHint")}
            </Typography.Paragraph>
            <SheetFormField
              label={t("mobile.marketplace.app.pasteLabel")}
              value={address}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              onChangeText={setAddress}
            />
          </View>
        ) : null}
      </View>

      {sent || canRelay ? (
        <View className="flex-row flex-wrap items-center gap-2">
          {sent ? (
            <View accessible className="flex-row items-center gap-1.5 px-1">
              <CircleCheck color={String(success)} size={16} strokeWidth={2} />
              <Typography.Paragraph type="body-sm" style={{ color: String(success) }}>
                {t("mobile.chat.mcpSignIn.signedIn")}
              </Typography.Paragraph>
            </View>
          ) : signingIn?.paste ? (
            <Button
              size="sm"
              variant="tertiary"
              className="rounded-full"
              isDisabled={!address.trim()}
              onPress={() => void relay.paste(address)}
            >
              <Button.Label className="font-sans font-semibold">
                {t("mobile.marketplace.app.finishSignIn")}
              </Button.Label>
            </Button>
          ) : signingIn ? (
            <Button size="sm" variant="tertiary" className="rounded-full" onPress={relay.reopen}>
              <Button.Label className="font-sans font-semibold">{t("mobile.marketplace.app.openAgain")}</Button.Label>
            </Button>
          ) : working ? (
            <Button size="sm" variant="tertiary" className="rounded-full" isDisabled>
              <Spinner size="sm" />
              <Button.Label className="font-sans font-semibold">{t("mobile.marketplace.app.waiting")}</Button.Label>
            </Button>
          ) : signedIn && onContinue ? (
            <Button
              size="sm"
              variant="tertiary"
              className="rounded-full"
              accessibilityLabel={t("mobile.chat.mcpSignIn.continueNamed", { name })}
              isDisabled={!canSend}
              onPress={sendContinue}
            >
              <Button.Label className="font-sans font-semibold">{t("mobile.chat.mcpSignIn.continue")}</Button.Label>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="tertiary"
              className="rounded-full"
              accessibilityLabel={t("mobile.chat.mcpSignIn.signInNamed", { name })}
              onPress={() => void signIn()}
            >
              <Button.Label className="font-sans font-semibold">{t("mobile.chat.mcpSignIn.signIn")}</Button.Label>
            </Button>
          )}
        </View>
      ) : null}
      {error ? (
        <Typography.Paragraph type="body-xs" className="text-danger-text" accessibilityRole="alert">
          {error}
        </Typography.Paragraph>
      ) : null}
    </View>
  );
}
