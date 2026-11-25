import { Button, Plus, TriangleAlert } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";
import { AppLogo, Done } from "./MarketplaceParts";
import { customServerStatus, type MarketplaceApp, pluginNeedsMac } from "./marketplace-model";
import type { MarketplaceScope } from "./marketplace-view";

export function useInstalls() {
  const { t, format } = useText();
  return (count: number) => t("marketplace.installs", { count, installs: format.number(count) });
}

export function AppAction(props: {
  scope: MarketplaceScope;
  app: MarketplaceApp;
  size?: "sm";
  variant?: "default";
  named?: boolean;
  onConnected?: () => void;
}) {
  const { t } = useText();
  const model = () => props.scope.model;
  const attention = () => props.app.status === "attention";
  const list = () => props.size !== undefined && props.variant === undefined;
  const checking = () => props.app.kind === "plugin" && model().appsBlocked?.()?.reason === "checking";
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
  const shortLabel = () => {
    if (refused()) return t("provider.account.signInAgain");
    return attention() ? t("marketplace.app.reconnect") : t("marketplace.app.connect");
  };
  const connect = () => {
    const app = props.app;
    if (app.kind === "x") {
      props.scope.nav.go({ kind: "app", id: app.id, setup: true });
      return;
    }
    if (app.kind === "connector") {
      const view = props.scope.nav.state.stack.at(-1);
      if (view?.kind !== "app" || view.id !== app.id) props.scope.nav.go({ kind: "app", id: app.id });
      const connector = model().connector(app.connector);
      if (app.status === "idle" && connector?.ready()) connector.connect?.();
      return;
    }
    if (app.kind !== "plugin") return;
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
          <Done>{t(props.app.kind === "custom" ? customServerStatus(props.app) : "marketplace.app.connected")}</Done>
        </Show>
      }
    >
      <Show
        when={
          props.app.kind === "connector" ||
          props.app.kind === "x" ||
          (props.app.kind === "plugin" &&
            !pluginNeedsMac(model(), props.app.plugin) &&
            (model().canConnectApps() || (!list() && checking())))
        }
      >
        <Button
          type="button"
          variant={variant()}
          size={props.size}
          class={list() ? "marketplace-app-action" : undefined}
          data-status={props.app.status}
          loading={model().appBusy(props.app.id) || props.app.status === "connecting" || checking()}
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

function focusRow(label: string) {
  requestAnimationFrame(() =>
    document
      .querySelector<HTMLElement>(`.skills-marketplace .marketplace-app-row-hit[aria-label="${CSS.escape(label)}"]`)
      ?.focus(),
  );
}

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
