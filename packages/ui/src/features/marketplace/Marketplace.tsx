import { Button, ChevronRight, Dialog, IconButton, X } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { useText } from "@openbot/ui/text";
import { createEffect, For, Match, onCleanup, Show, Switch } from "solid-js";
import { MarketplaceAgentPage } from "./MarketplaceAgentPage";
import { MarketplaceAppPage } from "./MarketplaceAppPage";
import { MarketplaceBrowse } from "./MarketplaceBrowse";
import { MarketplaceSkillPage } from "./MarketplaceSkillPage";
import { createMarketplaceListing } from "./marketplace-listing";
import type { MarketplaceModel } from "./marketplace-model";
import type { MarketplaceNavigation, MarketplaceScope, MarketplaceView } from "./marketplace-view";

export interface MarketplaceProps {
  model: MarketplaceModel;
  /** Where the user is. The caller owns it, so a link can open the window on an app page. */
  nav: MarketplaceNavigation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function viewTitle(scope: MarketplaceScope, view: MarketplaceView, fallback: string): string {
  switch (view.kind) {
    case "browse":
      return fallback;
    case "agent":
    case "skill":
      return view.listing.name;
    case "app":
      return scope.model.apps().find((app) => app.id === view.id)?.name ?? fallback;
  }
}

/** Marketplace › Linear. A parent crumb goes back to that view. */
function Crumbs(props: { scope: MarketplaceScope }) {
  const { t } = useText();
  const stack = () => props.scope.nav.state.stack;
  const title = (view: MarketplaceView) => viewTitle(props.scope, view, t("marketplace.title"));
  return (
    <nav class="marketplace-crumbs" aria-label={t("marketplace.crumbs.label")}>
      <For each={stack().slice(0, -1)}>
        {(view, index) => (
          <>
            <Button
              type="button"
              variant="ghost"
              class="marketplace-crumb-parent"
              onClick={() => props.scope.nav.backTo(index())}
            >
              {title(view)}
            </Button>
            <ChevronRight class="marketplace-crumb-separator" aria-hidden="true" />
          </>
        )}
      </For>
      <Dialog.Title class="marketplace-title" tabindex={-1}>
        {title(stack().at(-1) ?? { kind: "browse" })}
      </Dialog.Title>
    </nav>
  );
}

/**
 * The inside of the open window. The listings live here, so the catalog loads only while the window
 * is open.
 */
function MarketplaceWindow(props: MarketplaceProps) {
  const { t } = useText();
  const nav = props.nav;
  const scope: MarketplaceScope = {
    get model() {
      return props.model;
    },
    nav,
    agents: createMarketplaceListing({
      list: (query) => props.model.listAgents(query),
      homeCache: props.model.agentHomeCache,
      query: () => nav.state.query,
      category: () => nav.state.agentCategory,
    }),
    skills: createMarketplaceListing({
      list: (query) => props.model.listSkills(query),
      homeCache: props.model.skillHomeCache,
      query: () => nav.state.query,
      category: () => nav.state.skillCategory,
    }),
  };
  let body: HTMLDivElement | undefined;
  // A tab, a search or a new view changes the content height but not the body size, so the frame
  // is observed too.
  const fades = createScrollFades();
  const frameObserver = new ResizeObserver(() => fades.measure());
  onCleanup(() => {
    fades.stop();
    frameObserver.disconnect();
  });
  // For each open view: its scroll offset, and the name of the control the user last clicked, which
  // opened the next view. Back returns to that place and that control.
  const places: { top: number; opener: string | null }[] = [];
  const remember = (place: Partial<(typeof places)[number]>) => {
    const depth = nav.state.stack.length - 1;
    places[depth] = { top: 0, opener: null, ...places[depth], ...place };
  };
  // A new view moves the focus to its name, as a route change does. The first view keeps the focus.
  createEffect(
    () => nav.state.stack.length,
    (length, previous) => {
      if (previous === undefined) return;
      const place = length < previous ? places[length - 1] : undefined;
      places.length = length;
      body?.scrollTo({ top: place?.top ?? 0 });
      const opener = place?.opener
        ? body?.querySelector<HTMLElement>(`[aria-label="${CSS.escape(place.opener)}"]`)
        : null;
      const heading = length > 1 ? body?.querySelector<HTMLElement>(".marketplace-view h3") : null;
      if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      (opener ?? heading ?? document.querySelector<HTMLElement>(".skills-marketplace .marketplace-title"))?.focus({
        preventScroll: true,
      });
    },
  );

  return (
    <>
      <header class="skills-marketplace-topbar">
        <Crumbs scope={scope} />
        <div class="skills-marketplace-topbar-actions">
          <IconButton label={t("marketplace.close")} variant="ghost" onClick={() => props.onOpenChange(false)}>
            <X />
          </IconButton>
        </div>
      </header>
      <div
        class={["skills-marketplace-body", fades.classes()]}
        ref={(element) => {
          body = element;
          fades.bind(element);
          element.addEventListener(
            "click",
            (event) => {
              const control = event.target instanceof Element ? event.target.closest("[aria-label]") : null;
              remember({ opener: control && element.contains(control) ? control.getAttribute("aria-label") : null });
            },
            true,
          );
        }}
        onScroll={() => {
          fades.measure();
          if (body) remember({ top: body.scrollTop });
        }}
      >
        <div class="marketplace-frame" ref={(element) => frameObserver.observe(element)}>
          <Show when={nav.state.stack.at(-1)} keyed>
            {(view) => (
              <Switch>
                <Match when={view.kind === "browse"}>
                  <MarketplaceBrowse scope={scope} />
                </Match>
                <Match when={view.kind === "agent" && view.listing} keyed>
                  {(listing) => <MarketplaceAgentPage scope={scope} listing={listing} />}
                </Match>
                <Match when={view.kind === "skill" && view.listing} keyed>
                  {(listing) => <MarketplaceSkillPage scope={scope} listing={listing} />}
                </Match>
                <Match when={view.kind === "app" && view.id} keyed>
                  {(id) => <MarketplaceAppPage scope={scope} id={id} />}
                </Match>
              </Switch>
            )}
          </Show>
        </div>
        <Show when={props.model.error()}>
          {(message) => (
            <div class="skills-marketplace-error">
              <span>{message()}</span>
              <IconButton label={t("common.close")} variant="ghost" size="icon-sm" onClick={props.model.clearError}>
                <X />
              </IconButton>
            </div>
          )}
        </Show>
      </div>
      {/*
        The skill install menu stays open while installs run, and an open menu hides the rest of the
        window from screen readers. It keeps an element with `data-live-announcer` visible, so the
        results are said from here.
      */}
      <p class="marketplace-visually-hidden" role="status" data-live-announcer="">
        {props.model.notice()}
      </p>
      <p class="marketplace-visually-hidden" role="alert" data-live-announcer="">
        {props.model.error()}
      </p>
    </>
  );
}

/** The Marketplace window: agents, apps and skills, and a page for each. */
export function Marketplace(props: MarketplaceProps) {
  // A closed window starts again from the first tab, with no search and no filter.
  createEffect(
    () => props.open,
    (open, previous) => {
      if (previous && !open) props.nav.reset();
    },
  );
  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay class="skills-marketplace-backdrop">
          <Dialog.Content class="skills-marketplace" onOpenAutoFocus={(event: Event) => event.preventDefault()}>
            <MarketplaceWindow {...props} />
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
