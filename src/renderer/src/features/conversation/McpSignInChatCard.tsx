import type { McpServerConfig } from "@openbot/contracts/ipc";
import type { AgentMessage } from "@openbot/ui/data";
import { McpSignInCard, type McpSignInCardState } from "@openbot/ui/features/conversation/McpSignInCard";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, Show } from "solid-js";
import { useConversationViewScope } from "./conversation-scope";

export interface McpSignInChatCardProps {
  config: McpServerConfig;
  signedIn: boolean;
  onSignIn?: ((trigger: HTMLElement | null) => void) | undefined;
  onContinue: (body: string) => boolean | Promise<boolean>;
}

export function McpSignInChatCard(props: McpSignInChatCardProps) {
  const { t } = useText();
  const [sent, setSent] = createSignal(false);
  const state = (): McpSignInCardState => {
    if (sent()) return "sent";
    if (!props.onSignIn) return "unavailable";
    return props.signedIn ? "signed-in" : "sign-in";
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
      onSignIn={
        props.onSignIn
          ? () => props.onSignIn?.(document.activeElement instanceof HTMLElement ? document.activeElement : null)
          : undefined
      }
      onContinue={async () => {
        if (sent()) return;
        setSent(true);
        if (!(await props.onContinue(t("chat.mcpSignIn.message", { name: props.config.name })))) setSent(false);
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
