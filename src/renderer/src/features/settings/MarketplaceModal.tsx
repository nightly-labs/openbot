import { Marketplace } from "@openbot/ui/features/marketplace/Marketplace";
import { createMarketplaceNavigation } from "@openbot/ui/features/marketplace/marketplace-view";
import { McpKeyDialog } from "@openbot/ui/features/settings/McpKeyDialog";
import { McpLocalDialog } from "@openbot/ui/features/settings/McpLocalDialog";
import { McpSignInDialog } from "@openbot/ui/features/settings/McpSignInDialog";
import { PluginUninstallDialog } from "@openbot/ui/features/settings/PluginUninstallDialog";
import { createEffect, Match, Show, Switch, untrack } from "solid-js";
import { createMarketplaceController, type MarketplaceControllerProps } from "./marketplace-controller";

export interface MarketplaceModalProps extends MarketplaceControllerProps {
  /**
   * The listing an `openbot://plugins/<slug>` link asked for. It opens the app page; it never
   * connects, so what a link can do is show a user a listing they then decide about.
   */
  initialPluginSlug?: string | undefined;
  /**
   * Runs after the modal consumes `initialPluginSlug`. The owner clears the pending slug there, so
   * a second link to the same listing reads as a new request instead of no change.
   */
  onInitialPluginSlugConsumed?: (() => void) | undefined;
}

/** The Marketplace on this computer's or a joined server's data, with the dialogs it opens. */
export function MarketplaceModal(props: MarketplaceModalProps) {
  const nav = createMarketplaceNavigation();
  const controller = createMarketplaceController(props);

  createEffect(
    () => (props.open ? props.initialPluginSlug : undefined),
    (slug) => {
      if (!slug) return;
      // A link replaces the page on screen.
      nav.reset();
      nav.set((draft) => {
        draft.tab = "apps";
      });
      if (untrack(() => controller.model.apps().some((app) => app.id === slug))) nav.go({ kind: "app", id: slug });
      else
        nav.set((draft) => {
          draft.missingApp = slug;
        });
      // The page holds this listing now, so the owner forgets the link: the same slug arriving
      // again changes the signal from nothing, and this effect runs for it.
      untrack(() => props.onInitialPluginSlugConsumed)?.();
    },
  );

  /* GitHub joins the apps only when its status read ends. A link that came first opens its page then. */
  createEffect(
    () => {
      const slug = nav.state.missingApp;
      return slug && controller.model.apps().some((app) => app.id === slug) ? slug : null;
    },
    (slug) => {
      if (slug) nav.go({ kind: "app", id: slug });
    },
  );

  return (
    <>
      <Marketplace model={controller.model} nav={nav} open={props.open} onOpenChange={props.onOpenChange} />
      {/* The confirmation and the connect step are beside the Marketplace: each is one decision
          over the page it was started from, not a part of that page. */}
      <Show when={controller.uninstalling()} keyed>
        {(plugin) => (
          <PluginUninstallDialog
            open={true}
            plan={controller.uninstallPlan(plugin)}
            busy={controller.uninstallBusy(plugin)}
            onConfirm={() => void controller.uninstallPlugin(plugin)}
            onCancel={controller.cancelUninstall}
          />
        )}
      </Show>
      <Show when={controller.connecting()} keyed>
        {(pending) => (
          <Switch>
            <Match when={pending.flow.kind === "link"}>
              <McpSignInDialog
                open={true}
                subject={pending.subject}
                onTest={controller.testPluginApp}
                onConnected={(config) => pending.settle(config)}
                onCancel={() => pending.settle(null)}
              />
            </Match>
            <Match when={pending.flow.kind === "key" ? pending.flow : null} keyed>
              {(flow) => (
                <McpKeyDialog
                  open={true}
                  subject={pending.subject}
                  flow={flow}
                  onTest={controller.testPluginApp}
                  onConnected={(config) => pending.settle(config)}
                  onCancel={() => pending.settle(null)}
                  onOpenUrl={controller.openPluginUrl}
                  hostName={props.pluginHostName}
                />
              )}
            </Match>
            <Match when={pending.flow.kind === "local" ? pending.flow : null} keyed>
              {(flow) => (
                <McpLocalDialog
                  open={true}
                  subject={pending.subject}
                  flow={flow}
                  onTest={controller.testPluginApp}
                  onConnected={(config) => pending.settle(config)}
                  onCancel={() => pending.settle(null)}
                  onOpenUrl={controller.openPluginUrl}
                />
              )}
            </Match>
          </Switch>
        )}
      </Show>
    </>
  );
}
