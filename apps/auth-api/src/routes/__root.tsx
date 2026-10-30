import interLatinFont from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import type { JSX } from "@solidjs/web";
import { createRootRoute, type ErrorComponentProps, HeadContent, Outlet, Scripts } from "@tanstack/solid-router";
import { createSignal, onSettled, Show } from "solid-js";
import "@openbot/brand/logo.css";
import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import "../styles.css";
import { NotFoundPage } from "../components/landing/NotFoundPage";
import { PageError } from "../components/landing/PageError";
import { type RootPageText, rootPageText } from "../components/transactional/page-text";
import { loadPageText, type PageText } from "../lib/page-text";
import { requestLocale } from "../lib/request-locale";
import { servingSiteUrl } from "../lib/serving-site-url";
import { OPENBOT_SECURITY_HEADERS, openBotRootHead } from "../lib/site-metadata";

const NOT_FOUND_TITLE = "Page not found · OpenBot";

export const Route = createRootRoute({
  beforeLoad: () => ({ siteUrl: servingSiteUrl(), locale: requestLocale() }),
  // The error page text, in the language of the request. The server loads it once per document, and
  // the browser reads it from the loader data.
  loader: ({ context }) => loadPageText(context.locale, rootPageText),
  shouldReload: false,
  // The router marks the match that shows the global 404 with `_notFound`. That page has no route of
  // its own, so the root head gives it its title. A child route's own title still wins. The 404 page
  // is English only, so its title is English too.
  head: ({ matches }) => {
    const head = openBotRootHead(interLatinFont);
    if (!matches.some((match) => match._notFound)) return head;
    return { ...head, meta: head.meta.map((tag) => ("title" in tag ? { title: NOT_FOUND_TITLE } : tag)) };
  },
  // The HTML holds catalog text in the language of `Accept-Language`, so a cache must keep it apart.
  headers: () => ({ ...OPENBOT_SECURITY_HEADERS, Vary: "Accept-Language" }),
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
  const [fallback, setFallback] = createSignal<PageText<RootPageText>>();
  onSettled(() => {
    if (!loaded()) void loadPageText("en", rootPageText).then(setFallback);
  });
  return (
    <Show when={loaded() ?? fallback()}>
      {(page) => <PageError lang={page().lang} text={page().text.error} onRetry={() => window.location.reload()} />}
    </Show>
  );
}

const NO_SCRIPT_STYLE = "<style>[data-revealed=false],[data-revealed=false] *{opacity:1!important}</style>";

function RootDocument(props: { children: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        {/* Text waits at opacity 0 for a script to reveal it. Without scripts,
            show it as it is, so the page can still be read. */}
        <noscript innerHTML={NO_SCRIPT_STYLE} />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}
