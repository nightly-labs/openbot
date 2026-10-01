import { pluginLinkText } from "@openbot/contracts/plugin-links";
import {
  Button,
  ExternalLink,
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2,
  Plug,
  SettingsSection,
  Text,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { GitHubConnectorPanel } from "../settings/GitHubConnectorPanel";
import { DangerZone, DetailHeader, WizardDialog } from "../settings/IntegrationLayout";
import { AppAction } from "./MarketplaceCards";
import { AppMark, TryCard } from "./MarketplaceParts";
import { CATEGORY_LABELS } from "./marketplace-listing";
import type { MarketplaceApp, MarketplaceAppStatus } from "./marketplace-model";
import { type MarketplaceScope, serverAddress } from "./marketplace-view";
import { PluginIcon } from "./PluginIcon";

type PluginApp = Extract<MarketplaceApp, { kind: "plugin" }>;
type CustomApp = Extract<MarketplaceApp, { kind: "custom" }>;

const STATUS_LABEL = {
  connected: "marketplace.app.connected",
  attention: "marketplace.app.attention",
  idle: "marketplace.app.notConnected",
} as const satisfies Record<MarketplaceAppStatus, string>;

function PluginAppPage(props: { scope: MarketplaceScope; app: PluginApp }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const plugin = () => props.app.plugin;
  /* The name a reader hears carries the visible host, so the row is not three times "Open link". */
  const links = () =>
    [
      { label: t("plugin.link.website"), url: plugin().websiteUrl },
      { label: t("plugin.link.privacyPolicy"), url: plugin().privacyPolicyUrl },
      { label: t("plugin.link.terms"), url: plugin().termsUrl },
    ].flatMap((link) => (link.url ? [{ label: link.label, url: link.url, text: pluginLinkText(link.url) }] : []));
  const runPrompt = () => {
    const run = model().runPrompt;
    if (!run) return undefined;
    return (id: string) => {
      const prompt = plugin().prompts.find((entry) => entry.id === id);
      if (prompt) run(prompt);
    };
  };

  return (
    <>
      <DetailHeader
        logo={<AppMark app={props.app} />}
        name={props.app.name}
        status={props.app.status}
        statusLabel={t(STATUS_LABEL[props.app.status])}
        subtitle={props.app.tagline}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => model().copyLink(plugin().slug)}>
              <Link2 aria-hidden="true" />
              {t("plugin.copyLink")}
            </Button>
            <AppAction scope={props.scope} app={props.app} />
          </>
        }
      />
      <Show when={plugin().prompts.length > 0}>
        <TryCard
          seed={plugin().name}
          chip={{ kind: "plugin", name: plugin().name, icon: <AppMark app={props.app} /> }}
          requests={plugin().prompts}
          tryLabel={(prompt) => t("plugin.askPrompt", { name: plugin().name, prompt })}
          onTry={runPrompt()}
        />
      </Show>
      <Text as="p" variant="body-sm">
        {plugin().description}
      </Text>
      <Show when={plugin().apps.length > 0}>
        <SettingsSection title={t("plugin.section.apps")}>
          <ItemGroup class="settings-modal-card">
            <For each={plugin().apps}>
              {(app) => (
                <Item class="settings-modal-row">
                  <ItemMedia>
                    <PluginIcon iconUrl={app.iconUrl} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{app.name}</ItemTitle>
                    <ItemDescription>{app.description}</ItemDescription>
                  </ItemContent>
                </Item>
              )}
            </For>
          </ItemGroup>
        </SettingsSection>
      </Show>
      <Show when={plugin().skills.length > 0}>
        <SettingsSection title={t("plugin.section.skills")}>
          <ItemGroup class="settings-modal-card">
            <For each={plugin().skills}>
              {(skill) => (
                <Item class="settings-modal-row">
                  <ItemMedia>
                    <PluginIcon iconUrl={null} fallback="skill" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{skill.slug}</ItemTitle>
                    <ItemDescription>{skill.description}</ItemDescription>
                  </ItemContent>
                </Item>
              )}
            </For>
          </ItemGroup>
        </SettingsSection>
      </Show>
      <SettingsSection title={t("plugin.section.information")}>
        {/* `dt` and `dd` stay direct children of the list: axe rejects a wrapper per row. */}
        <dl class="marketplace-props marketplace-info">
          <dt>
            <Text as="span" variant="caption" tone="muted">
              {t("plugin.info.developer")}
            </Text>
          </dt>
          <dd>
            <Text as="span" variant="body-sm">
              {plugin().creatorName}
            </Text>
          </dd>
          <dt>
            <Text as="span" variant="caption" tone="muted">
              {t("plugin.info.category")}
            </Text>
          </dt>
          <dd>
            <Text as="span" variant="body-sm">
              {t(CATEGORY_LABELS[plugin().category])}
            </Text>
          </dd>
          <dt>
            <Text as="span" variant="caption" tone="muted">
              {t("plugin.info.version")}
            </Text>
          </dt>
          <dd>
            <Text as="span" variant="body-sm">
              {plugin().version}
            </Text>
          </dd>
          <For each={links()}>
            {(link) => (
              <>
                <dt>
                  <Text as="span" variant="caption" tone="muted">
                    {link.label}
                  </Text>
                </dt>
                <dd>
                  <Button
                    type="button"
                    variant="link"
                    class="marketplace-link"
                    aria-label={`${link.label}: ${link.text}`}
                    onClick={() => model().openUrl(link.url)}
                  >
                    {link.text}
                    <ExternalLink aria-hidden="true" />
                  </Button>
                </dd>
              </>
            )}
          </For>
        </dl>
      </SettingsSection>
      <Show when={props.app.status !== "idle" && model().canConnectApps()}>
        <DangerZone
          title={t("marketplace.app.disconnect.title")}
          description={t("marketplace.app.disconnect.description", { name: props.app.name })}
          action={t("marketplace.app.disconnect.action")}
          busy={model().appBusy(props.app.id)}
          onAction={() => model().disconnectApp(props.app)}
        />
      </Show>
    </>
  );
}

/** An MCP server that the user added, and that no catalog app claims. */
function CustomServerPage(props: { scope: MarketplaceScope; app: CustomApp }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const [confirm, setConfirm] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const remove = () => {
    setBusy(true);
    void model()
      .removeServer(props.app.server.id)
      .then((removed) => {
        setBusy(false);
        if (!removed) return;
        setConfirm(false);
        props.scope.nav.back();
      });
  };
  return (
    <>
      <DetailHeader
        logo={<Plug aria-hidden="true" />}
        name={props.app.name}
        status={props.app.status}
        statusLabel={t(STATUS_LABEL[props.app.status])}
        subtitle={t("marketplace.app.custom")}
      />
      <SettingsSection title={t("marketplace.app.server")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>
                {t(props.app.server.transport === "stdio" ? "marketplace.app.command" : "marketplace.app.address")}
              </ItemTitle>
              <ItemDescription>
                <code class="marketplace-command">{serverAddress(props.app.server)}</code>
              </ItemDescription>
            </ItemContent>
          </Item>
        </ItemGroup>
      </SettingsSection>
      <Show when={model().canConnectApps()}>
        <DangerZone
          title={t("marketplace.app.remove.title")}
          description={t("marketplace.app.remove.description")}
          action={t("marketplace.app.remove.action")}
          onAction={() => setConfirm(true)}
        />
      </Show>
      <WizardDialog
        open={confirm()}
        closeLabel={t("common.close")}
        dismissible={!busy()}
        onClose={() => {
          if (!busy()) setConfirm(false);
        }}
        logo={<Plug aria-hidden="true" />}
        link="broken"
        title={t("marketplace.app.remove.confirmTitle", { name: props.app.name })}
        description={t("marketplace.app.remove.description")}
        footer={
          <>
            <Button type="button" variant="outline" disabled={busy()} onClick={() => setConfirm(false)}>
              {t("marketplace.app.remove.keep")}
            </Button>
            <Button type="button" variant="destructive" loading={busy()} onClick={remove}>
              {t("marketplace.app.remove.action")}
            </Button>
          </>
        }
      />
    </>
  );
}

/** The page of one app: the GitHub connector, a catalog app, or a server that the user added. */
export function MarketplaceAppPage(props: { scope: MarketplaceScope; id: string }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const app = () =>
    model()
      .apps()
      .find((entry) => entry.id === props.id);
  const github = () => (app()?.kind === "github" ? model().github : undefined);
  const plugin = () => {
    const current = app();
    return current?.kind === "plugin" ? current : undefined;
  };
  const custom = () => {
    const current = app();
    return current?.kind === "custom" ? current : undefined;
  };
  return (
    <div class="marketplace-view marketplace-app-page">
      <Switch
        fallback={
          <div class="marketplace-empty" role="alert">
            <Text as="p" variant="body-sm" tone="muted">
              {t("marketplace.plugins.missing")}
            </Text>
          </div>
        }
      >
        <Match when={github()}>
          {(panel) => {
            const current = () => panel()();
            return (
              <GitHubConnectorPanel
                status={current().status}
                busy={current().busy}
                repositories={current().repositories}
                repositoriesError={current().repositoriesError}
                onConnect={() => current().onConnect()}
                onCancel={() => current().onCancel()}
                onDisconnect={() => current().onDisconnect()}
                onOpenVerification={() => current().onOpenVerification()}
                onOpenInstall={() => current().onOpenInstall()}
              />
            );
          }}
        </Match>
        <Match when={plugin()}>{(current) => <PluginAppPage scope={props.scope} app={current()} />}</Match>
        <Match when={custom()}>{(current) => <CustomServerPage scope={props.scope} app={current()} />}</Match>
      </Switch>
    </div>
  );
}
