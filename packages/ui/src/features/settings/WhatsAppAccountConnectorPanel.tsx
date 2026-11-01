import type {
  WhatsAppAccountConnectInput,
  WhatsAppAccountConnectorState,
  WhatsAppAccountConnectorStatus,
  WhatsAppAccountLinkMethod,
  WhatsAppAccountSubmitInput,
} from "@openbot/contracts/ipc";
import {
  Button,
  Field,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
  MessageCircle,
  QrCode,
  SettingsSection,
  SlidingTabs,
  Spinner,
  SwitchField,
  Text,
  TriangleAlert,
} from "@openbot/ui";
import { createEffect, createStore, Match, Show, Switch } from "solid-js";
import { useText } from "../../text";
import { IntegrationPage, type IntegrationPageSlots } from "./IntegrationLayout";
import { VaultDangerZone, type VaultStatus, vaultFailure, vaultHeader } from "./VaultParts";

export interface WhatsAppAccountConnectorPanelProps extends IntegrationPageSlots {
  status: WhatsAppAccountConnectorStatus;
  /** True while an action runs. Every button that changes the connection waits for it. */
  busy: boolean;
  /** Starts a link, or starts the one in progress again with another method. */
  onConnect: (input: WhatsAppAccountConnectInput) => void;
  /** Sends the phone number for a link with a code. */
  onSubmit: (input: WhatsAppAccountSubmitInput) => void;
  /** Stops the link in progress. */
  onCancel: () => void;
  onDisconnect: () => void;
  /** Lets agents send messages and mark chats as read, or stops them. */
  onSetSending: (enabled: boolean) => void;
  /**
   * The joined server whose connection this is, or undefined for this computer's. The server keeps
   * the keys of the linked device; this computer only shows the steps.
   */
  hostName?: string | undefined;
  /**
   * Why the last status read failed, when no newer status came. The state is not known: the page
   * shows the reason and Retry, not the link of a connection that may be there.
   */
  statusError?: string | null | undefined;
  /** Reads the status again. */
  onRetry?: (() => void) | undefined;
}

const LINKING = { status: "connecting", label: "connector.whatsappAccount.statusConnecting" } as const;

/** The status of the connection, as its page header and every list of connectors show it. */
export const WHATSAPP_ACCOUNT_STATUS = {
  disconnected: { status: "idle", label: "marketplace.app.notConnected" },
  connecting: LINKING,
  qr: LINKING,
  phone: LINKING,
  code: LINKING,
  connected: { status: "connected", label: "connector.whatsappAccount.statusConnected" },
} as const satisfies Record<WhatsAppAccountConnectorState, VaultStatus>;

/** The header status: not known after a failed read, else the entry of the status table. */
export function whatsappAccountStatus(props: Pick<WhatsAppAccountConnectorPanelProps, "status" | "statusError">) {
  return vaultHeader(props.statusError, WHATSAPP_ACCOUNT_STATUS[props.status.state]);
}

/** The phone number field is short: digits, spaces, a plus and brackets. */
const PHONE_LIMIT = 32;

/**
 * The WhatsApp account page of this computer or of a joined server. OpenBot becomes a linked device of
 * the user's own account, as WhatsApp Web does. The page shows the step that main or the host is at:
 * the QR code, or the phone number and then the code to type on the phone, then the account with the
 * sending switch. The phone number is cleared from the page when it is sent.
 */
export function WhatsAppAccountConnectorPanel(props: WhatsAppAccountConnectorPanelProps) {
  const { t, format } = useText();
  const [form, setForm] = createStore<{ method: WhatsAppAccountLinkMethod; phone: string }>({
    method: "qr",
    phone: "",
  });
  const header = () => whatsappAccountStatus(props);
  const failure = () =>
    vaultFailure(t("connector.whatsappAccount.actionFailed"), props.statusError, props.status.error);
  const linking = () => props.status.state !== "disconnected" && props.status.state !== "connected";
  const host = () => props.hostName;

  // A new step asks for a new value. The number of the step before is not kept.
  createEffect(
    () => props.status.state,
    () => {
      setForm((state) => {
        state.phone = "";
      });
    },
  );

  const connect = (method: WhatsAppAccountLinkMethod) => {
    if (props.busy) return;
    setForm((state) => {
      state.method = method;
    });
    props.onConnect({ method });
  };
  const submitPhone = (event: SubmitEvent) => {
    event.preventDefault();
    const value = form.phone.trim();
    if (!value || props.busy) return;
    setForm((state) => {
      state.phone = "";
    });
    props.onSubmit({ field: "phone", value });
  };

  return (
    <IntegrationPage
      class="whatsapp-account-connector"
      logo={<MessageCircle aria-hidden="true" />}
      name={t("connector.whatsappAccount.title")}
      status={header().status}
      statusLabel={t(header().label)}
      subtitle={
        host()
          ? t("connector.whatsappAccount.descriptionHost", { host: host() ?? "" })
          : t("connector.whatsappAccount.description")
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
          title={t("connector.whatsappAccount.disconnectTitle")}
          description={
            host()
              ? t("connector.whatsappAccount.disconnectSummaryHost", { host: host() ?? "" })
              : t("connector.whatsappAccount.disconnectSummary")
          }
          action={t("connector.whatsappAccount.disconnect")}
          busy={props.busy}
          onDisconnect={props.onDisconnect}
        />
      }
    >
      <Show when={!props.statusError}>
        <Show when={props.status.state === "disconnected"}>
          <SettingsSection
            title={t("connector.whatsappAccount.linkTitle")}
            description={
              host()
                ? t("connector.whatsappAccount.howItWorksHost", { host: host() ?? "" })
                : t("connector.whatsappAccount.howItWorks")
            }
          >
            <ItemGroup class="settings-modal-card">
              <Item class="settings-modal-row whatsapp-account-row">
                <ItemContent>
                  <ItemTitle>{t("connector.whatsappAccount.methodTitle")}</ItemTitle>
                  <ItemDescription>
                    {form.method === "qr"
                      ? t("connector.whatsappAccount.methodQrDescription")
                      : t("connector.whatsappAccount.methodPhoneDescription")}
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
                    <SlidingTabs.List aria-label={t("connector.whatsappAccount.methodTitle")}>
                      <SlidingTabs.Trigger value="qr">{t("connector.whatsappAccount.methodQr")}</SlidingTabs.Trigger>
                      <SlidingTabs.Trigger value="phone">
                        {t("connector.whatsappAccount.methodPhone")}
                      </SlidingTabs.Trigger>
                    </SlidingTabs.List>
                  </SlidingTabs.Root>
                </ItemActions>
              </Item>
              <Item class="settings-modal-row whatsapp-account-row">
                <ItemMedia>
                  <TriangleAlert aria-hidden="true" />
                </ItemMedia>
                <ItemContent>
                  <ItemDescription>{t("connector.whatsappAccount.riskNote")}</ItemDescription>
                </ItemContent>
              </Item>
              <div class="integration-card-body">
                <div class="whatsapp-account-actions">
                  <Button type="button" size="sm" loading={props.busy} onClick={() => connect(form.method)}>
                    {t("connector.whatsappAccount.connect")}
                  </Button>
                </div>
              </div>
              <Text class="integration-card-note" variant="caption" tone="muted">
                {t("connector.whatsappAccount.sendingOffNote")}
              </Text>
            </ItemGroup>
          </SettingsSection>
        </Show>

        <Show when={linking()}>
          <SettingsSection
            title={t("connector.whatsappAccount.linkTitle")}
            description={t("connector.whatsappAccount.linkProgress")}
            actions={
              <Button type="button" size="sm" variant="outline" onClick={() => props.onCancel()}>
                {t("common.cancel")}
              </Button>
            }
          >
            <ItemGroup class="settings-modal-card">
              <Switch>
                <Match when={props.status.state === "connecting"}>
                  <Item class="settings-modal-row whatsapp-account-row">
                    <ItemMedia>
                      <Spinner size="sm" />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{t("connector.whatsappAccount.connecting")}</ItemTitle>
                      <ItemDescription aria-live="polite">
                        {host()
                          ? t("connector.whatsappAccount.connectingHost", { host: host() ?? "" })
                          : t("connector.whatsappAccount.connectingDescription")}
                      </ItemDescription>
                    </ItemContent>
                  </Item>
                </Match>
                <Match when={props.status.state === "qr" ? props.status.qrCode : null}>
                  {(code) => (
                    <div class="integration-card-body whatsapp-account-link">
                      <QrCode value={code()} size={176} label={t("connector.whatsappAccount.qrLabel")} />
                      <div class="whatsapp-account-link-copy">
                        <Text variant="label">{t("connector.whatsappAccount.qrTitle")}</Text>
                        <ol class="whatsapp-account-steps">
                          <li>{t("connector.whatsappAccount.stepOpen")}</li>
                          <li>{t("connector.whatsappAccount.stepDevices")}</li>
                          <li>{t("connector.whatsappAccount.qrStepScan")}</li>
                        </ol>
                        <Text variant="caption" tone="muted">
                          {t("connector.whatsappAccount.qrRefresh")}
                        </Text>
                        <div class="whatsapp-account-actions">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={props.busy}
                            onClick={() => connect("phone")}
                          >
                            {t("connector.whatsappAccount.usePhone")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </Match>
                <Match when={props.status.state === "phone"}>
                  <div class="integration-card-body">
                    <Text variant="caption" tone="muted">
                      {t("connector.whatsappAccount.phoneDescription")}
                    </Text>
                    <form class="whatsapp-account-step-form" onSubmit={submitPhone}>
                      <Field label={t("connector.whatsappAccount.phoneLabel")}>
                        <Input
                          type="tel"
                          size="sm"
                          autocomplete="tel"
                          inputmode="tel"
                          spellcheck={false}
                          maxlength={PHONE_LIMIT}
                          placeholder={t("connector.whatsappAccount.phonePlaceholder")}
                          value={form.phone}
                          onInput={(event) =>
                            setForm((state) => {
                              state.phone = event.currentTarget.value;
                            })
                          }
                        />
                      </Field>
                      <Button type="submit" size="sm" loading={props.busy} disabled={!form.phone.trim()}>
                        {t("connector.whatsappAccount.getCode")}
                      </Button>
                    </form>
                    <div class="whatsapp-account-actions">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={props.busy}
                        onClick={() => connect("qr")}
                      >
                        {t("connector.whatsappAccount.useQr")}
                      </Button>
                    </div>
                  </div>
                </Match>
                <Match when={props.status.state === "code" ? props.status.pairingCode : null}>
                  {(code) => (
                    <div class="integration-card-body whatsapp-account-link">
                      <div class="whatsapp-account-link-copy">
                        <Text variant="label">{t("connector.whatsappAccount.codeTitle")}</Text>
                        <output
                          class="whatsapp-account-pairing-code"
                          aria-label={t("connector.whatsappAccount.codeLabel")}
                        >
                          {code()}
                        </output>
                        <ol class="whatsapp-account-steps">
                          <li>{t("connector.whatsappAccount.stepOpen")}</li>
                          <li>{t("connector.whatsappAccount.stepDevices")}</li>
                          <li>{t("connector.whatsappAccount.codeStepPhone")}</li>
                          <li>{t("connector.whatsappAccount.codeStepType")}</li>
                        </ol>
                      </div>
                    </div>
                  )}
                </Match>
              </Switch>
            </ItemGroup>
          </SettingsSection>
        </Show>

        <Show when={props.status.state === "connected" ? props.status.account : null}>
          {(account) => (
            <SettingsSection
              title={t("connector.whatsappAccount.accountTitle")}
              description={
                host()
                  ? t("connector.whatsappAccount.accountDescriptionHost", { host: host() ?? "" })
                  : t("connector.whatsappAccount.accountDescription")
              }
            >
              <ItemGroup class="settings-modal-card">
                <Item class="settings-modal-row whatsapp-account-row">
                  <ItemContent>
                    <ItemTitle>{account().name}</ItemTitle>
                    <Show when={account().phone}>{(phone) => <ItemDescription>{phone()}</ItemDescription>}</Show>
                  </ItemContent>
                </Item>
                <Show when={props.status.history}>
                  {(history) => (
                    <Item class="settings-modal-row whatsapp-account-row">
                      <ItemContent>
                        <ItemTitle>
                          {format.list([
                            t("connector.whatsappAccount.historyChats", { count: history().chats }),
                            t("connector.whatsappAccount.historyMessages", { count: history().messages }),
                          ])}
                        </ItemTitle>
                        <ItemDescription>{t("connector.whatsappAccount.historyNote")}</ItemDescription>
                      </ItemContent>
                    </Item>
                  )}
                </Show>
                <SwitchField
                  class="settings-modal-row"
                  checked={props.status.sendingEnabled}
                  disabled={props.busy}
                  onChange={(checked) => props.onSetSending(checked)}
                  label={t("connector.whatsappAccount.sendingLabel")}
                  description={t("connector.whatsappAccount.sendingDescription")}
                />
                <Text class="integration-card-note" variant="caption" tone="muted">
                  {host()
                    ? t("connector.whatsappAccount.devicesNoteHost", { host: host() ?? "" })
                    : t("connector.whatsappAccount.devicesNote")}
                </Text>
              </ItemGroup>
            </SettingsSection>
          )}
        </Show>
      </Show>
    </IntegrationPage>
  );
}
