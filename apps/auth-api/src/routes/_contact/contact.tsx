import { createFileRoute } from "@tanstack/solid-router";
import { contactPageText } from "../../components/contact/contact-page-text";
import { CONTACT_ROUTE, CONTACT_SOCIAL_IMAGE_PATH } from "../../lib/contact";
import { loadSitePage, siteLocale } from "../../lib/site-locale";
import { sitePageHead } from "../../lib/site-page-head";

// The contact page in the language of the request: Polish for Polish, Brazilian Portuguese for
// Portuguese, English for all others. `/pl/contact` always shows Polish, and `/pt/contact` Portuguese.
export const Route = createFileRoute("/_contact/contact")({
  loader: ({ context }) => loadSitePage(siteLocale(context.locale), contactPageText),
  head: ({ match, loaderData }) => {
    if (!loaderData)
      return { links: [{ rel: "canonical", href: new URL(CONTACT_ROUTE, match.context.siteUrl).toString() }] };
    return sitePageHead(match.context.siteUrl, {
      page: CONTACT_ROUTE,
      path: CONTACT_ROUTE,
      locale: loaderData.site.locale,
      title: loaderData.text.title,
      description: loaderData.text.description,
      image: { path: CONTACT_SOCIAL_IMAGE_PATH, alt: loaderData.text.imageAlt },
    });
  },
});
