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
  PlushLoader,
  RefreshCw,
  SettingsSection,
  Text,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { OnePasswordTile } from "./brand-marks";
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
  busy: boolean;
  onWatchSetup: () => () => void;
  onCheckSetup: () => void;
  onInstallCli: () => void;
  onOpenApp: () => void;
  onConnect: (accountId: string | null) => void;
  onConnectWithToken: (token: string) => void;
  onCancel: () => void;
  onDisconnect: () => void;
  hostName?: string | undefined;
  statusError?: string | null | undefined;
  onRetry?: (() => void) | undefined;
}

export const ONEPASSWORD_STATUS = {
  disconnected: { status: "idle", label: "marketplace.app.notConnected" },
  connecting: { status: "connecting", label: "connector.onePassword.statusConnecting" },
  "choose-account": { status: "connecting", label: "connector.onePassword.statusConnecting" },
  connected: { status: "connected", label: "connector.onePassword.statusConnected" },
} as const satisfies Record<OnePasswordConnectorStatus["state"], VaultStatus>;

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
  const vaultDescription = () => (props.status.vaultNames.length === 1 ? loginText() : undefined);

  return (
    <IntegrationPage
      class="onepassword-connector"
      logo={<OnePasswordTile />}
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
                  <PlushLoader size={24} label={t("connector.onePassword.approveInApp")} />
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
