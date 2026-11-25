import { Button, Check, Lock, Spinner } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, createStore, createUniqueId, onCleanup, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { PluginIcon } from "../marketplace/PluginIcon";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

export type MarketplaceSuggestionKind = "app" | "skill";

export type MarketplaceSuggestionSkillAction = "install" | "save" | "update";

export type MarketplaceSuggestionState = "available" | "busy" | "connected" | "attention" | "unavailable";

export interface MarketplaceSuggestionCardProps {
  kind: MarketplaceSuggestionKind;
  name: string;
  description: string;
  fullDescription?: boolean;
  skillAction?: MarketplaceSuggestionSkillAction;
  saving?: boolean;
  iconUrl: string | null;
  mark?: JSX.Element | undefined;
  state: MarketplaceSuggestionState;
  unavailableText?: string;
  dismissed?: boolean;
  onConnect?: (() => void) | undefined;
  onOpenDetails?: (() => void) | undefined;
  onDismiss?: () => void;
  onRestore?: () => void;
}

export function MarketplaceSuggestionCard(props: MarketplaceSuggestionCardProps) {
  const { t } = useText();
  let dismissButton: HTMLButtonElement | undefined;
  let undoButton: HTMLButtonElement | undefined;
  const [moving, setMoving] = createSignal(false);
  const nameId = createUniqueId();
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
            <span
              class="marketplace-suggestion-controls"
              data-state={props.state}
              data-motion={moving() ? "" : undefined}
            >
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
      const saving = busy() && props.saving === true;
      if (skillAction() === "save") return saving ? t("chat.suggestion.saving") : t("chat.suggestion.save");
      if (skillAction() === "update") return saving ? t("chat.suggestion.updating") : t("chat.suggestion.update");
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

function suggestionActionShown(props: MarketplaceSuggestionCardProps): boolean {
  return props.state === "connected" || Boolean(props.onConnect && props.state !== "unavailable");
}

function suggestionControlsShown(props: MarketplaceSuggestionCardProps): boolean {
  return Boolean(props.onDismiss) || suggestionActionShown(props);
}
