import { createEffect, createSignal, Show } from "solid-js";
import { ServerPlushLogo } from "../../server-plush-logo";

/** A server logo, or the server's plush when there is no logo or it does not load. */
export function ServerLogo(props: { serverId: string; url: string | null }) {
  const [failed, setFailed] = createSignal(false);
  createEffect(
    () => props.url,
    () => {
      setFailed(false);
    },
  );
  return (
    <Show
      when={!failed() ? props.url : null}
      fallback={<ServerPlushLogo class="server-settings-plush" seed={props.serverId} />}
    >
      {(url) => (
        <span class="server-settings-logo" aria-hidden="true">
          <img src={url()} alt="" draggable={false} onError={() => setFailed(true)} />
        </span>
      )}
    </Show>
  );
}
