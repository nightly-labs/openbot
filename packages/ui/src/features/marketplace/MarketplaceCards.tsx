import type { MarketplaceAgentSummary } from "@openbot/contracts/ipc";
import { Badge, Button, Heading, Plus, Text, TriangleAlert } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { For, Match, Show, Switch } from "solid-js";
import { AppLogo, Done } from "./MarketplaceParts";
import type { MarketplaceApp } from "./marketplace-model";
import type { MarketplaceScope } from "./marketplace-view";

/** "1,204 installs", in the reader's number format. */
export function useInstalls() {
  const { t, format } = useText();
  return (count: number) => t("marketplace.installs", { count, installs: format.number(count) });
}

/**
 * "Add", then "Added", or "Update available" when the user has an older version. Add keeps the
 * Marketplace open. The button is then gone, so `onAdded` gives the focus a new place.
 */
function AgentState(props: { scope: MarketplaceScope; listing: MarketplaceAgentSummary; onAdded: () => void }) {
  const { t } = useText();
  const model = () => props.scope.model;
  return (
    <Switch>
      <Match when={model().agentState(props.listing) === "add"}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={model().agentBusy(props.listing.id)}
          aria-label={t("marketplace.agent.addNamed", { name: props.listing.name })}
          onClick={() =>
            void model()
              .addAgent(props.listing)
              .then((added) => {
                if (added) props.onAdded();
              })
          }
        >
          <Plus aria-hidden="true" />
          {t("marketplace.agent.add")}
        </Button>
      </Match>
      <Match when={model().agentState(props.listing) === "added"}>
        <Done>{t("marketplace.agent.added")}</Done>
      </Match>
      <Match when={model().agentState(props.listing) === "update"}>
        <Badge variant="info-light">{t("marketplace.agent.updateAvailable")}</Badge>
      </Match>
    </Switch>
  );
}

/** The whole card opens the agent page. "Add" sits above the hit area and adds at once. */
function AgentCard(props: { scope: MarketplaceScope; listing: MarketplaceAgentSummary }) {
  const { t } = useText();
  const installs = useInstalls();
  const id = () => `marketplace-agent-${props.listing.id}`;
  let hit: HTMLButtonElement | undefined;
  return (
    <article class="marketplace-card" aria-labelledby={id()}>
      <Button
        type="button"
        variant="ghost"
        class="marketplace-hitarea"
        data-cuelume-tap="navigate"
        ref={(element) => (hit = element)}
        aria-label={t("marketplace.open", { name: props.listing.name })}
        onClick={() => props.scope.nav.go({ kind: "agent", listing: props.listing })}
      />
      <div class="marketplace-card-head">
        <span class="marketplace-avatar" data-size="md">
          <AgentAvatar agent={props.listing} motion="hover" />
        </span>
        <Heading as="h3" size="sm" class="marketplace-card-name" id={id()}>
          {props.listing.name}
        </Heading>
        <div class="marketplace-card-action">
          <AgentState scope={props.scope} listing={props.listing} onAdded={() => hit?.focus()} />
        </div>
      </div>
      <Text as="p" variant="body-sm" class="marketplace-card-body">
        {props.listing.description}
      </Text>
      <div class="marketplace-card-foot">
        <Text as="span" variant="caption" tone="muted">
          {[props.listing.creatorName, installs(props.listing.installs)].join(" · ")}
        </Text>
      </div>
    </article>
  );
}

/**
 * "Connect", or "Reconnect" for an app that needs attention. A connected app shows "Connected" in a
 * list; its page shows the status in the header instead. A connect removes this button, so
 * `onConnected` gives the focus a new place.
 */
export function AppAction(props: {
  scope: MarketplaceScope;
  app: MarketplaceApp;
  size?: "sm";
  /**
   * In a list, the button has an icon: a plus, or a warning for an app that needs attention. A
   * connected app shows "Connected" there. The app page header uses the filled button, and its status
   * already says "Connected".
   */
  variant?: "default";
  /** Outside the app's own page the button says which app: "Connect Linear". */
  named?: boolean;
  onConnected?: () => void;
}) {
  const { t } = useText();
  const model = () => props.scope.model;
  const attention = () => props.app.status === "attention";
  const list = () => props.size !== undefined && props.variant === undefined;
  /** The app of a plugin whose server refused its saved sign-in. The button then signs in to it again. */
  const refused = () => {
    const app = props.app;
    return app.kind === "plugin" ? app.plugin.apps.find((entry) => app.connections[entry.id]?.signInNeeded) : undefined;
  };
  const label = () => {
    const app = refused();
    if (app) return t("marketplace.app.signInTitle", { name: app.name });
    return attention()
      ? t("marketplace.app.reconnectNamed", { name: props.app.name })
      : t("marketplace.app.connectNamed", { name: props.app.name });
  };
  /** The short text of the button, when it does not name the app. */
  const shortLabel = () => {
    if (refused()) return t("provider.account.signInAgain");
    return attention() ? t("marketplace.app.reconnect") : t("marketplace.app.connect");
  };
  const connect = () => {
    const app = props.app;
    /* A connector's page owns its dialogs: the GitHub device code, a password manager's setup. A
       connector with a one-click connect starts it there. One that needs attention opens its page, which
       says what to fix. A connector shows "idle" before its first read, so it connects only after it. */
    if (app.kind === "connector") {
      const view = props.scope.nav.state.stack.at(-1);
      if (view?.kind !== "app" || view.id !== app.id) props.scope.nav.go({ kind: "app", id: app.id });
      const connector = model().connector(app.connector);
      if (app.status === "idle" && connector?.ready()) connector.connect?.();
      return;
    }
    if (app.kind !== "plugin") return;
    // An app whose server refused its sign-in signs in again; nothing else of the plugin changes.
    const entry = refused();
    const done = entry ? model().reconnectApp(app, entry.id) : model().connectApp(app);
    void done.then((connected) => {
      if (connected) props.onConnected?.();
    });
  };
  const variant = () => {
    if (props.variant) return props.variant;
    if (!props.size) return "default";
    return attention() ? "outline" : "secondary";
  };
  return (
    <Show
      when={props.app.status !== "connected"}
      fallback={
        <Show when={list()}>
          <Done>{t("marketplace.app.connected")}</Done>
        </Show>
      }
    >
      {/* A custom server is turned on in Server settings › MCP, not here. The Apps tab lists only the
          connectors that this account can connect. */}
      <Show when={props.app.kind === "connector" || (props.app.kind === "plugin" && model().canConnectApps())}>
        <Button
          type="button"
          variant={variant()}
          size={props.size}
          class={list() ? "marketplace-app-action" : undefined}
          data-status={props.app.status}
          loading={model().appBusy(props.app.id) || props.app.status === "connecting"}
          aria-label={label()}
          onClick={connect}
        >
          <Show when={list() && !model().appBusy(props.app.id) && props.app.status !== "connecting"}>
            <Show when={attention()} fallback={<Plus aria-hidden="true" />}>
              <TriangleAlert aria-hidden="true" />
            </Show>
          </Show>
          {props.named ? label() : shortLabel()}
        </Button>
      </Show>
    </Show>
  );
}

/** A connect moves the app into "Your apps", and the button is then gone. The row keeps the focus. */
function focusRow(label: string) {
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>(`.skills-marketplace .marketplace-app-row-hit[aria-label="${CSS.escape(label)}"]`)
      ?.focus(),
  );
}

/** An app in the list: its logo, name and one line, and its status. The row opens the app page. */
export function AppRow(props: { scope: MarketplaceScope; app: MarketplaceApp }) {
  const { t } = useText();
  const open = () => t("marketplace.open", { name: props.app.name });
  return (
    <li class="marketplace-app-row">
      <Button
        type="button"
        variant="ghost"
        class="marketplace-app-row-hit"
        data-cuelume-tap="navigate"
        aria-label={open()}
        onClick={() => props.scope.nav.go({ kind: "app", id: props.app.id })}
      />
      <AppLogo app={props.app} />
      <span class="marketplace-app-row-copy">
        <span class="marketplace-app-row-name">{props.app.name}</span>
        <span class="marketplace-app-row-tagline">{props.app.tagline}</span>
      </span>
      <span class="marketplace-app-row-status">
        <AppAction scope={props.scope} app={props.app} size="sm" onConnected={() => focusRow(open())} />
      </span>
    </li>
  );
}

export function AgentGrid(props: { scope: MarketplaceScope; items: readonly MarketplaceAgentSummary[] }) {
  return (
    <div class="marketplace-grid">
      <For each={props.items}>{(listing) => <AgentCard scope={props.scope} listing={listing} />}</For>
    </div>
  );
}
