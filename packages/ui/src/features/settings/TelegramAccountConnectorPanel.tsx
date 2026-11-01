import type {
  TelegramAccount,
  TelegramAccountConnectInput,
  TelegramAccountConnectorState,
  TelegramAccountConnectorStatus,
  TelegramAccountSignInMethod,
  TelegramAccountSubmitInput,
} from "@openbot/contracts/ipc";
import {
  Button,
  ExternalLink,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  KeyRound,
  QrCode,
  SettingsSection,
  SlidingTabs,
  Spinner,
  SwitchField,
  Text,
} from "@openbot/ui";
import { createEffect, createStore, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { TelegramAccountMark } from "./brand-marks";
import { IntegrationPage, type IntegrationPageSlots } from "./IntegrationLayout";
import { VaultDangerZone, type VaultStatus, vaultFailure, vaultHeader } from "./VaultParts";

export interface TelegramAccountConnectorPanelProps extends IntegrationPageSlots {
  status: TelegramAccountConnectorStatus;
  /** True while an action runs. Every button that changes the connection waits for it. */
  busy: boolean;
  /** Starts a sign-in, or starts the one in progress again with another method. */
  onConnect: (input: TelegramAccountConnectInput) => void;
  /** Sends the value that the current step asks for. */
  onSubmit: (input: TelegramAccountSubmitInput) => void;
  /** Stops the sign-in in progress. */
  onCancel: () => void;
  onDisconnect: () => void;
  /** Lets agents send messages and mark chats as read, or stops them. */
  onSetSending: (enabled: boolean) => void;
  /** Opens my.telegram.org, where the user gets the api_id and api_hash of a Telegram app. */
  onOpenApps: () => void;
  /**
   * The joined server whose connection this is, or undefined for this computer's. The server keeps
   * the session; this computer only shows the steps.
   */
  hostName?: string | undefined;
  /**
   * Why the last status read failed, when no newer status came. The state is not known: the page
   * shows the reason and Retry, not the sign-in of a connection that may be there.
   */
  statusError?: string | null | undefined;
  /** Reads the status again. */
  onRetry?: (() => void) | undefined;
}

const SIGNING_IN = { status: "connecting", label: "connector.telegramAccount.statusConnecting" } as const;

/** The status of the connection, as its page header and every list of connectors show it. */
export const TELEGRAM_ACCOUNT_STATUS = {
  disconnected: { status: "idle", label: "marketplace.app.notConnected" },
  connecting: SIGNING_IN,
  qr: SIGNING_IN,
  phone: SIGNING_IN,
  code: SIGNING_IN,
  password: SIGNING_IN,
  connected: { status: "connected", label: "connector.telegramAccount.statusConnected" },
} as const satisfies Record<TelegramAccountConnectorState, VaultStatus>;

/** The header status: not known after a failed read, else the entry of the status table. */
export function telegramAccountStatus(props: Pick<TelegramAccountConnectorPanelProps, "status" | "statusError">) {
  return vaultHeader(props.statusError, TELEGRAM_ACCOUNT_STATUS[props.status.state]);
}

/** The second line of the account: the username and the phone number with its middle hidden. */
export function telegramAccountLine(account: TelegramAccount): string {
  return [account.username ? `@${account.username}` : null, account.phone].filter(Boolean).join(" · ");
}

/** What the user types and chooses on the page. Nothing of it leaves the page except through the actions. */
interface SignInForm {
  method: TelegramAccountSignInMethod;
  /** The api_id and api_hash fields show. */
  credentialsOpen: boolean;
  apiId: string;
  apiHash: string;
  /** The phone number, the code or the password that the current step asks for. */
  value: string;
  /** A connect was sent, and the sign-in did not reach a step yet. */
  starting: boolean;
}

/** An api_id is a positive number. Telegram gives it with at most 10 digits. */
const API_ID_PATTERN = /^[1-9]\d{0,9}$/u;
/** The longest value that the host takes for one step. */
const VALUE_LIMIT = 256;

/**
 * The Telegram account page of this computer or of a joined server. OpenBot signs in to the user's own
 * account, as Telegram Desktop does. The page shows the step that main or the host is at: the QR code,
 * the phone number, the code, the two-step password, then the account with the sending switch.
 *
 * The status does not say whether the api_id and api_hash are stored, so the page first connects with
 * none, and opens their fields when that sign-in ends at once with an error: no credentials, credentials
 * in the wrong form, or credentials that Telegram does not accept. A value is cleared from the page when
 * it is sent, so the page keeps no copy of a code or a password.
 */
export function TelegramAccountConnectorPanel(props: TelegramAccountConnectorPanelProps) {
  const { t } = useText();
  const [form, setForm] = createStore<SignInForm>({
    method: "qr",
    credentialsOpen: false,
    apiId: "",
    apiHash: "",
    value: "",
    starting: false,
  });
  const header = () => telegramAccountStatus(props);
  const failure = () =>
    vaultFailure(t("connector.telegramAccount.actionFailed"), props.statusError, props.status.error);
  const signingIn = () => props.status.state !== "disconnected" && props.status.state !== "connected";
  const host = () => props.hostName;

  // A new step asks for a new value. The value of the step before is not kept.
  createEffect(
    () => props.status.state,
    () => {
      setForm((state) => {
        state.value = "";
      });
    },
  );
  // A connect that ends at once with an error: the api_id and api_hash are missing, in the wrong form or
  // not accepted by Telegram. A sign-in that reached a step had good credentials.
  createEffect(
    () => ({ state: props.status.state, error: props.status.error }),
    ({ state, error }) => {
      if (!form.starting || state === "connecting") return;
      setForm((draft) => {
        draft.starting = false;
        if (state !== "disconnected") {
          draft.credentialsOpen = false;
          draft.apiId = "";
          draft.apiHash = "";
        } else if (error) draft.credentialsOpen = true;
      });
    },
  );

  /** The credentials to send: null for both to use the stored ones, or undefined while they are incomplete. */
  const credentials = (): Pick<TelegramAccountConnectInput, "apiId" | "apiHash"> | undefined => {
    const apiId = form.apiId.trim();
    const apiHash = form.apiHash.trim().toLowerCase();
    if (!form.credentialsOpen || (!apiId && !apiHash)) return { apiId: null, apiHash: null };
    if (!API_ID_PATTERN.test(apiId) || !apiHash) return undefined;
    return { apiId: Number(apiId), apiHash };
  };
  const connect = (method: TelegramAccountSignInMethod) => {
    const given = credentials();
    if (!given || props.busy) return;
    setForm((state) => {
      state.starting = true;
      state.apiHash = "";
    });
    props.onConnect({ method, ...given });
  };
  /** Another method while a sign-in runs: the same stored credentials, a new start. */
  const switchMethod = (method: TelegramAccountSignInMethod) => {
    if (props.busy) return;
    setForm((state) => {
      state.method = method;
    });
    props.onConnect({ method, apiId: null, apiHash: null });
  };
  const submit = (event: SubmitEvent, field: TelegramAccountSubmitInput["field"]) => {
    event.preventDefault();
    const value = field === "password" ? form.value : form.value.trim();
    if (!value || props.busy) return;
    setForm((state) => {
      state.value = "";
    });
    props.onSubmit({ field, value });
  };
  const closeCredentials = () =>
    setForm((state) => {
      state.credentialsOpen = false;
      state.apiId = "";
      state.apiHash = "";
    });

  const codeText = () =>
    props.status.codeViaApp === true
      ? t("connector.telegramAccount.codeViaApp")
      : props.status.codeViaApp === false
        ? t("connector.telegramAccount.codeViaSms")
        : t("connector.telegramAccount.codeDescription");

  /** One field and its submit button: the phone number, the code or the password. */
  const StepForm = (step: {
    field: TelegramAccountSubmitInput["field"];
    label: string;
    submitLabel: string;
    type: "tel" | "text" | "password";
    autocomplete: string;
    inputmode?: "numeric" | "tel" | undefined;
    placeholder?: string | undefined;
  }) => (
    <form class="telegram-account-step-form" onSubmit={(event) => submit(event, step.field)}>
      <Field label={step.label}>
        <Input
          type={step.type}
          size="sm"
          autocomplete={step.autocomplete}
          inputmode={step.inputmode}
          spellcheck={false}
          maxlength={VALUE_LIMIT}
          placeholder={step.placeholder}
          value={form.value}
          onInput={(event) =>
            setForm((state) => {
              state.value = event.currentTarget.value;
            })
          }
        />
      </Field>
      <Button type="submit" size="sm" loading={props.busy} disabled={!form.value.trim()}>
        {step.submitLabel}
      </Button>
    </form>
  );

  return (
    <IntegrationPage
      class="telegram-account-connector"
      logo={<TelegramAccountMark />}
      name={t("connector.telegramAccount.title")}
      status={header().status}
      statusLabel={t(header().label)}
      subtitle={
        host()
          ? t("connector.telegramAccount.descriptionHost", { host: host() ?? "" })
          : t("connector.telegramAccount.description")
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
          title={t("connector.telegramAccount.disconnectTitle")}
          description={
            host()
              ? t("connector.telegramAccount.disconnectSummaryHost", { host: host() ?? "" })
              : t("connector.telegramAccount.disconnectSummary")
          }
          action={t("connector.telegramAccount.disconnect")}
          busy={props.busy}
          onDisconnect={props.onDisconnect}
        />
      }
    >
      <Show when={!props.statusError}>
        <Show when={props.status.state === "disconnected"}>
          <SettingsSection
            title={t("connector.telegramAccount.signInTitle")}
            description={
              host()
                ? t("connector.telegramAccount.howItWorksHost", { host: host() ?? "" })
                : t("connector.telegramAccount.howItWorks")
            }
          >
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row telegram-account-row">
                <ItemContent>
                  <ItemTitle>{t("connector.telegramAccount.methodTitle")}</ItemTitle>
                  <ItemDescription>
                    {form.method === "qr"
                      ? t("connector.telegramAccount.methodQrDescription")
                      : t("connector.telegramAccount.methodPhoneDescription")}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <SlidingTabs.Root
                    value={form.method}
                    onChange={(value: string) =>
                      setForm((state) => {
                        state.method = value === "phone" ? "phone" : "qr";
                      })
                    }
                  >
                    <SlidingTabs.List aria-label={t("connector.telegramAccount.methodTitle")}>
                      <SlidingTabs.Trigger value="qr">{t("connector.telegramAccount.methodQr")}</SlidingTabs.Trigger>
                      <SlidingTabs.Trigger value="phone">
                        {t("connector.telegramAccount.methodPhone")}
                      </SlidingTabs.Trigger>
                    </SlidingTabs.List>
                  </SlidingTabs.Root>
                </ItemActions>
              </Item>
              <Show
                when={form.credentialsOpen}
                fallback={
                  <Item class="settings-modal-row telegram-account-row">
                    <ItemMedia>
                      <KeyRound aria-hidden="true" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t("connector.telegramAccount.credentialsTitle")}</ItemTitle>
                      <ItemDescription>
                        {host()
                          ? t("connector.telegramAccount.credentialsStoredHost", { host: host() ?? "" })
                          : t("connector.telegramAccount.credentialsStored")}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setForm((state) => {
                            state.credentialsOpen = true;
                          })
                        }
                      >
                        {t("connector.telegramAccount.credentialsOpen")}
                      </Button>
                    </ItemActions>
                  </Item>
                }
              >
                <div class="integration-card-body telegram-account-credentials">
                  <Text variant="caption" tone="muted">
                    {t("connector.telegramAccount.credentialsHelp")}
                  </Text>
                  <div class="telegram-account-credential-fields">
                    <Field label={t("connector.telegramAccount.apiId")}>
                      <Input
                        size="sm"
                        inputmode="numeric"
                        autocomplete="off"
                        spellcheck={false}
                        maxlength={10}
                        value={form.apiId}
                        onInput={(event) =>
                          setForm((state) => {
                            state.apiId = event.currentTarget.value;
                          })
                        }
                      />
                    </Field>
                    <Field label={t("connector.telegramAccount.apiHash")}>
                      <Input
                        type="password"
                        size="sm"
                        autocomplete="off"
                        spellcheck={false}
                        maxlength={64}
                        value={form.apiHash}
                        onInput={(event) =>
                          setForm((state) => {
                            state.apiHash = event.currentTarget.value;
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div class="telegram-account-actions">
                    <Button type="button" size="sm" variant="outline" onClick={() => props.onOpenApps()}>
                      <ExternalLink aria-hidden="true" />
                      {t("connector.telegramAccount.openApps")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={closeCredentials}>
                      {t("common.cancel")}
                    </Button>
                  </div>
                </div>
              </Show>
              <div class="integration-card-body">
                <div class="telegram-account-actions">
                  <Button
                    type="button"
                    size="sm"
                    loading={props.busy}
                    disabled={credentials() === undefined}
                    onClick={() => connect(form.method)}
                  >
                    {t("connector.telegramAccount.connect")}
                  </Button>
                </div>
              </div>
              <Text class="integration-card-note" variant="caption" tone="muted">
                {t("connector.telegramAccount.sendingOffNote")}
              </Text>
            </ItemGroup>
          </SettingsSection>
        </Show>

        <Show when={signingIn()}>
          <SettingsSection
            title={t("connector.telegramAccount.signInTitle")}
            description={t("connector.telegramAccount.signInProgress")}
            actions={
              <Button type="button" size="sm" variant="outline" onClick={() => props.onCancel()}>
                {t("common.cancel")}
              </Button>
            }
          >
            <ItemGroup class="settings-modal-card">
              <Switch>
                <Match when={props.status.state === "connecting"}>
                  <Item class="settings-modal-row telegram-account-row">
                    <ItemMedia>
                      <Spinner size="sm" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t("connector.telegramAccount.connecting")}</ItemTitle>
                      <ItemDescription aria-live="polite">
                        {host()
                          ? t("connector.telegramAccount.connectingHost", { host: host() ?? "" })
                          : t("connector.telegramAccount.connectingDescription")}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                </Match>
                <Match when={props.status.state === "qr" ? props.status.qrUrl : null}>
                  {(url) => (
                    <div class="integration-card-body telegram-account-qr">
                      <QrCode value={url()} size={176} label={t("connector.telegramAccount.qrLabel")} />
                      <div class="telegram-account-qr-copy">
                        <Text variant="label">{t("connector.telegramAccount.qrTitle")}</Text>
                        <ol class="telegram-account-qr-steps">
                          <li>{t("connector.telegramAccount.qrStepOpen")}</li>
                          <li>{t("connector.telegramAccount.qrStepDevices")}</li>
                          <li>{t("connector.telegramAccount.qrStepScan")}</li>
                        </ol>
                        <Text variant="caption" tone="muted">
                          {t("connector.telegramAccount.qrRefresh")}
                        </Text>
                        <div class="telegram-account-actions">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={props.busy}
                            onClick={() => switchMethod("phone")}
                          >
                            {t("connector.telegramAccount.usePhone")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Match>
                <Match when={props.status.state === "phone"}>
                  <div class="integration-card-body">
                    <Text variant="caption" tone="muted">
                      {t("connector.telegramAccount.phoneDescription")}
                    </Text>
                    <StepForm
                      field="phone"
                      label={t("connector.telegramAccount.phoneLabel")}
                      submitLabel={t("connector.telegramAccount.sendCode")}
                      type="tel"
                      autocomplete="tel"
                      inputmode="tel"
                      placeholder={t("connector.telegramAccount.phonePlaceholder")}
                    />
                    <div class="telegram-account-actions">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={props.busy}
                        onClick={() => switchMethod("qr")}
                      >
                        {t("connector.telegramAccount.useQr")}
                      </Button>
                    </div>
                  </div>
                </Match>
                <Match when={props.status.state === "code"}>
                  <div class="integration-card-body">
                    <Text variant="caption" tone="muted" aria-live="polite">
                      {codeText()}
                    </Text>
                    <StepForm
                      field="code"
                      label={t("connector.telegramAccount.codeLabel")}
                      submitLabel={t("connector.telegramAccount.signIn")}
                      type="text"
                      autocomplete="one-time-code"
                      inputmode="numeric"
                    />
                  </div>
                </Match>
                <Match when={props.status.state === "password"}>
                  <div class="integration-card-body">
                    <Text variant="caption" tone="muted">
                      {t("connector.telegramAccount.passwordDescription")}
                    </Text>
                    <Show when={props.status.passwordHint}>
                      {(hint) => (
                        <Text variant="caption" tone="muted">
                          {t("connector.telegramAccount.passwordHint", { hint: hint() })}
                        </Text>
                      )}
                    </Show>
                    <StepForm
                      field="password"
                      label={t("connector.telegramAccount.passwordLabel")}
                      submitLabel={t("connector.telegramAccount.signIn")}
                      type="password"
                      autocomplete="current-password"
                    />
                  </div>
                </Match>
              </Switch>
            </ItemGroup>
          </SettingsSection>
        </Show>

        <Show when={props.status.state === "connected" ? props.status.account : null}>
          {(account) => (
            <SettingsSection
              title={t("connector.telegramAccount.accountTitle")}
              description={
                host()
                  ? t("connector.telegramAccount.accountDescriptionHost", { host: host() ?? "" })
                  : t("connector.telegramAccount.accountDescription")
              }
            >
              <ItemGroup class="settings-modal-card">
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemTitle>{account().name}</ItemTitle>
                    <Show when={telegramAccountLine(account())}>
                      {(line) => <ItemDescription>{line()}</ItemDescription>}
                    </Show>
                  </ItemContent>
                </Item>
                <SwitchField
                  class="settings-modal-row"
                  checked={props.status.sendingEnabled}
                  disabled={props.busy}
                  onChange={(checked) => props.onSetSending(checked)}
                  label={t("connector.telegramAccount.sendingLabel")}
                  description={t("connector.telegramAccount.sendingDescription")}
                />
                <Text class="integration-card-note" variant="caption" tone="muted">
                  {host()
                    ? t("connector.telegramAccount.devicesNoteHost", { host: host() ?? "" })
                    : t("connector.telegramAccount.devicesNote")}
                </Text>
              </ItemGroup>
            </SettingsSection>
          )}
        </Show>
      </Show>
    </IntegrationPage>
  );
}
