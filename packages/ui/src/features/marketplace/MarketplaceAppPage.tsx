import { mcpFlowFields } from "@openbot/contracts/mcp-connect-flows";
import { pluginLinkText } from "@openbot/contracts/plugin-links";
import type { AppTextKey } from "@openbot/i18n";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  Link2,
  Plug,
  SettingsSection,
  SwitchField,
  Text,
  TriangleAlert,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Match, Show, Switch } from "solid-js";
import { type ConnectorDetail, ConnectorDetailPanel, connectorDescription } from "../connectors/ConnectorDetailPanel";
import type { ConnectorId } from "../connectors/connectors";
import { DangerZone, IntegrationPage, StatusPill, WizardDialog } from "../settings/IntegrationLayout";
import type { MarketplacePluginApp } from "../settings/marketplace-plugins";
import { AppAction } from "./MarketplaceCards";
import { AppMark, TryCard } from "./MarketplaceParts";
import { CATEGORY_LABELS } from "./marketplace-listing";
import {
  appSetup,
  type MarketplaceApp,
  type MarketplaceAppConnection,
  type MarketplaceAppStatus,
  type MarketplaceMacAutomation,
  pluginAppSetup,
} from "./marketplace-model";
import { type MarketplaceScope, serverAddress } from "./marketplace-view";
import { PluginIcon } from "./PluginIcon";

type PluginApp = Extract<MarketplaceApp, { kind: "plugin" }>;
type ConnectorApp = Extract<MarketplaceApp, { kind: "connector" }>;
type CustomApp = Extract<MarketplaceApp, { kind: "custom" }>;

const STATUS_LABEL = {
  connected: "marketplace.app.connected",
  attention: "marketplace.app.attention",
  connecting: "connector.github.statusConnecting",
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
  /** The first app whose server refused its saved sign-in. */
  const refused = () => plugin().apps.find((app) => props.app.connections[app.id]?.signInNeeded);
  const automation = () =>
    model().canConnectApps() && plugin().apps.some((app) => app.macAutomation?.length)
      ? model().macAutomation
      : undefined;
  const runPrompt = () => {
    const run = model().runPrompt;
    if (!run) return undefined;
    return (id: string) => {
      const prompt = plugin().prompts.find((entry) => entry.id === id);
      if (prompt) run(prompt);
    };
  };

  return (
    <IntegrationPage
      class="marketplace-plugin-page"
      logo={<AppMark app={props.app} />}
      name={props.app.name}
      status={props.app.status}
      statusLabel={t(STATUS_LABEL[props.app.status])}
      subtitle={props.app.tagline}
      actions={
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => model().copyLink(plugin().slug)}>
            <Link2 aria-hidden="true" />
            {t("plugin.copyLink")}
          </Button>
          {/* With more than one app, each app's row signs in again: the header cannot say which. */}
          <Show when={!refused() || plugin().apps.length === 1}>
            <AppAction scope={props.scope} app={props.app} size="sm" variant="default" />
          </Show>
        </>
      }
      intro={
        <Show when={plugin().prompts.length > 0}>
          <TryCard
            seed={plugin().name}
            chip={{ kind: "plugin", name: plugin().name, icon: <AppMark app={props.app} /> }}
            requests={plugin().prompts}
            tryLabel={(prompt) => t("plugin.askPrompt", { name: plugin().name, prompt })}
            onTry={runPrompt()}
          />
        </Show>
      }
      alert={
        <Show when={props.app.status === "attention"}>
          <Alert tone="warning" role="alert">
            <AlertIcon>
              <TriangleAlert />
            </AlertIcon>
            <AlertContent>
              <Show
                when={refused()}
                fallback={
                  <>
                    <AlertTitle>{t("marketplace.app.partialTitle", { name: props.app.name })}</AlertTitle>
                    <AlertDescription>{t("marketplace.app.partialDescription")}</AlertDescription>
                  </>
                }
              >
                {(app) => (
                  <>
                    <AlertTitle>{t("marketplace.app.signInTitle", { name: app().name })}</AlertTitle>
                    <AlertDescription>{t("marketplace.app.signInDescription", { name: app().name })}</AlertDescription>
                  </>
                )}
              </Show>
            </AlertContent>
          </Alert>
        </Show>
      }
      details={
        <AppInformation
          description={plugin().description}
          developer={plugin().creatorName}
          category={t(CATEGORY_LABELS[plugin().category])}
          version={plugin().version}
          links={links()}
          onOpenUrl={(url) => model().openUrl(url)}
        />
      }
      danger={
        <Show when={props.app.status !== "idle" && model().canConnectApps()}>
          <DangerZone
            title={t("marketplace.app.disconnect.title", { name: props.app.name })}
            description={t("marketplace.app.disconnect.description", { name: props.app.name })}
            action={t("marketplace.app.disconnect.action")}
            busy={model().appBusy(props.app.id)}
            // A plugin opens its own uninstall dialog, which lists the apps and skills it removes.
            onAction={() => model().disconnectApp(props.app)}
          />
        </Show>
      }
    >
      <Show when={plugin().apps.length > 0}>
        <SettingsSection title={t("marketplace.app.connection")}>
          <ItemGroup class="settings-modal-card">
            <For each={plugin().apps}>
              {(entry) => <ConnectionRow scope={props.scope} app={props.app} entry={entry} />}
            </For>
            <Show when={automation()}>
              {(current) => <AutomationRow scope={props.scope} app={props.app} automation={current()} />}
            </Show>
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
    </IntegrationPage>
  );
}

const NOT_HELD: MarketplaceAppConnection = { held: false, signInNeeded: false };

/** The address that a desktop app's server answers on, as the listing gives it. */
function localAddress(entry: MarketplacePluginApp): string {
  return entry.server.transport === "http" ? entry.server.url : "";
}

/**
 * One app of a plugin in the Connection section: how it connects, what the host holds, and the
 * action that connects a held app again. A key is named, never shown.
 */
function ConnectionRow(props: { scope: MarketplaceScope; app: PluginApp; entry: MarketplacePluginApp }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const setup = () => pluginAppSetup(props.entry);
  const connection = () => props.app.connections[props.entry.id] ?? NOT_HELD;
  const host = () => model().appHostName ?? t("mcp.connect.thisComputer");
  const keyField = () => {
    const fields = mcpFlowFields(props.entry.server.auth?.[0]);
    return (fields.find((field) => !field.optional) ?? fields[0])?.label ?? "";
  };
  const description = () => {
    const name = props.entry.name;
    const held = connection().held;
    switch (setup()) {
      case "account":
        return held && !connection().signInNeeded
          ? t("mcp.status.signedIn")
          : t("marketplace.app.setup.account", { name });
      case "key":
        return held
          ? t("marketplace.app.setup.keySaved", { field: keyField(), host: host() })
          : t("marketplace.app.setup.key", { name });
      case "desktop":
        return held
          ? t("marketplace.app.setup.desktopConnected", { address: localAddress(props.entry) })
          : t("marketplace.app.setup.desktop", { name, address: localAddress(props.entry) });
      default:
        return t("marketplace.app.setup.open");
    }
  };
  /** The row action of a held app. An app that asks for nothing has none. */
  const action = (): AppTextKey | null => {
    if (!connection().held || !model().canConnectApps()) return null;
    switch (setup()) {
      case "account":
        return "provider.account.signInAgain";
      case "key":
        return "provider.settings.changeKey";
      case "desktop":
        return "marketplace.app.connectAgain";
      default:
        return null;
    }
  };
  return (
    <Item class="settings-modal-row">
      <ItemMedia>
        <PluginIcon iconUrl={props.entry.iconUrl} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.entry.name}</ItemTitle>
        <ItemDescription>{description()}</ItemDescription>
      </ItemContent>
      <Show when={connection().signInNeeded || action()}>
        <ItemActions>
          <Show when={connection().signInNeeded}>
            <StatusPill status="attention" label={t("mcp.status.signInNeeded")} />
          </Show>
          <Show when={action()}>
            {(label) => (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={model().appBusy(props.app.id)}
                onClick={() => void model().reconnectApp(props.app, props.entry.id)}
              >
                {t(label())}
              </Button>
            )}
          </Show>
        </ItemActions>
      </Show>
    </Item>
  );
}

/**
 * The Automation access of the Apple apps that a plugin drives. Before the install, the switch says
 * whether the install asks macOS; after it, the button asks again, such as for an app added later.
 */
function AutomationRow(props: { scope: MarketplaceScope; app: PluginApp; automation: MarketplaceMacAutomation }) {
  const { t } = useText();
  const busy = () => props.scope.model.appBusy(props.app.id);
  return (
    <Show
      when={props.app.status === "idle"}
      fallback={
        <Item class="settings-modal-row">
          <ItemContent>
            <ItemTitle>{t("marketplace.app.automation.title")}</ItemTitle>
            <ItemDescription>{t("marketplace.app.automation.description")}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy()}
              onClick={() => void props.automation.request(props.app)}
            >
              {t("marketplace.app.automation.request")}
            </Button>
          </ItemActions>
        </Item>
      }
    >
      <SwitchField
        class="settings-modal-row"
        checked={props.automation.askOnInstall()}
        disabled={busy()}
        onChange={(checked) => props.automation.setAskOnInstall(checked)}
        label={t("marketplace.app.automation.askOnInstall")}
        description={t("marketplace.app.automation.description")}
      />
    </Show>
  );
}

interface AppInformationLink {
  label: string;
  url: string;
  /** The visible host and path. */
  text: string;
}

/** What an app does, who makes it, its category and version, and its links: one card. */
function AppInformation(props: {
  description?: string | undefined;
  developer: string;
  category: string;
  version?: string | undefined;
  links: readonly AppInformationLink[];
  onOpenUrl: (url: string) => void;
}) {
  const { t } = useText();
  return (
    <SettingsSection title={t("plugin.section.information")}>
      <ItemGroup class="settings-modal-card">
        <div class="integration-card-body">
          <Show when={props.description}>
            {(description) => (
              <Text as="p" variant="body-sm">
                {description()}
              </Text>
            )}
          </Show>
          {/* `dt` and `dd` stay direct children of the list: axe rejects a wrapper per row. */}
          <dl class="marketplace-props marketplace-info">
            <dt>
              <Text as="span" variant="caption" tone="muted">
                {t("plugin.info.developer")}
              </Text>
            </dt>
            <dd>
              <Text as="span" variant="body-sm">
                {props.developer}
              </Text>
            </dd>
            <dt>
              <Text as="span" variant="caption" tone="muted">
                {t("plugin.info.category")}
              </Text>
            </dt>
            <dd>
              <Text as="span" variant="body-sm">
                {props.category}
              </Text>
            </dd>
            <Show when={props.version}>
              {(version) => (
                <>
                  <dt>
                    <Text as="span" variant="caption" tone="muted">
                      {t("plugin.info.version")}
                    </Text>
                  </dt>
                  <dd>
                    <Text as="span" variant="body-sm">
                      {version()}
                    </Text>
                  </dd>
                </>
              )}
            </Show>
            <For each={props.links}>
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
                      onClick={() => props.onOpenUrl(link.url)}
                    >
                      {link.text}
                      <ExternalLink aria-hidden="true" />
                    </Button>
                  </dd>
                </>
              )}
            </For>
          </dl>
        </div>
      </ItemGroup>
    </SettingsSection>
  );
}

interface ConnectorLink {
  label: AppTextKey;
  url: string;
}

/** The publisher's pages, shown in each connector page's information. Only addresses we are sure of. */
const CONNECTOR_LINKS: Readonly<Record<ConnectorId, readonly ConnectorLink[]>> = {
  slack: [{ label: "plugin.link.website", url: "https://slack.com" }],
  discord: [{ label: "plugin.link.website", url: "https://discord.com" }],
  telegram: [{ label: "plugin.link.website", url: "https://telegram.org" }],
  whatsapp: [{ label: "plugin.link.website", url: "https://www.whatsapp.com" }],
  github: [{ label: "plugin.link.website", url: "https://github.com" }],
  onepassword: [
    { label: "plugin.link.website", url: "https://1password.com" },
    { label: "plugin.link.privacyPolicy", url: "https://1password.com/legal/privacy" },
    { label: "plugin.link.terms", url: "https://1password.com/legal/terms-of-service" },
  ],
  bitwarden: [{ label: "plugin.link.website", url: "https://bitwarden.com" }],
};

/** Who makes each connector's service: the name the user knows it by. */
const CONNECTOR_DEVELOPER = {
  slack: "connector.slack.title",
  discord: "connector.discord.title",
  telegram: "connector.telegram.title",
  whatsapp: "connector.whatsapp.title",
  github: "connector.github.title",
  onepassword: "connector.onePassword.title",
  bitwarden: "connector.bitwarden.title",
} as const satisfies Record<ConnectorId, AppTextKey>;

/** The information card of a connector page: what it gives, its developer, category and website. */
function ConnectorInformation(props: { scope: MarketplaceScope; app: ConnectorApp; detail: ConnectorDetail }) {
  const { t } = useText();
  /* A password manager has a category more exact than the listing's own. */
  const category = () =>
    appSetup(props.app) === "vault" ? t("marketplace.app.onePasswordCategory") : t(CATEGORY_LABELS[props.app.category]);
  return (
    <AppInformation
      description={connectorDescription(props.detail, t)}
      developer={t(CONNECTOR_DEVELOPER[props.app.connector])}
      category={category()}
      links={CONNECTOR_LINKS[props.app.connector].map((link) => ({
        label: t(link.label),
        url: link.url,
        text: pluginLinkText(link.url),
      }))}
      onOpenUrl={(url) => props.scope.model.openUrl(url)}
    />
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
    <IntegrationPage
      class="marketplace-custom-page"
      logo={<Plug aria-hidden="true" />}
      name={props.app.name}
      status={props.app.status}
      statusLabel={t(STATUS_LABEL[props.app.status])}
      subtitle={t("marketplace.app.custom")}
      danger={
        <Show when={model().canConnectApps()}>
          <DangerZone
            title={t("marketplace.app.remove.title")}
            description={t("marketplace.app.remove.description")}
            action={t("marketplace.app.remove.action")}
            onAction={() => setConfirm(true)}
          />
        </Show>
      }
    >
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
            <Button
              type="button"
              variant="destructive"
              loading={busy()}
              data-cuelume-tap="close"
              data-cuelume-emphasis="strong"
              onClick={remove}
            >
              {t("marketplace.app.remove.action")}
            </Button>
          </>
        }
      />
    </IntegrationPage>
  );
}

/** The page of one app: a connector, a catalog app, or a server that the user added. */
export function MarketplaceAppPage(props: { scope: MarketplaceScope; id: string }) {
  const { t } = useText();
  const model = () => props.scope.model;
  const app = () =>
    model()
      .apps()
      .find((entry) => entry.id === props.id);
  const connector = () => {
    const current = app();
    if (current?.kind !== "connector") return undefined;
    const controller = model().connector(current.connector);
    return controller ? { app: current, controller } : undefined;
  };
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
        <Match when={connector()}>
          {(current) => (
            <Show when={current().controller.ready()}>
              <ConnectorDetailPanel
                detail={current().controller.detail}
                tagline={current().app.tagline}
                details={
                  <ConnectorInformation scope={props.scope} app={current().app} detail={current().controller.detail} />
                }
              />
            </Show>
          )}
        </Match>
        <Match when={plugin()}>{(current) => <PluginAppPage scope={props.scope} app={current()} />}</Match>
        <Match when={custom()}>{(current) => <CustomServerPage scope={props.scope} app={current()} />}</Match>
      </Switch>
    </div>
  );
}
