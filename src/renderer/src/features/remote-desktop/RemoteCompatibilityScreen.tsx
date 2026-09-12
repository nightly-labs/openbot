import type { ServerSummary } from "@openbot/contracts/ipc";
import { For, Show } from "solid-js";
import { Alert, AlertContent, AlertDescription, Button } from "../../components/ui";
import { useI18n } from "../i18n/i18n-context";

/**
 * What the workspace shows instead of a conversation when the active server is
 * a remote one this build cannot talk to. It takes the server and the retry as
 * props rather than reading `useServers()`: the shell already holds the server
 * in a keyed `<Show>` so that a different blocked server remounts this screen,
 * and a context read here would quietly re-derive what that key already decided.
 */
export function RemoteCompatibilityScreen(props: { server: ServerSummary; onRetry: () => Promise<void> }) {
  const { t } = useI18n();
  const title = () => {
    if (props.server.issue?.code === "client_update_required") return t("remoteDesktop.updateApp");
    if (props.server.issue?.code === "host_update_required")
      return t("remoteDesktop.updateHost", { name: props.server.name });
    if (props.server.issue?.code === "protocol_error") return t("remoteDesktop.unsafeHostData");
    return t("remoteDesktop.cannotConnect", { name: props.server.name });
  };
  const description = () => {
    if (props.server.issue?.code === "client_update_required") {
      return t("remoteDesktop.clientProtocolOlder");
    }
    if (props.server.issue?.code === "host_update_required") {
      return t("remoteDesktop.hostProtocolOlder");
    }
    if (props.server.issue?.code !== "protocol_error") {
      return props.server.issue?.message ?? t("remoteDesktop.hostUnreachable");
    }
    return t("remoteDesktop.invalidPayload");
  };
  const compatibility = () => props.server.compatibility;
  const details = () => [
    [t("remoteDesktop.clientVersion"), compatibility()?.localAppVersion ?? t("remoteDesktop.unknown")],
    [t("remoteDesktop.hostVersion"), compatibility()?.hostAppVersion ?? t("remoteDesktop.unknown")],
    [t("remoteDesktop.negotiatedProtocol"), compatibility()?.negotiatedProtocol ?? t("remoteDesktop.none")],
  ];

  return (
    <main class="remote-compatibility-screen" aria-labelledby="remote-compatibility-title">
      <Alert class="remote-compatibility-alert" tone="danger" role="alert">
        <AlertContent>
          <h1 class="ui-alert-title" id="remote-compatibility-title">
            {title()}
          </h1>
          <AlertDescription>{description()}</AlertDescription>
        </AlertContent>
      </Alert>
      <Show when={props.server.state === "incompatible" || props.server.issue?.code === "protocol_error"}>
        <dl class="remote-compatibility-details">
          <For each={details()}>
            {([label, value]) => (
              <div>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            )}
          </For>
        </dl>
      </Show>
      <Button onClick={() => void props.onRetry()}>{t("remoteDesktop.retry")}</Button>
    </main>
  );
}
