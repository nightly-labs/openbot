import { createFileRoute } from "@tanstack/solid-router";
import { contactPageText } from "../../../components/contact/contact-page-text";
import { CONTACT_ROUTE, CONTACT_SOCIAL_IMAGE_PATH } from "../../../lib/contact";
import { loadSitePage } from "../../../lib/site-locale";
import { sitePageHead } from "../../../lib/site-page-head";
import { LOCALIZED_PAGE_PATHS } from "../../../lib/site-paths";

// The contact page in Polish, whatever the language of the request.
export const Route = createFileRoute("/_contact/pl/contact")({
  loader: () => loadSitePage("pl", contactPageText),
  head: ({ match, loaderData }) => {
    const path = LOCALIZED_PAGE_PATHS.pl[CONTACT_ROUTE];
    if (!loaderData) return { links: [{ rel: "canonical", href: new URL(path, match.context.siteUrl).toString() }] };
    return sitePageHead(match.context.siteUrl, {
      page: CONTACT_ROUTE,
      path,
      locale: "pl",
      title: loaderData.text.title,
      description: loaderData.text.description,
      image: { path: CONTACT_SOCIAL_IMAGE_PATH, alt: loaderData.text.imageAlt },
    });
  },
});
