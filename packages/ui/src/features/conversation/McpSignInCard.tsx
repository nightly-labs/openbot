import { Badge, Button, Check, Lock } from "@openbot/ui";
import { createUniqueId, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { PluginIcon } from "../marketplace/PluginIcon";

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
  const titleId = createUniqueId();
  return (
    <article class="conversation-interaction-card marketplace-suggestion" aria-labelledby={titleId}>
      <header class="marketplace-suggestion-header">
        <PluginIcon iconUrl={null} fallback="plugin" class="marketplace-suggestion-icon" />
        <div class="marketplace-suggestion-heading">
          <h3 id={titleId} class="marketplace-suggestion-title">
            {props.name}
          </h3>
          <span class="marketplace-suggestion-description">{props.address}</span>
        </div>
        <div class="marketplace-suggestion-action" role="status">
          <Switch>
            <Match when={props.state === "sent"}>
              <Badge variant="success-light" class="marketplace-suggestion-done">
                <Check aria-hidden="true" />
                {t("chat.mcpSignIn.signedIn")}
              </Badge>
            </Match>
            <Match when={props.state === "signed-in" && props.onContinue}>
              <Button
                type="button"
                size="sm"
                aria-label={t("chat.mcpSignIn.continueNamed", { name: props.name })}
                onClick={() => props.onContinue?.()}
              >
                {t("chat.mcpSignIn.continue")}
              </Button>
            </Match>
            <Match when={props.state !== "unavailable" && props.onSignIn}>
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
        </div>
      </header>
      <Show when={props.state === "unavailable" && props.unavailableText}>
        <p class="marketplace-suggestion-unavailable">
          <Lock aria-hidden="true" />
          {props.unavailableText}
        </p>
      </Show>
    </article>
  );
}
