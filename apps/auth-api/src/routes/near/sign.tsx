import { createFileRoute } from "@tanstack/solid-router";
import { NearSignPage } from "../../components/transactional/NearSignPage";
import { nearSignText } from "../../components/transactional/page-text";
import { nearSignHeaders } from "../../lib/near-sign-csp";
import { loadPageText } from "../../lib/page-text";

export const Route = createFileRoute("/near/sign")({
  loader: ({ context }) => loadPageText(context.locale, nearSignText),
  head: ({ loaderData }) => ({
    meta: [
      ...(loaderData ? [{ title: loaderData.text.pageTitle }] : []),
      { name: "robots", content: "noindex, nofollow, noarchive" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  headers: ({ ssr }) => nearSignHeaders(ssr?.nonce),
  component: NearSign,
});

function NearSign() {
  const page = Route.useLoaderData();
  return <NearSignPage lang={page().lang} text={page().text} />;
}
