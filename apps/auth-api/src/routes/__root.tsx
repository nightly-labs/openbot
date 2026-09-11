import interLatinFont from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import type { JSX } from "@solidjs/web";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/solid-router";
import "@openbot/brand/logo.css";
import "../styles.css";
import { PageError } from "../components/landing/PageError";
import { servingSiteUrl } from "../lib/serving-site-url";
import { OPENBOT_SECURITY_HEADERS, openBotRootHead } from "../lib/site-metadata";

export const Route = createRootRoute({
  beforeLoad: () => ({ siteUrl: servingSiteUrl() }),
  head: () => openBotRootHead(interLatinFont),
  headers: () => OPENBOT_SECURITY_HEADERS,
  component: RootComponent,
  shellComponent: RootDocument,
  errorComponent: () => <PageError onRetry={() => window.location.reload()} />,
  notFoundComponent: () => <PageError notFound onRetry={() => window.location.reload()} />,
});

function RootComponent() {
  return <Outlet />;
}

function RootDocument(props: { children: JSX.Element }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {props.children}
        <Scripts />
      </body>
    </html>
  );
}
