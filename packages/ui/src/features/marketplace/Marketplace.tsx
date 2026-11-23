import { ErrorReference, IconButton, X } from "@openbot/ui";
import { createScrollFades } from "@openbot/ui/components/createScrollFades";
import { PageHeader, type PageHeaderParent } from "@openbot/ui/features/window/PageHeader";
import { useText } from "@openbot/ui/text";
import { holdFlag } from "@openbot/ui/utils";
import { createEffect, Match, onCleanup, onSettled, Show, Switch } from "solid-js";
import { MarketplaceAgentPage } from "./MarketplaceAgentPage";
import { AgentGroupPage } from "./MarketplaceAgents";
import { MarketplaceAppPage, MarketplaceServerPage } from "./MarketplaceAppPage";
import { AppGroupPage, createBrowseLists, MarketplaceBrowse } from "./MarketplaceBrowse";
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
    case "agentGroup":
    case "appGroup":
      return t(CATEGORY_LABELS[view.category]);
    case "app":
      return scope.model.apps().find((app) => app.id === view.id)?.name ?? fallback;
    case "skillGroup":
      return view.group === "yours" ? t("marketplace.skills.yours") : t(CATEGORY_LABELS[view.group]);
    case "server":
      return view.id === null ? t("mcp.panel.connectTitle") : t("mcp.panel.editTitle");
    case "localSkill":
      for (const agent of scope.model.agents()) {
        const skill = scope.model.installedSkill(agent.id, view.skillId);
        if (skill) return skill.name;
      }
      return fallback;
  }
}

function MarketplaceHeader(props: { scope: MarketplaceScope }) {
  const { t } = useText();
  const stack = () => props.scope.nav.state.stack;
  const title = (view: MarketplaceView) =>
    viewTitle(props.scope, view, t(MARKETPLACE_TAB_LABEL[props.scope.nav.state.tab]), t);
  const parents = (): PageHeaderParent[] =>
    stack()
      .slice(0, -1)
      .map((view, index) => ({ title: title(view), onSelect: () => props.scope.nav.backTo(index) }));
  const current = () => title(stack().at(-1) ?? { kind: "browse" });
  return (
    <Show when={stack().length > 1}>
      <PageHeader
        class="marketplace-heading"
        title={current()}
        path={parents()}
        pathLabel={t("marketplace.crumbs.label")}
      />
    </Show>
  );
}

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
      category: () => null,
      verified: () => sourceVerified(nav.state.agentSource),
    }),
    skills: createMarketplaceListing({
      list: (query) => props.model.listSkills(query),
      homeCache: props.model.skillHomeCache,
      query: () => nav.state.query,
      category: () => null,
      verified: () => sourceVerified(nav.state.skillSource),
    }),
  };
  const lists = createBrowseLists(scope);
  let body: HTMLDivElement | undefined;
  const fades = createScrollFades();
  const frameObserver = new ResizeObserver(() => fades.measure());
  onCleanup(() => {
    fades.stop();
    frameObserver.disconnect();
  });
  const places: { top: number; opener: string | null }[] = [];
  const remember = (place: Partial<(typeof places)[number]>) => {
    const depth = nav.state.stack.length - 1;
    places[depth] = { top: 0, opener: null, ...places[depth], ...place };
  };
  createEffect(
    () => [nav.state.stack.length, nav.state.stack.at(-1)] as const,
    ([length, view], previous) => {
      if (previous === undefined) return;
      const [previousLength, previousView] = previous;
      if (length === previousLength && view === previousView) return;
      const place = length < previousLength ? places[length - 1] : undefined;
      places.length = length < previousLength ? length : length - 1;
      body?.scrollTo({ top: place?.top ?? 0 });
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
  createEffect(
    () => nav.state.tab,
    (_tab, previous) => {
      if (previous !== undefined) body?.scrollTo({ top: 0 });
    },
  );

  return (
    <>
      <div class="skills-marketplace-topbar">
        <MarketplaceHeader scope={scope} />
      </div>
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
                <Match when={view.kind === "agent" && view} keyed>
                  {(agent) => <MarketplaceAgentPage scope={scope} listing={agent.listing} detail={agent.detail} />}
                </Match>
                <Match when={view.kind === "agentGroup" && view.category} keyed>
                  {(category) => <AgentGroupPage scope={scope} category={category} />}
                </Match>
                <Match when={view.kind === "skill" && view.listing} keyed>
                  {(listing) => <MarketplaceSkillPage scope={scope} listing={listing} />}
                </Match>
                <Match when={view.kind === "appGroup" && view.category} keyed>
                  {(category) => <AppGroupPage scope={scope} category={category} />}
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
                <Match when={view.kind === "server" && view} keyed>
                  {(server) => <MarketplaceServerPage scope={scope} id={server.id} />}
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
      <p class="marketplace-visually-hidden" role="status" data-live-announcer="">
        {props.model.notice()}
      </p>
      <p class="marketplace-visually-hidden" role="alert" data-live-announcer="">
        {props.model.error()}
      </p>
    </>
  );
}

export function Marketplace(props: MarketplaceProps) {
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

function MarketplacePage(props: MarketplaceProps) {
  const { t } = useText();
  const nav = createMovingNavigation(props.nav);
  let root!: HTMLElement;
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  onCleanup(holdFlag(document.body, "skills-marketplace"));
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
      const focus = document.activeElement;
      if (focus && focus !== document.body && !root.contains(focus)) return;
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
