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
        <Match when={STRIPED_FLAGS[props.locale]}>{(bands) => <StripedFlag bands={bands()} />}</Match>
        <Match when={props.locale === "ja"}>
          <svg viewBox="0 0 20 14" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <rect width="20" height="14" fill="#fff" />
            <circle cx="10" cy="7" r="4.2" fill="#bc002d" />
          </svg>
        </Match>
        <Match when={props.locale === "ko"}>
          <KoreaFlag />
        </Match>
        <Match when={props.locale === "tr"}>
          <svg viewBox="0 0 20 14" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <rect width="20" height="14" fill="#e30a17" />
            <circle cx="7.5" cy="7" r="3.5" fill="#fff" />
            <circle cx="8.4" cy="7" r="2.8" fill="#e30a17" />
            <polygon points={starPoints(12.6, 7, 1.6)} fill="#fff" />
          </svg>
        </Match>
        <Match when={props.locale === "zh"}>
          <svg viewBox="0 0 20 14" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <rect width="20" height="14" fill="#ee1c25" />
            <polygon points={starPoints(3.6, 3.6, 2.2)} fill="#ffde00" />
            <For each={CHINA_SMALL_STARS}>
              {(star) => <polygon points={starPoints(star.x, star.y, 0.75)} fill="#ffde00" />}
            </For>
          </svg>
        </Match>
        <Match when={props.locale === "he"}>
          <svg viewBox="0 0 20 14" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <rect width="20" height="14" fill="#fff" />
            <rect y="1.3" width="20" height="2" fill="#0038b8" />
            <rect y="10.7" width="20" height="2" fill="#0038b8" />
            <polygon points="10,4.4 12.2,8.2 7.8,8.2" fill="none" stroke="#0038b8" stroke-width="0.6" />
            <polygon points="10,9.6 12.2,5.8 7.8,5.8" fill="none" stroke="#0038b8" stroke-width="0.6" />
          </svg>
        </Match>
        <Match when={props.locale === "ar"}>
          <LandingIcon name="globe" />
        </Match>
      </Switch>
    </span>
  );
}

interface FlagBand {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

function stripedFlag(
  direction: "horizontal" | "vertical",
  stripes: readonly (readonly [string, number])[],
): FlagBand[] {
  const total = stripes.reduce((sum, [, size]) => sum + size, 0);
  let start = 0;
  return stripes.map(([color, size]) => {
    const offset = start / total;
    const length = size / total;
    start += size;
    return direction === "horizontal"
      ? { x: 0, y: offset, width: 1, height: length, color }
      : { x: offset, y: 0, width: length, height: 1, color };
  });
}

const STRIPED_FLAGS: Partial<Record<SiteLocale, FlagBand[]>> = {
  de: stripedFlag("horizontal", [
    ["#000", 1],
    ["#dd0000", 1],
    ["#ffce00", 1],
  ]),
  es: stripedFlag("horizontal", [
    ["#aa151b", 1],
    ["#f1bf00", 2],
    ["#aa151b", 1],
  ]),
  fr: stripedFlag("vertical", [
    ["#0055a4", 1],
    ["#fff", 1],
    ["#ef4135", 1],
  ]),
  it: stripedFlag("vertical", [
    ["#009246", 1],
    ["#fff", 1],
    ["#ce2b37", 1],
  ]),
  nl: stripedFlag("horizontal", [
    ["#ae1c28", 1],
    ["#fff", 1],
    ["#21468b", 1],
  ]),
  ru: stripedFlag("horizontal", [
    ["#fff", 1],
    ["#0039a6", 1],
    ["#d52b1e", 1],
  ]),
};

function StripedFlag(props: { bands: FlagBand[] }) {
  return (
    <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      <For each={props.bands}>
        {(band) => <rect x={band.x} y={band.y} width={band.width} height={band.height} fill={band.color} />}
      </For>
    </svg>
  );
}

function starPoints(cx: number, cy: number, radius: number): string {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI) / 5;
    const distance = index % 2 === 0 ? radius : radius * 0.4;
    return `${(cx + distance * Math.cos(angle)).toFixed(2)},${(cy + distance * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

const CHINA_SMALL_STARS = [
  { x: 6.6, y: 1.4 },
  { x: 7.8, y: 2.8 },
  { x: 7.8, y: 4.6 },
  { x: 6.6, y: 5.9 },
];

const KOREA_TRIGRAMS = [
  { x: 4.2, y: 3.2, rotate: -56 },
  { x: 15.8, y: 3.2, rotate: 56 },
  { x: 4.2, y: 10.8, rotate: 56 },
  { x: 15.8, y: 10.8, rotate: -56 },
];

function KoreaFlag() {
  return (
    <svg viewBox="0 0 20 14" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="20" height="14" fill="#fff" />
      <g transform="rotate(34 10 7)">
        <path d="M6.6 7 A3.4 3.4 0 0 1 13.4 7 Z" fill="#cd2e3a" />
        <path d="M6.6 7 A3.4 3.4 0 0 0 13.4 7 Z" fill="#0047a0" />
        <circle cx="8.3" cy="7" r="1.7" fill="#cd2e3a" />
        <circle cx="11.7" cy="7" r="1.7" fill="#0047a0" />
      </g>
      <For each={KOREA_TRIGRAMS}>
        {(trigram) => (
          <g transform={`rotate(${trigram.rotate} ${trigram.x} ${trigram.y})`} fill="#000">
            <rect x={trigram.x - 1.2} y={trigram.y - 1.1} width="2.4" height="0.5" />
            <rect x={trigram.x - 1.2} y={trigram.y - 0.25} width="2.4" height="0.5" />
            <rect x={trigram.x - 1.2} y={trigram.y + 0.6} width="2.4" height="0.5" />
          </g>
        )}
      </For>
    </svg>
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
