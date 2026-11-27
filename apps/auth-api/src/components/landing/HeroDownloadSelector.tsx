import { PlatformLogo } from "@openbot/brand";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { landingAnalytics } from "../../lib/analytics";
import { ANDROID_APK_AVAILABLE } from "../../lib/android-apk";
import {
  DOWNLOAD_PLATFORM_ORDER,
  DOWNLOAD_PLATFORMS,
  type DownloadPlatform,
  detectDownloadPlatform,
} from "../../lib/download-platforms";
import { EXTERNAL_LINK_REL, OPENBOT_ALTERNATE_DOWNLOAD_LINKS, OPENBOT_ANDROID_APK_LINK } from "../../lib/landing-links";
import type { LandingPageText } from "../../lib/landing-page-text";
import { detectMobilePlatform, MOBILE_APP_ORDER, MOBILE_APPS, type MobilePlatform } from "../../lib/mobile-apps";
import { LandingIcon } from "./LandingIcon";
import { useLandingText } from "./LandingText";

const ANDROID_APK = "android-apk";

const MAC_INTEL = "macos-intel";

type HeroPlatform = DownloadPlatform | MobilePlatform | typeof ANDROID_APK | typeof MAC_INTEL;

const HERO_DESKTOP_APPS: readonly HeroPlatform[] = DOWNLOAD_PLATFORM_ORDER.flatMap<HeroPlatform>((platform) =>
  platform === "macos" ? [platform, MAC_INTEL] : [platform],
);
const MAC_SILICON_LABEL = "macOS · Apple silicon";
const MAC_INTEL_LABEL = "macOS · Intel";

const HERO_PHONE_APPS: readonly HeroPlatform[] = ANDROID_APK_AVAILABLE
  ? [...MOBILE_APP_ORDER, ANDROID_APK]
  : MOBILE_APP_ORDER;
const ANDROID_PLAY_LABEL = "Android · Google Play";
const ANDROID_APK_LABEL = "Android · APK";

function heroSystem(platform: HeroPlatform): DownloadPlatform | MobilePlatform {
  if (platform === ANDROID_APK) return "android";
  if (platform === MAC_INTEL) return "macos";
  return platform;
}

interface HeroOffer {
  action: string;
  href?: string;
  label: string;
  status: string;
  external: boolean;
}

function heroOffer(platform: HeroPlatform, text: LandingPageText): HeroOffer {
  const { apk, available, desktop, intelMac, phone } = text.download;
  if (platform === MAC_INTEL)
    return {
      label: MAC_INTEL_LABEL,
      action: intelMac,
      href: OPENBOT_ALTERNATE_DOWNLOAD_LINKS.macos,
      status: available,
      external: false,
    };
  if (platform === ANDROID_APK)
    return {
      label: ANDROID_APK_LABEL,
      action: apk,
      href: OPENBOT_ANDROID_APK_LINK,
      status: available,
      external: false,
    };
  if (platform === "ios" || platform === "android") {
    const label = platform === "android" && ANDROID_APK_AVAILABLE ? ANDROID_PLAY_LABEL : MOBILE_APPS[platform].label;
    return { ...MOBILE_APPS[platform], ...phone[platform], label, status: available, external: true };
  }
  const { href, ...details } = DOWNLOAD_PLATFORMS[platform];
  if (!details.available || !href) return { ...details, external: false };
  const label = platform === "macos" ? MAC_SILICON_LABEL : details.label;
  return { ...details, label, action: desktop[platform], status: available, href, external: false };
}

interface HeroMenuItemProps {
  platform: HeroPlatform;
  selected: boolean;
  onSelect: () => void;
}

function HeroMenuItem(props: HeroMenuItemProps) {
  const text = useLandingText();
  const offer = () => heroOffer(props.platform, text());
  return (
    <Show
      when={offer().href}
      fallback={
        <button
          class="landing-download-menu-item"
          type="button"
          role="menuitem"
          data-state="coming-soon"
          data-selected={props.selected ? "true" : undefined}
          onClick={() => props.onSelect()}
        >
          <PlatformLogo platform={heroSystem(props.platform)} />
          <span>{offer().label}</span>
          <small>{offer().status}</small>
        </button>
      }
    >
      {(href) => (
        <a
          class="landing-download-menu-item"
          href={href()}
          target={offer().external ? "_blank" : undefined}
          rel={offer().external ? EXTERNAL_LINK_REL : undefined}
          role="menuitem"
          data-state="available"
          data-selected={props.selected ? "true" : undefined}
          onClick={() => props.onSelect()}
        >
          <PlatformLogo platform={heroSystem(props.platform)} />
          <span>{offer().label}</span>
          <small>{offer().status}</small>
        </a>
      )}
    </Show>
  );
}

export function HeroDownloadSelector() {
  const menuId = createUniqueId();
  const text = useLandingText();
  const [platform, setPlatform] = createSignal<HeroPlatform>("macos");
  const [open, setOpen] = createSignal(false);
  let root: HTMLDivElement | undefined;
  let trigger: HTMLButtonElement | undefined;

  const current = () => heroOffer(platform(), text());
  const menuItems = () => Array.from(root?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  function closeMenu(restoreFocus = false): void {
    setOpen(false);
    if (restoreFocus) trigger?.focus();
  }

  function openMenu(focus: "first" | "last" | false = false): void {
    setOpen(true);
    if (!focus) return;
    queueMicrotask(() => {
      const items = menuItems();
      (focus === "first" ? items[0] : items.at(-1))?.focus();
    });
  }

  function selectPlatform(nextPlatform: HeroPlatform): void {
    setPlatform(nextPlatform);
    landingAnalytics.trackDownloadSelected(heroSystem(nextPlatform), false);
    closeMenu(true);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && open()) {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    if (event.target === trigger && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openMenu(event.key === "ArrowDown" ? "first" : "last");
      return;
    }

    if (!open() || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = menuItems();
    const activeElement = document.activeElement;
    const activeIndex = activeElement instanceof HTMLElement ? items.indexOf(activeElement) : -1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    event.preventDefault();
    items[nextIndex]?.focus();
  }

  onSettled(() => {
    const detected = detectMobilePlatform(globalThis.navigator) ?? detectDownloadPlatform(globalThis.navigator);
    if (detected) {
      setPlatform(detected);
      landingAnalytics.trackDownloadSelected(detected, true);
    }

    const handleOutsidePointer = (event: PointerEvent) => {
      if (open() && event.target instanceof Node && !root?.contains(event.target)) closeMenu();
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => document.removeEventListener("pointerdown", handleOutsidePointer);
  });

  return (
    <div
      ref={root}
      class="landing-download-selector"
      data-detected-platform={platform()}
      data-open={open() ? "true" : "false"}
    >
      <div class="landing-download-split">
        <Show
          when={current().href}
          fallback={
            <span class="landing-download-primary" data-state="coming-soon" aria-disabled="true">
              <PlatformLogo platform={heroSystem(platform())} solid />
              {current().action}
            </span>
          }
        >
          {(href) => (
            <a
              class="landing-download-primary"
              href={href()}
              target={current().external ? "_blank" : undefined}
              rel={current().external ? EXTERNAL_LINK_REL : undefined}
              data-state="available"
            >
              <PlatformLogo platform={heroSystem(platform())} solid />
              {current().action}
            </a>
          )}
        </Show>
        <button
          ref={trigger}
          class="landing-download-trigger"
          type="button"
          aria-label={text().hero.choosePlatform}
          aria-haspopup="menu"
          aria-expanded={open() ? "true" : "false"}
          aria-controls={menuId}
          onClick={() => (open() ? closeMenu() : openMenu())}
          onKeyDown={handleKeyDown}
        >
          <LandingIcon name="chevron-down" />
        </button>
      </div>

      <Show when={open()}>
        <div
          id={menuId}
          class="landing-download-menu"
          role="menu"
          aria-label={text().hero.platforms}
          onKeyDown={handleKeyDown}
        >
          <For each={HERO_DESKTOP_APPS}>
            {(menuPlatform) => (
              <HeroMenuItem
                platform={menuPlatform}
                selected={platform() === menuPlatform}
                onSelect={() => selectPlatform(menuPlatform)}
              />
            )}
          </For>
          <hr class="landing-download-menu-separator" />
          <span class="landing-download-menu-label" aria-hidden="true">
            {text().hero.phoneApps}
          </span>
          <For each={HERO_PHONE_APPS}>
            {(menuPlatform) => (
              <HeroMenuItem
                platform={menuPlatform}
                selected={platform() === menuPlatform}
                onSelect={() => selectPlatform(menuPlatform)}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
