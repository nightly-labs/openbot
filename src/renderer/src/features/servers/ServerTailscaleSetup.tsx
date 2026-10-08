import type { TailscaleSetupStatus } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Button,
  CircleCheck,
  CircleDot,
  CopyButton,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  SettingsSection,
  SwitchField,
} from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { truncateMiddle } from "@openbot/ui/utils";
import { createStore, For, onSettled, Show } from "solid-js";
import type { ServerSettingsSectionHost } from "./server-settings-section";
import {
  TAILSCALE_SETUP_COMMAND,
  type TailscaleSetupStep,
  type TailscaleSetupStepId,
  tailscaleServerActions,
  tailscaleSetupComplete,
  tailscaleSetupSteps,
  tailscaleWslHint,
} from "./tailscale-setup-steps";

/** The Tailscale pages the setup links to. Main opens them from a closed table. */
export type TailscaleSetupLink =
  | "tailscale-windows-download"
  | "tailscale-download"
  | "tailscale-admin-dns"
  | "tailscale-admin-machines";

/** The calls of the owner's Tailscale setup of one joined server. Main reaches the host. */
export interface ServerTailscaleSetupApi {
  getSetup(): Promise<TailscaleSetupStatus>;
  setDirect(enabled: boolean): Promise<TailscaleSetupStatus>;
  /** Asks the host to start a Tailscale sign-in; main opens the sign-in page it reports. */
  signIn(): Promise<TailscaleSetupStatus>;
  /** Opens the Tailscale app of this computer, or its download page. */
  openLocalTailscale(): Promise<void>;
  openLink(link: TailscaleSetupLink): Promise<void>;
}

/** Each step checks itself again at this interval until all steps are done. */
export const TAILSCALE_SETUP_POLL_MS = 5_000;

const STEP_TITLE = {
  client: "server.tailscale.setup.clientTitle",
  server: "server.tailscale.setup.serverTitle",
  network: "server.tailscale.setup.networkTitle",
  https: "server.tailscale.setup.httpsTitle",
  direct: "server.tailscale.directLabel",
} as const satisfies Record<TailscaleSetupStepId, AppTextKey>;

const LOCAL_STATE_TEXT = {
  "not-installed": "server.tailscale.notInstalled",
  "not-running": "server.tailscale.notRunning",
  "signed-out": "server.tailscale.signedOut",
  stopped: "server.tailscale.stopped",
} as const satisfies Record<Exclude<TailscaleSetupStatus["client"]["state"], "connected">, AppTextKey>;

const HOST_ISSUE_TEXT = {
  "host-offline": "server.tailscale.setup.issue.hostOffline",
  "tailscale-unavailable": "server.tailscale.setup.issue.tailscaleUnavailable",
  "https-certificates-off": "server.tailscale.issue.httpsOff",
  "port-in-use": "server.tailscale.setup.issue.portInUse",
  "funnel-on": "server.tailscale.issue.funnelOn",
  "serve-failed": "server.tailscale.issue.serveFailed",
} as const satisfies Record<NonNullable<TailscaleSetupStatus["host"]["issue"]>, AppTextKey>;

/**
 * The owner's Tailscale setup of a joined server, in five steps. Each step reads its state from both
 * Tailscale clients and offers one action. A host without `host-tailscale-v1` (null `api`) asks the
 * owner to update it.
 */
export function ServerTailscaleSetup(props: { host: ServerSettingsSectionHost; api: ServerTailscaleSetupApi | null }) {
  const { t, errorMessage } = useText();
  const [view, setView] = createStore<{ status: TailscaleSetupStatus | null; error: string | null }>({
    status: null,
    error: null,
  });

  async function refresh(): Promise<void> {
    const api = props.api;
    if (!api) return;
    try {
      const status = await api.getSetup();
      setView((state) => {
        state.status = status;
        state.error = null;
      });
    } catch (error) {
      setView((state) => {
        state.error = errorMessage(error, t("server.tailscale.loadFailed"));
      });
    }
  }

  function apply(next: TailscaleSetupStatus): void {
    setView((state) => {
      state.status = next;
      state.error = null;
    });
  }

  onSettled(() => {
    void refresh();
    const timer = window.setInterval(() => {
      const current = view.status;
      if (props.api && !props.host.busy() && !(current && tailscaleSetupComplete(current))) void refresh();
    }, TAILSCALE_SETUP_POLL_MS);
    return () => window.clearInterval(timer);
  });

  const steps = () => (view.status ? tailscaleSetupSteps(view.status) : []);

  return (
    <SettingsSection title={t("server.tailscale.title")}>
      <Show
        when={props.api}
        fallback={
          <ItemGroup class="settings-modal-card">
            <Item>
              <ItemContent>
                <ItemTitle>{t("server.tailscale.setup.title")}</ItemTitle>
                <ItemDescription>{t("server.tailscale.setup.updateServer")}</ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        }
      >
        {(api) => (
          <ItemGroup class="settings-modal-card">
            <Item>
              <ItemContent>
                <ItemTitle>{t("server.tailscale.setup.title")}</ItemTitle>
                <ItemDescription>
                  {view.status
                    ? t("server.tailscale.setup.description")
                    : (view.error ?? t("server.tailscale.checking"))}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button type="button" size="sm" variant="ghost" onClick={() => void refresh()}>
                  {t("server.tailscale.checkAgain")}
                </Button>
              </ItemActions>
            </Item>
            <Show when={view.status}>
              {(status) => (
                <For each={steps()} keyed={(step) => step.id}>
                  {(step) => (
                    <SetupStep host={props.host} api={api()} status={status()} step={step()} onStatus={apply} />
                  )}
                </For>
              )}
            </Show>
          </ItemGroup>
        )}
      </Show>
    </SettingsSection>
  );
}

function SetupStep(props: {
  host: ServerSettingsSectionHost;
  api: ServerTailscaleSetupApi;
  status: TailscaleSetupStatus;
  step: TailscaleSetupStep;
  onStatus: (status: TailscaleSetupStatus) => void;
}) {
  const { t } = useText();
  const run = (key: string, action: () => Promise<void>) => void props.host.run(`tailscale-${key}`, action);
  const busy = () => Boolean(props.host.busy());
  const done = () => props.step.state === "done";
  const connected = (side: { tailnet: string | null; deviceName: string | null }) =>
    t("server.tailscale.connected", {
      tailnet: side.tailnet ?? t("server.tailscale.unknownTailnet"),
      device: side.deviceName ?? t("server.tailscale.unknownDevice"),
    });

  const description = (): string => {
    const { client, host, network } = props.status;
    switch (props.step.id) {
      case "client":
        return client.state === "connected" ? connected(client) : t(LOCAL_STATE_TEXT[client.state]);
      case "server":
        if (host.state === "connected") return connected(host);
        if (host.signInIssue === "failed") return t("server.tailscale.setup.serverSignInFailed");
        if (host.environment === "wsl") return t("server.tailscale.setup.serverWsl");
        if (host.state === "signed-out" && host.loginUrl) return t("server.tailscale.setup.serverWaitsForSignIn");
        if (host.setupCommand && (host.state === "not-installed" || host.signInIssue === "needs-setup"))
          return t("server.tailscale.setup.serverRunCommand");
        if (host.state === "not-installed") return t("server.tailscale.setup.serverInstall");
        return t("server.tailscale.setup.serverSignIn");
      case "network":
        if (props.step.state === "waiting") return t("server.tailscale.setup.networkWaiting");
        if (network === "same")
          return t("server.tailscale.setup.networkSame", {
            tailnet: host.tailnet ?? t("server.tailscale.unknownTailnet"),
          });
        if (network === "shared") return t("server.tailscale.setup.networkShared");
        return t("server.tailscale.setup.networkOther", {
          client: client.tailnet ?? t("server.tailscale.unknownTailnet"),
          server: host.tailnet ?? t("server.tailscale.unknownTailnet"),
        });
      case "https":
        if (props.step.state === "waiting") return t("server.tailscale.setup.serverFirst");
        return done() ? t("server.tailscale.setup.httpsOn") : t("server.tailscale.setup.httpsOff");
      case "direct":
        if (host.issue === "serve-failed" && host.issueDetail)
          return t("server.tailscale.issue.serveFailedDetail", { detail: host.issueDetail });
        if (host.issue) return t(HOST_ISSUE_TEXT[host.issue]);
        if (props.step.state === "waiting") return t("server.tailscale.setup.directWaiting");
        return t("server.tailscale.setup.directDescription");
    }
  };

  const stepTitle = () => t(STEP_TITLE[props.step.id]);
  const marker = () => (
    <ItemMedia aria-label={done() ? t("server.tailscale.setup.stepDone") : t("server.tailscale.setup.stepToDo")}>
      <Show when={done()} fallback={<CircleDot aria-hidden="true" />}>
        <CircleCheck aria-hidden="true" />
      </Show>
    </ItemMedia>
  );

  return (
    <Show
      when={props.step.id !== "direct"}
      fallback={
        <>
          <SwitchField
            size="default"
            checked={props.status.host.enabled}
            disabled={busy() || props.step.state === "waiting"}
            onChange={(enabled) => run("direct", async () => props.onStatus(await props.api.setDirect(enabled)))}
            label={stepTitle()}
            description={description()}
          />
          <Show when={props.status.host.url}>
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
        </>
      }
    >
      <Item>
        {marker()}
        <ItemContent>
          <ItemTitle>{stepTitle()}</ItemTitle>
          <ItemDescription>{description()}</ItemDescription>
          <Show when={props.step.id === "server" ? tailscaleWslHint(props.status) : null}>
            {(hint) => (
              <ItemDescription>
                {t(
                  hint() === "mirrored-required"
                    ? "server.tailscale.setup.wslMirroredRequired"
                    : "server.tailscale.setup.wslMirroredCheck",
                )}
              </ItemDescription>
            )}
          </Show>
        </ItemContent>
        <Show when={props.step.state === "action"}>
          <ItemActions>
            <StepActions {...props} run={run} busy={busy()} />
          </ItemActions>
        </Show>
      </Item>
    </Show>
  );
}

function StepActions(props: {
  host: ServerSettingsSectionHost;
  api: ServerTailscaleSetupApi;
  status: TailscaleSetupStatus;
  step: TailscaleSetupStep;
  onStatus: (status: TailscaleSetupStatus) => void;
  run: (key: string, action: () => Promise<void>) => void;
  busy: boolean;
}) {
  const { t } = useText();
  const link = (target: TailscaleSetupLink) => props.run("link", () => props.api.openLink(target));
  return (
    <>
      <Show when={props.step.id === "client"}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.busy}
          onClick={() => props.run("open", () => props.api.openLocalTailscale())}
        >
          {props.status.client.state === "not-installed" ? t("server.tailscale.install") : t("server.tailscale.open")}
        </Button>
      </Show>
      <Show when={props.step.id === "server"}>
        <For each={tailscaleServerActions(props.status)}>
          {(action) => (
            <Show
              when={action !== "setup-command"}
              fallback={
                <CopyButton
                  value={TAILSCALE_SETUP_COMMAND}
                  label={TAILSCALE_SETUP_COMMAND}
                  copiedLabel={t("common.copied")}
                  aria-label={t("server.tailscale.setup.copyCommand")}
                  title={TAILSCALE_SETUP_COMMAND}
                  onCopyError={props.host.showCopyError}
                />
              }
            >
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={props.busy}
                onClick={() => {
                  if (action === "windows-app") link("tailscale-windows-download");
                  else if (action === "download") link("tailscale-download");
                  else props.run("sign-in", async () => props.onStatus(await props.api.signIn()));
                }}
              >
                {action === "windows-app"
                  ? t("server.tailscale.setup.getWindowsApp")
                  : action === "download"
                    ? t("server.tailscale.install")
                    : props.status.host.loginUrl
                      ? t("server.tailscale.setup.openSignIn")
                      : t("server.tailscale.setup.signIn")}
              </Button>
            </Show>
          )}
        </For>
      </Show>
      <Show when={props.step.id === "network"}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.busy}
          onClick={() => link("tailscale-admin-machines")}
        >
          {t("server.tailscale.setup.shareServer")}
        </Button>
      </Show>
      <Show when={props.step.id === "https"}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.busy}
          onClick={() => link("tailscale-admin-dns")}
        >
          {t("server.tailscale.setup.turnOnHttps")}
        </Button>
      </Show>
    </>
  );
}
