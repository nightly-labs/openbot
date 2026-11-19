import { Button, Lock } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { PluginIcon } from "../marketplace/PluginIcon";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

export type McpSignInCardState = "sign-in" | "signed-in" | "sent" | "unavailable";

export interface McpSignInCardProps {
  name: string;
  address: string;
  state: McpSignInCardState;
  unavailableText?: string;
  onSignIn?: (() => void) | undefined;
  onContinue?: (() => void) | undefined;
}

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
