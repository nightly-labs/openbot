import type { ServerSummary } from "@openbot/contracts/ipc";
import { Alert, AlertContent, AlertDescription, Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";

/**
 * What the workspace shows instead of a conversation when the active server is
 * a remote one this build cannot talk to. It takes the server and the retry as
 * props rather than reading `useServers()`: the shell already holds the server
 * in a keyed `<Show>` so that a different blocked server remounts this screen,
 * and a context read here would quietly re-derive what that key already decided.
 *
 * `olderSide` is the side that runs the older OpenBot release, when the two releases differ. Data
 * that this app cannot use then says which side to update (#8059).
 */
export function RemoteCompatibilityScreen(props: {
  server: ServerSummary;
  olderSide?: "client" | "host" | null;
  onRetry: () => Promise<void>;
}) {
  const { t, sourceText } = useText();
  const updateSide = () => (props.server.issue?.code === "protocol_error" ? (props.olderSide ?? null) : null);
  const title = () => {
    if (props.server.issue?.code === "client_update_required" || updateSide() === "client") {
      return t("server.compatibility.updateClientTitle");
    }
    if (props.server.issue?.code === "host_update_required" || updateSide() === "host") {
      return t("server.compatibility.updateHostTitle", { name: props.server.name });
    }
    if (props.server.issue?.code === "protocol_error") return t("server.compatibility.unsafeDataTitle");
    return t("server.compatibility.cannotConnectTitle", { name: props.server.name });
  };
  const description = () => {
    if (props.server.issue?.code === "client_update_required") {
      return t("server.compatibility.updateClientDescription");
    }
    if (props.server.issue?.code === "host_update_required") {
      return t("server.compatibility.updateHostDescription");
    }
    if (props.server.issue?.code !== "protocol_error") {
      const message = props.server.issue?.message;
      return message === undefined ? t("error.remote.hostUnreachable") : sourceText(message);
    }
    if (updateSide() === "host") {
      return t("server.compatibility.unsafeDataUpdateHostDescription", { name: props.server.name });
    }
    if (updateSide() === "client") {
      return t("server.compatibility.unsafeDataUpdateClientDescription", { name: props.server.name });
    }
    return t("server.compatibility.unsafeDataDescription");
  };
  const compatibility = () => props.server.compatibility;
  const details = () => [
    [t("server.compatibility.clientVersion"), compatibility()?.localAppVersion ?? t("server.compatibility.unknown")],
    [t("server.compatibility.hostVersion"), compatibility()?.hostAppVersion ?? t("server.compatibility.unknown")],
    [
      t("server.compatibility.negotiatedProtocol"),
      compatibility()?.negotiatedProtocol ?? t("server.compatibility.none"),
    ],
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
      <Button onClick={() => void props.onRetry()}>{t("common.retry")}</Button>
    </main>
  );
}
