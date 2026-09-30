import { AppLogo } from "@openbot/brand";
import { createSignal, onSettled, Show } from "solid-js";
import { Button } from "../ui/button";

/**
 * The page that returns a Slack install to the desktop app. The install callback redirects here with
 * a sealed grant, or an error code, in the fragment. The page only builds the `openbot://` link:
 * only the host can open the grant.
 */
export function SlackConnectPage() {
  const [openUrl, setOpenUrl] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);

  onSettled(() => {
    const page = new URL(window.location.href);
    const fragment = new URLSearchParams(page.hash.slice(1));
    const target = slackDeepLink(fragment);
    // The grant is no use to anyone who reads the address bar later.
    window.history.replaceState(null, "", page.pathname);
    if (!target) {
      setFailure(fragment.get("error") ?? "slack_failed");
      return;
    }
    setOpenUrl(target);
    window.location.assign(target);
  });

  return (
    <main class="join-page">
      <a class="landing-brand join-page-brand" href="/" aria-label="OpenBot home">
        <AppLogo variant="production" class="landing-brand-logo" />
        <span>OpenBot</span>
      </a>
      <section class="join-card" aria-labelledby="slack-connect-title">
        <AppLogo variant="production" animation="blink" class="join-card-logo" />
        <p class="join-card-eyebrow">Slack</p>
        <h1 id="slack-connect-title">Return to OpenBot</h1>
        <Show
          when={!failure()}
          fallback={
            <p class="join-card-error">
              {failure() === "slack_workspace_taken"
                ? "Another OpenBot server already answers this Slack workspace. Disconnect it on that server, then try again."
                : "Slack did not finish the connection. Go back to OpenBot and start again."}
            </p>
          }
        >
          <p class="join-card-copy">OpenBot finishes the Slack connection on your computer.</p>
          <Show when={openUrl()}>
            {(href) => (
              <div class="join-card-actions">
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

function slackDeepLink(fragment: URLSearchParams): string | null {
  const nonce = fragment.get("nonce");
  const grant = fragment.get("grant");
  return nonce && grant ? `openbot://slack-workspace?${new URLSearchParams({ nonce, grant })}` : null;
}
