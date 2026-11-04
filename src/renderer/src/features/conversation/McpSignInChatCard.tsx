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
  /** Sends the message that tells the agent to test again. False when it could not be sent now. */
  onContinue: (body: string) => boolean | Promise<boolean>;
}

/**
 * An MCP server an agent saved that needs the user's sign-in. Sign in runs the sign-in of Server
 * settings, MCP; Continue tells the agent to test the server again.
 */
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
      // The card shows "sent" during the send, so a second click sends nothing. A failed send shows Continue again.
      onContinue={async () => {
        if (sent()) return;
        setSent(true);
        if (!(await props.onContinue(t("chat.mcpSignIn.message", { name: props.config.name })))) setSent(false);
      }}
    />
  );
}

/**
 * The sign-in card of a side thread message, as the agent's own chat draws it. Continue goes to that
 * thread. Another message, or a row this client cannot read, keeps its row.
 */
export function useThreadMcpSignInCard(onContinue: (body: string) => Promise<boolean>) {
  const { props, mcpServers } = useConversationViewScope();
  const config = (mcpServerId: string) =>
    mcpServers().find((candidate) => candidate.id === mcpServerId && candidate.transport === "http");
  // The http rows by id. A list read again with the same rows keeps each card, and what it shows.
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
