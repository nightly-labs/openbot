import { AppLogo } from "@openbot/brand";
import { createSignal, onSettled, Show } from "solid-js";
import { Button } from "../ui/button";

/**
 * The page that returns a Discord install to the desktop app. The install callback redirects here
 * with a sealed grant, or an error code, in the fragment. The page only builds the `openbot://` link:
 * only the host can open the grant.
 */
export function DiscordConnectPage() {
  const [openUrl, setOpenUrl] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);

  onSettled(() => {
    const page = new URL(window.location.href);
    const fragment = new URLSearchParams(page.hash.slice(1));
    const target = discordDeepLink(fragment);
    // The grant is no use to anyone who reads the address bar later.
    window.history.replaceState(null, "", page.pathname);
    if (!target) {
      setFailure(fragment.get("error") ?? "discord_failed");
      return;
    }
    setOpenUrl(target);
    window.location.assign(target);
  });

  return <DiscordConnectView openUrl={openUrl()} failure={failure()} />;
}

/** The page's card: the link back to OpenBot, or why Discord did not finish. */
export function DiscordConnectView(props: { openUrl: string; failure: string | null }) {
  return (
    <main class="join-page">
      <a class="landing-brand join-page-brand" href="/" aria-label="OpenBot home">
        <AppLogo variant="production" class="landing-brand-logo" />
        <span>OpenBot</span>
      </a>
      <section class="join-card" aria-labelledby="discord-connect-title">
        <AppLogo variant="production" animation="blink" class="join-card-logo" />
        <p class="join-card-eyebrow">Discord</p>
        <h1 id="discord-connect-title">Return to OpenBot</h1>
        <Show
          when={!props.failure}
          fallback={
            <p class="join-card-error">
              {props.failure === "discord_guild_taken"
                ? "Another OpenBot server already answers this Discord server. Disconnect it on that server, then try again."
                : "Discord did not finish the connection. Go back to OpenBot and start again."}
            </p>
          }
        >
          <p class="join-card-copy">OpenBot finishes the Discord connection on your computer.</p>
          <Show when={props.openUrl}>
            {(href) => (
              <div class="join-card-actions join-card-actions-single">
                <Button href={href()} variant="primary" size="lg" icon="open">
                  Open OpenBot
                </Button>
              </div>
            )}
          </Show>
        </Show>
      </section>
    </main>
  );
}

function discordDeepLink(fragment: URLSearchParams): string | null {
  const nonce = fragment.get("nonce");
  const grant = fragment.get("grant");
  return nonce && grant ? `openbot://discord-guild?${new URLSearchParams({ nonce, grant })}` : null;
}
