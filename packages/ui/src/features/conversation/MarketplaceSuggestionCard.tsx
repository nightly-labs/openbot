import { Button, Check, Lock, Spinner } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, createStore, createUniqueId, onCleanup, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { PluginIcon } from "../marketplace/PluginIcon";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

/** An app connects to a service. A skill installs on the agent. */
export type MarketplaceSuggestionKind = "app" | "skill";

/**
 * What the action of a skill card does: install a listing, save a new skill from the chat, or add
 * the chat's lesson to a skill the agent has.
 */
export type MarketplaceSuggestionSkillAction = "install" | "save" | "update";

/**
 * Where the suggested listing is for this user. `attention` is an app whose connection needs a new
 * sign-in. `unavailable` cannot be connected here, for example by a member of a joined server.
 */
export type MarketplaceSuggestionState = "available" | "busy" | "connected" | "attention" | "unavailable";

export interface MarketplaceSuggestionCardProps {
  kind: MarketplaceSuggestionKind;
  name: string;
  /** The line under the name: the listing tagline. */
  description: string;
  /**
   * The description is a question that the user answers with the action. It shows in full under the
   * name, and the action goes under it, so a long question keeps the width of the card.
   */
  fullDescription?: boolean;
  /** The action of a skill card. Install when absent. */
  skillAction?: MarketplaceSuggestionSkillAction;
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
  /* Skip and Undo replace each other, so the focus moves to the control that is there now. */
  let dismissButton: HTMLButtonElement | undefined;
  let undoButton: HTMLButtonElement | undefined;
  /* The action animates only a change that the user started here. A card that opens connected, or
     that reads its state late, shows the state with no motion. */
  const [moving, setMoving] = createSignal(false);
  // Several suggestions can be in one chat: each Skip says which one it skips.
  const nameId = createUniqueId();
  // A question shows in full in the body, and its action goes to the footer under it.
  const subtitle = () => (props.fullDescription ? undefined : props.description);
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
      <UiBlockCard
        class="marketplace-suggestion"
        // The action stays on the card when it is done: the same button turns into Connected.
        status="pending"
        inlineActions={!props.fullDescription}
        title={
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
        }
        subtitle={subtitle()}
        icon={
          <Show
            when={props.mark}
            fallback={
              <PluginIcon
                iconUrl={props.iconUrl}
                fallback={props.kind === "skill" ? "skill" : "plugin"}
                class="ui-block-icon marketplace-suggestion-icon"
              />
            }
          >
            {(mark) => <span class="ui-block-icon skills-marketplace-icon marketplace-suggestion-icon">{mark()}</span>}
          </Show>
        }
        actions={
          <Show when={suggestionControlsShown(props)}>
            {/* The controls carry the state and the motion flag for the stylesheet; they add no box. */}
            <span
              class="marketplace-suggestion-controls"
              data-state={props.state}
              data-motion={moving() ? "" : undefined}
            >
              {/* A connected card has nothing to skip. The stylesheet folds the button away, so the
                  action moves to the edge instead of a jump. */}
              <Show when={props.onDismiss}>
                <span id={nameId} hidden>
                  {props.name}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  class="ui-block-skip marketplace-suggestion-dismiss"
                  aria-describedby={nameId}
                  ref={(element) => (dismissButton = element)}
                  onClick={() => {
                    props.onDismiss?.();
                    onSettled(() => undoButton?.focus());
                  }}
                >
                  {t("uiBlock.skip")}
                </Button>
              </Show>
              <span class="marketplace-suggestion-action" role="status">
                <SuggestionAction {...props} onStart={() => setMoving(true)} />
              </span>
            </span>
          </Show>
        }
      >
        <Show when={props.fullDescription}>
          <p class="marketplace-suggestion-question">{props.description}</p>
        </Show>
        <Show when={props.state === "unavailable" && props.unavailableText}>
          <p class="marketplace-suggestion-unavailable">
            <Lock aria-hidden="true" />
            {props.unavailableText}
          </p>
        </Show>
      </UiBlockCard>
    </Show>
  );
}

/**
 * Connect or Install. The same button shows the busy step and then turns green with a check, so the
 * focus stays on it. Each label keeps its width, and the button takes the width of the label on screen.
 */
function SuggestionAction(props: MarketplaceSuggestionCardProps & { onStart: () => void }) {
  const { t } = useText();
  const app = () => props.kind === "app";
  const done = () => props.state === "connected";
  const busy = () => props.state === "busy";
  const startable = () => props.state === "available" || props.state === "attention";
  const shown = () => suggestionActionShown(props);
  const variant = () => (props.state === "attention" ? "outline" : "default");
  const skillAction = () => props.skillAction ?? "install";
  const label = () => {
    if (done()) return undefined;
    if (!app()) {
      if (skillAction() === "save") return t("chat.suggestion.saveNamed", { name: props.name });
      if (skillAction() === "update") return t("chat.suggestion.updateNamed", { name: props.name });
      return t("chat.suggestion.installNamed", { name: props.name });
    }
    return props.state === "attention"
      ? t("marketplace.app.reconnectNamed", { name: props.name })
      : t("marketplace.app.connectNamed", { name: props.name });
  };
  const text = () => {
    if (!app()) {
      if (skillAction() === "save") return t("chat.suggestion.save");
      if (skillAction() === "update") return t("chat.suggestion.update");
      return t("chat.suggestion.install");
    }
    return props.state === "attention" ? t("marketplace.app.reconnect") : t("marketplace.app.connect");
  };
  const doneText = () => {
    if (app()) return t("marketplace.app.connected");
    if (skillAction() === "save") return t("chat.suggestion.saved");
    if (skillAction() === "update") return t("chat.suggestion.updated");
    return t("chat.suggestion.installed");
  };
  const [widths, setWidths] = createStore({ start: 0, done: 0 });
  // `Show` builds the button again when it comes back, so a layer drops the observer of its old element.
  const observers: Partial<Record<"start" | "done", ResizeObserver>> = {};
  onCleanup(() => {
    observers.start?.disconnect();
    observers.done?.disconnect();
  });
  const measure = (layer: "start" | "done") => (element: HTMLElement) => {
    observers[layer]?.disconnect();
    const observer = new ResizeObserver(() =>
      setWidths((draft) => {
        draft[layer] = element.offsetWidth;
      }),
    );
    observer.observe(element);
    observers[layer] = observer;
  };
  // A busy or connected button does nothing, so it makes no tap sound, as a loading button does not.
  const tapCue = () => (startable() ? "" : undefined);
  const stageStyle = () => {
    const width = widths[done() ? "done" : "start"];
    return width > 0 ? { width: `${width}px` } : undefined;
  };
  return (
    <Show when={shown()}>
      <Button
        type="button"
        variant={variant()}
        size="sm"
        class="marketplace-suggestion-button"
        data-state={props.state}
        data-cuelume-tap={tapCue()}
        data-disabled={busy() ? "" : undefined}
        aria-busy={busy() ? "true" : undefined}
        aria-disabled={busy() || done() ? "true" : undefined}
        aria-label={label()}
        onClick={() => {
          if (!startable()) return;
          props.onStart();
          props.onConnect?.();
        }}
      >
        <span class="marketplace-suggestion-stage" style={stageStyle()}>
          <span
            class="marketplace-suggestion-layer"
            data-layer="start"
            ref={measure("start")}
            aria-hidden={done() ? "true" : undefined}
          >
            <span class="marketplace-suggestion-spinner">
              <Spinner size="sm" />
            </span>
            {text()}
          </span>
          <span
            class="marketplace-suggestion-layer"
            data-layer="done"
            ref={measure("done")}
            aria-hidden={done() ? undefined : "true"}
          >
            <Check aria-hidden="true" />
            {doneText()}
          </span>
        </span>
      </Button>
    </Show>
  );
}

/** The action shows when it is done, or when the user can start it here. */
function suggestionActionShown(props: MarketplaceSuggestionCardProps): boolean {
  return props.state === "connected" || Boolean(props.onConnect && props.state !== "unavailable");
}

/** The card has controls when it has Skip or an action: with none, a question card has no footer. */
function suggestionControlsShown(props: MarketplaceSuggestionCardProps): boolean {
  return Boolean(props.onDismiss) || suggestionActionShown(props);
}
