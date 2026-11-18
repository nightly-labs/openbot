import type { PasswordManagerStatus } from "@openbot/contracts/ipc";
import {
  Alert,
  AlertActions,
  AlertContent,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  buttonVariants,
  CopyButton,
  DropdownMenu,
  Ellipsis,
  ExternalLink,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  KeyRound,
  PlushLoader,
  SettingsSection,
  TriangleAlert,
} from "@openbot/ui";
import { createEffect, createSignal, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { ProtonPassTile } from "./brand-marks";
import {
  IntegrationPage,
  type IntegrationPageSlots,
  Stepper,
  WizardDialog,
  type WizardLink,
} from "./IntegrationLayout";
import {
  SharedVaultSection,
  VaultDangerZone,
  VaultRow,
  VaultSecretForm,
  type VaultStatus,
  vaultFailure,
  vaultHeader,
} from "./VaultParts";

export interface ProtonPassConnectorPanelProps extends IntegrationPageSlots {
  /** The status from the shared password manager engine. It never holds a key or a password. */
  status: PasswordManagerStatus;
  /** True while an action runs. Every button waits for it. */
  busy: boolean;
  /** The joined server whose connection this is. Absent: this computer's. */
  hostName?: string | undefined;
  /**
   * Why the last status read failed, when no newer status came. The state is not known: the page
   * shows the reason and Retry, not the setup of a connection that may be there.
   */
  statusError?: string | null | undefined;
  /** Reads the status again. */
  onRetry?: (() => void) | undefined;
  /** Starts the sign-in in the browser. The host makes the shared vault and its read-only key after it. */
  onConnect: () => void;
  /** Connects with an access key that the user made. */
  onConnectWithKey: (key: string) => void;
  /** Sends the extra password that Proton Pass asks for during the sign-in. */
  onSubmitExtraPassword: (password: string) => void;
  /** Stops the sign-in. */
  onCancel: () => void;
  onDisconnect: () => void;
  /** Opens the sign-in page in the browser again. */
  onOpenSignIn: () => void;
}

/**
 * The connect dialog shows one of these. `failed` is a sign-in that stopped, and `connected` stays
 * until the user closes the dialog.
 */
type ConnectStep = "browser" | "extra-password" | "setup" | "connected" | "failed";

function connectStep(status: PasswordManagerStatus): ConnectStep {
  if (status.state === "connected") return "connected";
  if (status.state === "signing-in") return status.step ?? "browser";
  return "failed";
}

/** The index of the step in the dialog's stepper. */
const STEP_INDEX = { browser: 0, "extra-password": 0, setup: 1, connected: 2, failed: 0 } as const satisfies Record<
  ConnectStep,
  number
>;

/** True when the host's access key expired, so the user connects again. */
function expired(status: PasswordManagerStatus): boolean {
  if (status.errorCode === "expired") return true;
  return status.state === "connected" && status.expiresAt !== null && status.expiresAt <= Date.now();
}

/** True while the page shows the shared vault: the connection is there, also with an expired key. */
function linked(status: PasswordManagerStatus): boolean {
  return status.state === "connected" || expired(status);
}

const PROTON_PASS_STATUS = {
  disconnected: { status: "idle", label: "marketplace.app.notConnected" },
  connecting: { status: "connecting", label: "connector.protonPass.statusConnecting" },
  connected: { status: "connected", label: "connector.protonPass.statusConnected" },
  expired: { status: "attention", label: "connector.protonPass.statusExpired" },
} as const satisfies Record<"disconnected" | "connecting" | "connected" | "expired", VaultStatus>;

/** The status of the connection, as its page header and every list of connectors show it. */
export function protonPassStatus(props: Pick<ProtonPassConnectorPanelProps, "status" | "statusError">) {
  const status = props.status;
  const state = expired(status)
    ? "expired"
    : status.state === "signing-in"
      ? "connecting"
      : status.state === "connected"
        ? "connected"
        : "disconnected";
  return vaultHeader(props.statusError, PROTON_PASS_STATUS[state]);
}

/**
 * The Proton Pass page of one OpenBot computer or joined server. The host runs the Proton sign-in,
 * and this computer opens the sign-in page in the browser. Then the host makes the shared vault and a
 * read-only access key for it, and keeps only that key.
 *
 * Connect opens a dialog with the steps. × closes the dialog and the sign-in goes on: the page shows
 * the current step, and "Show steps" opens the dialog again. Cancel stops the sign-in. The ⋯ menu has
 * the other way in, an access key that the user made.
 */
export function ProtonPassConnectorPanel(props: ProtonPassConnectorPanelProps) {
  const { t, format } = useText();
  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [keyOpen, setKeyOpen] = createSignal(false);
  // A sign-in that runs when the page opens, or that asks for the extra password, shows its dialog.
  createEffect(
    () => (props.status.state === "signing-in" ? (props.status.step ?? "browser") : null),
    (step) => {
      if (step === "browser" || step === "extra-password") setDialogOpen(true);
    },
  );
  const header = () => protonPassStatus(props);
  const signingIn = () => props.status.state === "signing-in";
  const idle = () => !props.statusError && !signingIn() && !linked(props.status);
  const failure = () => {
    const code = props.status.errorCode;
    if (dialogOpen() || code === "plan" || code === "expired") return null;
    return vaultFailure(t("connector.protonPass.actionFailed"), props.statusError, props.status.error);
  };
  const vaultName = () => props.status.vaultNames[0] ?? t("connector.protonPass.vaultName");
  const keyDescription = () => {
    const expiresAt = props.status.expiresAt;
    if (expiresAt === null) return t("connector.protonPass.keyNoExpiry");
    const date = format.date(expiresAt, { dateStyle: "long" });
    return expired(props.status)
      ? t("connector.protonPass.keyExpired", { date })
      : t("connector.protonPass.keyExpires", { date });
  };
  const loginCount = () => {
    const count = props.status.loginCount;
    return count === null ? t("connector.protonPass.loginsLoading") : t("connector.protonPass.loginCount", { count });
  };

  const connect = () => {
    setKeyOpen(false);
    setDialogOpen(true);
    props.onConnect();
  };
  const cancel = () => {
    setDialogOpen(false);
    props.onCancel();
  };

  return (
    <IntegrationPage
      class="proton-pass-connector"
      logo={<ProtonPassTile />}
      name={t("connector.protonPass.title")}
      subtitle={
        props.hostName
          ? t("connector.protonPass.descriptionHost", { host: props.hostName })
          : t("connector.protonPass.description")
      }
      status={header().status}
      statusLabel={t(header().label)}
      readError={props.statusError}
      onRetry={props.onRetry}
      actions={
        <Show when={idle()}>
          <Button type="button" size="sm" loading={props.busy} onClick={connect}>
            {t("connector.protonPass.connect")}
          </Button>
          <Show when={props.status.methods.includes("key")}>
            <MoreMenu disabled={props.busy} onUseKey={() => setKeyOpen(true)} />
          </Show>
        </Show>
      }
      failure={failure()}
      alert={
        <Switch>
          <Match when={!props.statusError && expired(props.status)}>
            <Alert tone="warning" role="alert">
              <AlertIcon>
                <TriangleAlert />
              </AlertIcon>
              <AlertContent>
                <AlertTitle>{t("connector.protonPass.expiredTitle")}</AlertTitle>
                <AlertDescription>{t("connector.protonPass.expiredDescription")}</AlertDescription>
              </AlertContent>
              <AlertActions>
                <Button type="button" size="sm" loading={props.busy} onClick={connect}>
                  {t("connector.protonPass.reconnect")}
                </Button>
              </AlertActions>
            </Alert>
          </Match>
          <Match when={!props.statusError && !dialogOpen() && props.status.errorCode === "plan"}>
            <Alert tone="warning" role="alert">
              <AlertIcon>
                <TriangleAlert />
              </AlertIcon>
              <AlertContent>
                <AlertTitle>{t("connector.protonPass.planTitle")}</AlertTitle>
                <AlertDescription>{t("connector.protonPass.planDescription")}</AlertDescription>
              </AlertContent>
            </Alert>
          </Match>
        </Switch>
      }
      tagline={props.tagline}
      intro={props.intro}
      details={props.details}
      // With the state not known, the page offers neither the setup nor Disconnect.
      danger={
        <VaultDangerZone
          show={!props.statusError && linked(props.status)}
          title={t("connector.protonPass.disconnectTitle")}
          description={
            props.hostName
              ? t("connector.protonPass.disconnectSummaryHost", { host: props.hostName })
              : t("connector.protonPass.disconnectSummary")
          }
          action={t("connector.protonPass.disconnect")}
          busy={props.busy}
          onDisconnect={props.onDisconnect}
        />
      }
    >
      <Show when={!props.statusError}>
        <Show
          when={linked(props.status)}
          fallback={
            <SettingsSection
              title={t("connector.protonPass.setupTitle")}
              description={
                props.hostName
                  ? t("connector.protonPass.setupDescriptionHost", { host: props.hostName })
                  : t("connector.protonPass.setupDescription")
              }
            >
              <ItemGroup class="settings-modal-card">
                <Show
                  when={signingIn()}
                  fallback={
                    <Show
                      when={keyOpen()}
                      fallback={<VaultRow title={vaultName()} description={t("connector.protonPass.vaultSetup")} />}
                    >
                      <div class="integration-card-body">
                        <VaultSecretForm
                          label={t("connector.protonPass.keyLabel")}
                          placeholder={t("connector.protonPass.keyPlaceholder")}
                          submitLabel={t("connector.protonPass.connect")}
                          busy={props.busy}
                          onSubmit={props.onConnectWithKey}
                          cancelVisible
                          onCancel={() => setKeyOpen(false)}
                        />
                      </div>
                    </Show>
                  }
                >
                  <StepRow status={props.status} hostName={props.hostName} onShowSteps={() => setDialogOpen(true)} />
                </Show>
              </ItemGroup>
            </SettingsSection>
          }
        >
          <SharedVaultSection
            title={t("connector.protonPass.vaultTitle")}
            description={t("connector.protonPass.vaultDescription")}
          >
            <VaultRow title={vaultName()} description={loginCount()} />
            <VaultRow title={t("connector.protonPass.keyLabel")} description={keyDescription()} />
          </SharedVaultSection>
        </Show>
      </Show>

      <ConnectDialog
        open={dialogOpen()}
        status={props.status}
        busy={props.busy}
        hostName={props.hostName}
        vaultName={vaultName()}
        onClose={() => setDialogOpen(false)}
        onCancel={cancel}
        onConnect={connect}
        onOpenSignIn={props.onOpenSignIn}
        onSubmitExtraPassword={props.onSubmitExtraPassword}
      />
    </IntegrationPage>
  );
}

/** The ⋯ button in the header, with the other way in. */
function MoreMenu(props: { disabled: boolean; onUseKey: () => void }) {
  const { t } = useText();
  return (
    <DropdownMenu.Root placement="bottom-end" gutter={4}>
      <DropdownMenu.Trigger
        class={`${buttonVariants({ variant: "ghost", size: "icon-sm" })} ui-icon-button`}
        aria-label={t("connector.protonPass.moreWays")}
        disabled={props.disabled}
      >
        <Ellipsis aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content class="marketplace-menu">
          <DropdownMenu.Item onSelect={() => props.onUseKey()}>
            <KeyRound aria-hidden="true" />
            {t("connector.protonPass.useKey")}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The title and the description of the dialog, and of the page row while the sign-in runs. */
function stepText(
  status: PasswordManagerStatus,
  hostName: string | undefined,
  vaultName: string,
  text: ReturnType<typeof useText>,
) {
  const { t, sourceText } = text;
  switch (connectStep(status)) {
    case "browser":
      return {
        title: t("connector.protonPass.signInTitle"),
        description: !status.signInUrl
          ? t("connector.protonPass.signInStarting")
          : hostName
            ? t("connector.protonPass.signInDescriptionHost", { host: hostName })
            : t("connector.protonPass.signInDescription"),
      };
    case "extra-password":
      return {
        title: t("connector.protonPass.signInTitle"),
        description:
          status.errorCode === "extra-password"
            ? t("connector.protonPass.extraPasswordWrong")
            : t("connector.protonPass.extraPasswordDescription"),
      };
    case "setup":
      return {
        title: t("connector.protonPass.setupStepTitle"),
        description: t("connector.protonPass.setupStepDescription", { vault: vaultName }),
      };
    case "connected":
      return {
        title: t("connector.protonPass.doneTitle"),
        description: t("connector.protonPass.doneDescription", { vault: vaultName }),
      };
    case "failed":
      return {
        title: t("connector.protonPass.failedTitle"),
        description:
          status.errorCode === "plan"
            ? t("connector.protonPass.planDescription")
            : status.error
              ? sourceText(status.error)
              : t("connector.protonPass.actionFailed"),
      };
  }
}

/** The page row of a sign-in that runs, with the way back to its dialog. */
function StepRow(props: { status: PasswordManagerStatus; hostName: string | undefined; onShowSteps: () => void }) {
  const text = useText();
  const vaultName = () => props.status.vaultNames[0] ?? text.t("connector.protonPass.vaultName");
  const current = () => stepText(props.status, props.hostName, vaultName(), text);
  return (
    <Item class="settings-modal-row onepassword-connector-step">
      <ItemMedia>
        <PlushLoader size={24} label={current().title} />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{current().title}</ItemTitle>
        <ItemDescription aria-live="polite">{current().description}</ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button type="button" size="sm" variant="outline" onClick={() => props.onShowSteps()}>
          {text.t("connector.protonPass.showSteps")}
        </Button>
      </ItemActions>
    </Item>
  );
}

function ConnectDialog(props: {
  open: boolean;
  status: PasswordManagerStatus;
  busy: boolean;
  hostName: string | undefined;
  vaultName: string;
  /** Closes the dialog. The sign-in goes on. */
  onClose: () => void;
  /** Stops the sign-in and closes the dialog. */
  onCancel: () => void;
  onConnect: () => void;
  onOpenSignIn: () => void;
  onSubmitExtraPassword: (password: string) => void;
}) {
  const text = useText();
  const { t } = text;
  const [password, setPassword] = createSignal("");
  const step = () => connectStep(props.status);
  const current = () => stepText(props.status, props.hostName, props.vaultName, text);
  const link = (): WizardLink => {
    const value = step();
    if (value === "connected") return "connected";
    return value === "failed" ? "broken" : "connecting";
  };
  const steps = () => [
    t("connector.protonPass.stepSignIn"),
    t("connector.protonPass.stepVault"),
    t("connector.protonPass.stepDone"),
  ];
  const stepIndex = () => (step() === "connected" ? steps().length : STEP_INDEX[step()]);
  const submitPassword = () => {
    const value = password();
    if (step() !== "extra-password" || !value || props.busy) return;
    setPassword("");
    props.onSubmitExtraPassword(value);
  };
  const close = () => {
    setPassword("");
    props.onClose();
  };
  return (
    <WizardDialog
      open={props.open}
      dismissible={false}
      closeLabel={t("connector.protonPass.close")}
      onClose={close}
      logo={<ProtonPassTile />}
      link={link()}
      title={current().title}
      description={current().description}
      stepper={<Stepper steps={steps()} current={stepIndex()} label={t("connector.protonPass.stepsLabel")} />}
      onSubmit={submitPassword}
      footer={
        <Switch>
          <Match when={step() === "browser"}>
            <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
              {t("common.cancel")}
            </Button>
            <Show when={props.status.signInUrl}>
              {(url) => (
                <CopyButton
                  value={url()}
                  size="sm"
                  variant="outline"
                  label={t("connector.protonPass.copyLink")}
                  copiedLabel={t("connector.protonPass.linkCopied")}
                />
              )}
            </Show>
            <Button type="button" size="sm" disabled={!props.status.signInUrl} onClick={() => props.onOpenSignIn()}>
              <ExternalLink aria-hidden="true" />
              {t("connector.protonPass.openAgain")}
            </Button>
          </Match>
          <Match when={step() === "extra-password"}>
            <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" size="sm" loading={props.busy} disabled={!password()}>
              {t("connector.protonPass.continue")}
            </Button>
          </Match>
          <Match when={step() === "setup"}>
            <Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
              {t("common.cancel")}
            </Button>
          </Match>
          <Match when={step() === "failed"}>
            <Button type="button" size="sm" variant="ghost" onClick={close}>
              {t("connector.protonPass.close")}
            </Button>
            <Show when={props.status.errorCode !== "plan"}>
              <Button type="button" size="sm" loading={props.busy} onClick={() => props.onConnect()}>
                {t("connector.protonPass.connect")}
              </Button>
            </Show>
          </Match>
          <Match when={step() === "connected"}>
            <Button type="button" size="sm" onClick={close}>
              {t("connector.protonPass.done")}
            </Button>
          </Match>
        </Switch>
      }
    >
      <Switch>
        <Match when={step() === "extra-password"}>
          <Input
            type="password"
            autocomplete="off"
            aria-label={t("connector.protonPass.extraPasswordLabel")}
            aria-invalid={props.status.errorCode === "extra-password" ? "true" : undefined}
            value={password()}
            onInput={(event) => setPassword(event.currentTarget.value)}
          />
        </Match>
        <Match when={step() === "browser" || step() === "setup"}>
          <div class="github-connector-center">
            <PlushLoader size={48} label={current().title} />
          </div>
        </Match>
      </Switch>
    </WizardDialog>
  );
}
