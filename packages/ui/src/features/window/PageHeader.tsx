import { ArrowLeft, Button, ChevronRight, IconButton, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For, onSettled, Show, untrack } from "solid-js";

export interface PageHeaderParent {
  title: string;
  onSelect: () => void;
}

export type PageHeaderFrame = "window";

export function PageHeader(props: {
  title: string;
  hostName?: string | undefined;
  headingId?: string | undefined;
  onBack?: (() => void) | undefined;
  path?: readonly PageHeaderParent[] | undefined;
  pathLabel?: string | undefined;
  frame?: PageHeaderFrame | undefined;
  headingRef?: ((heading: HTMLHeadingElement) => void) | undefined;
  class?: string | undefined;
  children?: JSX.Element;
}) {
  const { t } = useText();
  let heading: HTMLHeadingElement | undefined;
  onSettled(() => {
    if (untrack(() => props.onBack)) heading?.focus();
  });
  const inWindow = () => props.frame === "window";
  const back = () => (inWindow() ? undefined : props.onBack);
  const close = () => (inWindow() ? props.onBack : undefined);
  onSettled(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      const action = close();
      if (!action || event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  });
  const hostName = () => (inWindow() ? undefined : props.hostName);
  const hasPath = () => (props.path?.length ? "" : undefined);
  const identity = () => (
    <>
      <Show when={back()}>
        {(goBack) => (
          <IconButton
            class="page-header-back"
            variant="ghost"
            label={t("common.back")}
            data-cuelume-tap="navigate"
            onClick={() => goBack()()}
          >
            <ArrowLeft />
          </IconButton>
        )}
      </Show>
      <For each={props.path}>
        {(parent) => (
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              class="page-header-parent"
              data-cuelume-tap="navigate"
              onClick={() => parent.onSelect()}
            >
              {parent.title}
            </Button>
            <ChevronRight class="page-header-separator" aria-hidden="true" />
          </>
        )}
      </For>
      <h2
        id={props.headingId}
        class="page-header-title"
        ref={(element) => {
          heading = element;
          props.headingRef?.(element);
        }}
        tabindex={-1}
      >
        {props.title}
        <Show when={hostName()}>
          {(host) => (
            <span class="page-header-host">
              {" "}
              <span aria-hidden="true">/</span> {host()}
            </span>
          )}
        </Show>
      </h2>
    </>
  );
  return (
    <header class={props.class ? `page-header ${props.class}` : "page-header"}>
      <Show
        when={props.pathLabel}
        fallback={
          <div class="page-header-identity" data-path={hasPath()}>
            {identity()}
          </div>
        }
      >
        {(label) => (
          <nav class="page-header-identity" aria-label={label()} data-path={hasPath()}>
            {identity()}
          </nav>
        )}
      </Show>
      {props.children}
      <Show when={close()}>
        {(closePage) => (
          <IconButton
            class="page-header-close"
            variant="ghost"
            label={t("common.close")}
            data-cuelume-tap="close"
            onClick={() => closePage()()}
          >
            <X />
          </IconButton>
        )}
      </Show>
    </header>
  );
}
