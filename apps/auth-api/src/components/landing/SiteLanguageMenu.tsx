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
                {appLanguageOption(item).label}
                <Show when={item === locale()}>
                  <LandingIcon name="check" />
                </Show>
              </a>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
