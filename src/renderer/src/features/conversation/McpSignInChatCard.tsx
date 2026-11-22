import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { McpSignInCard, type McpSignInCardState } from "@openbot/ui/features/conversation/McpSignInCard";
import { isPluginAppConfig } from "@openbot/ui/features/settings/marketplace-plugins";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, Show } from "solid-js";
import { MARKETPLACE_PLUGINS } from "../settings/marketplace-plugin-catalog";
import { conversationRuntime } from "./conversation-runtime";
import { useConversationViewScope } from "./conversation-scope";

export interface McpSignInChatCardProps {
  config: McpServerConfig;
  signedIn: boolean;
  onSignIn?: ((trigger: HTMLElement | null) => void) | undefined;
  onContinue: (body: string) => boolean | Promise<boolean>;
}

function heldByAppWithoutSignIn(config: McpServerConfig): boolean {
  return MARKETPLACE_PLUGINS.some((plugin) =>
    plugin.apps.some((app) => !app.server.auth?.length && isPluginAppConfig(config, app)),
  );
}

export function McpSignInChatCard(props: McpSignInChatCardProps) {
  const { t } = useText();
  const { props: view } = useConversationViewScope();
  const [sent, setSent] = createSignal(false);
  const [checking, setChecking] = createSignal(false);
  const [notNeeded, setNotNeeded] = createSignal(false);
  const state = (): McpSignInCardState => {
    if (notNeeded()) return sent() ? "not-needed-sent" : "not-needed";
    if (sent()) return "sent";
    if (!props.onSignIn) return "unavailable";
    if (checking()) return "checking";
    return props.signedIn ? "signed-in" : "sign-in";
  };
  const savedRow = async (serverId: string) => {
    const rows = await conversationRuntime(view).agent.listMcpServers(serverId);
    return rows.find((row) => row.id === props.config.id && row.transport === "http");
  };
  const worksWithoutSignIn = async (): Promise<boolean> => {
    const serverId = view.server?.id;
    const test = conversationRuntime(view).agent.testMcpServer;
    if (!serverId || !test) return false;
    setChecking(true);
    try {
      const row = await savedRow(serverId);
      if (!row || !heldByAppWithoutSignIn(row)) return false;
      return (await test({ config: row }, serverId)).error === null;
    } catch {
      return false;
    } finally {
      setChecking(false);
    }
  };
  const signIn = async (trigger: HTMLElement | null) => {
    if (checking()) return;
    if (await worksWithoutSignIn()) setNotNeeded(true);
    else props.onSignIn?.(trigger);
  };
  const address = () => {
    if (!URL.canParse(props.config.url)) return props.config.url;
    const url = new URL(props.config.url);
    return `${url.origin}${url.pathname}`;
  };
  return (
    <McpSignInCard
      name={props.config.name}
      address={address()}
      state={state()}
      unavailableText={t("chat.mcpSignIn.unavailable", { name: props.config.name })}
      notNeededText={t("chat.mcpSignIn.notNeeded", { name: props.config.name })}
      onSignIn={
        props.onSignIn
          ? () => void signIn(document.activeElement instanceof HTMLElement ? document.activeElement : null)
          : undefined
      }
      onContinue={async () => {
        if (sent()) return;
        setSent(true);
        const body = notNeeded()
          ? t("chat.mcpSignIn.notNeededMessage", { name: props.config.name })
          : t("chat.mcpSignIn.message", { name: props.config.name });
        if (!(await props.onContinue(body))) setSent(false);
      }}
    />
  );
}

export function useThreadMcpSignInCard(onContinue: (body: string) => Promise<boolean>) {
  const { props, mcpServers } = useConversationViewScope();
  const config = (mcpServerId: string) =>
    mcpServers().find((candidate) => candidate.id === mcpServerId && candidate.transport === "http");
  const httpIds = createMemo(() =>
    mcpServers()
      .flatMap((candidate) => (candidate.transport === "http" ? [candidate.id] : []))
      .join("\n"),
  );
  return (message: AgentMessage) => {
    const marker = message.actionMarker;
    if (marker?.kind !== "mcp-sign-in" || !httpIds().split("\n").includes(marker.mcpServerId)) return undefined;
    return (
      <Show when={config(marker.mcpServerId)}>
        {(row) => (
          <McpSignInChatCard
            config={row()}
            signedIn={props.mcpSignedIn?.(row().id) ?? false}
            onSignIn={props.onOpenMcpSignIn ? (trigger) => props.onOpenMcpSignIn?.(row().id, trigger) : undefined}
            onContinue={onContinue}
          />
        )}
      </Show>
    );
  };
}
