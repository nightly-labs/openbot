import interLatinFont from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import type { JSX } from "@solidjs/web";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/solid-router";
import { onSettled } from "solid-js";
import "@openbot/brand/logo.css";
import { installPointerFocusGuard } from "@openbot/ui/pointer-focus";
import "../styles.css";
import { NotFoundPage } from "../components/landing/NotFoundPage";
import { PageError } from "../components/landing/PageError";
import { servingSiteUrl } from "../lib/serving-site-url";
import { OPENBOT_SECURITY_HEADERS, openBotRootHead } from "../lib/site-metadata";

export const Route = createRootRoute({
  beforeLoad: () => ({ siteUrl: servingSiteUrl() }),
  head: () => openBotRootHead(interLatinFont),
  headers: () => OPENBOT_SECURITY_HEADERS,
  component: RootComponent,
  shellComponent: RootDocument,
  errorComponent: (props) => {
    console.error(props.error);
    return <PageError onRetry={() => window.location.reload()} />;
  },
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  // Runs only in the browser: the server render has no document.
  onSettled(() => installPointerFocusGuard());
  return <Outlet />;
}

const NO_SCRIPT_STYLE =
  "<style>.t-stagger-line{opacity:1;transform:none;filter:none}[data-revealed=false],[data-revealed=false] *{opacity:1!important}</style>";

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
