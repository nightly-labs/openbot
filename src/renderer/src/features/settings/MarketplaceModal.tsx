import { Marketplace } from "@openbot/ui/features/marketplace/Marketplace";
import { createMarketplaceNavigation } from "@openbot/ui/features/marketplace/marketplace-view";
import { McpKeyDialog } from "@openbot/ui/features/settings/McpKeyDialog";
import { McpLocalDialog } from "@openbot/ui/features/settings/McpLocalDialog";
import { McpSignInDialog } from "@openbot/ui/features/settings/McpSignInDialog";
import { PluginUninstallDialog } from "@openbot/ui/features/settings/PluginUninstallDialog";
import { createEffect, createSignal, Match, Show, Switch, untrack } from "solid-js";
import { createMarketplaceController, type MarketplaceControllerProps } from "./marketplace-controller";

export interface MarketplaceModalProps extends MarketplaceControllerProps {
  /**
   * The listing an `openbot://plugins/<slug>` link or a chat suggestion asked for. It opens the app
   * page; a link never connects, so what a link can do is show a user a listing they then decide
   * about.
   */
  initialPluginSlug?: string | undefined;
  /**
   * The person pressed Connect for `initialPluginSlug` on a chat suggestion card, so the page starts
   * the connect step with its sign-in and approval dialogs. An agent cannot set it.
   */
  initialPluginConnect?: boolean | undefined;
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
  /**
   * A Connect press from a chat card. It runs when the listing is in the apps and their states are
   * read, so an installed app is not installed again.
   */
  const [connectWhenReady, setConnectWhenReady] = createSignal<string | null>(null);
  const startConnect = (slug: string) => {
    const model = controller.model;
    const app = model.apps().find((candidate) => candidate.id === slug);
    if (!app || app.status === "connected") return;
    // GitHub signs in with a device code, and its page, which is open now, shows that dialog.
    if (app.kind === "github") model.github?.().onConnect();
    else if (app.kind === "plugin" && model.canConnectApps()) void model.connectApp(app);
  };

  createEffect(
    () => (props.open ? props.initialPluginSlug : undefined),
    (slug) => {
      if (!slug) return;
      // A link replaces the page on screen.
      nav.reset();
      nav.set((draft) => {
        draft.tab = "apps";
      });
      setConnectWhenReady(untrack(() => props.initialPluginConnect) === true ? slug : null);
      if (untrack(() => controller.model.apps().some((app) => app.id === slug))) {
        nav.go({ kind: "app", id: slug });
      } else {
        nav.set((draft) => {
          draft.missingApp = slug;
        });
      }
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

  createEffect(
    () => {
      const slug = connectWhenReady();
      if (!slug) return null;
      return controller.appStatesRead() && controller.model.apps().some((app) => app.id === slug) ? slug : null;
    },
    (slug) => {
      if (!slug) return;
      setConnectWhenReady(null);
      untrack(() => startConnect(slug));
    },
  );
  /* A Connect press ends with the window, so a later open does not connect. */
  createEffect(
    () => props.open,
    (open) => {
      if (!open) setConnectWhenReady(null);
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
