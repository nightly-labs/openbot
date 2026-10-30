import { Button, ChevronRight, ErrorReference, IconButton, X } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { useText } from "@openbot/ui/text";
import { createEffect, For, Match, onCleanup, onSettled, Show, Switch } from "solid-js";
import { MarketplaceAgentPage } from "./MarketplaceAgentPage";
import { MarketplaceAppPage } from "./MarketplaceAppPage";
import { createBrowseLists, MarketplaceBrowse } from "./MarketplaceBrowse";
import { MarketplaceNav } from "./MarketplaceNav";
import { MarketplaceLocalSkillPage, MarketplaceSkillPage } from "./MarketplaceSkillPage";
import { SkillGroupPage } from "./MarketplaceSkills";
import { CATEGORY_LABELS, createMarketplaceListing } from "./marketplace-listing";
import type { MarketplaceModel } from "./marketplace-model";
import { createMovingNavigation } from "./marketplace-motion";
import {
  MARKETPLACE_TAB_LABEL,
  type MarketplaceNavigation,
  type MarketplaceScope,
  type MarketplaceView,
  sourceVerified,
} from "./marketplace-view";

export interface MarketplaceProps {
  model: MarketplaceModel;
  /** Where the user is. The caller owns it, so a link can open the window on an app page. */
  nav: MarketplaceNavigation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Translate = ReturnType<typeof useText>["t"];

function viewTitle(scope: MarketplaceScope, view: MarketplaceView, fallback: string, t: Translate): string {
  switch (view.kind) {
    case "browse":
      return fallback;
    case "agent":
    case "skill":
      return view.listing.name;
    case "app":
      return scope.model.apps().find((app) => app.id === view.id)?.name ?? fallback;
    case "skillGroup":
      return view.group === "yours" ? t("marketplace.skills.yours") : t(CATEGORY_LABELS[view.group]);
    case "localSkill":
      for (const agent of scope.model.agents()) {
        const skill = scope.model.installedSkill(agent.id, view.skillId);
        if (skill) return skill.name;
      }
      return fallback;
  }
}

/**
 * The path to the open page: Apps › GitHub. Each part of the path goes back to its view. The top row already has the
 * Back and Forward arrows of the chats, so the path is the way back here. A list has no path: the side panel names it.
 */
function MarketplaceHeader(props: { scope: MarketplaceScope }) {
  const { t } = useText();
  const stack = () => props.scope.nav.state.stack;
  const title = (view: MarketplaceView) =>
    viewTitle(props.scope, view, t(MARKETPLACE_TAB_LABEL[props.scope.nav.state.tab]), t);
  return (
    <nav class="marketplace-heading" aria-label={t("marketplace.crumbs.label")} hidden={stack().length < 2}>
      <For each={stack().slice(0, -1)}>
        {(view, index) => (
          <>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              class="marketplace-crumb-parent"
              data-cuelume-tap="navigate"
              onClick={() => props.scope.nav.backTo(index())}
            >
              {title(view)}
            </Button>
            <ChevronRight class="marketplace-crumb-separator" aria-hidden="true" />
          </>
        )}
      </For>
      <Show when={stack().length > 1}>
        <h2 class="marketplace-title" tabindex={-1}>
          {title(stack().at(-1) ?? { kind: "browse" })}
        </h2>
      </Show>
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
      // The Skills tab shows each category, and a group page has its own listing.
      category: () => null,
      verified: () => sourceVerified(nav.state.skillSource),
    }),
  };
  const lists = createBrowseLists(scope);
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
  // The side panel can replace the open view with another at the same depth, which is a new view too.
  createEffect(
    () => [nav.state.stack.length, nav.state.stack.at(-1)] as const,
    ([length, view], previous) => {
      if (previous === undefined) return;
      const [previousLength, previousView] = previous;
      if (length === previousLength && view === previousView) return;
      const place = length < previousLength ? places[length - 1] : undefined;
      // Back keeps the place it returns to. Another view at a depth starts with no place there.
      places.length = length < previousLength ? length : length - 1;
      body?.scrollTo({ top: place?.top ?? 0 });
      // A click in the side panel keeps the focus on the panel.
      if (document.activeElement?.closest(".marketplace-nav")) return;
      const opener = place?.opener
        ? body?.querySelector<HTMLElement>(`[aria-label="${CSS.escape(place.opener)}"]`)
        : null;
      const heading = length > 1 ? body?.querySelector<HTMLElement>(".marketplace-view h3") : null;
      if (heading && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
      (opener ?? heading ?? document.querySelector<HTMLElement>(".skills-marketplace .marketplace-nav-title"))?.focus({
        preventScroll: true,
      });
    },
  );
  // Another kind is a new list, so it starts at the top.
  createEffect(
    () => nav.state.tab,
    (_tab, previous) => {
      if (previous !== undefined) body?.scrollTo({ top: 0 });
    },
  );

  return (
    <>
      {/* The page rail is the way back from the page, so the top bar has no close button. */}
      <header class="skills-marketplace-topbar">
        <MarketplaceHeader scope={scope} />
      </header>
      <MarketplaceNav scope={scope} lists={lists} />
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
                  <MarketplaceBrowse scope={scope} lists={lists} />
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
                <Match when={view.kind === "skillGroup" && view.group} keyed>
                  {(group) => <SkillGroupPage scope={scope} group={group} />}
                </Match>
                <Match when={view.kind === "localSkill" && view.skillId} keyed>
                  {(skillId) => <MarketplaceLocalSkillPage scope={scope} skillId={skillId} />}
                </Match>
              </Switch>
            )}
          </Show>
        </div>
        <Show when={props.model.error()}>
          {(message) => (
            <div class="skills-marketplace-error">
              <span>
                {message()}
                <ErrorReference reference={props.model.errorReference?.()} />
              </span>
              <IconButton label={t("common.close")} variant="ghost" size="icon-sm" onClick={props.model.clearError}>
                <X />
              </IconButton>
            </div>
          )}
        </Show>
      </div>
      {/*
        The agents dialog of a skill hides the rest of the window from screen readers while it is
        open. It keeps an element with `data-live-announcer` visible, so the results are said from
        here.
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

/** The Marketplace: agents, apps and skills, and a page for each. It is a page of the window. */
export function Marketplace(props: MarketplaceProps) {
  // A closed window starts again from the first tab, with no search and no filter.
  createEffect(
    () => props.open,
    (open, previous) => {
      if (previous && !open) props.nav.reset();
    },
  );
  return (
    <Show when={props.open}>
      <MarketplacePage {...props} />
    </Show>
  );
}

/**
 * The open Marketplace page. The title takes the focus, as a new page does, and the control that
 * opened the page gets it back when the page closes with the focus in it. Escape goes back one view,
 * or else clears the search, or else closes the page. A view keeps the search but does not show it,
 * so the view goes back first. The handler is on the document and after the delegated handlers, so a
 * control that handles Escape keeps it. The focus can stay on the control that opened the page, so a
 * target outside the page also counts, except an open popup or a text field.
 */
function MarketplacePage(props: MarketplaceProps) {
  const { t } = useText();
  // Each view change of the open page moves in a view transition. The caller's navigation stays plain.
  const nav = createMovingNavigation(props.nav);
  let root!: HTMLElement;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  onSettled(() => {
    root.querySelector<HTMLElement>(".marketplace-nav-title")?.focus({ preventScroll: true });
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]")) return;
      if (target && !root.contains(target) && target.closest("input, textarea, select, [contenteditable]")) return;
      event.preventDefault();
      if (nav.state.stack.length > 1) nav.back();
      else if (nav.state.query)
        nav.set((draft) => {
          draft.query = "";
        });
      else props.onOpenChange(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      // A rail button that closed the page keeps the focus.
      const focus = document.activeElement;
      if (focus && focus !== document.body && !root.contains(focus)) return;
      // After the page leaves the DOM, unless the next page took the focus.
      queueMicrotask(() => {
        if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body)) {
          opener.focus({ preventScroll: true });
        }
      });
    };
  });
  return (
    <section ref={root} class="skills-marketplace skills-marketplace-page" aria-label={t("marketplace.title")}>
      <MarketplaceWindow model={props.model} nav={nav} open={props.open} onOpenChange={props.onOpenChange} />
    </section>
  );
}
