import { ArrowLeft, Button, ChevronRight, IconButton } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import type { JSX } from "@solidjs/web";
import { For, onSettled, Show, untrack } from "solid-js";

/** A page above the open one in its path, such as `Providers` before `ChatGPT`. */
export interface PageHeaderParent {
  title: string;
  /** Goes back to this page. */
  onSelect: () => void;
}

/**
 * Where the header shows. In the top row of the app window (`window.css`), the page rail is the way
 * back and the server menu names the server, so the header has no Back button and no server name.
 */
export type PageHeaderFrame = "window";

/**
 * The header of a full page, such as Tasks, Usage and Schedule: an optional Back button, the title
 * with the server name after it, and the controls of the page at the end. A page that opens from a
 * list, such as one provider in Settings or one app in the Marketplace, shows the path to it before
 * the title.
 */
export function PageHeader(props: {
  title: string;
  /** The server that the page shows. It follows the title. */
  hostName?: string | undefined;
  /** The `id` of the heading, for `aria-labelledby` of the page. */
  headingId?: string | undefined;
  /** With a way back, the header shows Back, and the heading takes focus when the page opens. */
  onBack?: (() => void) | undefined;
  /** The pages above this one, first to last. Each one is a button that goes back to it. */
  path?: readonly PageHeaderParent[] | undefined;
  /** The name of the path for screen readers. With it, the path is a navigation landmark. */
  pathLabel?: string | undefined;
  frame?: PageHeaderFrame | undefined;
  /** Lets the page move focus to the heading. */
  headingRef?: ((heading: HTMLHeadingElement) => void) | undefined;
  class?: string | undefined;
  /** The controls at the end of the header. */
  children?: JSX.Element;
}) {
  const { t } = useText();
  let heading: HTMLHeadingElement | undefined;
  onSettled(() => {
    if (untrack(() => props.onBack)) heading?.focus();
  });
  const inWindow = () => props.frame === "window";
  const back = () => (inWindow() ? undefined : props.onBack);
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
    </header>
  );
}
