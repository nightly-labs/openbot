import type { BitwardenConnectorStatus, BitwardenHostConnectInput } from "@openbot/contracts/ipc";
import { Button, Field, Input, ItemGroup, Lock, SettingsSection, Text } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
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

/** The hosted Bitwarden service. A self-hosted Vaultwarden server replaces it in the form. */
const DEFAULT_SERVER_URL = "https://vault.bitwarden.com";

export interface BitwardenConnectorPanelProps extends IntegrationPageSlots {
  status: BitwardenConnectorStatus;
  busy: boolean;
  onConnect: (sessionKey: string) => void;
  onDisconnect: () => void;
  /**
   * The joined server whose connection this is, or undefined for this computer's. A server signs in
   * with its own CLI, so the page asks for an API key and the master password, not a session key.
   */
  hostName?: string | undefined;
  /** Connects a joined server's Bitwarden. Set together with `hostName`. */
  onConnectHost?: ((input: BitwardenHostConnectInput) => void) | undefined;
  /**
   * Why the last status read failed, when no newer status came. The state is not known: the page
   * shows the reason and Retry, not the session key form of a connection that may be there.
   */
  statusError?: string | null | undefined;
  /** Reads the status again. */
  onRetry?: (() => void) | undefined;
}

const BITWARDEN_STATUS = {
  disconnected: { status: "idle", label: "marketplace.app.notConnected" },
  connecting: { status: "connecting", label: "connector.bitwarden.connecting" },
  connected: { status: "connected", label: "connector.bitwarden.connected" },
} as const satisfies Record<"disconnected" | "connecting" | "connected", VaultStatus>;

/** The status of the connection, as its page header and every list of connectors show it. */
export function bitwardenStatus(props: Pick<BitwardenConnectorPanelProps, "status" | "statusError">) {
  const state = props.status.connecting ? "connecting" : props.status.connected ? "connected" : "disconnected";
  return vaultHeader(props.statusError, BITWARDEN_STATUS[state]);
}

export function BitwardenConnectorPanel(props: BitwardenConnectorPanelProps) {
  const { t } = useText();
  const [serverUrl, setServerUrl] = createSignal(DEFAULT_SERVER_URL);
  const [clientId, setClientId] = createSignal("");
  const [clientSecret, setClientSecret] = createSignal("");
  const [masterPassword, setMasterPassword] = createSignal("");
  const header = () => bitwardenStatus(props);
  const failure = () => vaultFailure(t("connector.bitwarden.actionFailed"), props.statusError, props.status.error);
  const hostReady = () => Boolean(serverUrl().trim() && clientId().trim() && clientSecret().trim() && masterPassword());
  const setupText = () =>
    props.hostName ? t("connector.bitwarden.setupHost", { host: props.hostName }) : t("connector.bitwarden.setup");
  const scopeText = () =>
    props.hostName ? t("connector.bitwarden.scopeHost", { host: props.hostName }) : t("connector.bitwarden.scope");
  const sessionText = () =>
    props.hostName ? t("connector.bitwarden.sessionHost", { host: props.hostName }) : t("connector.bitwarden.session");
  /** What agents can use, and how long the access lasts: the last lines of the card. */
  const Notes = () => (
    <>
      <Text class="integration-card-note" variant="caption" tone="muted">
        {scopeText()}
      </Text>
      <Text class="integration-card-note" variant="caption" tone="muted">
        {sessionText()}
      </Text>
    </>
  );
  return (
    <IntegrationPage
      class="bitwarden-connector"
      logo={<Lock />}
      name={t("connector.bitwarden.title")}
      subtitle={
        props.hostName
          ? t("connector.bitwarden.descriptionHost", { host: props.hostName })
          : t("connector.bitwarden.description")
      }
      status={header().status}
      statusLabel={t(header().label)}
      readError={props.statusError}
      onRetry={props.onRetry}
      failure={failure()}
      tagline={props.tagline}
      intro={props.intro}
      details={props.details}
      // With the state not known, the page offers neither the connect form nor Disconnect.
      danger={
        <VaultDangerZone
          show={!props.statusError && props.status.connected}
          title={t("connector.bitwarden.disconnect")}
          description={
            props.hostName
              ? t("connector.bitwarden.disconnectSummaryHost", { host: props.hostName })
              : t("connector.bitwarden.disconnectSummary")
          }
          action={t("connector.bitwarden.disconnectAction")}
          busy={props.busy}
          onDisconnect={props.onDisconnect}
        />
      }
    >
      <Show when={!props.statusError}>
        <Show
          when={props.status.connected}
          fallback={
            <SettingsSection title={t("connector.bitwarden.connect")} description={setupText()}>
              <ItemGroup class="settings-modal-card">
                <div class="integration-card-body">
                  <Show
                    when={props.hostName}
                    fallback={
                      <VaultSecretForm
                        label={t("connector.bitwarden.sessionKey")}
                        submitLabel={t("connector.bitwarden.connect")}
                        busy={props.busy}
                        onSubmit={props.onConnect}
                        cancelVisible={props.busy}
                        onCancel={props.onDisconnect}
                      />
                    }
                  >
                    <form
                      class="bitwarden-connector-host-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!hostReady() || props.busy || props.status.connecting) return;
                        const input = {
                          serverUrl: serverUrl().trim(),
                          clientId: clientId().trim(),
                          clientSecret: clientSecret().trim(),
                          masterPassword: masterPassword(),
                        };
                        setClientSecret("");
                        setMasterPassword("");
                        props.onConnectHost?.(input);
                      }}
                    >
                      <Field label={t("connector.bitwarden.serverUrl")}>
                        <Input
                          type="url"
                          size="sm"
                          autocomplete="off"
                          spellcheck={false}
                          value={serverUrl()}
                          onInput={(event) => setServerUrl(event.currentTarget.value)}
                        />
                      </Field>
                      <Field label={t("connector.bitwarden.clientId")}>
                        <Input
                          size="sm"
                          autocomplete="off"
                          spellcheck={false}
                          value={clientId()}
                          onInput={(event) => setClientId(event.currentTarget.value)}
                        />
                      </Field>
                      <Field label={t("connector.bitwarden.clientSecret")}>
                        <Input
                          type="password"
                          size="sm"
                          autocomplete="off"
                          spellcheck={false}
                          value={clientSecret()}
                          onInput={(event) => setClientSecret(event.currentTarget.value)}
                        />
                      </Field>
                      <Field label={t("connector.bitwarden.masterPassword")}>
                        <Input
                          type="password"
                          size="sm"
                          autocomplete="off"
                          spellcheck={false}
                          value={masterPassword()}
                          onInput={(event) => setMasterPassword(event.currentTarget.value)}
                        />
                      </Field>
                      <div class="bitwarden-connector-actions">
                        <Button
                          type="submit"
                          size="sm"
                          loading={props.busy || props.status.connecting}
                          disabled={!hostReady() || props.status.connecting}
                        >
                          {t("connector.bitwarden.connect")}
                        </Button>
                        <Show when={props.status.connecting}>
                          <Button type="button" size="sm" variant="ghost" onClick={() => props.onDisconnect()}>
                            {t("common.cancel")}
                          </Button>
                        </Show>
                      </div>
                    </form>
                  </Show>
                </div>
                <Notes />
              </ItemGroup>
            </SettingsSection>
          }
        >
          <SharedVaultSection
            title={t("connector.bitwarden.folderTitle")}
            description={t("connector.bitwarden.folderDescription")}
          >
            <VaultRow title={t("connector.bitwarden.folderName")} description={t("connector.bitwarden.folderKind")} />
            <Show when={props.status.serverUrl}>
              {(server) => <VaultRow title={t("connector.bitwarden.serverUrl")} description={server()} />}
            </Show>
            <Notes />
          </SharedVaultSection>
        </Show>
      </Show>
    </IntegrationPage>
  );
}
