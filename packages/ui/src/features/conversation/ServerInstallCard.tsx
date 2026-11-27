import type { ServerSummary } from "@openbot/contracts/ipc";
import { Button, Check, CircleAlert, LoaderCircle, PlushLoader } from "@openbot/ui";
import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { ServerMark } from "../servers/ServerRail";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

export type ServerInstallCardStep = "waiting" | "starting" | "connected" | "offline" | "expired";

export interface ServerInstallCardProps {
  step: ServerInstallCardStep;
  name: string | null;
  server?: Pick<ServerSummary, "id" | "logoUrl"> | null | undefined;
  onOpenServer?: (() => void) | undefined;
}

const isLive = (step: ServerInstallCardStep) => step === "starting" || step === "connected" || step === "offline";

export function ServerInstallCard(props: ServerInstallCardProps) {
  const { t } = useText();
  const name = () => props.name ?? t("chat.serverInstall.title");
  const status = () => {
    if (props.step === "waiting") return t("server.install.waiting");
    if (props.step === "starting") return t("server.install.starting", { name: name() });
    if (props.step === "connected") return t("server.install.connected", { name: name() });
    if (props.step === "offline") return t("server.install.offline", { name: name() });
    return t("chat.serverInstall.expired");
  };
  return (
    <UiBlockCard
      class="marketplace-suggestion server-install-card"
      status="pending"
      inlineActions
      title={name()}
      subtitle={
        <span class="server-install-card-status" data-step={props.step} role="status">
          <Show when={status()} keyed>
            {(text) => <span class="server-install-card-status-text">{text}</span>}
          </Show>
        </span>
      }
      icon={<ServerInstallTile step={props.step} server={props.server ?? null} />}
      actions={
        <Show when={props.step === "connected" ? props.onOpenServer : undefined}>
          {(open) => (
            <Button type="button" size="sm" class="server-install-card-action" onClick={() => open()()}>
              {t("server.hosted.open")}
            </Button>
          )}
        </Show>
      }
    />
  );
}

function ServerInstallTile(props: {
  step: ServerInstallCardStep;
  server: Pick<ServerSummary, "id" | "logoUrl"> | null;
}) {
  const revealed = untrack(() => isLive(props.step));
  const [loaderGone, setLoaderGone] = createSignal(revealed);
  return (
    <span
      class="ui-block-icon server-install-card-tile"
      data-step={props.step}
      data-revealed={revealed ? "" : undefined}
    >
      <Show
        when={props.step !== "expired"}
        fallback={<CircleAlert class="install-server-warning" aria-hidden="true" />}
      >
        <Show when={!loaderGone()}>
          <span
            class="server-install-card-face server-install-card-loader"
            onAnimationEnd={(event) => {
              if (event.animationName === "server-install-pop-out") setLoaderGone(true);
            }}
          >
            <PlushLoader size={24} layout="stack" />
          </span>
        </Show>
        <Show when={isLive(props.step) ? props.server : null}>
          {(server) => (
            <span class="server-install-card-face server-install-card-logo">
              <ServerMark server={server()} />
            </span>
          )}
        </Show>
        <Show when={props.step === "starting" || props.step === "connected"}>
          <span class="server-install-card-badge" data-step={props.step} aria-hidden="true">
            <Show when={props.step === "connected"} fallback={<LoaderCircle class="install-server-spin" />}>
              <Check class="server-install-card-check" />
            </Show>
          </span>
        </Show>
      </Show>
    </span>
  );
}
