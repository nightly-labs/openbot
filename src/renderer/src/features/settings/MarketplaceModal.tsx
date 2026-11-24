import type { MarketplaceListingLink } from "@openbot/contracts/marketplace-links";
import { ConfirmDialog } from "@openbot/ui";
import { AgentUpdateDialog } from "@openbot/ui/features/marketplace/AgentUpdateDialog";
import { Marketplace } from "@openbot/ui/features/marketplace/Marketplace";
import type { MarketplaceApp } from "@openbot/ui/features/marketplace/marketplace-model";
import { createMarketplaceNavigation } from "@openbot/ui/features/marketplace/marketplace-view";
import { McpConnectDialog } from "@openbot/ui/features/settings/McpConnectDialog";
import { McpSignInPageDialog, McpSignInRelayDialog } from "@openbot/ui/features/settings/McpSignInPage";
import { PluginUninstallDialog } from "@openbot/ui/features/settings/PluginUninstallDialog";
import { useText } from "@openbot/ui/text";
import { createEffect, createSignal, Show, untrack } from "solid-js";
import { McpServerControls } from "../servers/McpServerControls";
import { McpServerForm } from "../servers/McpServerForm";
import {
  createMarketplaceController,
  type MarketplaceControllerProps,
  type PendingSkillConfirm,
} from "./marketplace-controller";

export interface MarketplaceModalProps extends MarketplaceControllerProps {
  initialPluginSlug?: string | undefined;
  initialPluginConnect?: boolean | undefined;
  onInitialPluginSlugConsumed?: (() => void) | undefined;
  initialListing?: MarketplaceListingLink | undefined;
  onInitialListingConsumed?: (() => void) | undefined;
}

export function MarketplaceModal(props: MarketplaceModalProps) {
  const { t } = useText();
  const nav = createMarketplaceNavigation();
  const controller = createMarketplaceController(props, (tools) => ({
    form: (form) => <McpServerForm tools={tools} id={form.id} onClose={form.onClose} />,
    controls: (controls) => <McpServerControls tools={tools} id={controls.id} />,
  }));
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
  const [connectWhenReady, setConnectWhenReady] = createSignal<string | null>(null);
  const startConnect = (slug: string) => {
    const model = controller.model;
    const app = model.apps().find((candidate) => candidate.id === slug);
    if (!app || app.status === "connected") return;
    if (app.kind === "connector") {
      if (app.status === "idle") model.connector(app.connector)?.connect?.();
    } else if (app.kind === "x") nav.go({ kind: "app", id: app.id, setup: true });
    else if (app.kind === "plugin" && model.canConnectApps()) void model.connectApp(app);
  };

  createEffect(
    () => (props.open ? props.initialPluginSlug : undefined),
    (slug) => {
      if (!slug) return;
      nav.reset();
      setConnectWhenReady(untrack(() => props.initialPluginConnect) === true ? slug : null);
      if (untrack(() => controller.model.apps().some((app) => app.id === slug))) {
        nav.go({ kind: "app", id: slug });
      } else {
        nav.set((draft) => {
          draft.missingApp = slug;
        });
      }
      untrack(() => props.onInitialPluginSlugConsumed)?.();
    },
  );

  let listingRequest = 0;
  createEffect(
    () => (props.open ? props.initialListing : undefined),
    (link) => {
      if (!link) return;
      listingRequest += 1;
      const request = listingRequest;
      nav.reset();
      untrack(() => props.onInitialListingConsumed)?.();
      void controller.readListing(link).then((listing) => {
        if (request !== listingRequest) return;
        if (listing?.kind === "agent")
          nav.show("agents", { kind: "agent", listing: listing.detail, detail: listing.detail });
        else if (listing?.kind === "skill") nav.show("skills", { kind: "skill", listing: listing.skill });
        else
          nav.set((draft) => {
            draft.tab = link.kind === "agent" ? "agents" : "skills";
            draft.missingListing = link.kind;
          });
      });
    },
  );

  createEffect(
    () => {
      const id = props.open ? props.mcpSignInRequest : undefined;
      return id ? controller.mcpServerApp(id) : undefined;
    },
    (app) => {
      if (app === undefined) return;
      const view = untrack(() => nav.state.stack.at(-1));
      if (!app || view?.kind !== "app" || view.id !== app) {
        nav.reset();
        if (app) nav.go({ kind: "app", id: app });
      }
      if (app?.startsWith("custom:")) return;
      const id = untrack(() => props.mcpSignInRequest);
      if (app && id) queueMicrotask(() => controller.signInPluginServer(id));
      untrack(() => props.onMcpSignInRequestHandled)?.();
    },
  );

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
  createEffect(
    () => (props.open ? props.connectors?.available() : undefined),
    (controllers) => {
      const stops = (controllers ?? []).map((connector) => connector.watch());
      return () => {
        for (const stop of stops) stop();
      };
    },
  );
  createEffect(
    () => props.open,
    (open) => {
      if (open) return;
      setConnectWhenReady(null);
      listingRequest += 1;
    },
  );

  return (
    <>
      <Marketplace model={controller.model} nav={nav} open={props.open} onOpenChange={props.onOpenChange} />
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
      <Show when={controller.serverReplace()} keyed>
        {(replace) => (
          <ConfirmDialog
            open={true}
            onCancel={() => replace.settle(false)}
            onConfirm={() => replace.settle(true)}
            title={t("marketplace.app.replace.title", { server: replace.server })}
            description={t("marketplace.app.replace.description", { server: replace.server, name: replace.app })}
            confirmLabel={t("marketplace.app.replace.action")}
            initialFocus="cancel"
          />
        )}
      </Show>
      <Show when={controller.agentUpdate()} keyed>
        {(pending) => (
          <AgentUpdateDialog
            agentName={pending.agentName}
            changed={pending.changed}
            othersCount={pending.othersCount}
            onCancel={() => pending.settle(null)}
            onConfirm={(replaceSkillIds) => pending.settle(replaceSkillIds)}
          />
        )}
      </Show>
      <Show when={controller.connecting()} keyed>
        {(pending) => (
          <McpConnectDialog
            subject={pending.subject}
            flows={pending.flows}
            onTest={controller.testPluginApp}
            onSignIn={controller.signInPluginApp}
            onConnected={(config) => pending.settle(config)}
            onCancel={() => pending.settle(null)}
            onOpenUrl={controller.openPluginUrl}
            hostName={props.pluginHostName}
            signInHostName={props.pluginSignInRelay ? props.pluginHostName : undefined}
            onCancelSignIn={controller.cancelSignIn}
            onCopySignInLink={props.pluginHostName ? undefined : controller.copySignInLink()}
            onPasteSignInAddress={props.pluginHostName ? undefined : controller.pasteSignInAddress()}
            signInExtra={
              <>
                <Show when={controller.signInHostPage()} keyed>
                  {(page) => (
                    <McpSignInPageDialog
                      name={pending.subject.name}
                      iconUrl={pending.subject.iconUrl}
                      hostName={props.pluginHostName ?? ""}
                      page={page}
                      onCancel={controller.cancelSignIn}
                    />
                  )}
                </Show>
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
              </>
            }
          />
        )}
      </Show>
    </>
  );
}
