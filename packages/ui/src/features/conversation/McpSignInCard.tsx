import { Button, CircleCheck, Lock } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { PluginIcon } from "../marketplace/PluginIcon";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

export type McpSignInCardState =
  | "sign-in"
  | "checking"
  | "signed-in"
  | "not-needed"
  | "sent"
  | "not-needed-sent"
  | "unavailable";

export interface McpSignInCardProps {
  name: string;
  address: string;
  state: McpSignInCardState;
  unavailableText?: string;
  notNeededText?: string;
  onSignIn?: (() => void) | undefined;
  onContinue?: (() => void) | undefined;
}

export function McpSignInCard(props: McpSignInCardProps) {
  const { t } = useText();
  const sent = () => props.state === "sent" || props.state === "not-needed-sent";
  const notNeeded = () => props.state === "not-needed" || props.state === "not-needed-sent";
  const canContinue = () =>
    (props.state === "signed-in" || props.state === "not-needed") && props.onContinue !== undefined;
  const canSignIn = () => props.state !== "unavailable" && !notNeeded() && props.onSignIn !== undefined;
  const status = () => (sent() ? "answered" : "pending");
  const outcome = () => {
    if (props.state === "not-needed-sent") return t("chat.mcpSignIn.notNeededOutcome");
    return sent() ? t("chat.mcpSignIn.signedIn") : undefined;
  };

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
            disabled={props.state === "checking"}
            aria-busy={props.state === "checking" ? "true" : undefined}
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
      <Show when={notNeeded() && props.notNeededText}>
        <p class="marketplace-suggestion-unavailable">
          <CircleCheck aria-hidden="true" />
          {props.notNeededText}
        </p>
      </Show>
    </UiBlockCard>
  );
}
