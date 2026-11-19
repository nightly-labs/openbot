import interLatinFont from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import type { JSX } from "@solidjs/web";
import { createRootRoute, type ErrorComponentProps, HeadContent, Outlet, Scripts } from "@tanstack/solid-router";
import { createSignal, onSettled, Show } from "solid-js";
import "@openbot/brand/logo.css";
import { rememberPromotionCode } from "@openbot/contracts/promotion-code";
import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import "../styles.css";
import { NotFoundPage } from "../components/landing/NotFoundPage";
import { PageError } from "../components/landing/PageError";
import { SiteTextProvider, useRouteSiteChrome } from "../components/landing/SiteText";
import { type RootPageText, rootPageText } from "../components/transactional/page-text";
import { loadPageText, type PageText } from "../lib/page-text";
import { requestLocale } from "../lib/request-locale";
import { servingSiteUrl } from "../lib/serving-site-url";
import { loadSiteChrome } from "../lib/site-locale";
import { OPENBOT_SECURITY_HEADERS, openBotRootHead } from "../lib/site-metadata";
import type { SiteChrome } from "../lib/site-text";

const NOT_FOUND_TITLE = "Page not found · OpenBot";

export const Route = createRootRoute({
  beforeLoad: () => ({ siteUrl: servingSiteUrl(), locale: requestLocale() }),
  loader: async ({ context }) => {
    const [page, site] = await Promise.all([loadPageText(context.locale, rootPageText), loadSiteChrome("en")]);
    return { ...page, site };
  },
  shouldReload: false,
  head: ({ matches }) => {
    const head = openBotRootHead(interLatinFont);
    if (!matches.some((match) => match._notFound)) return head;
    return { ...head, meta: head.meta.map((tag) => ("title" in tag ? { title: NOT_FOUND_TITLE } : tag)) };
  },
  headers: () => ({ ...OPENBOT_SECURITY_HEADERS, Vary: "Accept-Language, Cookie" }),
  component: RootComponent,
  shellComponent: RootDocument,
  errorComponent: RootError,
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  onSettled(() => installPointerFocusGuard());
  onSettled(() => rememberPromotionCode(() => window.localStorage, window.location.href, Date.now()));
  return <Outlet />;
}

function RootError(props: ErrorComponentProps) {
  console.error(props.error);
  const loaded = Route.useMatch({ select: (match) => match.loaderData });
  const [fallback, setFallback] = createSignal<PageText<RootPageText> & { site: SiteChrome }>();
  onSettled(() => {
    if (loaded()) return;
    void Promise.all([loadPageText("en", rootPageText), loadSiteChrome("en")]).then(([page, site]) =>
      setFallback({ ...page, site }),
    );
  });
  return (
    <Show when={loaded() ?? fallback()}>
      {(page) => (
        <SiteTextProvider chrome={page().site}>
          <PageError lang={page().lang} text={page().text.error} onRetry={() => window.location.reload()} />
        </SiteTextProvider>
      )}
    </Show>
  );
}

const NO_SCRIPT_STYLE = "<style>[data-revealed=false],[data-revealed=false] *{opacity:1!important}</style>";

function RootDocument(props: { children: JSX.Element }) {
  const chrome = useRouteSiteChrome();
  const lang = () => chrome()?.lang ?? "en";
  return (
    <html lang={lang()}>
      <head>
        <HeadContent />
        <noscript innerHTML={NO_SCRIPT_STYLE} />
      </head>
      <body>
        <SiteTextProvider>{props.children}</SiteTextProvider>
        <Scripts />
      </body>
    </html>
  );
}
