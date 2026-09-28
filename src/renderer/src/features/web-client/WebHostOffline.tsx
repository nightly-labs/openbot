import { AppLogo } from "@openbot/brand";
import { Button, Heading, RefreshCw, Text } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";

/** Takes the conversation panel while the selected computer is not online. */
export function WebHostOffline(props: {
  title: string;
  description: string | null;
  reconnectable: boolean;
  connecting: boolean;
  disabled: boolean;
  onReconnect: () => void;
}) {
  const { t } = useText();
  return (
    <section class="conversation-panel web-connect" role="status" aria-labelledby="web-host-offline-title">
      <div class="web-connect-card">
        <header class="web-connect-header">
          <AppLogo variant="production" class="web-connect-logo" />
          <Heading as="h2" size="lg" id="web-host-offline-title">
            {props.title}
          </Heading>
          <Show when={props.description}>{(description) => <Text tone="muted">{description()}</Text>}</Show>
        </header>

        <Show when={props.reconnectable}>
          <footer class="web-connect-actions">
            <Button
              class="web-host-offline-reconnect"
              loading={props.connecting}
              loadingLabel={t("webClient.notice.connecting")}
              disabled={props.disabled}
              onClick={() => props.onReconnect()}
            >
              <RefreshCw aria-hidden="true" />
              {t("webClient.notice.reconnect")}
            </Button>
          </footer>
        </Show>
      </div>
    </section>
  );
}
