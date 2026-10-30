import { ConfirmDialog } from "@openbot/ui";
import { Marketplace } from "@openbot/ui/features/marketplace/Marketplace";
import type { MarketplaceApp } from "@openbot/ui/features/marketplace/marketplace-model";
import { createMarketplaceNavigation } from "@openbot/ui/features/marketplace/marketplace-view";
import { McpConnectDialog } from "@openbot/ui/features/settings/McpConnectDialog";
import { McpSignInRelayDialog } from "@openbot/ui/features/settings/McpSignInPage";
import { PluginUninstallDialog } from "@openbot/ui/features/settings/PluginUninstallDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import {
  createMarketplaceController,
  type MarketplaceControllerProps,
  type PendingSkillConfirm,
} from "./marketplace-controller";

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
  const { t } = useText();
  const nav = createMarketplaceNavigation();
  const controller = createMarketplaceController(props);
  const skillConfirmTitle = (confirm: PendingSkillConfirm) =>
    t(confirm.kind === "replace" ? "skill.confirm.replaceTitle" : "skill.confirm.removeTitle");
  const skillConfirmBody = (confirm: PendingSkillConfirm) =>
    `${t(confirm.kind === "replace" ? "skill.confirm.replaceBody" : "skill.confirm.removeModifiedBody")} ${t(
      "skill.marketplace.confirmAgents",
      { agents: confirm.agents },
    )}`;
  const skillConfirmLabel = (confirm: PendingSkillConfirm) =>
    t(confirm.kind === "replace" ? "skill.confirm.replace" : "skill.confirm.remove");
  const skillConfirmTone = (confirm: PendingSkillConfirm) => (confirm.kind === "replace" ? "default" : "destructive");
  /**
   * A Connect press from a chat card. It runs when the listing is in the apps and their states are
   * read, so an installed app is not installed again.
   */
  const [connectWhenReady, setConnectWhenReady] = createSignal<string | null>(null);
  const startConnect = (slug: string) => {
    const model = controller.model;
    const app = model.apps().find((candidate) => candidate.id === slug);
    if (!app || app.status === "connected") return;
    // A connector's page, which is open now, shows its dialogs, such as GitHub's device code.
    if (app.kind === "connector") {
      if (app.status === "idle") model.connector(app.connector)?.connect?.();
    } else if (app.kind === "plugin" && model.canConnectApps()) void model.connectApp(app);
  };

  createEffect(
    () => (props.open ? props.initialPluginSlug : undefined),
    (slug) => {
      if (!slug) return;
      // A link replaces the page on screen. The page opens on Apps.
      nav.reset();
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
      // A connector shows "idle" before its first read, so a connected one could connect again.
      const read = (app: MarketplaceApp) =>
        app.kind !== "connector" || controller.model.connector(app.connector)?.ready() === true;
      return controller.appStatesRead() && controller.model.apps().some((app) => app.id === slug && read(app))
        ? slug
        : null;
    },
    (slug) => {
      if (!slug) return;
      setConnectWhenReady(null);
      untrack(() => startConnect(slug));
    },
  );
  // Slack, Discord and Telegram change with no event from main, so each available connector is
  // followed while the window is open.
  createEffect(
    () => (props.open ? props.connectors?.available() : undefined),
    (controllers) => {
      const stops = (controllers ?? []).map((connector) => connector.watch());
      return () => {
        for (const stop of stops) stop();
      };
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
      <Show when={controller.skillConfirm()} keyed>
        {(confirm) => (
          <ConfirmDialog
            open={true}
            onCancel={() => confirm.settle(false)}
            onConfirm={() => confirm.settle(true)}
            title={skillConfirmTitle(confirm)}
            description={skillConfirmBody(confirm)}
            tone={skillConfirmTone(confirm)}
            confirmLabel={skillConfirmLabel(confirm)}
            initialFocus="cancel"
          />
        )}
      </Show>
      <Show when={controller.connecting()} keyed>
        {(pending) => (
          <McpConnectDialog
            subject={pending.subject}
            flow={pending.flow}
            onTest={controller.testPluginApp}
            onSignIn={controller.signInPluginApp}
            onConnected={(config) => pending.settle(config)}
            onCancel={() => pending.settle(null)}
            onOpenUrl={controller.openPluginUrl}
            hostName={props.pluginHostName}
            signInHostName={props.pluginSignInRelay ? props.pluginHostName : undefined}
            onCancelSignIn={controller.cancelSignIn}
            signInExtra={
              /* The page opens in this computer's browser; the paste field is the way back when the
                 browser cannot reach this computer's listener. */
              <Show when={controller.signInRelayed()} keyed>
                {(relay) => (
                  <McpSignInRelayDialog
                    name={pending.subject.name}
                    iconUrl={pending.subject.iconUrl}
                    hostName={props.pluginHostName ?? ""}
                    page={relay.page}
                    onOpen={controller.openSignInRelay}
                    onPaste={controller.pasteSignInRelay}
                    onCancel={controller.cancelSignIn}
                  />
                )}
              </Show>
            }
          />
        )}
      </Show>
    </>
  );
}
