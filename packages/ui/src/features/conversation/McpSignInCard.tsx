import { Button, Lock } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { PluginIcon } from "../marketplace/PluginIcon";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

/**
 * Where the sign-in is. `signed-in`: the agent can test the server again. `sent`: the user told it
 * to. `unavailable`: this user cannot sign in here, or the server is gone.
 */
export type McpSignInCardState = "sign-in" | "signed-in" | "sent" | "unavailable";

export interface McpSignInCardProps {
  name: string;
  /** The server address, without its query. */
  address: string;
  state: McpSignInCardState;
  /** Why the user cannot sign in here. Shown under the header when `unavailable`. */
  unavailableText?: string;
  /** Starts the sign-in. The sign-in dialogs stay in the consumer. */
  onSignIn?: (() => void) | undefined;
  /** Tells the agent that the sign-in is done, so it tests the server again. */
  onContinue?: (() => void) | undefined;
}

/**
 * An MCP server that an agent added and that waits for the user's sign-in. The user signs in from
 * the chat, then tells the agent to continue.
 */
export function McpSignInCard(props: McpSignInCardProps) {
  const { t } = useText();
  const sent = () => props.state === "sent";
  const canContinue = () => props.state === "signed-in" && props.onContinue !== undefined;
  const canSignIn = () => props.state !== "unavailable" && props.onSignIn !== undefined;
  const status = () => (sent() ? "answered" : "pending");
  const outcome = () => (sent() ? t("chat.mcpSignIn.signedIn") : undefined);

  function actionButtons(): JSX.Element | undefined {
    if (!canContinue() && !canSignIn()) return undefined;
    return (
      <Switch>
        <Match when={canContinue()}>
          <Button
            type="button"
            size="sm"
            aria-label={t("chat.mcpSignIn.continueNamed", { name: props.name })}
            onClick={() => props.onContinue?.()}
          >
            {t("chat.mcpSignIn.continue")}
          </Button>
        </Match>
        <Match when={canSignIn()}>
          <Button
            type="button"
            variant={props.state === "signed-in" ? "outline" : "default"}
            size="sm"
            aria-label={t("chat.mcpSignIn.signInNamed", { name: props.name })}
            onClick={() => props.onSignIn?.()}
          >
            {t("chat.mcpSignIn.signIn")}
          </Button>
        </Match>
      </Switch>
    );
  }

  return (
    <UiBlockCard
      class="marketplace-suggestion"
      status={status()}
      outcome={outcome()}
      outcomeBadge
      inlineActions
      title={props.name}
      subtitle={props.address}
      icon={<PluginIcon iconUrl={null} fallback="plugin" class="ui-block-icon marketplace-suggestion-icon" />}
      actions={actionButtons()}
    >
      <Show when={props.state === "unavailable" && props.unavailableText}>
        <p class="marketplace-suggestion-unavailable">
          <Lock aria-hidden="true" />
          {props.unavailableText}
        </p>
      </Show>
    </UiBlockCard>
  );
}
