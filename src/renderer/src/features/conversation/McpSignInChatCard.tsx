import type { McpServerConfig } from "@openbot/contracts/ipc";
import { McpSignInCard, type McpSignInCardState } from "@openbot/ui/features/conversation/McpSignInCard";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";

export interface McpSignInChatCardProps {
  config: McpServerConfig;
  signedIn: boolean;
  onSignIn?: ((trigger: HTMLElement | null) => void) | undefined;
  /** Sends the message that tells the agent to test again. False when it could not be sent now. */
  onContinue: (body: string) => boolean;
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
      onContinue={() => {
        if (props.onContinue(t("chat.mcpSignIn.message", { name: props.config.name }))) setSent(true);
      }}
    />
  );
}
