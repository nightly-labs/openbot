import type { BitwardenConnectorStatus } from "@openbot/contracts/ipc";
import { Button, Input, Lock, SettingsSection, Text } from "@openbot/ui";
import { createSignal, Show } from "solid-js";
import { useText } from "../../text";
import { DetailHeader } from "./IntegrationLayout";

export interface BitwardenConnectorPanelProps {
  status: BitwardenConnectorStatus;
  busy: boolean;
  onConnect: (sessionKey: string) => void;
  onDisconnect: () => void;
}

export function BitwardenConnectorPanel(props: BitwardenConnectorPanelProps) {
  const { t } = useText();
  const [key, setKey] = createSignal("");
  return (
    <div class="onepassword-connector">
      <DetailHeader
        logo={<Lock />}
        name={t("connector.bitwarden.title")}
        subtitle={t("connector.bitwarden.description")}
        status={props.status.connected ? "connected" : "idle"}
        statusLabel={
          props.status.connected ? t("connector.bitwarden.connected") : t("connector.bitwarden.disconnected")
        }
      />
      <Text variant="body-sm" tone="muted">
        {t("connector.bitwarden.scope")}
      </Text>
      <Text variant="body-sm" tone="muted">
        {t("connector.bitwarden.session")}
      </Text>
      <Show
        when={!props.status.connected}
        fallback={
          <Button type="button" variant="outline" onClick={() => props.onDisconnect()}>
            {t("connector.bitwarden.disconnect")}
          </Button>
        }
      >
        <SettingsSection title={t("connector.bitwarden.connect")} description={t("connector.bitwarden.setup")}>
          <form
            class="onepassword-connector-token"
            onSubmit={(event) => {
              event.preventDefault();
              const value = key().trim();
              if (!value || props.busy) return;
              setKey("");
              props.onConnect(value);
            }}
          >
            <Input
              type="password"
              autocomplete="off"
              spellcheck={false}
              aria-label={t("connector.bitwarden.sessionKey")}
              value={key()}
              onInput={(event) => setKey(event.currentTarget.value)}
            />
            <Button type="submit" loading={props.busy} disabled={!key().trim()}>
              {t("connector.bitwarden.connect")}
            </Button>
          </form>
          <Show when={props.busy}>
            <Button type="button" variant="ghost" onClick={() => props.onDisconnect()}>
              {t("common.cancel")}
            </Button>
          </Show>
        </SettingsSection>
      </Show>
    </div>
  );
}
