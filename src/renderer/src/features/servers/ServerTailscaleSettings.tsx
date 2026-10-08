import type { OpenBotDesktopApi, ServerSummary, TailscaleHostStatus } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  CopyButton,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  SettingsSection,
  SwitchField,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { truncateMiddle } from "@openbot/ui/utils";
import { createSignal, onSettled, Show } from "solid-js";
import type { ServerSettingsSectionHost } from "./server-settings-section";

/** The host calls of the Tailscale section. Only this computer has them. */
export type ServerTailscaleHostApi = Pick<
  OpenBotDesktopApi["host"],
  "getTailscaleStatus" | "setTailscaleDirect" | "openTailscale"
>;

const LOCAL_STATE_TEXT = {
  "not-installed": "server.tailscale.notInstalled",
  "not-running": "server.tailscale.notRunning",
  "signed-out": "server.tailscale.signedOut",
  stopped: "server.tailscale.stopped",
} as const satisfies Record<Exclude<TailscaleHostStatus["state"], "connected">, AppTextKey>;

const HOST_ISSUE_TEXT = {
  "host-offline": "server.tailscale.issue.hostOffline",
  "tailscale-unavailable": "server.tailscale.issue.tailscaleUnavailable",
  "https-certificates-off": "server.tailscale.issue.httpsOff",
  "port-in-use": "server.tailscale.issue.portInUse",
  "funnel-on": "server.tailscale.issue.funnelOn",
  "serve-failed": "server.tailscale.issue.serveFailed",
} as const satisfies Record<NonNullable<TailscaleHostStatus["issue"]>, AppTextKey>;

const CLIENT_HINT_TEXT = {
  "tailscale-unavailable": "server.tailscale.hint.tailscaleUnavailable",
  "other-tailnet": "server.tailscale.hint.otherTailnet",
  failed: "server.tailscale.hint.failed",
} as const satisfies Record<NonNullable<NonNullable<ServerSummary["direct"]>["hint"]>, AppTextKey>;

/**
 * The host side of the direct Tailscale path, for this computer: the state of the local Tailscale
 * client and the owner's switch. OpenBot runs `tailscale serve` (never Funnel) while it is on.
 */
export function HostTailscaleSettings(props: { host: ServerSettingsSectionHost; api: ServerTailscaleHostApi }) {
  const { t, errorMessage } = useText();
  const [status, setStatus] = createSignal<TailscaleHostStatus | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  async function refresh(): Promise<void> {
    try {
      setStatus(await props.api.getTailscaleStatus());
      setLoadError(null);
    } catch (error) {
      setLoadError(errorMessage(error, t("server.tailscale.loadFailed")));
    }
  }

  onSettled(() => {
    void refresh();
  });

  async function setDirect(enabled: boolean): Promise<void> {
    await props.host.run("tailscale", async () => {
      setStatus(await props.api.setTailscaleDirect(enabled));
    });
  }

  const stateText = () => {
    const current = status();
    if (!current) return loadError() ?? t("server.tailscale.checking");
    if (current.state === "connected")
      return t("server.tailscale.connected", {
        tailnet: current.tailnet ?? t("server.tailscale.unknownTailnet"),
        device: current.deviceName ?? t("server.tailscale.unknownDevice"),
      });
    return t(LOCAL_STATE_TEXT[current.state]);
  };
  const switchDescription = () => {
    const current = status();
    const issue = current?.issue;
    if (issue === "serve-failed" && current?.issueDetail)
      return t("server.tailscale.issue.serveFailedDetail", { detail: current.issueDetail });
    if (issue) return t(HOST_ISSUE_TEXT[issue]);
    return t("server.tailscale.directDescription");
  };
  const canOpenTailscale = () => {
    const state = status()?.state;
    return state !== undefined && state !== "connected";
  };

  return (
    <SettingsSection title={t("server.tailscale.title")}>
      <ItemGroup class="settings-modal-card">
        <Item>
          <ItemContent>
            <ItemTitle>{t("server.tailscale.localTitle")}</ItemTitle>
            <ItemDescription>{stateText()}</ItemDescription>
          </ItemContent>
          <Show when={canOpenTailscale()}>
            <ItemActions>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void props.host.run("tailscale-open", () => props.api.openTailscale())}
              >
                {status()?.state === "not-installed" ? t("server.tailscale.install") : t("server.tailscale.open")}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>
                {t("server.tailscale.checkAgain")}
              </Button>
            </ItemActions>
          </Show>
        </Item>
        <SwitchField
          size="default"
          checked={status()?.enabled ?? false}
          disabled={!status() || Boolean(props.host.busy())}
          onChange={(value) => void setDirect(value)}
          label={t("server.tailscale.directLabel")}
          description={switchDescription()}
        />
        <Show when={status()?.url}>
          {(url) => (
            <Item>
              <ItemContent>
                <ItemTitle>{t("server.tailscale.addressTitle")}</ItemTitle>
                <ItemDescription>{t("server.tailscale.addressDescription")}</ItemDescription>
              </ItemContent>
              <CopyButton
                value={url()}
                label={truncateMiddle(url(), 31)}
                copiedLabel={t("common.copied")}
                aria-label={t("server.tailscale.copyAddress")}
                title={url()}
                onCopyError={props.host.showCopyError}
              />
            </Item>
          )}
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}

/**
 * A joined server's direct Tailscale path: the member's switch, the path in use, and why it is not,
 * such as a device in another tailnet that needs node sharing.
 */
export function ClientTailscaleSettings(props: {
  host: ServerSettingsSectionHost;
  direct: NonNullable<ServerSummary["direct"]>;
  onSetDirectEnabled: (enabled: boolean) => Promise<void>;
}) {
  const { t } = useText();
  const description = () => {
    if (!props.direct.enabled) return t("server.tailscale.useDescription");
    if (props.direct.active) return t("server.tailscale.routeDirect");
    const hint = props.direct.hint;
    return hint ? t(CLIENT_HINT_TEXT[hint]) : t("server.tailscale.routeCloud");
  };
  return (
    <SettingsSection title={t("server.tailscale.title")}>
      <ItemGroup class="settings-modal-card">
        <SwitchField
          size="default"
          checked={props.direct.enabled}
          disabled={Boolean(props.host.busy())}
          onChange={(value) => void props.host.run("tailscale", () => props.onSetDirectEnabled(value))}
          label={t("server.tailscale.useLabel")}
          description={description()}
        />
      </ItemGroup>
    </SettingsSection>
  );
}
