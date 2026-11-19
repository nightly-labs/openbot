import { appLanguageOption } from "@openbot/i18n/languages";
import { useLocation, useRouter } from "@tanstack/solid-router";
import { createSignal, createUniqueId, For, Match, onSettled, Show, Switch } from "solid-js";
import {
  type EnglishPagePath,
  pagePaths,
  pageWithLocalizedCopy,
  SITE_LOCALE_COOKIE,
  SITE_LOCALES,
  type SiteLocale,
  siteHreflang,
} from "../../lib/site-paths";
import { LandingIcon } from "./LandingIcon";
import { useSiteChrome } from "./SiteText";

const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function rememberLanguage(locale: SiteLocale) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SITE_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

let focusMenuAfterChange = false;

export function SiteLanguageMenu() {
  const location = useLocation();
  const page = () => pageWithLocalizedCopy(location().pathname);
  return <Show when={page()}>{(current) => <LanguageMenu page={current()} />}</Show>;
}

function LanguageMenu(props: { page: EnglishPagePath }) {
  const chrome = useSiteChrome();
  const router = useRouter();
  const listId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let menu: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;
  const locale = () => chrome().locale;
  const text = () => chrome().text.language;

  onSettled(() => {
    if (focusMenuAfterChange) {
      focusMenuAfterChange = false;
      button?.focus();
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !open()) return;
      setOpen(false);
      button?.focus();
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  });

  const changeLanguage = (event: MouseEvent, item: SiteLocale) => {
    rememberLanguage(item);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    setOpen(false);
    router.clearCache();
    focusMenuAfterChange = true;
    const href = pagePaths(props.page)[item];
    const change =
      href === withoutTrailingSlash(router.state.location.pathname)
        ? router.invalidate()
        : router.navigate({ href, resetScroll: false });
    void change.finally(() => {
      if (!focusMenuAfterChange || !button?.isConnected) return;
      focusMenuAfterChange = false;
      button.focus();
    });
  };

  return (
    <div ref={menu} class="site-language-menu">
      <button
        ref={button}
        type="button"
        class="landing-button landing-button-secondary landing-button-sm landing-button-glass site-language-trigger"
        aria-label={text().current[locale()]}
        aria-expanded={open() ? "true" : "false"}
        aria-controls={listId}
        onClick={() => setOpen(!open())}
      >
        <LandingIcon name="globe" />
        <span aria-hidden="true">{locale().toUpperCase()}</span>
        <LandingIcon name="chevron-down" />
      </button>
      <ul id={listId} class="site-language-list" aria-label={text().label} hidden={!open()}>
        <For each={SITE_LOCALES}>
          {(item) => (
            <li>
              <a
                href={pagePaths(props.page)[item]}
                hreflang={siteHreflang(item)}
                lang={siteHreflang(item)}
                aria-current={item === locale() ? "page" : undefined}
                onClick={(event) => changeLanguage(event, item)}
              >
                <LanguageFlag locale={item} />
                <span class="site-language-name">{appLanguageOption(item).label}</span>
                <Show when={item === locale()}>
                  <LandingIcon name="check" class="site-language-check" />
                </Show>
              </a>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

function LanguageFlag(props: { locale: SiteLocale }) {
  return (
    <span class="site-language-flag">
      <Switch>
        <Match when={props.locale === "en"}>
          <UnitedStatesFlag />
        </Match>
        <Match when={props.locale === "pl"}>
          <svg viewBox="0 0 16 10" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <rect width="16" height="5" fill="#fff" />
            <rect y="5" width="16" height="5" fill="#dc143c" />
          </svg>
        </Match>
        <Match when={props.locale === "pt"}>
          <BrazilFlag />
        </Match>
      </Switch>
    </span>
  );
}

function BrazilFlag() {
  return (
    <svg viewBox="0 0 20 14" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="20" height="14" fill="#009c3b" />
      <polygon points="10,1.7 18.3,7 10,12.3 1.7,7" fill="#ffdf00" />
      <circle cx="10" cy="7" r="3.5" fill="#002776" />
      <path d="M6.6 6.2 C8.6 5.6 11.4 5.9 13.4 7.4" fill="none" stroke="#fff" stroke-width="0.6" />
    </svg>
  );
}

const US_STRIPES = [0, 2, 4, 6, 8, 10, 12];
const US_STARS = [1, 2.5, 4, 5.5].flatMap((x) => [1.2, 2.8, 4.4].map((y) => ({ x, y })));

function UnitedStatesFlag() {
  return (
    <svg viewBox="0 0 19 13" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="19" height="13" fill="#fff" />
      <For each={US_STRIPES}>{(y) => <rect y={y} width="19" height="1" fill="#b22234" />}</For>
      <rect width="7.6" height="7" fill="#3c3b6e" />
      <For each={US_STARS}>{(star) => <circle cx={star.x + 0.3} cy={star.y} r="0.4" fill="#fff" />}</For>
    </svg>
  );
}
