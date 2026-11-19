import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { createFileRoute } from "@tanstack/solid-router";
import { ReportSitePage } from "../components/report-site/ReportSitePage";
import { reportSiteText } from "../components/transactional/page-text";
import { loadPageText } from "../lib/page-text";

export const Route = createFileRoute("/report-site")({
  validateSearch: (value) => ({
    hostname: isDynamicRecord(value) && isString(value.hostname) ? value.hostname : "",
  }),
  loader: ({ context }) => loadPageText(context.locale, reportSiteText),
  head: ({ loaderData }) => ({
    meta: [
      ...(loaderData ? [{ title: loaderData.text.pageTitle }] : []),
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ReportSite,
});

function ReportSite() {
  const search = Route.useSearch();
  const page = Route.useLoaderData();
  return <ReportSitePage hostname={search().hostname} lang={page().lang} text={page().text} />;
}
