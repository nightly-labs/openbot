import { AppLogo } from "@openbot/brand";
import { createWebAppInvitePath, OPENBOT_INVITE_ORIGIN, toOpenBotInviteUrl } from "@openbot/contracts/invite-links";
import { createSignal, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { detectDownloadPlatform } from "../../lib/download-platforms";
import { OPENBOT_DOWNLOAD_LINKS } from "../../lib/landing-links";
import { createOpenAppFallback, OpenAppFallbackDialog } from "../transactional/OpenAppFallback";
import type { JoinLink, JoinPageText } from "../transactional/page-text";
import { TransactionalPage } from "../transactional/TransactionalPage";
import { Button } from "../ui/button";

export function JoinPage(props: { lang: string; text: JoinPageText }) {
  const [openUrl, setOpenUrl] = createSignal("");
  const [browserUrl, setBrowserUrl] = createSignal("");
  const [downloadUrl, setDownloadUrl] = createSignal<string>(OPENBOT_DOWNLOAD_LINKS.macos);
  const [mobile, setMobile] = createSignal(false);
  const [invalid, setInvalid] = createSignal(false);
  const fallback = createOpenAppFallback();

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

  const noApp = () => (mobile() ? props.text.noAppMobile : props.text.noApp);
  const linkHref = (link: JoinLink) => (link === "browser" ? browserUrl() : downloadUrl());
  // The dialog offers the desktop download, which a phone cannot install. Phones get the note below.
  const armFallback = () => {
    if (!mobile()) fallback.arm();
  };

  return (
    <TransactionalPage titleId="join-title" lang={props.lang}>
      <AppLogo variant="production" animation="blink" class="join-card-logo" />
      <p class="join-card-eyebrow">{props.text.eyebrow}</p>
      <h1 id="join-title">{props.text.title}</h1>
      <p class="join-card-copy">{props.text.intro}</p>

      <Show when={!invalid()} fallback={<p class="join-card-error">{props.text.invalid}</p>}>
        <div class="join-card-actions join-card-actions-full">
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
              <Button href={href()} variant="primary" size="lg" icon="open" onClick={armFallback}>
                {props.text.open}
              </Button>
            )}
          </Show>
        </div>
        <Show when={browserUrl()}>
          <p class="join-card-alternatives">
            <For each={noApp()}>
              {(part) => (
                <Show when={part.link} fallback={part.text}>
                  {(link) => <a href={linkHref(link())}>{part.text}</a>}
                </Show>
              )}
            </For>
          </p>
        </Show>
      </Show>

      <Show when={mobile()}>
        <p class="join-card-note">{props.text.mobile}</p>
      </Show>
      <p class="join-card-note">{props.text.email}</p>
      <OpenAppFallbackDialog fallback={fallback} text={props.text.openAppFallback} />
    </TransactionalPage>
  );
}
