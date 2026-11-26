import {
  type BrowserLogoVariant,
  type MobilePlatformLogoVariant,
  PlatformLogo,
  type PlatformLogoVariant,
} from "@openbot/brand";
import type { JSX } from "@solidjs/web";
import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { ANDROID_APK_AVAILABLE } from "../../lib/android-apk";
import { CHROME_EXTENSION } from "../../lib/browser-extension";
import { DOWNLOAD_PLATFORM_ORDER, DOWNLOAD_PLATFORMS } from "../../lib/download-platforms";
import { EXTERNAL_LINK_REL, OPENBOT_ALTERNATE_DOWNLOAD_LINKS, OPENBOT_ANDROID_APK_LINK } from "../../lib/landing-links";
import { MOBILE_APP_ORDER, MOBILE_APPS } from "../../lib/mobile-apps";
import { createLandingReveal } from "./createLandingReveal";
import { LandingIcon } from "./LandingIcon";
import { useLandingText } from "./LandingText";

interface DownloadCardContentProps {
  action?: string;
  actions?: JSX.Element;
  description: string;
  platform: PlatformLogoVariant | MobilePlatformLogoVariant | BrowserLogoVariant;
  status: string;
  title: string;
}

function DownloadCardContent(props: DownloadCardContentProps) {
  return (
    <>
      <div class="landing-download-card-top">
        <PlatformLogo platform={props.platform} class="landing-download-platform-logo" />
        <span class="landing-download-status">{props.status}</span>
      </div>
      <div class="landing-download-card-copy">
        <h3>{props.title}</h3>
        <p>{props.description}</p>
        <Show
          when={props.actions}
          fallback={
            <Show when={props.action}>
              <span class="landing-download-action">
                {props.action}
                <LandingIcon name="arrow-up-right" class="landing-download-arrow" />
              </span>
            </Show>
          }
        >
          {(actions) => <div class="landing-download-actions">{actions()}</div>}
        </Show>
      </div>
    </>
  );
}

export function DownloadSection() {
  let sectionRef: HTMLElement | undefined;
  const revealed = createLandingReveal(() => sectionRef);
  const revealState = () => (revealed() ? "true" : "false");
  const landing = useLandingText();
  const text = () => landing().download;
  const macos = DOWNLOAD_PLATFORMS.macos;
  const windows = DOWNLOAD_PLATFORMS.windows;
  const linux = DOWNLOAD_PLATFORMS.linux;

  return (
    <section ref={sectionRef} id="download" class="landing-download" aria-labelledby="download-title">
      <div class="landing-download-inner">
        <header class="landing-download-heading" data-revealed={revealState()}>
          <h2 id="download-title">{text().title}</h2>
          <p>{text().description}</p>
        </header>

        <div class="landing-download-grid">
          <div
            class="landing-download-card"
            data-download-platform="macos"
            data-state="available"
            data-revealed={revealState()}
          >
            <DownloadCardContent
              platform="macos"
              status={text().available}
              title={macos.label}
              description={macos.description}
              actions={
                <>
                  <a class="landing-download-action landing-download-card-link" href={macos.href}>
                    {text().desktop.macos}
                    <LandingIcon name="arrow-up-right" class="landing-download-arrow" />
                  </a>
                  <a
                    class="landing-download-action landing-download-action-alternate"
                    href={OPENBOT_ALTERNATE_DOWNLOAD_LINKS.macos}
                  >
                    {text().intelMac}
                    <LandingIcon name="download" class="landing-download-action-icon" />
                  </a>
                </>
              }
            />
          </div>

          <a
            class="landing-download-card"
            href={windows.href}
            data-download-platform="windows"
            data-state="available"
            data-revealed={revealState()}
          >
            <DownloadCardContent
              platform="windows"
              status={text().available}
              title={windows.label}
              description={windows.description}
              action={text().desktop.windows}
            />
          </a>

          <a
            class="landing-download-card"
            href={linux.href}
            data-download-platform="linux"
            data-state="available"
            data-revealed={revealState()}
          >
            <DownloadCardContent
              platform="linux"
              status={text().available}
              title={linux.label}
              description={linux.description}
              action={text().desktop.linux}
            />
          </a>
        </div>

        <div class="landing-download-grid landing-download-grid-mobile">
          <For each={MOBILE_APP_ORDER}>
            {(platform) => {
              const app = MOBILE_APPS[platform];
              if (platform === "android" && ANDROID_APK_AVAILABLE)
                return (
                  <div
                    class="landing-download-card"
                    data-download-platform={platform}
                    data-state="available"
                    data-revealed={revealState()}
                  >
                    <DownloadCardContent
                      platform={platform}
                      status={text().available}
                      title={app.label}
                      description={text().phone[platform].description}
                      actions={
                        <>
                          <a
                            class="landing-download-action landing-download-card-link"
                            href={app.href}
                            target="_blank"
                            rel={EXTERNAL_LINK_REL}
                          >
                            {text().phone[platform].action}
                            <LandingIcon name="arrow-up-right" class="landing-download-arrow" />
                          </a>
                          <a
                            class="landing-download-action landing-download-action-alternate"
                            href={OPENBOT_ANDROID_APK_LINK}
                          >
                            {text().apk}
                            <LandingIcon name="download" class="landing-download-action-icon" />
                          </a>
                        </>
                      }
                    />
                  </div>
                );
              return (
                <a
                  class="landing-download-card"
                  href={app.href}
                  target="_blank"
                  rel={EXTERNAL_LINK_REL}
                  data-download-platform={platform}
                  data-state="available"
                  data-revealed={revealState()}
                >
                  <DownloadCardContent
                    platform={platform}
                    status={text().available}
                    title={app.label}
                    description={text().phone[platform].description}
                    action={text().phone[platform].action}
                  />
                </a>
              );
            }}
          </For>
          <a
            class="landing-download-card"
            href={CHROME_EXTENSION.href}
            target="_blank"
            rel={EXTERNAL_LINK_REL}
            data-download-platform={CHROME_EXTENSION.id}
            data-state="available"
            data-revealed={revealState()}
          >
            <DownloadCardContent
              platform={CHROME_EXTENSION.id}
              status={text().available}
              title={CHROME_EXTENSION.label}
              description={text().chrome.description}
              action={text().chrome.action}
            />
          </a>
        </div>

        <p class="landing-download-pages">
          {text().pages}
          <For each={DOWNLOAD_PLATFORM_ORDER}>
            {(platform) => (
              <Link to="/download/$platform" params={{ platform }}>
                {DOWNLOAD_PLATFORMS[platform].label}
              </Link>
            )}
          </For>
          <span class="landing-download-pages-mobile">
            <For each={MOBILE_APP_ORDER}>
              {(platform) => (
                <Link to="/download/$platform" params={{ platform }}>
                  {MOBILE_APPS[platform].label}
                </Link>
              )}
            </For>
          </span>
        </p>
      </div>
    </section>
  );
}
