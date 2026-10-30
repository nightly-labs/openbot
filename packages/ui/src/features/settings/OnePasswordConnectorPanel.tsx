import type { OnePasswordConnectorStatus, OnePasswordSetup } from "@openbot/contracts/ipc";
import {
  Button,
  CircleCheck,
  CircleDot,
  Download,
  ExternalLink,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  KeyRound,
  RefreshCw,
  SettingsSection,
  Spinner,
  Text,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { OnePasswordMark } from "./brand-marks";
import { IntegrationPage, type IntegrationPageSlots } from "./IntegrationLayout";
import {
  SharedVaultSection,
  VaultDangerZone,
  VaultRow,
  VaultSecretForm,
  type VaultStatus,
  vaultFailure,
  vaultHeader,
} from "./VaultParts";

export interface OnePasswordConnectorPanelProps extends IntegrationPageSlots {
  status: OnePasswordConnectorStatus;
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  /** Starts checking the setup while the page shows, and returns the stop. */
  onWatchSetup: () => () => void;
  onCheckSetup: () => void;
  onInstallCli: () => void;
  onOpenApp: () => void;
  /** `accountId` is null until the user picks one of several accounts. */
  onConnect: (accountId: string | null) => void;
  onConnectWithToken: (token: string) => void;
  onCancel: () => void;
  onDisconnect: () => void;
  /**
   * The joined server whose connection this is, or undefined for this computer's. A server connects
   * with a service account token only, so the page shows no setup steps.
   */
  hostName?: string | undefined;
  /**
   * Why the last status read failed, when no newer status came. The state is not known: the page
   * shows the reason and Retry, not the setup steps of a connection that may be there.
   */
  statusError?: string | null | undefined;
  /** Reads the status again. */
  onRetry?: (() => void) | undefined;
}

/** The status of the connection, as its page header and every list of connectors show it. */
export const ONEPASSWORD_STATUS = {
  disconnected: { status: "idle", label: "marketplace.app.notConnected" },
  connecting: { status: "connecting", label: "connector.onePassword.statusConnecting" },
  "choose-account": { status: "connecting", label: "connector.onePassword.statusConnecting" },
  connected: { status: "connected", label: "connector.onePassword.statusConnected" },
} as const satisfies Record<OnePasswordConnectorStatus["state"], VaultStatus>;

/** `done` shows a check; `waiting` is a step whose earlier step is not done, so its action is off. */
type StepState = "done" | "current" | "waiting";

function setupSteps(setup: OnePasswordSetup): { cli: StepState; app: StepState; vault: StepState } {
  const cli = setup.cli === "ready";
  const app = cli && setup.appIntegration === true;
  return {
    cli: cli ? "done" : "current",
    app: app ? "done" : cli ? "current" : "waiting",
    vault: app ? "current" : "waiting",
  };
}

/**
 * The 1Password page of one OpenBot computer. The token never reaches this component after the user
 * types it: the status holds the setup, the vault names and the login count only.
 *
 * Before a connection the page is three steps, each with the one button it needs: install the CLI,
 * turn on its integration in the 1Password app, and create the shared vault. Only the current step's
 * button is primary. The page checks the setup while it shows and when the window gets the focus back,
 * so a step done in the 1Password app is ticked without a click. A user without the CLI pastes a
 * service account token instead. A joined server has only the token form.
 */
export function OnePasswordConnectorPanel(props: OnePasswordConnectorPanelProps) {
  const { t } = useText();
  const [tokenOpen, setTokenOpen] = createSignal(false);
  const header = () => vaultHeader(props.statusError, ONEPASSWORD_STATUS[props.status.state]);
  const steps = () => setupSteps(props.status.setup);
  const failure = () => vaultFailure(t("connector.onePassword.actionFailed"), props.statusError, props.status.error);
  onSettled(() => props.onWatchSetup());
  const connectVariant = () =>
    steps().vault === "current" && props.status.state !== "choose-account" ? "default" : "outline";
  const loginText = () =>
    props.status.loginCount === null
      ? t("connector.onePassword.loginsLoading")
      : t("connector.onePassword.loginCount", { count: props.status.loginCount });
  /** The login count belongs to the one vault. With more vaults it is a note for all of them. */
  const vaultDescription = () => (props.status.vaultNames.length === 1 ? loginText() : undefined);

  return (
    <IntegrationPage
      class="onepassword-connector"
      logo={<OnePasswordMark />}
      name={t("connector.onePassword.title")}
      status={header().status}
      statusLabel={t(header().label)}
      subtitle={
        props.hostName
          ? t("connector.onePassword.descriptionHost", { host: props.hostName })
          : t("connector.onePassword.description")
      }
      readError={props.statusError}
      onRetry={props.onRetry}
      failure={failure()}
      tagline={props.tagline}
      intro={props.intro}
      details={props.details}
      danger={
        <VaultDangerZone
          show={!props.statusError && props.status.state === "connected"}
          title={t("connector.onePassword.disconnectTitle")}
          description={
            props.hostName
              ? t("connector.onePassword.disconnectSummaryHost", { host: props.hostName })
              : t("connector.onePassword.disconnectSummary")
          }
          action={t("connector.onePassword.disconnect")}
          busy={props.busy}
          onDisconnect={props.onDisconnect}
        />
      }
    >
      <Show when={!props.statusError}>
        <Show when={props.status.state !== "connected" && props.hostName}>
          {(host) => (
            <SettingsSection
              title={t("connector.onePassword.tokenLabel")}
              description={t("connector.onePassword.howItWorksHost", { host: host() })}
            >
              <ItemGroup class="settings-modal-card">
                <div class="integration-card-body">
                  <VaultSecretForm
                    label={t("connector.onePassword.tokenLabel")}
                    placeholder={t("connector.onePassword.tokenPlaceholder")}
                    submitLabel={t("connector.onePassword.connectWithToken")}
                    busy={props.busy || props.status.state !== "disconnected"}
                    onSubmit={props.onConnectWithToken}
                  />
                </div>
              </ItemGroup>
            </SettingsSection>
          )}
        </Show>

        <Show when={props.status.state !== "connected" && !props.hostName}>
          <SettingsSection
            title={t("connector.onePassword.setupTitle")}
            description={t("connector.onePassword.howItWorks")}
          >
            <ItemGroup class="settings-modal-card onepassword-connector-steps">
              <SetupStep
                state={steps().cli}
                title={t("connector.onePassword.stepCliTitle")}
                description={
                  props.status.setup.cli === "checking"
                    ? t("connector.onePassword.stepCliChecking")
                    : props.status.setup.cli === "installing"
                      ? t("connector.onePassword.stepCliInstalling")
                      : props.status.setup.cli === "ready"
                        ? t("connector.onePassword.stepCliReady", { version: props.status.setup.cliVersion ?? "" })
                        : props.status.setup.canInstall
                          ? t("connector.onePassword.stepCliMissing")
                          : t("connector.onePassword.stepCliManual")
                }
              >
                <Show when={props.status.setup.cli !== "ready" && props.status.setup.canInstall}>
                  <Button
                    type="button"
                    size="sm"
                    loading={props.status.setup.cli === "installing"}
                    disabled={props.busy || props.status.setup.cli === "checking"}
                    onClick={props.onInstallCli}
                  >
                    <Download aria-hidden="true" />
                    {t("connector.onePassword.installCli")}
                  </Button>
                </Show>
              </SetupStep>
              <SetupStep
                state={steps().app}
                title={t("connector.onePassword.stepAppTitle")}
                description={
                  steps().app === "done"
                    ? t("connector.onePassword.stepAppReady")
                    : t("connector.onePassword.stepAppDescription")
                }
              >
                <Show when={steps().app === "current"}>
                  <Button type="button" size="sm" variant="outline" onClick={props.onCheckSetup}>
                    <RefreshCw aria-hidden="true" />
                    {t("connector.onePassword.checkAgain")}
                  </Button>
                  <Button type="button" size="sm" onClick={props.onOpenApp}>
                    <ExternalLink aria-hidden="true" />
                    {t("connector.onePassword.openApp")}
                  </Button>
                </Show>
              </SetupStep>
              <SetupStep
                state={steps().vault}
                title={t("connector.onePassword.stepVaultTitle")}
                description={
                  props.status.state === "connecting"
                    ? t("connector.onePassword.approveInApp")
                    : t("connector.onePassword.stepVaultDescription")
                }
              >
                <Show
                  when={props.status.state === "connecting"}
                  fallback={
                    <Button
                      type="button"
                      size="sm"
                      variant={connectVariant()}
                      loading={props.busy && steps().vault === "current"}
                      disabled={steps().vault !== "current" || props.status.state === "choose-account"}
                      onClick={() => props.onConnect(null)}
                    >
                      {t("connector.onePassword.connect")}
                    </Button>
                  }
                >
                  <Spinner size="sm" label={t("connector.onePassword.approveInApp")} />
                  <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
                    {t("connector.onePassword.cancel")}
                  </Button>
                </Show>
              </SetupStep>
              <Show when={props.status.state === "disconnected"}>
                <Show
                  when={tokenOpen()}
                  fallback={
                    <Item class="settings-modal-row onepassword-connector-step">
                      <ItemMedia>
                        <KeyRound aria-hidden="true" />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{t("connector.onePassword.tokenLabel")}</ItemTitle>
                        <ItemDescription>{t("connector.onePassword.useTokenDescription")}</ItemDescription>
                      </ItemContent>
                      <ItemActions>
                        <Button type="button" size="sm" variant="outline" onClick={() => setTokenOpen(true)}>
                          {t("connector.onePassword.useTokenAction")}
                        </Button>
                      </ItemActions>
                    </Item>
                  }
                >
                  <div class="integration-card-body">
                    <VaultSecretForm
                      label={t("connector.onePassword.tokenLabel")}
                      placeholder={t("connector.onePassword.tokenPlaceholder")}
                      submitLabel={t("connector.onePassword.connectWithToken")}
                      busy={props.busy}
                      onSubmit={props.onConnectWithToken}
                      cancelVisible
                      onCancel={() => setTokenOpen(false)}
                    />
                  </div>
                </Show>
              </Show>
            </ItemGroup>
          </SettingsSection>
        </Show>

        <Show when={props.status.state === "choose-account"}>
          <SettingsSection
            title={t("connector.onePassword.chooseAccountTitle")}
            description={t("connector.onePassword.chooseAccountDescription")}
            actions={
              <Button type="button" size="sm" variant="outline" onClick={props.onCancel}>
                {t("connector.onePassword.cancel")}
              </Button>
            }
          >
            <ItemGroup class="settings-modal-card">
              <For each={props.status.accounts} keyed={(account) => account.id}>
                {(account) => (
                  <Item class="settings-modal-row">
                    <ItemContent>
                      <ItemTitle>{account().label}</ItemTitle>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={props.busy}
                        onClick={() => props.onConnect(account().id)}
                      >
                        {t("connector.onePassword.useAccount")}
                      </Button>
                    </ItemActions>
                  </Item>
                )}
              </For>
            </ItemGroup>
          </SettingsSection>
        </Show>

        <Show when={props.status.state === "connected"}>
          <SharedVaultSection
            title={t("connector.onePassword.vaultTitle")}
            description={t("connector.onePassword.vaultDescription")}
          >
            <For each={props.status.vaultNames}>
              {(name) => <VaultRow title={name} description={vaultDescription()} />}
            </For>
            <Show when={props.status.vaultNames.length !== 1}>
              <Text class="integration-card-note" variant="caption" tone="muted">
                {loginText()}
              </Text>
            </Show>
          </SharedVaultSection>
        </Show>
      </Show>
    </IntegrationPage>
  );
}

/** One setup step: a check when done, its text, and the buttons it needs while it is the current one. */
function SetupStep(props: { state: StepState; title: string; description: string; children: JSX.Element }) {
  return (
    <Item class="settings-modal-row onepassword-connector-step" data-step={props.state}>
      <ItemMedia>
        {props.state === "done" ? <CircleCheck aria-hidden="true" /> : <CircleDot aria-hidden="true" />}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{props.title}</ItemTitle>
        <ItemDescription aria-live="polite">{props.description}</ItemDescription>
      </ItemContent>
      <ItemActions>{props.children}</ItemActions>
    </Item>
  );
}
