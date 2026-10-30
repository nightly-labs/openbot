import { AppLogo } from "@openbot/brand";
import { createWebAppInvitePath, OPENBOT_INVITE_ORIGIN, toOpenBotInviteUrl } from "@openbot/contracts/invite-links";
import { createSignal, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { detectDownloadPlatform } from "../../lib/download-platforms";
import { OPENBOT_DOWNLOAD_LINKS } from "../../lib/landing-links";
import type { JoinPageText } from "../transactional/page-text";
import { TransactionalPage } from "../transactional/TransactionalPage";
import { Button } from "../ui/button";

export function JoinPage(props: { lang: string; text: JoinPageText }) {
  const [openUrl, setOpenUrl] = createSignal("");
  const [browserUrl, setBrowserUrl] = createSignal("");
  const [downloadUrl, setDownloadUrl] = createSignal<string>(OPENBOT_DOWNLOAD_LINKS.macos);
  const [mobile, setMobile] = createSignal(false);
  const [invalid, setInvalid] = createSignal(false);
  const [openAttempted, setOpenAttempted] = createSignal(false);

  onSettled(() => {
    setMobile(
      /android|iphone|ipad|ipod/iu.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
    );
    const platform = detectDownloadPlatform(globalThis.navigator) ?? "macos";
    let validInvite = true;
    try {
      const pageUrl = new URL(window.location.href);
      const canonicalUrl = new URL(`${pageUrl.pathname}${pageUrl.search}`, OPENBOT_INVITE_ORIGIN);
      setOpenUrl(toOpenBotInviteUrl(canonicalUrl.toString()));
      setBrowserUrl(createWebAppInvitePath(canonicalUrl.toString()));
    } catch {
      validInvite = false;
      setInvalid(true);
    }
    setDownloadUrl(OPENBOT_DOWNLOAD_LINKS[platform]);
    const cleanup = landingAnalytics.startJoin(document, window.location.hostname, { validInvite, platform });
    return cleanup;
  });

  return (
    <TransactionalPage titleId="join-title" lang={props.lang}>
      <div class="join-card-signal" aria-hidden="true">
        <span />
        <i />
        <span />
      </div>
      <AppLogo variant="production" animation="blink" class="join-card-logo" />
      <p class="join-card-eyebrow">{props.text.eyebrow}</p>
      <h1 id="join-title">{props.text.title}</h1>
      <p class="join-card-copy">{props.text.intro}</p>

      <Show when={!invalid()} fallback={<p class="join-card-error">{props.text.invalid}</p>}>
        <div class="join-card-actions">
          {/* Until the page reads the link, the app cannot open it. The button is then a real
              disabled button, so it is not a link that goes nowhere. */}
          <Show
            when={openUrl()}
            fallback={
              <Button as="button" type="button" disabled variant="primary" size="lg" icon="open">
                {props.text.open}
              </Button>
            }
          >
            {(href) => (
              <Button href={href()} variant="primary" size="lg" icon="open" onClick={() => setOpenAttempted(true)}>
                {props.text.open}
              </Button>
            )}
          </Show>
          <Show when={browserUrl()}>
            {(href) => (
              <Button href={href()} variant="secondary" size="lg" icon="arrow-right">
                {props.text.browser}
              </Button>
            )}
          </Show>
          <Show when={!mobile()}>
            <Button href={downloadUrl()} variant="secondary" size="lg" icon="download">
              {props.text.download}
            </Button>
          </Show>
        </div>
      </Show>

      <Show when={!mobile()}>
        {/* The live region exists before the click, so screen readers announce the text when it appears. */}
        <p class={openAttempted() ? "join-card-note" : "join-card-status-empty"} role="status">
          <Show when={openAttempted()}>{props.text.notOpened}</Show>
        </p>
      </Show>
      <Show when={mobile()}>
        <p class="join-card-note">{props.text.mobile}</p>
      </Show>
      <ul class="transactional-notes">
        <li>{props.text.singleUse}</li>
        <li>{props.text.email}</li>
        <li>{props.text.share}</li>
      </ul>
    </TransactionalPage>
  );
}
