import type { ServerSummary } from "@openbot/contracts/ipc";
import { Button, Check, CircleAlert, LoaderCircle, PlushLoader } from "@openbot/ui";
import { createSignal, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { ServerMark } from "../servers/ServerRail";
import { UiBlockCard } from "./ui-blocks/UiBlockCard";

/**
 * - waiting: the agent has the command. No server used it yet.
 * - starting: the new server is in the server list, but it is not online yet.
 * - connected: the new server is online.
 * - offline: the server signed in earlier, but it is not online now.
 * - expired: nobody used the command before it expired.
 */
export type ServerInstallCardStep = "waiting" | "starting" | "connected" | "offline" | "expired";

export interface ServerInstallCardProps {
  step: ServerInstallCardStep;
  /** The new server's name, or the name that the command gives it. Null when neither is known. */
  name: string | null;
  /** The new server, from the step `starting`. Its logo takes the place of the loader. */
  server?: Pick<ServerSummary, "id" | "logoUrl"> | null | undefined;
  /** Opens the new server. Shown when the step is `connected`. */
  onOpenServer?: (() => void) | undefined;
}

/** The server signed in: its logo takes the place of the loader. */
const isLive = (step: ServerInstallCardStep) => step === "starting" || step === "connected" || step === "offline";

/** A one-time install command that an agent runs on another computer. The card waits for that server. */
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

/**
 * The icon tile. The loader waits in it; when the new server signs in, the loader shrinks away and the
 * server's logo pops in, with a spinner on its corner that turns into a check when the server is online.
 */
function ServerInstallTile(props: {
  step: ServerInstallCardStep;
  server: Pick<ServerSummary, "id" | "logoUrl"> | null;
}) {
  /** A card that shows first with its server signed in, such as in an older chat, does not play the reveal. */
  const revealed = untrack(() => isLive(props.step));
  /** The loader leaves the tile after it shrinks away, so that its animations stop. */
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
