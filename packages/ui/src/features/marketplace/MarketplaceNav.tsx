import { Blocks, BookOpen, Bot, Button, TriangleAlert } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Dynamic } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { BrowseLists } from "./MarketplaceBrowse";
import { AppMark } from "./MarketplaceParts";
import {
  MARKETPLACE_TAB_LABEL,
  MARKETPLACE_TABS,
  type MarketplaceScope,
  type MarketplaceTab,
  ownedApps,
} from "./marketplace-view";

const TAB_ICON = { apps: Blocks, agents: Bot, skills: BookOpen } as const;

/**
 * The side panel of the Marketplace, as the settings page has: the kinds, then the apps that the user connected. While
 * a search runs, each kind shows how many rows match. A connected app opens its page.
 *
 * One row is selected: the app of "Your apps" whose page shows, otherwise the kind of the list or of the page.
 */
export function MarketplaceNav(props: { scope: MarketplaceScope; lists: BrowseLists }) {
  const { t } = useText();
  const nav = () => props.scope.nav;
  const top = () => nav().state.stack.at(-1);
  const yours = () => ownedApps(props.scope.model.apps());
  const appCurrent = (id: string) => {
    const view = top();
    return view?.kind === "app" && view.id === id ? ("page" as const) : undefined;
  };
  /** The kind of an app, agent or skill page stays selected, as the section that holds the page. */
  const kindCurrent = (tab: MarketplaceTab) => {
    const view = top();
    if (nav().state.tab !== tab || !view) return undefined;
    if (view.kind === "browse") return "page" as const;
    if (view.kind === "app" && yours().some((app) => app.id === view.id)) return undefined;
    return "location" as const;
  };
  return (
    <aside class="marketplace-nav" aria-labelledby="marketplace-nav-title">
      <h2 id="marketplace-nav-title" class="marketplace-nav-title" tabindex={-1}>
        {t("marketplace.title")}
      </h2>
      <nav aria-label={t("marketplace.kinds")}>
        <ul class="settings-modal-nav marketplace-nav-list">
          <For each={MARKETPLACE_TABS}>
            {(tab) => (
              <li>
                <Button
                  type="button"
                  variant="ghost"
                  class="settings-modal-nav-item marketplace-nav-item"
                  data-cuelume-tap="select"
                  aria-current={kindCurrent(tab)}
                  onClick={() => nav().show(tab)}
                >
                  <Dynamic component={TAB_ICON[tab]} aria-hidden="true" />
                  <span>{t(MARKETPLACE_TAB_LABEL[tab])}</span>
                  <Show when={props.lists.searching()}>
                    <span class="marketplace-nav-count">{props.lists.countLabel(tab)}</span>
                  </Show>
                </Button>
              </li>
            )}
          </For>
        </ul>
      </nav>
      <Show when={yours().length > 0}>
        <section class="marketplace-nav-group" aria-labelledby="marketplace-nav-yours">
          <h3 id="marketplace-nav-yours" class="marketplace-nav-heading">
            {t("marketplace.app.yourApps")}
          </h3>
          <ul class="settings-modal-nav marketplace-nav-list">
            <For each={yours()} keyed={(app) => app.id}>
              {(app) => (
                <li>
                  <Button
                    type="button"
                    variant="ghost"
                    class="settings-modal-nav-item marketplace-nav-item marketplace-nav-app"
                    data-cuelume-tap="navigate"
                    aria-current={appCurrent(app().id)}
                    onClick={() => nav().show("apps", { kind: "app", id: app().id })}
                  >
                    <span class="marketplace-nav-mark">
                      <AppMark app={app()} />
                    </span>
                    <span class="marketplace-nav-name">{app().name}</span>
                    <Show when={app().status === "attention"}>
                      <TriangleAlert class="marketplace-nav-warning" aria-hidden="true" />
                      <span class="marketplace-visually-hidden">{t("marketplace.app.attention")}</span>
                    </Show>
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </aside>
  );
}
