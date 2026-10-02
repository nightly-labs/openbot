import { Badge, Button, Check, IconButton, Lock, X } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createUniqueId, Match, onSettled, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { PluginIcon } from "../marketplace/PluginIcon";

/** An app connects to a service. A skill installs on the agent. */
export type MarketplaceSuggestionKind = "app" | "skill";

/**
 * Where the suggested listing is for this user. `attention` is an app whose connection needs a new
 * sign-in. `unavailable` cannot be connected here, for example by a member of a joined server.
 */
export type MarketplaceSuggestionState = "available" | "busy" | "connected" | "attention" | "unavailable";

export interface MarketplaceSuggestionCardProps {
  kind: MarketplaceSuggestionKind;
  name: string;
  /** The one line under the name: the listing tagline. */
  description: string;
  iconUrl: string | null;
  /** Drawn instead of the icon: the mark of an app with no listing icon, such as GitHub. */
  mark?: JSX.Element | undefined;
  state: MarketplaceSuggestionState;
  /** Why the user cannot connect it here. Shown under the header when `unavailable`. */
  unavailableText?: string;
  /** The user dismissed the card. It stays as one line with Undo. */
  dismissed?: boolean;
  /** Runs the connect or install step. The approval and sign-in dialogs stay in the consumer. */
  onConnect?: (() => void) | undefined;
  /** Opens the listing in Marketplace. */
  onOpenDetails?: (() => void) | undefined;
  onDismiss?: () => void;
  onRestore?: () => void;
}

/**
 * A Marketplace app or skill that an agent suggests in a conversation. The user connects it from
 * the chat, opens its listing, or dismisses it.
 */
export function MarketplaceSuggestionCard(props: MarketplaceSuggestionCardProps) {
  const { t } = useText();
  const titleId = createUniqueId();
  /* Dismiss and Undo replace each other, so the focus moves to the control that is there now. */
  let dismissButton: HTMLButtonElement | undefined;
  let undoButton: HTMLButtonElement | undefined;
  return (
    <Show
      when={!props.dismissed}
      fallback={
        <div class="marketplace-suggestion-dismissed">
          <span role="status">{t("chat.suggestion.dismissed", { name: props.name })}</span>
          <Show when={props.onRestore}>
            <Button
              variant="ghost"
              size="xs"
              type="button"
              ref={(element) => (undoButton = element)}
              onClick={() => {
                props.onRestore?.();
                onSettled(() => dismissButton?.focus());
              }}
            >
              {t("chat.suggestion.undo")}
            </Button>
          </Show>
        </div>
      }
    >
      <article class="conversation-interaction-card marketplace-suggestion" aria-labelledby={titleId}>
        <header class="marketplace-suggestion-header">
          <Show
            when={props.mark}
            fallback={
              <PluginIcon
                iconUrl={props.iconUrl}
                fallback={props.kind === "skill" ? "skill" : "plugin"}
                class="marketplace-suggestion-icon"
              />
            }
          >
            {(mark) => <span class="skills-marketplace-icon marketplace-suggestion-icon">{mark()}</span>}
          </Show>
          <div class="marketplace-suggestion-heading">
            <h3 id={titleId} class="marketplace-suggestion-title">
              <Show when={props.onOpenDetails} fallback={props.name}>
                <Button
                  variant="link"
                  type="button"
                  class="marketplace-suggestion-name"
                  aria-label={t("chat.suggestion.detailsNamed", { name: props.name })}
                  onClick={() => props.onOpenDetails?.()}
                >
                  {props.name}
                </Button>
              </Show>
            </h3>
            <span class="marketplace-suggestion-description">{props.description}</span>
          </div>
          <div class="marketplace-suggestion-action" role="status">
            <SuggestionAction {...props} />
          </div>
          <Show when={props.onDismiss && props.state !== "connected"}>
            <IconButton
              label={t("chat.suggestion.dismissNamed", { name: props.name })}
              variant="ghost"
              size="icon-xs"
              ref={(element) => (dismissButton = element)}
              onClick={() => {
                props.onDismiss?.();
                onSettled(() => undoButton?.focus());
              }}
            >
              <X />
            </IconButton>
          </Show>
        </header>
        <Show when={props.state === "unavailable" && props.unavailableText}>
          <p class="marketplace-suggestion-unavailable">
            <Lock aria-hidden="true" />
            {props.unavailableText}
          </p>
        </Show>
      </article>
    </Show>
  );
}

/** Connect or Install, or the connected badge. */
function SuggestionAction(props: MarketplaceSuggestionCardProps) {
  const { t } = useText();
  const app = () => props.kind === "app";
  const label = () => {
    if (!app()) return t("chat.suggestion.installNamed", { name: props.name });
    return props.state === "attention"
      ? t("marketplace.app.reconnectNamed", { name: props.name })
      : t("marketplace.app.connectNamed", { name: props.name });
  };
  const text = () => {
    if (!app()) return t("chat.suggestion.install");
    return props.state === "attention" ? t("marketplace.app.reconnect") : t("marketplace.app.connect");
  };
  return (
    <Switch>
      <Match when={props.state === "connected"}>
        <Badge variant="success-light" class="marketplace-suggestion-done">
          <Check aria-hidden="true" />
          {app() ? t("marketplace.app.connected") : t("chat.suggestion.installed")}
        </Badge>
      </Match>
      <Match when={props.onConnect && props.state !== "unavailable"}>
        <Button
          type="button"
          variant={props.state === "attention" ? "outline" : "default"}
          size="sm"
          loading={props.state === "busy"}
          aria-label={label()}
          onClick={() => props.onConnect?.()}
        >
          {text()}
        </Button>
      </Match>
    </Switch>
  );
}
