import interLatinFont from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import type { JSX } from "@solidjs/web";
import { createRootRoute, type ErrorComponentProps, HeadContent, Outlet, Scripts } from "@tanstack/solid-router";
import { createSignal, onSettled, Show } from "solid-js";
import "@openbot/brand/logo.css";
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
  // The error page text, in the language of the request, and the English header and footer of the
  // pages that are in English only. The server loads them once per document, and the browser reads
  // them from the loader data.
  loader: async ({ context }) => {
    const [page, site] = await Promise.all([loadPageText(context.locale, rootPageText), loadSiteChrome("en")]);
    return { ...page, site };
  },
  shouldReload: false,
  // The router marks the match that shows the global 404 with `_notFound`. That page has no route of
  // its own, so the root head gives it its title. A child route's own title still wins. The 404 page
  // is English only, so its title is English too.
  head: ({ matches }) => {
    const head = openBotRootHead(interLatinFont);
    if (!matches.some((match) => match._notFound)) return head;
    return { ...head, meta: head.meta.map((tag) => ("title" in tag ? { title: NOT_FOUND_TITLE } : tag)) };
  },
  // The HTML holds catalog text in the language of `Accept-Language`, or of the language cookie, so a
  // cache must keep them apart.
  headers: () => ({ ...OPENBOT_SECURITY_HEADERS, Vary: "Accept-Language, Cookie" }),
  component: RootComponent,
  shellComponent: RootDocument,
  errorComponent: RootError,
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  // Runs only in the browser: the server render has no document.
  onSettled(() => installPointerFocusGuard());
  return <Outlet />;
}

/**
 * The load error page. Its text comes from the root loader data. When the root loader itself did not
 * finish, the browser loads the English text, and the page shows when that text is ready.
 */
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
  // The language of the header, the menu and the footer is the language of the page.
  const lang = () => chrome()?.lang ?? "en";
  return (
    <html lang={lang()}>
      <head>
        <HeadContent />
        {/* Text waits at opacity 0 for a script to reveal it. Without scripts,
            show it as it is, so the page can still be read. */}
        <noscript innerHTML={NO_SCRIPT_STYLE} />
      </head>
      <body>
        <SiteTextProvider>{props.children}</SiteTextProvider>
        <Scripts />
      </body>
    </html>
  );
}
