import { appLanguageOption } from "@openbot/i18n/languages";
import { useLocation } from "@tanstack/solid-router";
import { createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import {
  type EnglishPagePath,
  pagePaths,
  pageWithPolishCopy,
  SITE_LOCALE_COOKIE,
  SITE_LOCALES,
  type SiteLocale,
} from "../../lib/site-paths";
import { LandingIcon } from "./LandingIcon";
import { useSiteChrome } from "./SiteText";

/** One year: the choice stays until the visitor chooses again. */
const LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Keeps the choice, so the English address of a page does not go back to the browser language. */
function rememberLanguage(locale: SiteLocale) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SITE_LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LANGUAGE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

/**
 * The language button of the header, on the pages that have a copy in each language. Each item is a
 * plain link: a full page load gives the server the new choice.
 */
export function SiteLanguageMenu() {
  const location = useLocation();
  const page = () => pageWithPolishCopy(location().pathname);
  return <Show when={page()}>{(current) => <LanguageMenu page={current()} />}</Show>;
}

function LanguageMenu(props: { page: EnglishPagePath }) {
  const chrome = useSiteChrome();
  const listId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  let menu: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;
  const locale = () => chrome().locale;
  const text = () => chrome().text.language;

  onSettled(() => {
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
                hreflang={item}
                lang={item}
                aria-current={item === locale() ? "page" : undefined}
                onClick={() => rememberLanguage(item)}
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

/**
 * The flag of the usual country of each language, as in the app's language selector. It is drawn,
 * not an emoji: Windows shows a flag emoji as two letters.
 */
function LanguageFlag(props: { locale: SiteLocale }) {
  return (
    <span class="site-language-flag">
      <Show when={props.locale === "pl"} fallback={<UnitedStatesFlag />}>
        <svg viewBox="0 0 16 10" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <rect width="16" height="5" fill="#fff" />
          <rect y="5" width="16" height="5" fill="#dc143c" />
        </svg>
      </Show>
    </span>
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
