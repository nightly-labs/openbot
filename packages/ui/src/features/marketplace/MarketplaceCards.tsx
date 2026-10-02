import type { MarketplaceAgentSummary, MarketplaceSkillSummary } from "@openbot/contracts/ipc";
import { Badge, Button, Heading, Plus, Text } from "@openbot/ui";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { For, Match, Show, Switch } from "solid-js";
import { InstallSkill } from "./MarketplaceInstallSkill";
import { AppLogo, Done, SkillMark } from "./MarketplaceParts";
import { CATEGORY_LABELS } from "./marketplace-listing";
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

function SkillCard(props: { scope: MarketplaceScope; skill: MarketplaceSkillSummary }) {
  const { t } = useText();
  const installs = useInstalls();
  const id = () => `marketplace-skill-${props.skill.id}`;
  return (
    <article class="marketplace-card" aria-labelledby={id()}>
      <Button
        type="button"
        variant="ghost"
        class="marketplace-hitarea"
        aria-label={t("marketplace.open", { name: props.skill.name })}
        onClick={() => props.scope.nav.go({ kind: "skill", listing: props.skill })}
      />
      <div class="marketplace-card-head">
        <SkillMark skill={props.skill} size="md" />
        <Heading as="h3" size="sm" class="marketplace-card-name" id={id()}>
          {props.skill.name}
        </Heading>
        <Show when={props.scope.model.agents().length > 0}>
          <div class="marketplace-card-action">
            <InstallSkill scope={props.scope} skill={props.skill} />
          </div>
        </Show>
      </div>
      <Text as="p" variant="body-sm" class="marketplace-card-body">
        {props.skill.description}
      </Text>
      <div class="marketplace-card-foot">
        <Text as="span" variant="caption" tone="muted">
          {[props.skill.creatorName, installs(props.skill.installs)].join(" · ")}
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
  /** A small button is outline in a list. The app page header uses the filled one. */
  variant?: "default";
  /** Outside the app's own page the button says which app: "Connect Linear". */
  named?: boolean;
  onConnected?: () => void;
}) {
  const { t } = useText();
  const model = () => props.scope.model;
  const attention = () => props.app.status === "attention";
  const label = () =>
    attention()
      ? t("marketplace.app.reconnectNamed", { name: props.app.name })
      : t("marketplace.app.connectNamed", { name: props.app.name });
  const connect = () => {
    const app = props.app;
    /* GitHub signs in with a device code. Its page owns that dialog, and opens it while the sign-in waits. */
    if (app.kind === "github") {
      const view = props.scope.nav.state.stack.at(-1);
      if (view?.kind !== "app" || view.id !== app.id) props.scope.nav.go({ kind: "app", id: app.id });
      model().github?.().onConnect();
      return;
    }
    /* 1Password can ask for an account or a token. Its page owns those choices. */
    if (app.kind === "onepassword") {
      props.scope.nav.go({ kind: "app", id: app.id });
      return;
    }
    void model()
      .connectApp(app)
      .then((connected) => {
        if (connected) props.onConnected?.();
      });
  };
  return (
    <Show
      when={props.app.status !== "connected"}
      fallback={
        <Show when={props.size}>
          <Done>{t("marketplace.app.connected")}</Done>
        </Show>
      }
    >
      {/* A custom server is turned on in Server settings › MCP, not here. */}
      <Show when={model().canConnectApps() && props.app.kind !== "custom"}>
        <Button
          type="button"
          variant={props.variant ?? (props.size ? "outline" : "default")}
          size={props.size}
          loading={model().appBusy(props.app.id)}
          aria-label={label()}
          onClick={connect}
        >
          {props.named ? label() : attention() ? t("marketplace.app.reconnect") : t("marketplace.app.connect")}
        </Button>
      </Show>
    </Show>
  );
}

/** The line under an app card: its category, or "MCP server" for a server that the user added. */
function appKind(app: MarketplaceApp) {
  return app.kind === "custom" ? ("marketplace.app.custom" as const) : CATEGORY_LABELS[app.category];
}

/** A connect moves the app to the apps that the user has, where its card is a new element. */
function focusCard(label: string) {
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>(`.skills-marketplace .marketplace-hitarea[aria-label="${CSS.escape(label)}"]`)
      ?.focus(),
  );
}

/** An app card, as on the Agents and Skills tabs. The card opens the app page; Connect sits above it. */
export function AppCard(props: { scope: MarketplaceScope; app: MarketplaceApp }) {
  const { t } = useText();
  const id = () => `marketplace-app-${props.app.id}`;
  const open = () => t("marketplace.open", { name: props.app.name });
  return (
    <article class="marketplace-card" aria-labelledby={id()}>
      <Button
        type="button"
        variant="ghost"
        class="marketplace-hitarea"
        aria-label={open()}
        onClick={() => props.scope.nav.go({ kind: "app", id: props.app.id })}
      />
      <div class="marketplace-card-head">
        <AppLogo app={props.app} />
        <Heading as="h4" size="sm" class="marketplace-card-name" id={id()}>
          {props.app.name}
        </Heading>
        <div class="marketplace-card-action">
          <AppAction scope={props.scope} app={props.app} size="sm" onConnected={() => focusCard(open())} />
        </div>
      </div>
      <Text as="p" variant="body-sm" class="marketplace-card-body">
        {props.app.tagline}
      </Text>
      <div class="marketplace-card-foot">
        <Text as="span" variant="caption" tone="muted">
          {t(appKind(props.app))}
        </Text>
      </div>
    </article>
  );
}

export function AgentGrid(props: { scope: MarketplaceScope; items: readonly MarketplaceAgentSummary[] }) {
  return (
    <div class="marketplace-grid">
      <For each={props.items}>{(listing) => <AgentCard scope={props.scope} listing={listing} />}</For>
    </div>
  );
}

export function SkillGrid(props: { scope: MarketplaceScope; items: readonly MarketplaceSkillSummary[] }) {
  return (
    <div class="marketplace-grid">
      <For each={props.items}>{(skill) => <SkillCard scope={props.scope} skill={skill} />}</For>
    </div>
  );
}
