import { AppLogo } from "@openbot/brand";
import {
  WEB_MESSAGING_INSTALL_KEY_PREFIX,
  type WebMessagingInstallPlatform,
} from "@openbot/contracts/web-messaging-install";
import { DiscordMark, SlackMark } from "@openbot/ui/features/settings/brand-marks";
import type { JSX } from "@solidjs/web";
import { createSignal, onSettled, Show } from "solid-js";
import { handOffToWebClient } from "../landing/web-messaging-handoff";
import { Button } from "../ui/button";
import { createOpenAppFallback, OpenAppFallbackDialog } from "./OpenAppFallback";
import type { MessagingConnectText } from "./page-text";
import { TransactionalPage } from "./TransactionalPage";

export type FailureKind =
  | "cancelled"
  | "expired"
  | "exchange"
  | "enterprise"
  | "taken"
  | "unavailable"
  | "tabClosed"
  | "failed";

interface MessagingProvider {
  mark: () => JSX.Element;
  deepLinkHost: string;
  failedCode: string;
  tabClosedCode: string;
  errors: Record<string, FailureKind>;
}

const MESSAGING_PROVIDERS: Record<WebMessagingInstallPlatform, MessagingProvider> = {
  slack: {
    mark: () => <SlackMark class="transactional-provider-mark" />,
    deepLinkHost: "slack-workspace",
    failedCode: "slack_failed",
    tabClosedCode: "slack_tab_closed",
    errors: {
      slack_cancelled: "cancelled",
      access_denied: "cancelled",
      slack_state_invalid: "expired",
      slack_exchange_failed: "exchange",
      slack_enterprise_install: "enterprise",
      slack_workspace_taken: "taken",
      slack_not_configured: "unavailable",
      slack_tab_closed: "tabClosed",
    },
  },
  discord: {
    mark: () => <DiscordMark class="transactional-provider-mark" />,
    deepLinkHost: "discord-guild",
    failedCode: "discord_failed",
    tabClosedCode: "discord_tab_closed",
    errors: {
      discord_cancelled: "cancelled",
      access_denied: "cancelled",
      discord_state_invalid: "expired",
      discord_exchange_failed: "exchange",
      discord_guild_taken: "taken",
      discord_not_configured: "unavailable",
      discord_tab_closed: "tabClosed",
    },
  },
};

const APP_URL = "openbot://";
const WEB_CLIENT_URL = "/app";

function failureKind(provider: MessagingProvider, code: string): FailureKind {
  return Object.hasOwn(provider.errors, code) ? (provider.errors[code] ?? "failed") : "failed";
}

function deepLink(provider: MessagingProvider, fragment: URLSearchParams): string | null {
  const nonce = fragment.get("nonce");
  const grant = fragment.get("grant");
  return nonce && grant ? `openbot://${provider.deepLinkHost}?${new URLSearchParams({ nonce, grant })}` : null;
}

function openLinkScript(actionsId: string, platform: WebMessagingInstallPlatform, provider: MessagingProvider): string {
  const id = JSON.stringify(actionsId);
  const host = JSON.stringify(`openbot://${provider.deepLinkHost}?`);
  const prefix = JSON.stringify(WEB_MESSAGING_INSTALL_KEY_PREFIX);
  return `(()=>{const f=new URLSearchParams(location.hash.slice(1)),n=f.get("nonce"),g=f.get("grant"),e=document.getElementById(${id}),a=e&&e.querySelector("a");if(!a||!n||!g)return;try{const m=JSON.parse(localStorage.getItem(${prefix}+n));if(m&&m.platform===${JSON.stringify(platform)}&&m.expiresAt>Date.now())return}catch{}a.href=${host}+new URLSearchParams({nonce:n,grant:g});e.hidden=false})()`;
}

export function MessagingConnectPage(props: {
  provider: WebMessagingInstallPlatform;
  lang: string;
  text: MessagingConnectText;
}) {
  const [openUrl, setOpenUrl] = createSignal("");
  const [failure, setFailure] = createSignal<string | null>(null);
  const [webClient, setWebClient] = createSignal(false);

  onSettled(() => {
    const provider = MESSAGING_PROVIDERS[props.provider];
    const page = new URL(window.location.href);
    const fragment = new URLSearchParams(page.hash.slice(1));
    const target = deepLink(provider, fragment);
    window.history.replaceState(null, "", page.pathname);
    if (!target) {
      setFailure(fragment.get("error") ?? provider.failedCode);
      return;
    }
    const handoff = handOffToWebClient(props.provider, fragment);
    if (handoff) {
      void handoff.then((received) => (received ? setWebClient(true) : setFailure(provider.tabClosedCode)));
      return;
    }
    setOpenUrl(target);
    window.location.assign(target);
  });

  return (
    <MessagingConnectView
      provider={props.provider}
      lang={props.lang}
      text={props.text}
      openUrl={openUrl()}
      failure={failure()}
      webClient={webClient()}
    />
  );
}

export function MessagingConnectView(props: {
  provider: WebMessagingInstallPlatform;
  lang: string;
  text: MessagingConnectText;
  openUrl: string;
  failure: string | null;
  webClient?: boolean;
}) {
  const provider = () => MESSAGING_PROVIDERS[props.provider];
  const kind = () => (props.failure ? failureKind(provider(), props.failure) : null);
  const fallback = createOpenAppFallback();
  const titleId = () => `${props.provider}-connect-title`;
  const actionsId = () => `${props.provider}-connect-open`;

  return (
    <TransactionalPage titleId={titleId()} lang={props.lang}>
      <AppLogo variant="production" animation="blink" class="join-card-logo" />
      <p class="join-card-eyebrow transactional-provider">
        {provider().mark()}
        {props.text.name}
      </p>
      <Show
        when={kind()}
        fallback={
          <>
            <h1 id={titleId()}>{props.text.title}</h1>
            <p class="join-card-copy">{props.webClient ? props.text.doneInWebClient : props.text.doneInApp}</p>
            <div id={actionsId()} class="join-card-actions join-card-actions-single" hidden={!props.openUrl}>
              <Button href={props.openUrl || APP_URL} variant="primary" size="lg" icon="open" onClick={fallback.arm}>
                {props.text.openApp}
              </Button>
            </div>
            <script innerHTML={openLinkScript(actionsId(), props.provider, provider())} />
          </>
        }
      >
        {(failed) => (
          <>
            <h1 id={titleId()}>{props.text.failedTitle}</h1>
            <p class="join-card-error" role="alert">
              {props.text.failure[failed()]}
            </p>
            <div class="join-card-actions">
              <Show
                when={failed() === "tabClosed"}
                fallback={
                  <>
                    <Button href={APP_URL} variant="primary" size="lg" icon="open" onClick={fallback.arm}>
                      {props.text.tryAgainApp}
                    </Button>
                    <Button href={WEB_CLIENT_URL} variant="secondary" size="lg" icon="arrow-right">
                      {props.text.tryAgainBrowser}
                    </Button>
                  </>
                }
              >
                <Button href={WEB_CLIENT_URL} variant="primary" size="lg" icon="arrow-right">
                  {props.text.tryAgainBrowser}
                </Button>
                <Button href={APP_URL} variant="secondary" size="lg" icon="open" onClick={fallback.arm}>
                  {props.text.tryAgainApp}
                </Button>
              </Show>
            </div>
            <p class="join-card-note">{props.text.restartHint}</p>
          </>
        )}
      </Show>
      <OpenAppFallbackDialog fallback={fallback} text={props.text.openAppFallback} />
    </TransactionalPage>
  );
}
