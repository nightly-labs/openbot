import type { OnePasswordConnectorStatus, OnePasswordSetup } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  CircleCheck,
  CircleDot,
  Download,
  ExternalLink,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  OctagonX,
  RefreshCw,
  SettingsSection,
  Spinner,
  Text,
} from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { createSignal, For, onSettled, Show } from "solid-js";
import { useText } from "../../text";
import { DangerZone, DetailHeader, type IntegrationStatus, OnePasswordMark } from "./IntegrationLayout";

export interface OnePasswordConnectorPanelProps {
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
}

const HEADER_STATUS = {
  disconnected: { status: "idle", label: "connector.onePassword.statusNotSetUp" },
  connecting: { status: "idle", label: "connector.onePassword.statusConnecting" },
  "choose-account": { status: "idle", label: "connector.onePassword.statusConnecting" },
  connected: { status: "connected", label: "connector.onePassword.statusConnected" },
} as const satisfies Record<OnePasswordConnectorStatus["state"], { status: IntegrationStatus; label: string }>;

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
 * turn on its integration in the 1Password app, and create the shared vault. The page checks the
 * setup while it shows and when the window gets the focus back, so a step done in the 1Password app
 * is ticked without a click. A user without the CLI pastes a service account token instead.
 */
export function OnePasswordConnectorPanel(props: OnePasswordConnectorPanelProps) {
  const { t, sourceText } = useText();
  const [tokenOpen, setTokenOpen] = createSignal(false);
  const [token, setToken] = createSignal("");
  const header = () => HEADER_STATUS[props.status.state];
  const steps = () => setupSteps(props.status.setup);
  onSettled(() => props.onWatchSetup());
  const submitToken = (event: SubmitEvent) => {
    event.preventDefault();
    const value = token().trim();
    if (!value) return;
    props.onConnectWithToken(value);
    setToken("");
  };

  return (
    <div class="onepassword-connector">
      <DetailHeader
        logo={<OnePasswordMark />}
        name={t("connector.onePassword.title")}
        status={header().status}
        statusLabel={t(header().label)}
        subtitle={t("connector.onePassword.description")}
      />

      <Show when={props.status.error}>
        {(message) => (
          <Alert tone="danger" role="alert">
            <AlertIcon>
              <OctagonX />
            </AlertIcon>
            <AlertContent>
              <AlertTitle>{t("connector.onePassword.actionFailed")}</AlertTitle>
              <AlertDescription>{sourceText(message())}</AlertDescription>
            </AlertContent>
          </Alert>
        )}
      </Show>

      <Show when={props.status.state !== "connected"}>
        <Text variant="body-sm" tone="muted">
          {t("connector.onePassword.howItWorks")}
        </Text>
        <SettingsSection title={t("connector.onePassword.setupTitle")}>
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
          </ItemGroup>
        </SettingsSection>
      </Show>

      <Show when={props.status.state === "disconnected"}>
        <Show
          when={tokenOpen()}
          fallback={
            <Button
              type="button"
              size="sm"
              variant="link"
              class="onepassword-connector-link"
              onClick={() => setTokenOpen(true)}
            >
              {t("connector.onePassword.useToken")}
            </Button>
          }
        >
          <form class="onepassword-connector-token" onSubmit={submitToken}>
            <Input
              type="password"
              size="sm"
              autocomplete="off"
              spellcheck={false}
              aria-label={t("connector.onePassword.tokenLabel")}
              placeholder={t("connector.onePassword.tokenPlaceholder")}
              value={token()}
              onInput={(event) => setToken(event.currentTarget.value)}
            />
            <Button type="submit" size="sm" loading={props.busy} disabled={!token().trim()}>
              {t("connector.onePassword.connectWithToken")}
            </Button>
          </form>
        </Show>
      </Show>

      <Show when={props.status.state === "choose-account"}>
        <SettingsSection
          title={t("connector.onePassword.chooseAccountTitle")}
          description={t("connector.onePassword.chooseAccountDescription")}
          actions={
            <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
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
        <SettingsSection
          title={t("connector.onePassword.vaultTitle")}
          description={t("connector.onePassword.vaultDescription")}
        >
          <ItemGroup class="settings-modal-card">
            <For each={props.status.vaultNames}>
              {(name) => (
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemTitle>{name}</ItemTitle>
                  </ItemContent>
                </Item>
              )}
            </For>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemDescription>
                  {props.status.loginCount === null
                    ? t("connector.onePassword.loginsLoading")
                    : t("connector.onePassword.loginCount", { count: props.status.loginCount })}
                </ItemDescription>
              </ItemContent>
            </Item>
          </ItemGroup>
        </SettingsSection>
        <DangerZone
          title={t("connector.onePassword.disconnectTitle")}
          description={t("connector.onePassword.disconnectSummary")}
          action={t("connector.onePassword.disconnect")}
          busy={props.busy}
          onAction={props.onDisconnect}
        />
      </Show>
    </div>
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
